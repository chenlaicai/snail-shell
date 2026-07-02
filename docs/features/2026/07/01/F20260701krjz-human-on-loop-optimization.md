---
id: F20260701krjz
title: human-on-loop-optimization
from_ids: []
tags: [prompt, hitl, collaboration]
modules: [issue-collaboration, prompt]
doc_kind: spec
---

# F20260701krjz [collaboration] Human-on-the-Loop 优化：修复 HITL 架构的三个断裂点

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

Snail Shell 的 HITL（Human-in-the-Loop）架构在设计层面是正确的——建立了决策分级体系、对抗性审查机制、merge 硬性阻断。但在实现层面存在三个断裂点，导致"设计正确但实现未闭环"：

1. **信息断裂**：后端持有的决策依据（gate_evidence、signal_type、adversarial_artifact）没有传递到前端，StageSuggestionCard 是"信息黑洞"
2. **持久化断裂**：Suggestions 存储在进程内存中，服务重启后丢失，人类的审阅进度被浪费
3. **强制断裂**：决策模式（自主决策/建议层/必须人类决策）只是提示词规则，没有代码层强制

这三个断裂点导致了三个 HITL 反模式：
- **橡皮图章**：用户无法做出有意义的判断，只能盲从或盲拒
- **警报疲劳**：Agent 可以频繁呼叫用户，没有任何频率限制
- **责任真空**：决策模式无法验证，Agent 可以"声称"自己做了正确决策

**关于"人类纠正跨会话丢失"**：用户的"不要"有两种处理路径：
1. 大问题（如兼容性处理）→ 走 evolution 机制（已有另一个 issue 在修复这一点）
2. 设计方案中的决策 → 架构师记录到 Feature 文档的"关键决策记录"中

这两种路径都已经存在，不需要额外的 `human.preference.*` 持久化机制。

## 目标

**P1 — 修复三个断裂点，将 HITL 架构从"设计正确"升级为"实现闭环"**

1. 修复信息断裂：StageSuggestionCard 展示完整的决策依据
2. 修复持久化断裂：Suggestions 持久化到 SQLite，重启可恢复
3. 修复强制断裂：Decision Mode 从"君子协定"升级为"物理约束"
4. 优化注意力劫持：User Call 频率限制，减少低价值打扰

## 非目标

- 不引入新的 HITL 机制（Human-on-the-Loop 模式已足够）
- 不做"跳过人类审阅的 Stage Transition"（AI 必须能自主做技术决策，但 Stage Transition 必须可被人类审阅和干预）
- 本轮不实现"人类可用性感知"（UX 优化，优先级低于断裂点修复，可作为后续优化）
- 不修改对抗性审查机制（R1-R8 规则已完善）
- 不修改 merge 阶段的硬性阻断（已正确实现）

## 核心业务行为

| # | 场景 | 预期行为 |
|---|------|----------|
| B1 | 当用户查看 StageSuggestionCard 时 | 展示 gate_evidence 摘要（前 3 条 + 总数）、signal_type、目标阶段信息、可回退性。点击 Details 展示完整 gate_evidence 列表和对抗产物摘要 |
| B2 | 当服务重启时 | 未处理的 Suggestions 从 SQLite 恢复，用户审阅进度不丢失 |
| B3 | 当 Agent 通过 set_final_body 声明 decision_mode 为 suggestive 时 | 引擎校验必须包含 recommendation/reason/alternatives 三个字段，缺失任一字段则阻断推进，返回 SUGGESTIVE_MISSING_* 错误码 |
| B4 | 当同一 stage 内连续 user call 间隔 < 30s 时 | 合并通知，展示"您有 N 条未读通知"摘要，30s 阈值为初始值，可通过配置调整 |
| B5 | 当用户 Ignore 一个 suggestion 后，agent 重新发出相同 suggestion 时 | 系统应记录重复次数，超过 3 次时展示"该建议已被忽略 N 次"提示 |

## 设计

### 修复 1：信息断裂 → StageSuggestionCard 信息增强

**问题**：后端有 gate_evidence、signal_type、adversarial_artifact，但前端只有"建议推进到 X"。

**方案**：
- 后端 API 返回 `gate_evidence` 摘要（通过/未通过的项目）
- 后端 API 返回 `signal_type`（分歧/完成/共识）
- 前端 StageSuggestionCard 展示完整决策依据

