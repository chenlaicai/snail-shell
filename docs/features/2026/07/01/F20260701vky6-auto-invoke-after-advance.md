---
id: F20260701vky6
title: auto-invoke-after-advance
from_ids: [F2026060303]
tags: [workflow, collaboration]
modules: [issue-collaboration]
doc_kind: spec
---

# F20260701vky6 [workflow] 阶段推进后自动触发新阶段 Agent

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

用户日常使用研发 SOP 时，stage transition（design→development、development→review）完成后，新阶段的 conversation 为空，用户必须手动发消息才能触发 AI 工作。

**现状流程**：
1. Agent 完成当前阶段工作，调用 `set_final_body` 附带 `stage_transition` 信号
2. `AutoAdvanceEngine.evaluate()` 校验通过后调用 `executeAutoAdvance()`
3. `executeAutoAdvance()` → `IssueCollaboration.advanceStage()` 创建新阶段
4. 记录审计日志、通知 consumers（`onAutoAdvanced`）
5. **流程结束** — 新阶段无消息、无 agent 调用，等待用户手动输入

**根因**：`IssueCollaboration.advanceStage()` 是纯状态转移操作（创建新阶段 + 清理旧状态 + 初始化 cursor），不包含任何消息发送或 agent 调用逻辑。

**历史背景**：F2026060303 P4 已识别此问题，提出前端方案（`src/web/stage-controller.js` 自动发送"开始执行。"）。但该文件已不存在于当前代码库——架构已从前端驱动演变为后端 `IssueCollaboration` 编排驱动，P4 方案失效。

## 目标

stage transition 完成后（无论 auto-advance 还是手动 advance），系统自动向新阶段发送 kickoff 消息，触发新阶段的默认 agent 开始工作，消除用户手动干预。

## 非目标

- 不改变 `AutoAdvanceEngine` 的评估逻辑（gate 校验、R1-R8 规则）
- 不改变 stage transition 的信号协议（`gate_complete`、`adversarial_consensus`、`disagreement`）
- 不改变 merge 阶段的特殊处理（merge 不 auto-advance FROM，但可以被 auto-advance TO）
- 不引入 per-stage 配置开关（后续按需扩展）

## 设计

### 问题链路分析

```
advanceStage()                          ← 纯状态转移，无消息
    ├── stagePort.advanceStage()        ← domain 层创建新阶段
    ├── cleanupDispatchStates()         ← 清理旧阶段调度状态
    ├── suggestions.delete()            ← 清理旧阶段信号
    └── helpers.initStageCursors()      ← 初始化新阶段 cursor
        ↓
    return newStage                     ← 返回，无后续动作
```

**断点**：`initStageCursors()` 之后没有任何机制向新阶段注入消息或触发 agent。

### 方案：advanceStage() 内嵌 kickoff

在 `IssueCollaboration.advanceStage()` 中，`initStageCursors()` 之后调用 `autoInvokeNewStage(stage)`：

```typescript
async advanceStage(stageId: string, targetKey: string): Promise<Stage> {
    const stage = this.deps.stagePort.advanceStage(stageId, targetKey);
    this.cleanupDispatchStates(stageId);
    this.suggestions.delete(stageId);
    this.helpers.initStageCursors(stage);
    this.autoInvokeNewStage(stage);       // ← 新增
    return stage;
}

private autoInvokeNewStage(stage: Stage): void {
    const defaultSpeaker = stage.default_role_instance;
    if (!defaultSpeaker) return;
    try {
        void this.sendMessage(stage.id, "开始执行。", "");
    } catch (err) {
        log.error({ stageId: stage.id, err }, "autoInvokeNewStage failed");
    }
}
```

**`fromSpeaker=""` 选择理由**：

DTO 映射（`issue.route.ts:200`）使用 `message.from_speaker` 的 truthy/falsy 判断 role：
```typescript
const role = message.from_speaker === "user" ? "user" : message.from_speaker ? "assistant" : "system";
```

