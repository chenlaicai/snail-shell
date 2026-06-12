# Issue Collaboration 设计

## 定位

app 层业务编排，串联 issue、message、snail、sop、lite-ai 五个 domain，实现"人类与 AI Agent 在 Stage 中协作完成工作"的完整场景。

通过 **输入/输出端口** 与外部消费者（Web、IM）解耦。issue-collaboration 不依赖 IM domain，只认识 CollaborationConsumer 接口。

---

## 端口定义

### 输入端口 — 外部 → issue-collaboration

```typescript
interface CollaborationInput {
  /** 用户向 stage 发送消息（异步，调用方不等 Agent 完成） */
  sendMessage(stageId: string, text: string, fromSpeaker: string): Promise<void>;

  /** 注册消费者（stage 维度，事件 fanout） */
  registerConsumer(stageId: string, consumer: CollaborationConsumer): void;

  /** 注销消费者 */
  unregisterConsumer(stageId: string, consumer: CollaborationConsumer): void;
}
```

### 输出端口 — issue-collaboration → 外部

```typescript
interface CollaborationConsumer {
  /** Agent 产生流式事件 */
  onEvent(stageId: string, event: MessageEvent): void;

  /** 消息完成（含最终上下文） */
  onMessageCompleted(stageId: string, message: Message, context: MessageContext): void;

  /** Agent 呼叫用户 */
  onUserCalled(stageId: string, message: Message): void;
}
```

### 调用关系

```
Web ──sendMessage──→ issue-collaboration ──onEvent/onCompleted──→ WebConsumer (WebSocket)
IM  ──sendMessage──→ issue-collaboration ──onEvent/onCompleted──→ IMConsumer (sendText/patchText)
```

Web 和 IM 都是输入方（调 sendMessage）和输出方（实现 CollaborationConsumer）。issue-collaboration 不关心背后是哪个平台。

---

## 业务场景

### 场景 1：启动 Issue（launchIssue）

```
输入：{ issue_id, initial_message? }

1. issuePort.findIssue(issueId) → 校验存在
2. stagePort.previewStage(issueId, firstStageKey) → 获取 stage 定义 + role instances
3. 查询 snail 列表 → 用户为每个 role_instance 选择 snail
4. stagePort.createStage({ issue_id, key, snail_assignments })
   → 创建 stage + 初始 RoleSnailSession（seq=0）
5. messagePort.initCursor(stageId, speaker) → 为每个 role_instance + "user" 初始化游标
6. 如果有 initial_message:
   → sendMessage(stageId, initial_message, "user")
```

### 场景 2：用户发送消息（sendMessage）

```
输入：stageId, text, fromSpeaker

1. 解析 to_speakers
   → 有显式 mention → 使用 mention
   → 无 mention → 查最近响应的 speaker，或 default_role_instance
2. createMessage({ stage_id, from_speaker: fromSpeaker, to_speakers, status: "completed" })
3. setContext(messageId, "final_text", text)
4. 对每个 to_speaker（非 "user"）→ createCallSignal
5. collaborationLoop(stageId)  // 异步，调用方不等待
```

### 场景 3：协作循环（collaborationLoop）

```
输入：stageId

remainingRounds = maxCollaborationRounds

while (remainingRounds > 0) {
  signals = messagePort.getCallSignals(stageId)
  if (signals.length === 0) break

  groups = groupBy(signals, s => s.target_speaker)

  for (speaker, group) in groups {
    if (speaker === "user") {
      messagePort.deleteCallSignal(stageId, "user")
      notifyConsumers(stageId, "onUserCalled", message)
      continue
    }

    unread = messagePort.getUnreadMessages(stageId, speaker)
    if (unread.length === 0) {
      messagePort.deleteCallSignal(stageId, speaker)
      continue
    }

    messagePort.advanceCursor(stageId, speaker, unread[unread.length - 1].id)
    for (s of group) messagePort.deleteCallSignal(stageId, s.target_speaker)
    await invokeAgent(stageId, speaker, unread)
    remainingRounds--
  }
}

if (remainingRounds <= 0) forceWrapUp(stageId)
```

### 场景 4：调用 Agent（invokeAgent）

