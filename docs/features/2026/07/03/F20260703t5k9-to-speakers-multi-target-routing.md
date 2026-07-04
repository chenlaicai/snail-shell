---
id: F20260703t5k9
title: fix-set-final-body-idempotent-guard-swallows-to-speakers
from_ids: []
tags: [collaboration, routing, bugfix]
modules: [snail-mcp-server]
doc_kind: spec
---

# F20260703t5k9 [collaboration] 修复 set_final_body 幂等防护吞掉 to_speakers 更新

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

### 现象

issue《破窗效应的抵抗》review 阶段，开发者 agent 调用 `set_final_body` 时声明 `to_speakers: ["审查者-1", "审查者-2"]`，但 message 3539 实际存储的 `to_speakers` 是 `["user"]`。系统未触发两位审查者的调用。

### 根因分析

**核心根因：`set_final_body` 的幂等防护在 `to_speakers` 写入之前拦截，导致第二次调用的 `to_speakers` 更新被丢弃。**

### 证据（数据库直查）

| 证据 | 数据 | 来源 |
|------|------|------|
| message 3539 `to_speakers` | `["user"]` | `message` 表 |
| message 3539 `mcp_final_body` context | `## 审查者-2 检视报告...`（审查者-2 的检视报告） | `message_context` 表 |
| message 3539 seq 48 `tool_call` 事件 | `set_final_body` with `to_speakers: ["审查者-1", "审查者-2"]`, text=`## 开发者回应：2 个问题均已修复...` | `message_event` 表 |
| message 3539 seq 39 signal 事件 | `stage_transition` with `signal_type: "disagreement"` | `message_event` 表 |
| message 3539 seq 46 signal 事件 | 同上（重复的 signal 事件） | `message_event` 表 |

**关键矛盾**：`mcp_final_body` context 的文本（审查者-2 检视报告）与 seq 48 `set_final_body` 调用的 text 参数（开发者回应）完全不同。这说明存在一次更早的 `set_final_body` 调用设置了 context，而 seq 48 的调用被幂等防护拦截。

**signal 事件佐证**：seq 39 和 seq 46 两个 signal 事件都是由 `extractStageTransition` 创建的（`signal: "stage_transition"` 不属于 `LifecycleSignal` 类型，不可能由 `mapAgentEvent` 产生）。这证明至少有两次 `set_final_body` 调用通过了幂等检查并执行了 `extractStageTransition`。两次 signal 内容完全相同（都来自审查者-2 检视报告中的 `stage_transition` JSON），说明两次调用的 text 参数都包含审查者-2 的检视报告。

**推断的调用时序**：

1. **第一次 `set_final_body` 调用**（~02:47:26Z，tool_call 事件缺失）：text = 审查者-2 检视报告，`to_speakers: ["user"]` → 通过幂等检查 → `setContext` 写入审查者-2 检视报告 → `extractStageTransition` 创建 seq 39 signal 事件 → `setMcpRoutingTargets` 存储 `["user"]` → `submittedMessages.add(3539)`
2. **第二次 `set_final_body` 调用**（~02:48:28Z，tool_call 事件缺失）：text = 审查者-2 检视报告 → 通过幂等检查（原因待查，可能进程重启导致 `submittedMessages` 清空）→ `extractStageTransition` 创建 seq 46 signal 事件 → `setMcpRoutingTargets` 覆盖为相同值 `["user"]` → `submittedMessages.add(3539)`
3. **第三次 `set_final_body` 调用**（~02:48:46Z，seq 48 tool_call 事件）：text = 开发者回应，`to_speakers: ["审查者-1", "审查者-2"]` → **幂等检查命中** → 返回 `already_submitted: true` → `to_speakers` **不更新**

> **注**：第一次和第二次调用的 `tool_call` 事件缺失（原因未明，可能是 Claude Code 未报告或事件处理 bug）。但 signal 事件和 context 数据的存在证明了这些调用确实发生过。第二次调用通过幂等检查的原因也未完全查明，最可能的解释是进程重启导致内存中的 `submittedMessages` Set 被清空。这些未解细节不影响根因判断——幂等防护吞掉 `to_speakers` 更新是确凿的。

### `set_final_body` handler 执行顺序

```
line 26:  verifyStageOwnership()     → 归属校验
line 28:  verifyMessageFreshness()   → 时效性校验
line 30:  submittedMessages.has()    → ⚠️ 幂等检查：已提交则直接 return
line 33:  setContext()               → 写 final body（仅首次）
line 35:  extractStageTransition()   → 提取信号（仅首次）
line 45:  setMcpRoutingTargets()     → 写入 to_speakers（仅首次）
line 52:  submittedMessages.add()    → 标记已提交
```

### 影响面

- **直接影响**：当 agent 对同一 message 调用多次 `set_final_body` 时，只有第一次的 `to_speakers` 生效，后续更新被静默丢弃。
- **触发条件**：agent 在一次 invocation 中多次调用 `set_final_body`。系统无硬终止机制，依赖 prompt 引导 + 幂等防护 + 返回值提示三层"尽力引导"（F20260630wtu5 设计决策）。
- **不影响的路径**：单次 `set_final_body` 调用不受影响。

## 用户意图锚