- `from_speaker="system"` → truthy → `role="assistant"` → UI 渲染为 assistant 气泡（错误）
- `from_speaker=""` → falsy → `role="system"` → UI 渲染为紧凑系统消息条（正确）

**触发链路**：
```
sendMessage("开始执行。", fromSpeaker="")
    → sendMessageAsync()
        → resolveToSpeakers()           ← 新阶段无历史消息，回退到 default_role_instance
        → route()
            → dispatch(default_role_instance)
                → invokeAgent()         ← agent 被自动调用
```

### 为什么选择这个位置

| 方案 | 优点 | 缺点 |
|------|------|------|
| advanceStage() 内嵌 | 同时覆盖 auto-advance 和 manual advance；无需前端改动 | 与状态转移逻辑耦合 |
| detectStageTransition() 后置 | 仅覆盖 auto-advance | manual advance 不受益；需在 evaluate 返回后再次查询新阶段 |
| 前端 onAutoAdvanced 回调 | 解耦 | 仅覆盖 auto-advance；依赖 WebSocket 连接；增加前端复杂度 |

选择 advanceStage() 内嵌：这是两种推进路径的唯一交汇点，改动最小、覆盖最全。

### 边界条件

1. **issue 已关闭**：`sendMessage()` 内部 `assertIssueOpen()` 会抛出，被 try-catch 捕获并记录日志，不影响 `advanceStage()` 的返回值
2. **无 default_role_instance**：直接 return，不发送消息（防御性检查）
3. **agent 调用失败**：`sendMessageAsync()` 的 fire-and-forget 模式下，错误被 `.catch()` 记录日志
4. **并发调度**：`dispatchStates` 机制处理同一 speaker 的并发 dispatch，不会重复调用
5. **rollback 转移**：rollback 也经过 `advanceStage()`，同样触发 kickoff。这是合理行为——rollback 后 agent 应开始处理回退任务

### kickoff 消息设计

- **内容**：`"开始执行。"` — 最小化，不干扰 agent 的 systemReminder 上下文
- **fromSpeaker**：`""`（空字符串）— 通过 DTO 映射的 falsy 判断得到 `role="system"`，UI 渲染为紧凑系统消息条
- **可见性**：在 conversation 中可见，为用户提供反馈（"agent 已开始工作"）

#### 行为条目 S1：kickoff 消息必须渲染为可读文本

**问题**：`sendMessage()` 将文本写入 `context.final_text`，但不创建 text event。UI 系统消息渲染逻辑（`ChatMessage.tsx:87-90`）只从 events 中提取文本：
```typescript
const text = message.events
  .filter((e) => e.payload?.type === "text" && e.payload && "text" in e.payload)
  .map((e) => (e.payload as unknown as { text: string }).text)
  .join("");
```

无 text event → `text = ""` → 渲染为无文本的 pill badge。

**约束**：kickoff 消息必须在 conversation 中渲染为可读文本，不是空 pill badge。

**实现方向**（供 development 参考）：`autoInvokeNewStage` 在调用 `sendMessage` 后，需为该 message 创建一条 text event（`appendEvent` with `payload.type === "text"`, `payload.text = "开始执行。"`）。关键约束：不能改变已有 user/agent 消息的事件创建流程。

### 前端依赖：stage_changed 事件规范

auto-advance 触发后，前端需要自动切换到新阶段的 conversation 视图，否则 kickoff 消息和 agent 工作对用户不可见。

#### 行为条目 S2：auto-advance 后前端自动切换阶段

**实现链路**：

1. WebSocket consumer 新增 `onAutoAdvanced` 处理，发送 `stage_changed` 事件
2. 前端监听 `stage_changed`，自动更新 `searchParams` 切换到新阶段

**`stage_changed` 事件规范**：

