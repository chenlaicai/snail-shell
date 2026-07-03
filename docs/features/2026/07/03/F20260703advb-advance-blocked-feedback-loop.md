---
id: F20260703advb
title: advance-blocked-feedback-loop
from_ids: []
tags: [issue-collaboration, mcp, websocket, advance, feedback]
modules: [issue-collaboration]
doc_kind: spec
change_type: feature
---

# F20260703advb 推进阻断反馈闭环

## 背景

用户反馈"Advance blocked by engine"错误频繁出现，体验割裂：AI 产出 stage suggestion → UI 显示"可推进" → 用户点击 advance → 报错。AI 和用户都无法得知具体阻断原因。

## 问题分析

### 数据流断点

```
AI 产出信号 → L1 拦截（只检查 unresolved_findings）→ 持久化 suggestion → UI 显示"可推进"
→ autoAdvanceEngine.evaluate() → 结果是 "blocked"
→ onEvaluationResult 通知 → WebSocket 不转发 → 死路
→ 用户点击推进 → evaluateAdvance() 再次返回 blocked → HTTP 409
→ 前端只取 data?.error → 显示 "Advance blocked by engine"
→ evaluation.reasons（真正有用的信息）被丢弃
```

### 三个断点

1. **L1 拦截太窄**：`collaboration.ts:374-383` 只检查 `adversarial_consensus` 的 `unresolved_findings`，其他阻断原因（`CONTEXT_MISSING`、`GATE_FAILED`、`SPEAKERS_INSUFFICIENT` 等）不拦截
2. **onEvaluationResult 是死路**：后端在信号发射时已执行 `evaluate()`，但 WebSocket consumer 未实现 `onEvaluationResult`，DTO 无对应事件类型，结果到不了前端和 agent
3. **前端丢弃评估详情**：HTTP 409 响应体包含 `evaluation`（有具体 error code 和 message），但 `api-client.ts:36` 只提取 `data?.error`，`evaluation` 被丢弃

### 根本问题

信号解析发生在 AI turn 结束**之后**（`detectStageTransition` 在 messageCompleted 回调中触发）。AI 无法在产出信号时获得反馈，只能被动等待用户点击 advance 后才知道阻断原因。

## 设计方案

### 核心原则

**提供信号预校验工具，让 AI 在发出信号之前完成校验并自纠；后端和前端保留兜底机制处理未预校验的情况。**

### 四层架构

| 层级 | 职责 | 触发时机 | 反馈目标 |
|------|------|----------|----------|
| P0: 信号预校验工具 | AI 发出信号前调用，返回校验结果 | AI turn 中，set_final_body 之前 | AI（立即自纠） |
| P1: 前端提取 409 评估详情 | 展示 HTTP 409 响应体中的 evaluation | 用户点击 advance 被阻断时 | 用户（toast 展示具体原因） |
| P1: L1 扩展单条校验 | 服务端兜底拦截 | 信号发射时（messageCompleted） | 前端（消息流阻断状态） |
| P2: WebSocket 转发 evaluation_result | 实时推送评估结果 | 信号发射时 / 评估完成时 | 前端（更新 suggestion card 状态） |

### 变更范围

#### 变更 0（P0）：新增 `validate_stage_signal` MCP 工具

新增 MCP 工具，让 AI 在发出 `stage_transition` 信号**之前**先调用校验：

```
AI 产出信号草稿 → 调用 validate_stage_signal →
  通过 → 调用 set_final_body 发出信号
  阻断 → AI 自纠 → 再次调用 → 通过后发出
```

**工具定义**：
- 名称：`validate_stage_signal`
- 输入：与 stage_transition 信号相同的参数（target_key, signal_type, gate_evidence, adversarial_artifact 等）
- 输出：`{ valid: boolean, reasons?: EvaluationReason[] }`
- 实现：抽取 `validateSingleSignal()` 子集，只执行 L1 校验范围内的检查（表格中标 ✅ 的项），跳过 `SPEAKERS_INSUFFICIENT` 和 `NO_VALID_SIGNALS`（留给 L2 兜底）
- `stage_id` 来源：从环境变量 `SNAIL_CTX_STAGE_ID` 获取

**AI 使用规范**（写入 system prompt）：
- 发出 `stage_transition` 信号前应先调用 `validate_stage_signal`
- 如果返回 `valid: false`，AI 根据 `reasons` 自纠后再次调用
- 最多重试 2 次（工具调用天然有 token 预算限制，无需额外计数器）
- 如果 2 次仍失败，AI 应在消息中说明阻断原因，由用户介入

**优势**：
- 反馈时机：信号发出前，AI 可立即自纠
- 用户感知：无感知，AI 自行修正
- 复杂度：只需新增一个 MCP 工具
- 自纠机制：天然有限（工具调用有 token 预算）

#### 变更 1（P1）：前端提取 409 评估详情

创建 409 专用 `BlockedError` 子类：

```typescript
export class BlockedError extends ApiError {
  constructor(
    message: string,
    public readonly evaluation: { action: string; reasons: Array<{ code: string; severity: string; message: string; details?: Record<string, unknown> }> }
  ) {
    super(message, 409);
    this.name = "BlockedError";
  }
}
```

`handleResponse` 中对 409 状态码特殊处理，抛出 `BlockedError`。catch 块通过 `instanceof BlockedError` 精确判断，展示 `reasons[].message`。