**格式**：
```
[StageSuggestionCard]
建议推进：design → development

✅ Gate 通过：
  - design-01: Feature 文档已锁定
  - design-02: 无未解决争议

📋 信号类型：adversarial_consensus
👥 共识 speaker：架构师-1, 架构师-2

↩️ 可回退：是（可随时回退到 design）

[Confirm] [Ignore] [Details...]
```

**约束**：只展示摘要信息，不展示完整的对抗产物（避免信息过载）。

**Details 按钮行为**：
- 展示完整 gate_evidence 列表（所有通过/未通过的项目）
- 展示对抗产物摘要（independent_verification 的 actual_output 前 100 字符、adversarial_findings 的数量和状态）
- 不展示完整对抗产物 JSON（避免信息过载）

### 修复 2：持久化断裂 → Suggestion 持久化

**问题**：Suggestions 存储在进程内存中，重启丢失。

**方案**：
- 在 `StageTransitionSuggestion` 中增加 `id` 字段
- 持久化到 SQLite（新建 `stage_suggestion` 表）
- `startup-recovery.ts` 中增加 suggestions 恢复逻辑
- 已 confirm/ignore 的 suggestion 标记为 processed，不恢复

**表结构**：
```sql
CREATE TABLE IF NOT EXISTS stage_suggestion (
  id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  gate_evidence TEXT,
  adversarial_artifact TEXT,
  status TEXT DEFAULT 'pending',  -- pending | confirmed | ignored
  created_at INTEGER NOT NULL,
  processed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_stage_suggestion_stage_status ON stage_suggestion(stage_id, status);
```

**约束**：只持久化未处理的 suggestion，已 confirm/ignore 的定期清理。

### 修复 3：强制断裂 → Decision Mode 校验入口

**问题**：决策模式只是提示词规则，无代码强制。

**方案**：
- 在 `set_final_body` 的 signal 中增加 `decision_mode` 字段
- 取值：`autonomous` | `suggestive` | `requires_human`
- `suggestive` 模式必须包含 `recommendation`、`reason`、`alternatives` 字段
- AutoAdvanceEngine 对 `suggestive` 信号做格式校验，缺失必要字段时阻断

**校验规则**：
```
if signal_type === 'suggestive':
  if !recommendation: BLOCKED (SUGGESTIVE_MISSING_RECOMMENDATION)
  if !reason: BLOCKED (SUGGESTIVE_MISSING_REASON)
  if !alternatives: BLOCKED (SUGGESTIVE_MISSING_ALTERNATIVES)
```

**约束**：只校验格式，不校验内容正确性（那是对抗性审查的工作）。

**decision_mode 与 signal_type 的关系**：
- 两个字段独立，但有约束：suggestive 模式只适用于 `gate_complete` 和 `adversarial_consensus` 信号
- `signal_type: "disagreement"` + `decision_mode: "suggestive"` 是非法组合（分歧信号不需要 decision_mode）
- `signal_type: "gate_complete"` + `decision_mode: "autonomous"` 是合法组合（自主决策的 gate 完成）
- `signal_type: "adversarial_consensus"` + `decision_mode: "suggestive"` 是合法组合（给出建议的对抗共识）
- 缺失 decision_mode 时，默认为 `autonomous`（向后兼容）

### 修复 4：注意力劫持 → User Call 频率限制

**问题**：Agent 可以频繁呼叫用户，导致警报疲劳。

**方案**：
- 在 `Collaboration` 层增加 per-stage 的 user call 计数器
- 同一 stage 内，连续 user call 间隔 < 30s 时合并通知
- 合并后的通知格式："您有 N 条未读通知（来自 stage: {stage_key}）"
- 30s 阈值为初始值，可通过配置调整

**约束**：不阻断 agent 的呼叫能力，只优化通知策略。多个 agent 同时呼叫时，按 stage 维度合并，不按 agent 维度合并。

## 设计约束摘要

- **边界**：不引入新的 HITL 机制，不做"跳过人类审阅的 Stage Transition"，本轮不实现"人类可用性感知"
- **关键决策**：修复三个断裂点 + 一个优化，不是增加新机制
- **向后兼容**：现有 signal 格式仍可处理，decision_mode 为可选字段
- **语义不变量**：人类的确认权不可让渡，决策模式必须可验证
- **字段关系**：decision_mode 与 signal_type 独立，但 suggestive 模式只适用于 gate_complete 和 adversarial_consensus 信号

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件/层 | 变更类型 | 说明 |
|---|---|---|
| `StageSuggestionCard.tsx` | UI 增强 | 展示 gate_evidence、signal_type、可回退性 |
| `auto-advance.ts` | 持久化 | Suggestion 持久化到 SQLite，增加 decision_mode 校验 |
| `startup-recovery.ts` | 恢复逻辑 | 增加 suggestions 恢复 |
| `schema.ts` | 数据模型 | 新增 stage_suggestion 表 |
| `collaboration.ts` | 频率限制 | User Call 计数器和合并逻辑 |
| `T-01-行为准则.md` | 提示词 | 补充 decision_mode 声明要求 |

