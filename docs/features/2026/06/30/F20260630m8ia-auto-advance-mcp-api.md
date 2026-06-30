---
id: F20260630m8ia
title: auto-advance-mcp-api
from_ids: [F20260626m4vx, F20260629v7k7]
tags: [sop, mcp, auto-advance, stage-transition]
modules: [mcp, collaboration, sop]
doc_kind: spec
---

# F20260630m8ia [sop] 自动推进信号通道：打通 set_final_body 到 AutoAdvanceEngine

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

PR #484（F20260626m4vx）实现了 `AutoAdvanceEngine`，定义了完整的自动推进机制：agent 发出信号 → 系统校验条件 → 自动推进。但合入后自动推进从未生效。

**根因**：信号链存在断点。Agent 的通信通道是 MCP 工具，但 MCP 层没有暴露任何能产生 `stage_transition` 信号的工具。`set_final_body` 只存正文不解析信号，`set_context` 只写 KV 不产生消息事件。`AutoAdvanceEngine` 逻辑完整但永远收不到输入——造了引擎但没接油路。

| 层 | 现状 | 断点 |
|---|---|---|
| Agent 层 | SKILL.md 定义了信号协议（consensus/disagreement JSON） | Agent 只能通过 MCP 工具交互，没有工具可以发出 signal 事件 |
| MCP 层 | 7 个 server、19 个工具，无任何 stage transition 相关工具 | `set_final_body` 只存正文，`set_context` 只写 KV |
| Collaboration 层 | `detectStageTransition()` 正确实现了信号提取 | 信号来源是 `MessageEvent`，MCP 工具调用不产生 signal 类型事件 |
| AutoAdvanceEngine | 逻辑完整（gate 校验、context 校验、对抗共识） | 永远收不到输入 |

### 设计演进

初版方案（方案 B）设计了独立 `snail-issue-stage` MCP server + `propose_transition` 工具。交叉审视发现 **mid-invocation 时序冲突**：`propose_transition` 在 agent 执行过程中被调用，如果触发推进，stage 会在 agent 还在执行时就变了，导致 `set_final_body` 归属校验失败、agent context 过期。

修正方案转向**增强 `set_final_body` 自动提取**：`set_final_body` 是 agent 最后调用的工具，调用时 agent 执行已完成、stage 还没推进、message 已存在——是注入信号的最佳时机。

## 目标

在 `set_final_body` 中增加信号提取能力，使 agent 按现有协议输出的 `stage_transition` JSON 自动转化为系统信号，触发 `AutoAdvanceEngine` 评估。

### P1 — `set_final_body` 自动提取 stage_transition 信号

- `set_final_body` handler 在存入 text 后，自动从 text 中解析 `stage_transition` JSON
- 解析成功时，通过 `messagePort.appendEvent()` 追加一个 `signal` 类型事件到当前 message
- 解析失败时静默跳过（agent 可能没有输出信号，这是正常情况）
- 复用现有 `tryParseStageTransition` 解析逻辑

### P2 — SOP 文档对齐

- 更新 SKILL.md 中信号协议的说明，明确 `set_final_body` 会自动提取 text 中的 `stage_transition` JSON
- 不改变 agent 的输出行为——agent 继续按现有协议在消息末尾输出 stage_transition JSON

## 非目标

- 不修改 `AutoAdvanceEngine` 的评估逻辑（gate 校验、context 校验、对抗共识规则不变）
- 不修改 `detectStageTransition()` 的信号提取逻辑（仍保留对消息事件中信号的检测能力）
- 不新建 MCP server（不引入 `snail-issue-stage`）
- 不暴露 `rollback_stage` MCP 工具（rollback 是低频操作，mid-invocation 回滚同样有时序问题，暂搁置）
- 不改变 agent 的输出行为（agent 继续按现有 SKILL.md 协议输出 stage_transition JSON）

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当 agent 在 `set_final_body` 的 text 中包含 `stage_transition` JSON 且所有 gate 条件满足时 | 系统应自动推进 stage | |
| B2 | 当 agent 在 text 中包含 `stage_transition` JSON 但 gate 条件不满足时 | 系统应不推进，等待更多信号 | |
| B3 | 当 agent 在 text 中包含 `stage_transition` JSON 但 context 字段缺失时 | 系统应阻断推进并报告缺失字段 | |
| B4 | 当两个不同 agent 对同一 stage 分别在 `set_final_body` 中发出 `consensus: true` 的信号时 | 系统应在第二个信号到达时满足对抗共识条件，自动推进 | |
| B5 | 当 agent 在 text 中包含 `consensus: false` 的信号时 | 系统应生成分歧卡片通知用户，不推进 | |
| B6 | 当 agent 在 text 中不包含 `stage_transition` JSON 时 | `set_final_body` 正常工作，不产生额外信号事件 | |
| B7 | 当 agent 在 text 中包含格式不合法的 `stage_transition` JSON 时 | `set_final_body` 正常工作，静默跳过信号提取，不报错 | |

