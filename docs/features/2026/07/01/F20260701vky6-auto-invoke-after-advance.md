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

**初始阶段同样缺失**：`createIssue()` 创建 issue 和第一个 stage 后直接返回，不调用 `autoInvokeNewStage()`。用户必须手动发消息才能触发第一个阶段的 agent 开始工作。与 advance/rollback 场景一样，这是额外的认知负担——用户已经填写了 title、summary、SOP 选择和 snail 分配，这些上下文对第一个阶段的 agent 来说已经足够启动。

## 目标

1. ~~stage transition 完成后（无论 auto-advance 还是手动 advance），系统自动向新阶段发送 kickoff 消息，触发新阶段的默认 agent 开始工作，消除用户手动干预~~ ✅ 已实现
2. ~~issue 创建完成后，系统自动向第一个阶段发送 kickoff 消息，触发默认 agent 开始工作，消除用户手动干预~~ ✅ 已实现

## 非目标

- 不改变 `AutoAdvanceEngine` 的评估逻辑（gate 校验、R1-R8 规则）
- 不改变 stage transition 的信号协议（`gate_complete`、`adversarial_consensus`、`disagreement`）
- 不改变 merge 阶段的特殊处理（merge 不 auto-advance FROM，但可以被 auto-advance TO）
- 不引入 per-stage 配置开关（后续按需扩展）

## 设计

### 问题链路分析

**advanceStage / rollbackStage**：✅ 已修复。`initStageCursors()` 之后调用 `autoInvokeNewStage(stage)`，链路完整。

**createIssue**：当前断点如下：

```
createIssue()
    ├── deps.createIssue(input)         ← domain 层创建 issue
    ├── helpers.createInitialStage()    ← 创建第一个 stage + 初始化 cursor
        ↓
    return { issue, stage }             ← 返回，无后续动作
```

**断点**：`createInitialStage()` 之后没有任何机制向第一个阶段注入消息或触发 agent。

### 方案：advanceStage() / rollbackStage() 内嵌 kickoff ✅ 已实现

`advanceStage()` 和 `rollbackStage()` 均已调用 `autoInvokeNewStage(stage)`，`autoInvokeNewStage()` 方法已实现。`sendMessage` → `sendMessageAsync` → `resolveToSpeakers` → `route` → `dispatch` → `invokeAgent` 链路完整。PR #524 已通过 review 并合入。

### 方案：createIssue() 内嵌 kickoff ✅ 已实现

在 `IssueCollaboration.createIssue()` 中，`createInitialStage()` 之后调用 `autoInvokeFirstStage(stage, input)`：

```typescript
async createIssue(input: CreateIssueInput): Promise<CreateIssueResult> {
    return this.deps.stagePort.transaction(() => {
      const issue = this.deps.createIssue(input);
      const stage = this.helpers.createInitialStage(issue);
      this.autoInvokeFirstStage(stage, input);  // ← 新增
      return { issue, stage };
    });
}
```

**kickoff 消息选择：使用 summary 作为用户消息**

与 advanceStage/rollbackStage 的 `"开始执行。"` 不同，createIssue 场景下用户已在 `summary` 字段中提供了问题描述。将 summary 作为第一条**用户消息**发送（`fromSpeaker="user"`），而非系统消息：

```typescript
private autoInvokeFirstStage(stage: Stage, input: CreateIssueInput): void {
    const defaultSpeaker = stage.default_role_instance;
    if (!defaultSpeaker) return;
    try {
        const summary = input.summary?.trim();
        if (summary) {
            void this.sendMessage(stage.id, summary, "user");    // 用户消息气泡
        } else {
            void this.sendMessage(stage.id, "开始执行。", "");    // 系统消息条
        }
    } catch (err) {
        log.error({ stageId: stage.id, err }, "autoInvokeFirstStage failed");
    }
}
```

**与 advanceStage kickoff 的差异**：

| 维度 | advanceStage kickoff | createIssue kickoff |
|------|---------------------|---------------------|
| 消息内容 | `"开始执行。"` | `summary` 内容（用户填写的问题描述） |
| fromSpeaker | `""`（系统消息） | `"user"`（用户消息） |
| UI 渲染 | 系统消息条（shield icon） | 用户气泡（右侧） |
| agent 处理 | 通过 systemReminder 获取上下文 | 收到用户指令作为第一条消息 |

**为什么用 `autoInvokeFirstStage` 而非复用 `autoInvokeNewStage`**：
- `autoInvokeNewStage(stage)` 签名只有 stage，不接收 `CreateIssueInput`，无法获取 summary
- `autoInvokeFirstStage(stage, input)` 需要访问 `input.summary` 决定消息内容和类型
- 两者行为不同：`autoInvokeNewStage` 固定发送系统消息，`autoInvokeFirstStage` 根据 summary 有无选择用户消息或系统消息

**为什么用用户消息而非系统消息**：
- summary 本质上是**用户给 agent 的指令**，不是 metadata
- 作为用户消息发送，agent 会将其视为用户意图，优先处理
- systemReminder 中仍保留 `**Issue 摘要**：` 字段，agent 同时看到结构化上下文和用户指令

**summary 为空时的 fallback**：当用户未填写 summary 时，发送 `"开始执行。"` 作为系统消息（与 advanceStage 行为一致）。此时 agent 依赖 systemReminder 中的 title + SOP 定义启动。