## 验收标准

- [ ] StageSuggestionCard 展示 gate_evidence 摘要（前 3 条 + 总数）和 signal_type
- [ ] StageSuggestionCard 的 Details 按钮展示完整 gate_evidence 列表和对抗产物摘要
- [ ] 服务重启后未处理的 Suggestions 恢复，UI 自动刷新
- [ ] suggestive 决策模式缺少必要字段时阻断推进，返回 SUGGESTIVE_MISSING_* 错误码
- [ ] decision_mode 与 signal_type 的非法组合被拒绝
- [ ] 同一 stage 内连续 user call 间隔 < 30s 时合并通知，展示"您有 N 条未读通知"
- [ ] 用户 Ignore 后 agent 重复发出相同 suggestion 超过 3 次时展示提示
- [ ] 现有测试通过，无回归

## 关联

- **前置**: F20260630jeds（人的介入边界优化）— 本 feature 修复其"最后一公里"断裂（已合入：a728062d）
- **前置**: F20260630uyj5（SOP 自动推进全链路修复）— 本 feature 在其基础上增加校验（已合入：888d84a5）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|---------|---------|---------|---------|--------|------|
| D1 | 是否实现"跳过人类审阅的 Stage Transition" | AI 必须能自主做技术决策 | Stage Transition 必须可被人类审阅和干预 | 不实现跳过人类审阅的 Stage Transition | 当前 AutoAdvanceEngine 的自动推进是正确的（gate 通过自动推进，但人类仍可审阅和干预）；AI 自主设计决策必须做，但 Stage Transition 不能跳过人类 | 架构师-1, 架构师-2, 用户 | 2026-07-01 |
| D2 | 是否引入"人类可用性感知" | 动态调整建议频率，优化用户体验 | 优先级低于断裂点修复 | 本轮不实现，作为后续优化 | 这是 UX 优化（检测用户在线状态、调整交互策略、积压建议摘要展示），不是过度设计，但优先级低于断裂点修复 | 架构师-1, 架构师-2, 用户 | 2026-07-01 |
| D3 | Decision Mode 校验深度 | 只校验格式 | 校验内容正确性 | 只校验格式 | 内容正确性是对抗性审查的工作，不是引擎的工作 | 架构师-1, 架构师-2 | 2026-07-01 |
| D4 | ~~偏好存储位置~~ | ~~新建表~~ | ~~复用 Issue Context~~ | ~~复用 Issue Context~~ | **已废弃（被 D6 覆盖）**：human.preference.* 机制已被 D6 决定移除 | 架构师-1, 架构师-2 | 2026-07-01 |
| D5 | Suggestion 持久化范围 | 只持久化未处理 | 持久化所有 | 只持久化未处理 | 已处理的 suggestion 无审计价值，定期清理 | 架构师-1, 架构师-2 | 2026-07-01 |
| D6 | 是否需要 human.preference.* 持久化机制 | 跨会话继承人类决策偏好 | 过度设计，现有路径已覆盖 | 不需要 | 设计决策记录在 Feature 文档，大问题走 evolution，两种路径都已存在 | 架构师-1, 架构师-2, 用户 | 2026-07-01 |

## 范围变更记录

| # | 变更类型 | 变更内容 | 原因 | 日期 |
|---|----------|----------|------|------|
| 1 | 删除 | 移除修复 4（偏好断裂 → 人类决策偏好持久化） | 用户指出"不要"有两种处理路径：大问题走 evolution，设计决策记录在 Feature 文档，不需要额外的 human.preference.* 机制 | 2026-07-01 |
| 2 | 修订 | 非目标章节措辞修订 | 用户指出"不做自动确认"措辞过于绝对，AI 必须能自主做技术决策；"人类可用性感知"不是过度设计，是 UX 优化 | 2026-07-01 |
| 3 | 修订 | 架构师-2 对抗性检视发现 11 项问题 | B3/B5 语义重叠合并、B4 边界条件补充、Details 按钮定义、decision_mode 与 signal_type 关系定义、suppress_user_call 移除、索引增加、D4 标记废弃、验收标准可测量化 | 2026-07-01 |