| # | 用户原话 | 来源 | 关键修饰语 | 架构师解读 |
|---|---------|------|-----------|-----------|
| UA-1 | "issue《破窗效应的抵抗》中，《开发者》调用了snail-final-response.set_final_body ，内容中有 "message_id": "3539", "to_speakers": ["审查者-1", "审查者-2"]。但是我看系统并没有触发 两个审查者的调用。你排查下根因" | message_id 3630 | 对象：tospeakers多位；断言：并未触发两个审查者的调用；要求：排查下根因 | 用户报告 to_speakers 多位路由失效，要求根因分析。不限定修复方案。 |

## 目标

确保 `to_speakers` 声明在任何时序下都能正确生效，不被幂等防护吞掉。

## 核心业务行为

| # | 场景 | 预期行为 | 溯源 |
|---|------|----------|------|
| B1 | 当 agent 对同一 message 多次调用 `set_final_body` 且后续调用包含 `to_speakers` 时 | 系统应更新 `to_speakers` 为最新值 | ← UA-1 |
| B2 | 当 agent 单次调用 `set_final_body` 包含 `to_speakers` 时 | 系统应将消息路由到所有声明的目标（不变） | ← UA-1 |
| B3 | 当 agent 重复调用 `set_final_body` 且 `to_speakers` 相同时 | `to_speakers` 被重新写入相同值（`Map.set` 覆盖，语义等价于幂等） | ← UA-1 |
| B4 | 当 agent 重复调用 `set_final_body` 且后续调用不含 `to_speakers` 时 | 系统应保留前次 `to_speakers` 不变 | ← UA-1 |

## 设计

### 方案：拆分幂等粒度——final body 幂等，to_speakers 不幂等

```typescript
// 伪代码
const isFirstSubmission = !submittedMessages.has(messageId);
if (isFirstSubmission) {
    messagePort.setContext(messageId, "mcp_final_body", text);
    // extract stage_transition（仅首次，防止重复 signal 事件）
    const stageTransition = extractStageTransition(text);
    if (stageTransition) {
        messagePort.appendEvent(messageId, { type: "signal", signal: "stage_transition", stage_transition: stageTransition });
    }
}
// to_speakers 每次都更新（不幂等）
if (Array.isArray(params.to_speakers) && params.to_speakers.length > 0) {
    const targets = (params.to_speakers as unknown[]).filter((t): t is string => typeof t === "string");
    if (targets.length > 0) {
        warning = validateToSpeakers(targets, stageId, stagePort, message?.from_speaker ?? null);
        mcpMessageStore.setMcpRoutingTargets(messageId, targets);
    }
}
submittedMessages.add(messageId);
```

### 关键设计决策

1. **`setContext` 幂等（仅首次写入）**：final body 文本是消息的展示内容，首次写入后不应被覆盖。agent 如果需要更新展示内容，应通过新的发言而非重复调用 `set_final_body`。

2. **`extractStageTransition` 幂等（仅首次提取）**：signal 事件不应重复创建。多次提取同一文本会产生重复 signal 事件，干扰 `detectStageTransition` 的信号处理。

3. **`setMcpRoutingTargets` 不幂等（每次都更新）**：`to_speakers` 是路由声明，agent 可能在一次发言中多次调整路由目标。`Map.set` 覆盖语义保证最后声明的值生效。

4. **`validateToSpeakers` 每次都执行**：即使 `to_speakers` 不幂等，校验仍然每次执行。如果后续调用的 `to_speakers` 包含无效目标，`validateToSpeakers` 会抛错，agent 收到错误后可以修正。

5. **`submittedMessages.add` 位置不变**：仍然在所有写入之后，确保第一次调用完整执行后才标记为已提交。

### 不修改的部分

- **`resolveReplies`**：不修改 MCP store 读取逻辑
- **`route` 和 `dispatch`**：不修改路由分发逻辑
- **`detectStageTransition`**：不修改信号处理逻辑
- **`invokeAgent` 执行顺序**：不调整 `detectStageTransition` 和 `route` 的顺序（第一版 Feature 文档的方案，已否决——根因不在执行顺序）

## 不兼容更新

无。

## 设计约束摘要

- **语义不变量**：`to_speakers` 必须反映 agent 最后一次 `set_final_body` 调用的值
- **边界**：只修改 `set_final_body` handler 内部的幂等逻辑，不修改其他组件
- **关键决策**：final body 幂等（防止覆盖），to_speakers 不幂等（允许更新）

<!-- [design-time] 章节结束 -->

## 改动范围

1. `src/domain/snail-mcp-server/_internal/servers/snail-final-response.ts` — `handleSetFinalBody` 函数的幂等逻辑调整
2. 相关测试文件

## 验证

- [x] agent 多次调用 `set_final_body` 时，最后一次的 `to_speakers` 生效
- [x] agent 单次调用 `set_final_body` 时，`to_speakers` 正常存储（回归）
- [x] final body 文本不被重复调用覆盖（幂等保持）
- [x] signal 事件不被重复创建（幂等保持）
- [x] `npm run check` 通过

## 关联

- **相关**: F20260630dy6x（to_speakers 路由目标错误修复）
- **相关**: F20260630m8ia（set_final_body 信号通道）
- **相关**: F20260630wtu5（set_final_body 循环修复，建立了幂等防护机制——本 feature 修正该机制的粒度）