**前端 UI 适配**：当前 summary 是 3 行 textarea，标签 "Summary"，placeholder "Optional description"。需要调整为更大的编辑区域，标签改为"问题描述"，placeholder 改为"描述你希望 AI 帮你解决的问题"，鼓励用户提供充分上下文。

### 为什么选择这个位置

**advanceStage / rollbackStage 位置选择**：✅ 已实现。选择 advanceStage() 内嵌——两种推进路径的唯一交汇点，改动最小、覆盖最全。

**createIssue() 位置选择**：`createIssue()` 是创建初始阶段的唯一路径，在此处调用 `autoInvokeFirstStage()` 是覆盖初始阶段的最小改动。`autoInvokeFirstStage()` 与 `autoInvokeNewStage()` 签名不同，需要访问 `input.summary` 决定消息内容和类型。

### 边界条件

1. **issue 已关闭**：`sendMessage()` 内部 `assertIssueOpen()` 会抛出，被 try-catch 捕获并记录日志 ✅ 已验证
2. **无 default_role_instance**：直接 return，不发送消息（防御性检查）✅ 已验证
3. **agent 调用失败**：`sendMessageAsync()` 的 fire-and-forget 模式下，错误被 `.catch()` 记录日志 ✅ 已验证
4. **并发调度**：`dispatchStates` 机制处理同一 speaker 的并发 dispatch，不会重复调用 ✅ 已验证
5. **rollback 转移**：rollback 也经过 `advanceStage()`，同样触发 kickoff ✅ 已验证
6. **createIssue 事务内调用**：`createIssue()` 在 `stagePort.transaction()` 内执行，`autoInvokeFirstStage()` 的 `sendMessage` 是 fire-and-forget，事务提交后才实际触发 agent。这是安全的——`sendMessage` 内部会自行处理消息创建和路由
7. **长 summary 内容**：summary 可能包含大量 markdown 内容。作为用户消息发送时，`sendMessage` 会完整保留原始文本。systemReminder 中也保留 summary 作为结构化上下文。agent 同时看到两份内容，但用户消息是主要指令来源

### kickoff 消息设计

- **内容**：`"开始执行。"` — 最小化，不干扰 agent 的 systemReminder 上下文
- **fromSpeaker**：`""`（空字符串）— 通过 DTO 映射的 falsy 判断得到 `role="system"`，UI 渲染为紧凑系统消息条
- **可见性**：在 conversation 中可见，为用户提供反馈（"agent 已开始工作"）

#### 行为条目 S1：kickoff 消息必须渲染为可读文本 ✅ 已实现

`sendMessageAsync` 在 `fromSpeaker=""` 时已创建 text event，UI 可正确渲染 kickoff 文本。

#### 行为条目 S2：auto-advance 后前端自动切换阶段 ✅ 已实现

`dto.ts` 已包含 `stage_changed` 事件类型，`unified-websocket.ts` 和 `useWebSocket.ts` 均已实现。

## 生效路径

- `src/app/issue-collaboration/collaboration.ts` — `createIssue()` 新增 `autoInvokeFirstStage(stage, input)` 调用；新增 `autoInvokeFirstStage()` 方法
- `src/web/components/NewIssueDialog.tsx` — summary 编辑区域 UI 优化

## 改动范围

| 文件 | 改动 | 状态 |
|------|------|------|
| `src/app/issue-collaboration/collaboration.ts` | `createIssue()` 新增 `autoInvokeFirstStage(stage, input)` 调用；新增 `autoInvokeFirstStage()` 方法（summary 作为用户消息） | ✅ 已实现 |
| `src/web/components/NewIssueDialog.tsx` | summary textarea 改为更大编辑区域，标签改为"问题描述"，placeholder 改为"描述你希望 AI 帮你解决的问题" | ✅ 已实现 |
| `tests/collaboration-kickoff.test.ts` | 新增：createIssue 后自动发送 kickoff 消息的测试用例（含 summary 有内容和空 summary 两种场景） | ✅ 已实现 |

## 验证

- [x] 创建 issue 后，第一个阶段 agent 自动开始工作
- [x] 创建 issue 后，summary 内容作为用户消息在 conversation 中可见（右侧用户气泡）
- [x] summary 为空时，fallback 为"开始执行。"系统消息
- [x] 前端 NewIssueDialog 的 summary 编辑区域 UI 已优化（更大编辑区、标签"问题描述"）
- [x] auto-advance（design→development）后，development 阶段 agent 自动开始工作（PR #524 已验证）
- [x] auto-advance（development→review）后，review 阶段 agent 自动开始工作（PR #524 已验证）
- [x] 手动 advance 后，新阶段 agent 自动开始工作（PR #524 已验证）
- [x] kickoff 消息渲染为系统消息条样式，文本内容可读（PR #524 已验证）
- [x] agent 调用失败时不影响 advanceStage() 的返回值（PR #524 已验证）
- [x] 无 default_role_instance 时不发送消息（PR #524 已验证）
- [x] auto-advance 后前端自动切换到新阶段 conversation（PR #524 已验证）
- [x] rollback 后，新阶段 agent 自动开始工作（PR #524 已验证）
- [x] 现有 auto-advance 测试全部通过

<!-- [design-time] 章节结束 -->