**兜底场景**：处理 AI 未调用预校验的情况，用户点击 advance 被阻断时能看到具体原因。

#### 变更 2（P1）：扩展 L1 拦截（collaboration 层）

将 `detectStageTransition` 中的 L1 拦截从只检查 `unresolved_findings` 扩展为调用单条信号校验子集。

**目标逻辑**：
```
detectStageTransition() {
  suggestion = signalParser.extract()
  if (!suggestion) return
  // L1: 单条信号校验
  result = validateSingleSignal(stage, suggestion)
  if (result.action === "blocked") {
    // 不持久化，通知前端阻断状态
    notify onEvaluationResult(result)
    return
  }
  // 通过才持久化
  persistSuggestion()
  evaluate() → notify onEvaluationResult
}
```

**L1 校验范围**（单条信号 + stage 静态状态即可判断）：

| Error Code | L1 可判断 | 依据 |
|------------|-----------|------|
| `CONTEXT_MISSING` | ✅ | 读取 issue context，检查 required fields |
| `GATE_FAILED` | ✅ | 读取 gate_evidence，检查必需 gate ID |
| `ADVERSARIAL_ARTIFACT_MISSING` | ✅ | 检查 artifact 是否存在 |
| `ADVERSARIAL_VALIDATION_FAILED` | ✅ | R1-R8 单条校验 |
| `INVALID_DECISION_MODE_COMBINATION` | ✅ | decision_mode vs signal_type |
| `SUGGESTIVE_MISSING_*` | ✅ | suggestive 模式字段完整性 |
| `L1_UNRESOLVED_FINDINGS` | ✅ | 已有逻辑 |
| `SPEAKERS_INSUFFICIENT` | ❌ | 需要统计不同 speaker 数量 |
| `NO_VALID_SIGNALS` | ❌ | 需要与已有 suggestions 比对 |

**兜底场景**：处理 AI 未调用预校验直接发出信号的情况。

#### 变更 3（P2）：WebSocket 转发 evaluation_result

在 `IssueRealtimeMessage` DTO 中新增事件类型：

```typescript
| { type: "evaluation_result"; stage_id: string; action: EvaluationAction; reasons: EvaluationReason[] }
```

在 `unified-websocket.ts` 的 `createIssueConsumer` 中实现 `onEvaluationResult` 回调。

### 向后兼容

1. 所有变更都是新增能力，不改变已有行为语义
2. L1 扩展只影响新信号，不回溯已有数据
3. 409 错误处理增强不改变非 409 错误的行为
4. `validate_stage_signal` 是可选工具，AI 不调用时走原有流程

### 不兼容更新

无。

## 验收标准

1. AI 调用 `validate_stage_signal` 时，返回具体阻断原因（如 `CONTEXT_MISSING: Issue 上下文缺少必要字段: worktree_path`）
2. AI 根据阻断原因自纠后，再次调用校验通过，成功发出信号
3. 用户点击 advance 被阻断时，展示具体原因而非"Advance blocked by engine"
4. AI 未调用预校验时，L1 兜底拦截并在消息流中展示阻断状态

## 最小可行方案（按优先级）

1. **新增 `validate_stage_signal` MCP 工具**（P0）：AI 信号预校验，从根本上解决反馈问题
2. **前端提取 409 评估详情**（P1）：`BlockedError` + catch 块展示具体原因
3. **L1 扩展单条校验**（P1）：persistence 前调用校验子集
4. **WebSocket `evaluation_result` 事件**（P2）：DTO 新增 + consumer 实现

## 实现记录

### 变更文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/app/issue-collaboration/signal-validation.ts` | 新增 | 共享单条信号校验函数 `validateSingleSignal`，供 L1 拦截和 AutoAdvanceEngine 使用 |
| `src/domain/snail-mcp-server/_internal/servers/snail-signal-validation.ts` | 新增 | `validate_stage_signal` MCP 工具（domain 层自包含校验逻辑，避免跨层依赖） |
| `src/domain/snail-mcp-server/_internal/initor.ts` | 修改 | 注册 signal-validation MCP server |
| `src/app/issue-collaboration/collaboration.ts` | 修改 | L1 拦截从只检查 unresolved_findings 扩展为调用 `validateSingleSignal` |
| `src/app/issue-collaboration/auto-advance.ts` | 修改 | `inferSignalType` 和 `getAutoAdvanceConfig` 改为 public（供 L1 拦截使用） |
| `src/web/services/api-client.ts` | 修改 | 新增 `BlockedError` 子类，409 响应保留 evaluation 详情 |
| `src/api-contracts/dto.ts` | 修改 | `IssueRealtimeMessage` 新增 `evaluation_result` 事件类型 |
| `src/infra/http/unified-websocket.ts` | 修改 | `createIssueConsumer` 实现 `onEvaluationResult` 回调 |

### 架构决策

- **MCP 工具校验逻辑自包含**：domain 层 MCP server 不能反向依赖 app 层，因此 `snail-signal-validation.ts` 内联了校验逻辑（与 `signal-validation.ts` 逻辑一致但独立实现）。未来可通过将校验函数下沉到 domain 层消除重复。
- **L1 拦截覆盖所有信号类型**：不再仅限 `adversarial_consensus`，`gate_complete` 也会被 L1 校验（context、gate、blocking rules）。这是设计意图——越早拦截越好。
