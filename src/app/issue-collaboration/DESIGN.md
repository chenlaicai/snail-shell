# Issue Collaboration 设计

## 定位

app 层业务编排，串联 issue、message、snail、sop、lite-ai 五个 domain，实现“人类与 AI Agent 在 Stage 中协作完成工作”的完整场景。

`issue-collaboration` 是 **Issue 对话运行态的唯一中枢**：

- IM/Web 只负责输入适配和输出展示
- `app/im-hub` 负责组合 `domain/im` 与 `issue-collaboration`
- `domain/im` 只负责协议适配、lobby 导航、去重、channel 出站能力，不依赖 app 层
- Issue/Stage/Message/Snail domain 只提供领域能力
- Stage 内的消息路由、Agent 调用、并行协作、上下文提取、Stage 转换建议都由本模块编排

通过 **输入/输出端口** 与外部消费者（Web、IM）解耦。issue-collaboration 不依赖 IM/Web domain，只认识 `CollaborationConsumer` 接口。

---

## 已确认业务决策

1. **多角色并行是核心场景** — 设计必须天然支持多个角色在同一轮协作中并行响应，不能先设计成单 Agent 串行模型再硬靠并行。
2. **消息分别展示** — 每个角色响应都是独立 `Message`，前端/IM 按消息分别流式展示，不聚合成一个“协作总输出”。
3. **用户消息默认路由优先级** — 显式 mention > 最近响应的 Agent 角色 > `stage.default_role_instance`。
4. **Agent 可以互相 @** — Agent 回复中 @其他角色会创建对应 call signal，触发下一轮协作。
5. **Stage 转换由 Agent 评估、用户确认** — Transition 信息必须注入 Agent 上下文，Agent 可提出建议，但系统永不自动推进 Stage。
6. **Transition 检测结构化优先** — MCP/结构化信号优先，文本检测只作为兜底。
7. **launchIssue 属于本模块** — 它创建的是可协作的 Stage 运行态，不是单纯 domain CRUD。

---

## 端口定义

### 输入端口 — 外部 → issue-collaboration

```typescript
interface CollaborationInput {
  /** 启动 Issue 的第一个 Stage，并可选投递初始消息 */
  launchIssue(input: LaunchIssueInput): Promise<Stage>;

  /** 用户或外部入口向 stage 发送消息；异步触发协作循环，调用方不等待 Agent 完成 */
  sendMessage(stageId: string, text: string, fromSpeaker?: string): Promise<void>;

  /** 注册消费者（stage 维度，事件 fanout） */
  registerConsumer(stageId: string, consumer: CollaborationConsumer): void;

  /** 注销消费者 */
  unregisterConsumer(stageId: string, consumer: CollaborationConsumer): void;

  /** 用户确认 Stage 转换建议后推进 Stage */
  advanceStage(stageId: string, targetKey: string, snailAssignments: Record<string, string>): Promise<Stage>;
}
```

### 输出端口 — issue-collaboration → 外部

```typescript
interface CollaborationConsumer {
  /** Agent message 已创建，消费者可创建流式占位 */
  onMessageStarted?(stageId: string, message: Message): void | Promise<void>;

  /** Agent 产生流式事件 */
  onEvent(stageId: string, event: MessageEvent): void | Promise<void>;

  /** 消息完成（含最终上下文） */
  onMessageCompleted(stageId: string, message: Message, context: MessageContext | null): void | Promise<void>;

  /** Agent 呼叫用户 */
  onUserCalled(stageId: string, message: Message): void | Promise<void>;

  /** Agent 提出 Stage 转换建议 */
  onStageTransitionSuggested?(stageId: string, suggestion: StageTransitionSuggestion): void | Promise<void>;
}
```

### 调用关系

```
Web ──sendMessage──→ issue-collaboration ──onEvent/onCompleted──→ WebConsumer (WebSocket)
IM  ──sendMessage──→ issue-collaboration ──onEvent/onCompleted──→ IMConsumer (sendText/patchText)
```

Web 和 IM 都是输入方（调 sendMessage）和输出方（实现 CollaborationConsumer）。issue-collaboration 不关心背后是哪个平台。

---

## 核心模型

### StageQueue

- 同一 `stageId` 的协作循环只能有一个 drain 过程运行，防止 call signal、cursor、message status 竞态。
- 队列只串行化 **stage 状态推进**，不禁止同一轮内多个角色并行调用。
- 不同 Stage 可以并行运行。

### CallSignal

- `CallSignal(stageId, targetSpeaker)` 表示某个 speaker 需要读取未读消息并响应。
- CallSignal 是持久化协作触发器，重启后可恢复。
- 用户、Agent、系统都不直接调用下一个角色，只创建 call signal。

### ReadCursor

- 每个 speaker 一个 cursor。
- 未读消息 = `message.id > cursor`。
- 调用某个 speaker 前先读取 unread，再把 cursor 推进到本批 unread 的最后一条，避免并发重复消费。

### RoleSnailAssignment