DTO 类型变更（`src/api-contracts/dto.ts`）— `IssueRealtimeMessage.event` 联合类型新增变体：
```typescript
| { type: "stage_changed"; stage_id: string; new_stage_id: string; from_key: string; to_key: string }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `stage_id` | `string` | 旧阶段 ID |
| `new_stage_id` | `string` | 新阶段 ID |
| `from_key` | `string` | 旧阶段 key（如 "design"） |
| `to_key` | `string` | 新阶段 key（如 "development"） |

**WebSocket consumer 实现**（`unified-websocket.ts`）：
```typescript
onAutoAdvanced(stageId, payload) {
  send(socket, {
    type: "issue_event",
    issue_id: issueId,
    activity_status: collaboration.getActivityStatus(payload.to),
    event: { type: "stage_changed", stage_id: stageId, new_stage_id: payload.to, from_key: payload.from, to_key: payload.to },
  });
}
```

**前端处理**（`useWebSocket.ts` → `IssueConversation.tsx`）：
- `EventBatcher` 新增 `stage_changed` 事件类型处理
- 收到 `stage_changed` 后，调用 `setSearchParams({ stage: new_stage_id }, { replace: true })`
- 新 stage 的 conversation 数据通过 React Query 自动 fetch（`queryKeys.stages.messages(new_stage_id)`）

## 生效路径

- `src/app/issue-collaboration/collaboration.ts` — `advanceStage()` 新增 `autoInvokeNewStage()` 调用；新增 `autoInvokeNewStage()` 私有方法；kickoff 消息创建 text event（S1）
- `src/api-contracts/dto.ts` — `IssueRealtimeMessage.event` 新增 `stage_changed` 变体
- `src/infra/http/unified-websocket.ts` — WebSocket consumer 新增 `onAutoAdvanced` 处理
- `src/web/hooks/useWebSocket.ts` — `EventBatcher` 新增 `stage_changed` 处理
- `src/web/pages/IssueConversation.tsx` — 监听 `stage_changed` 自动切换阶段

## 改动范围

| 文件 | 改动 |
|------|------|
| `src/app/issue-collaboration/collaboration.ts` | `advanceStage()` 新增 `autoInvokeNewStage()` 调用；新增 `autoInvokeNewStage()` 方法；kickoff 消息需创建 text event（S1） |
| `src/api-contracts/dto.ts` | `IssueRealtimeMessage.event` 联合类型新增 `stage_changed` 变体 |
| `src/infra/http/unified-websocket.ts` | WebSocket consumer 新增 `onAutoAdvanced` 处理，发送 `stage_changed` 事件 |
| `src/web/hooks/useWebSocket.ts` | `EventBatcher` 新增 `stage_changed` 事件类型处理 |
| `src/web/pages/IssueConversation.tsx` | 监听 `stage_changed` 事件，自动切换 `searchParams` 到新阶段 |
| `tests/collaboration-kickoff.test.ts` | 新增：advanceStage 后自动发送 kickoff 消息的测试用例 |

## 验证

- [ ] auto-advance（design→development）后，development 阶段 agent 自动开始工作
- [ ] auto-advance（development→review）后，review 阶段 agent 自动开始工作
- [ ] 手动 advance 后，新阶段 agent 自动开始工作
- [ ] kickoff 消息在 conversation 中可见，渲染为系统消息条样式（shield icon + 单行），文本内容可读（非空 pill badge）
- [ ] agent 调用失败时不影响 advanceStage() 的返回值
- [ ] 无 default_role_instance 时不发送消息（不报错）
- [ ] auto-advance 后前端自动切换到新阶段 conversation
- [ ] rollback 后，新阶段 agent 自动开始工作
- [ ] rollback kickoff 消息在 conversation 中可见
- [ ] kickoff 消息在 advanceStage 返回后立即可见；agent 流式输出可能有短暂延迟
- [ ] 现有 auto-advance 测试全部通过

<!-- [design-time] 章节结束 -->