```
输入：stageId, roleInstance, unreadMessages

1. 解析上下文
   → stage = stagePort.findStage(stageId)
   → issue = issuePort.findIssue(stage.issue_id)
   → session = stagePort.getRoleSnailSession(stageId, roleInstance)
   → snail = snailPort.getSnailRuntime(session.snail_id)
   → handbook = stagePort.getRoleHandbook(stageId, session.role_key)
   → externalSessionId = session.external_session_ids.at(-1) ?? null

2. 构建 system prompt
   → assembleSystemPrompt({
       issue, stage, roleInstance, session,
       handbook, shared_handbook: issue.sop_snapshot.shared_handbook,
       availableTransitions: stage.available_transitions,
     })

3. 首次 vs 后续调用
   → 首次（externalSessionId === null）：传入完整 system prompt + system reminder
   → 后续：只传 system reminder（内容有变化时才传）

4. 创建 agent message
   → createMessage({ stage_id, from_speaker: roleInstance, to_speakers: [], status: "streaming" })

5. 调用 snail runtime
   → snail.invokeMessage({
       workspacePath: issue.workspace_path,
       systemPrompt, sessionId: externalSessionId,
       messages: unreadMessages,
       onEvent: handleStreamingEvent
     })

6. 流式事件处理（handleStreamingEvent）
   → appendEvent(messageId, payload)
   → notifyConsumers(stageId, "onEvent", event)  // fanout 到所有消费者

7. 完成后
   → 如果 snail 返回 sessionId → stagePort.appendSessionId()
   → completeMessage(messageId, "completed")
   → 提取终端上下文 → setContext
   → notifyConsumers(stageId, "onMessageCompleted", message, context)
   → 解析 to_speakers → 创建 callSignals
   → 扫描 stage_transition 提议

8. 错误处理
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
1. stagePort.advanceStage(stageId, targetKey, snailAssignments)
2. 为新 stage 初始化游标
3. 可选：sendMessage → collaborationLoop
```

### 场景 7：中断 Agent（interruptAgent）

```
1. interruptRegistry.interrupt(stageId, messageId)
2. completeMessage(messageId, "interrupted")
3. 系统自动总结 → setContext
```

### 场景 8：启动恢复（startupRecovery）

```
1. messagePort.getAllCallSignals()
2. 对每个有 callSignal 的 stage → collaborationLoop(stageId)
```

### 场景 9：终端上下文提取（extractTerminalContext）

```
优先级：
1. mcp_final_body（最高，Agent 通过 MCP 主动声明）
2. 最后一个 text event 的 text → "final_text"
3. 中断场景 → 系统自动总结 → "event_summary"
```

### 场景 10：解析 Agent 回复目标（resolveToSpeakers）

```
优先级：
1. Agent 通过 MCP 结构化方法传入 mention
2. 从 text events 中提取 @mention → lite-ai 兜底
3. 无 mention → 最近响应的 speaker 或 default_role_instance
```

### 场景 11：Stage 转换检测（detectStageTransition）

```
1. 扫描 text events 中的 stage_transition JSON
2. 存储为 StageSuggestion → 通知前端
3. 不自动执行，需用户确认
```

---

## 模块结构

```
src/app/issue-collaboration/
  port.ts                 ← CollaborationInput + CollaborationConsumer 端口定义
  collaboration.ts        ← 协作核心（sendMessage, collaborationLoop, invokeAgent, notifyConsumers）
  stage-queue.ts          ← StageQueue（per-stage 串行化）
  prompt-assembly.ts      ← System Prompt 组装
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
  ├── domain/lite-ai   (MentionExtractorPort)
  └── 不依赖 IM/Web    (通过 CollaborationConsumer 接口输出)

im-hub
  ├── IM domain        (Hono app, LobbyRouter)
  └── issue-collaboration (CollaborationInput)

web-hub
  └── issue-collaboration (CollaborationInput)
```

issue-collaboration 是**被依赖方**，不依赖任何外部消费者。IM 和 Web 通过端口接入。

---

## 关键设计决策

1. **输入/输出端口解耦** — issue-collaboration 通过 CollaborationInput 接收消息，通过 CollaborationConsumer 推送事件，不依赖 IM/Web
2. **消费者注册 + fanout** — 每个 stage 维护消费者列表，事件 fanout 到所有注册者
3. **sendMessage 异步** — 调用方不等待 Agent 完成，Agent 完成后通过 consumer 回调通知
4. **StageQueue 串行化** — 同一 stage 内消息串行处理，不同 stage 并行
5. **CallSignal 持久化** — 重启后自动恢复未处理的 call signals
6. **ReadCursor** — 每个 speaker 一个游标，未读 = id > cursor
7. **RoleSnailSession** — append-only，seq 标识交接链，external_session_ids 数组
8. **System Prompt 按需组装** — 每次 Agent 调用时构建，不缓存
9. **MCP set_final_body 最高优先级** — Agent 主动声明的终端上下文优先于自动提取
10. **Mention 结构化优先** — Agent 通过 MCP 传入，lite-ai 作为兜底
11. **Stage 转换需用户确认** — Agent 提议存储，用户确认后执行
12. **三阶段进程停止** — SIGINT → SIGTERM → SIGKILL