- 每个 role instance 当前绑定一个 snail。
- `snail_instance_id === null` 表示首次调用该 role instance，需要 `snail.invokeFirstCall`。
- `snail_instance_id !== null` 表示恢复调用，需要 `snail.invokeResume`。
- 切换 snail 通过 append-only `seq + 1` 表示交接链。

### StageTransitionSuggestion

- Agent 输出的 Stage 转换建议是独立业务对象。
- 建议包含：来源消息、目标 stage、理由、guard/artifact 评估结果。
- 建议只通知用户确认，不自动执行。

---

## 业务场景

### 场景 1：启动 Issue（launchIssue）

```
输入：{ issue_id, stage_key?, snail_assignments, initial_message? }

1. issuePort.findIssue(issueId) → 校验存在
2. 确定 stage_key：默认 SOP 第一个 stage，或使用输入 stage_key
3. stagePort.previewStage(issueId, stageKey) → 获取 stage 定义 + role instances
4. 校验 snail_assignments 覆盖所有 role_instance
5. stagePort.createStage({ issue_id, key, snail_assignments })
   → 创建 stage + 初始 RoleSnailAssignment（seq=0）
6. messagePort.initCursor(stageId, speaker)
   → 为每个 role_instance + "user" 初始化游标
7. 如果有 initial_message:
   → sendMessage(stageId, initial_message, "user")
```

### 场景 2：用户发送消息（sendMessage）

```
输入：stageId, text, fromSpeaker = "user"

1. 解析 to_speakers
   → 有显式 mention → 使用 mention
   → 无 mention → 查最近响应的 speaker
   → 仍无 → stage.default_role_instance
2. createMessage({ stage_id, from_speaker: fromSpeaker, to_speakers, status: "completed" })
3. setContext(messageId, "final_text", text)
4. 对每个 to_speaker（非 "user"）→ createCallSignal(stageId, to_speaker)
5. enqueueDrain(stageId)  // 异步，调用方不等待 Agent 完成
```

### 场景 3：协作循环（collaborationLoop）

```
输入：stageId

remainingRounds = maxCollaborationRounds

while (remainingRounds > 0) {
  signals = messagePort.getCallSignals(stageId)
  if (signals.length === 0) break

  groups = groupBy(signals, s => s.target_speaker)

  // 同一轮内，不同 Agent 角色并行调用
  settled = await Promise.allSettled(groups.map(async ([speaker, group]) => {
    if (speaker === "user") {
      messagePort.deleteCallSignal(stageId, "user")
      notifyConsumers(stageId, "onUserCalled", latestMessage)
      return "user-called"
    }

    unread = messagePort.getUnreadMessages(stageId, speaker)
    messagePort.deleteCallSignal(stageId, speaker)

    if (unread.length === 0) return "no-unread"

    messagePort.advanceCursor(stageId, speaker, unread[unread.length - 1].id)
    await invokeAgent(stageId, speaker, unread)
    return "agent-called"
  }))

  remainingRounds -= count(settled where result === "agent-called")
}

if (remainingRounds <= 0) forceWrapUp(stageId)
```

### 场景 4：调用 Agent（invokeAgent）

```
输入：stageId, roleInstance, unreadMessages

1. 解析上下文
   → stage = stagePort.findStage(stageId)
   → issue = issuePort.findIssue(stage.issue_id)
   → assignment = stagePort.getRoleSnailAssignment(stageId, roleInstance)
   → handbook = stagePort.getRoleHandbook(stageId, assignment.role_key)

2. 构建 Agent 上下文
   → system-reminder 注入：
     - issue / stage 基本信息
     - 当前 role instance 与 role handbook
     - stage.available_transitions
     - transition guard 要求
     - stage.output_artifacts
     - “可建议但不可自动推进 Stage”的规则

3. 首次 vs 后续调用
   → assignment.snail_instance_id === null：snail.invokeFirstCall(assignment.snail_key, request)
   → 否则：snail.invokeResume(assignment.snail_instance_id, request)

4. 创建 agent message
   → createMessage({ stage_id, from_speaker: roleInstance, to_speakers: [], status: "streaming" })
   → notifyConsumers(stageId, "onMessageStarted", message)

5. 流式事件处理
   → appendEvent(messageId, payload)
   → notifyConsumers(stageId, "onEvent", event)

6. 完成后
   → setSnailInstanceId（首次调用返回 snail_instance_id 时）
   → 提取终端上下文 → setContext
   → completeMessage(messageId, "completed")
   → notifyConsumers(stageId, "onMessageCompleted", message, context)
   → 解析 to_speakers → 更新 message.to_speakers 或创建后续 callSignals
   → 检测 stage_transition 建议 → 存储/通知消费者

7. 错误处理
   → 中断 → completeMessage("interrupted") + 系统总结
   → 失败 → completeMessage("failed")
```

### 场景 5：消费者管理