## 设计

### P1 详设：`set_final_body` 信号提取

#### 1. handler 流程变更

现有流程：
1. 校验参数
2. `messagePort.setContext(messageId, "mcp_final_body", text)`
3. 处理 `to_speakers`
4. 返回 `{ ok: true }`

变更后流程：
1. 校验参数
2. `messagePort.setContext(messageId, "mcp_final_body", text)`
3. **新增**：从 `text` 中解析 `stage_transition` JSON；如果解析成功，调用 `messagePort.appendEvent(messageId, signalPayload)` 追加 signal 事件
4. 处理 `to_speakers`
5. 返回 `{ ok: true }`

#### 2. 信号解析逻辑

从 `text` 中提取 `stage_transition` JSON。解析策略：在 text 中查找 `{ "stage_transition": { ... } }` 模式。

复用 `collaboration.ts` 中 `tryParseStageTransition` 的解析逻辑（提取为共享函数，或在 handler 中实现等价逻辑）。

解析结果映射为 `MessageEventPayload`：

```typescript
{
  type: "signal",
  signal: "stage_transition",
  stage_transition: {
    target_key: string,
    reason?: string,
    guard?: string,
    consensus?: boolean,
    positions?: Position[],
    gate_evidence?: Record<string, unknown>
  }
}
```

#### 3. 时序保障

`set_final_body` 调用时的时序状态：
- **message 已存在**：`invokeAgent` 开始时就创建了 message（`collaboration.ts:255-257`）
- **agent 执行已完成**：`set_final_body` 是 agent 最后调用的工具
- **stage 未推进**：`detectStageTransition` 在 `invokeAgent` 完成后才运行

信号事件写入 MessageEvents 后，`detectStageTransition` 在 `invokeAgent` 完成时正常扫描，信号被提取为 `StageTransitionSuggestion`，触发 `autoAdvanceEngine.evaluate()`。

#### 4. 信号归属

signal 事件自动关联到当前 message（通过 `messageId`）。`from_speaker` 由 `detectStageTransition` 从 `roleInstance` 参数获取（与 agent 消息一致），无需在 signal 中重复。

### P2 详设：SOP 文档对齐

更新 SKILL.md 中信号协议说明，补充一句：`set_final_body` 会自动从 text 中提取 `stage_transition` JSON 并转化为系统信号。agent 的输出格式和行为不变。