```
registerConsumer(stageId, consumer):
  → consumers Map<stageId, Set<consumer>> 添加

unregisterConsumer(stageId, consumer):
  → consumers Map 移除

notifyConsumers(stageId, method, ...args):
  → 遍历 consumers.get(stageId) ?? []
  → 调用 consumer[method](stageId, ...args)
  → 每个 consumer 独立 try-catch，一个失败不影响其他
```

### 场景 6：Stage 转换（advanceStage）

```
1. 用户确认某个 StageTransitionSuggestion
2. collaboration.advanceStage(stageId, targetKey, snailAssignments)
3. stagePort.advanceStage(stageId, targetKey, snailAssignments)
4. 为新 stage 初始化 user + role instance 游标
5. 可选：sendMessage(newStageId, initialMessage, "user")
```

### 场景 7：中断 Agent（interruptAgent）

```
1. interruptRegistry.interrupt(stageId, messageId)
2. 运行时收到 abort signal
3. completeMessage(messageId, "interrupted")
4. 系统自动总结 → setContext(kind="event_summary")
```

### 场景 8：启动恢复（startupRecovery）

```
1. messagePort.getAllCallSignals()
2. 对每个有 callSignal 的 stage → enqueueDrain(stageId)
3. IM/Web 各自恢复 consumer 注册
```

### 场景 9：终端上下文提取（extractTerminalContext）

```
优先级：
1. mcp_final_body（最高，Agent 通过 MCP 主动声明）
2. 最后一个 text event 的 text → "final_text"
3. 中断/失败场景 → 系统自动总结 → "event_summary"
```

### 场景 10：解析 Agent 回复目标（resolveToSpeakers）

```
优先级：
1. Agent 通过 MCP/结构化方式传入 mention
2. 从 text events 中提取 @mention → lite-ai 兜底
3. 无 mention → 最近响应的 speaker 或 default_role_instance
```

### 场景 11：Stage 转换检测（detectStageTransition）

```
1. 优先扫描结构化事件中的 stage_transition payload
2. 兜底扫描 text events 中的 stage_transition JSON
3. 存储为 StageTransitionSuggestion → 通知消费者
4. 不自动执行，需用户确认
```

---

## 模块结构

```
src/app/issue-collaboration/
  port.ts                 ← CollaborationInput + CollaborationConsumer 端口定义
  collaboration.ts        ← 协作核心（launchIssue, sendMessage, collaborationLoop, invokeAgent, notifyConsumers）
  stage-queue.ts          ← StageQueue（per-stage drain 串行化）
  prompt-assembly.ts      ← System reminder 组装
  context-extraction.ts   ← 终端上下文提取
  mention-resolver.ts     ← Mention 解析
  stage-transition.ts     ← Stage 转换检测
  startup-recovery.ts     ← 启动恢复
```

---

## 依赖关系

```
issue-collaboration
  ├── domain/issue     (IssuePort, StagePort)
  ├── domain/message   (MessagePort)
  ├── domain/snail     (SnailPort)
  ├── domain/lite-ai   (MentionExtractorPort，可选兜底)
  └── 不依赖 IM/Web    (通过 CollaborationConsumer 接口输出)

app/im-hub
  ├── domain/im        (webhook/lobby/channel/sendText/patchText)
  └── issue-collaboration (CollaborationInput + CollaborationConsumer)

app/web-hub
  └── issue-collaboration (CollaborationInput + CollaborationConsumer)

domain/im
  └── 不依赖 app 层，只在 in_stage 普通消息时产出 forwarded 结果
```

issue-collaboration 是**被依赖方**，不依赖任何外部消费者。IM 和 Web 通过端口接入。

---

## 关键设计决策

1. **输入/输出端口解耦** — issue-collaboration 通过 CollaborationInput 接收消息，通过 CollaborationConsumer 推送事件，不依赖 IM/Web
2. **消费者注册 + fanout** — 每个 stage 维护消费者列表，事件 fanout 到所有注册者
3. **sendMessage 异步** — 调用方不等待 Agent 完成，Agent 完成后通过 consumer 回调通知
4. **StageQueue 串行 drain** — 同一 stage 只允许一个 drain 循环运行，避免状态竞态
5. **同轮角色并行** — drain 循环内按 target speaker 分组，不同 Agent role 可并行 invoke
6. **CallSignal 持久化** — 重启后自动恢复未处理的 call signals
7. **ReadCursor** — 每个 speaker 一个游标，未读 = id > cursor
8. **RoleSnailAssignment** — append-only，seq 标识 snail 切换链，当前状态 = 最大 seq
9. **System Reminder 动态注入** — 每次 Agent 调用注入 stage/transition/artifact/role 上下文
10. **MCP set_final_body 最高优先级** — Agent 主动声明的终端上下文优先于自动提取
11. **Mention 结构化优先** — Agent 通过 MCP/结构化事件传入，文本/LLM 作为兜底
12. **Stage 转换需用户确认** — Agent 提议存储并通知，用户确认后才执行
13. **三阶段进程停止** — SIGINT → SIGTERM → SIGKILL