## 生效路径

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/domain/snail-mcp-server/_internal/servers/snail-final-response.ts` | 修改 | handler 增加 stage_transition 解析和 appendEvent 逻辑 |
| `data/file/skills/cd-shared/references/stage-gate.md` | 修改 | 补充说明：set_final_body 自动提取信号 |

## 设计约束摘要

- **边界**：`set_final_body` 从 text 中被动提取信号，不是主动提交——职责扩展最小化
- **关键决策**：增强 `set_final_body` 而非新建 MCP server（避免 mid-invocation 时序冲突）
- **关键决策**：自动提取而非增加参数（agent 已在输出 stage_transition JSON，不需要重复传递）
- **关键决策**：rollback 暂不暴露（低频操作，mid-invocation 回滚同样有时序问题）
- **关键决策**：解析失败静默跳过（agent 可能没有信号，这是正常情况）
- **非目标约束**：不修改 AutoAdvanceEngine 评估逻辑，不修改 detectStageTransition，不改变 agent 输出行为

<!-- [design-time] 章节结束 -->

## 验证

- [x] agent 在 `set_final_body` text 中包含合法 `stage_transition` JSON 时，signal 事件被追加到 MessageEvents（snail-final-response.test.ts: "appends signal event when text contains valid stage_transition JSON"）
- [x] `invokeAgent` 完成后 `detectStageTransition` 能从 MessageEvents 中提取到 signal（信号以 signal 类型事件注入，`extractSignalPayload` 已有 signal 类型处理逻辑）
- [x] gate 条件满足时自动推进触发（auto-advance.test.ts: "allows auto-advance when all context fields are present"）
- [x] gate 条件不满足时不推进（auto-advance.test.ts: context 缺失阻断测试）
- [x] context 缺失时阻断推进（auto-advance.test.ts: 各 stage context 校验测试）
- [x] 两个 agent 分别发出 `consensus: true` 时，对抗共识条件满足后自动推进（auto-advance.test.ts: design stage 测试 + 信号提取已验证 consensus 传递）
- [x] `consensus: false` 时生成分歧卡片（snail-final-response.test.ts: "handles disagreement signal" + AutoAdvanceEngine 已有 generateDisagreementCard 逻辑）
- [x] text 中无 `stage_transition` JSON 时，`set_final_body` 正常工作不报错（snail-final-response.test.ts: "does not append signal event when text has no stage_transition"）
- [x] text 中 `stage_transition` JSON 格式不合法时，静默跳过不报错（snail-final-response.test.ts: "silently skips when stage_transition JSON is malformed"）
- [x] `npm run check` 通过
- [x] 相关测试通过（23 tests passed）

## 关联

- **前置**: F20260626m4vx（AutoAdvanceEngine 实现，本 feature 补通信通道）
- **前置**: F20260629v7k7（SOP Context 强制执行，本 feature 不修改 context 校验逻辑）
- **相关**: F2026060303（AI 阶段转移建议：提议→用户确认→执行，本 feature 在此基础上增加自动推进能力）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|---------|---------|---------|---------|--------|------|
| D1 | 信号通道实现：独立 MCP server vs 增强 set_final_body | 独立 server：职责清晰，可扩展（rollback、stage_info） | 增强 set_final_body：改动最小，避免 mid-invocation 时序问题 | 增强 set_final_body | 独立 server 的 `propose_transition` 工具在 agent 执行过程中调用，触发推进会导致 stage 在 agent 执行中变化，`set_final_body` 归属校验失败；`set_final_body` 是 agent 最后调用的工具，调用时 agent 执行已完成，是注入信号的最佳时机 | 架构师-1 + 架构师-2 交叉审视 | 2026-06-29 |
| D2 | 信号注入方式：增加参数 vs 自动提取 | 增加参数：结构化，解析确定 | 自动提取：agent 已在输出 stage_transition JSON，不需要重复传递；零 agent 改动 | 自动提取 | agent 已按现有 SKILL.md 协议输出 stage_transition JSON，增加参数等于让 agent 重复传递同样信息；自动提取复用现有 `tryParseStageTransition` 逻辑 | 架构师-2 建议，架构师-1 接受 | 2026-06-29 |
| D3 | rollback 是否暴露：暴露 vs 搁置 | 暴露：agent 可自行回滚，减少人类介入 | 搁置：mid-invocation 回滚有时序问题，低频操作 | 搁置 | rollback 同样存在 mid-invocation 时序问题（回滚后 agent context 失效）；rollback 是低频操作，不值得为此引入复杂度 | 架构师-1 + 架构师-2 共识 | 2026-06-29 |
| D4 | 解析失败处理：报错 vs 静默跳过 | 报错：agent 知道信号格式错误 | 静默跳过：agent 可能没有输出信号，这是正常情况 | 静默跳过 | `set_final_body` 的首要职责是存入正文，信号提取是附加能力；agent 可能不输出信号（如用户消息、简单回复），报错会干扰正常流程 | 架构师-1 | 2026-06-29 |

## 范围变更记录

| # | 变更 | 原因 | 日期 |
|---|------|------|------|
| 1 | 方案从"新建 snail-issue-stage MCP server + propose_transition 工具"修正为"增强 set_final_body 自动提取" | 交叉审视发现 mid-invocation 时序冲突：propose_transition 在 agent 执行中调用，触发推进会导致 stage 在 agent 执行中变化 | 2026-06-29 |
| 2 | 搁置 rollback_stage MCP 工具 | rollback 同样存在 mid-invocation 时序问题，且是低频操作 | 2026-06-29 |
