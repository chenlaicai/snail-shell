---
id: F20260702uaww
title: Stage Suggestion 在存在未解决检视意见时仍建议推进
status: implemented
created_at: 2026-07-02
---

# F20260702uaww — Stage Suggestion 在存在未解决检视意见时仍建议推进

## 背景

用户反复报告：Stage Suggestion 卡片显示"AI 建议由 审查者-1 推进到 merge：存在 2 个待处理检视意见"。用户困惑：既然有问题，为什么还在建议推进？

## 根因分析

### 核心根因：Agent 违反 SOP，系统无拦截

SOP（cd-review SKILL.md）明确写了：
- "存在任何'待处理'项时，结论必须是'需要开发者继续处理'"（第 34 行）
- "存在未通过项时，不得建议推进，应继续处理检视意见"（第 72 行）

**但 agent 无视了这些规则**，在同一次 `set_final_body` 输出中同时写了"存在 2 个待处理检视意见"和 `stage_transition` 信号（target_key: "merge"）。这不是 R8 引擎的问题，不是 UI 时序的问题——是 **agent 层面的合规性失败**。

### 为什么 R8 没拦住？

R8 规则（auto-advance.ts:312-318）会在 `evaluate()` 时检查 `adversarial_findings` 的 disposition 并返回 `blocked`。但问题在 `detectStageTransition()` 的执行顺序（collaboration.ts:377-383）：

```
1. persistSuggestion(suggestion)     ← 先写 DB，卡片已可见
2. notifyConsumers(...)              ← 前端显示"建议推进"
3. evaluate()                        ← R8 在这里才检查，但卡片已经显示了
```

R8 拦住了自动推进（auto_advance），但没拦住卡片显示。用户看到的是一个**被 R8 阻止但仍然显示的建议**。

### 完整因果链

1. Agent 违反 SOP，发出 stage_transition 信号（reason 中承认有未解决问题）
2. `detectStageTransition()` 持久化信号 → 前端卡片显示："AI 建议推进到 merge"
3. `evaluate()` → R8 检查 findings → 返回 `blocked`（但结果不传达给前端）
4. 用户看到：建议推进 + 问题列表 + 可点击的 Confirm 按钮
5. 用户困惑：为什么有问题还在建议推进？

## [design-time] 决策记录

| 决策 | 正方论点 | 反方论点 | 结论 |
|------|----------|----------|------|
| 拦截位置：persist 前 vs evaluate 后 | persist 前拦截避免卡片闪现 | 需要提前访问数据 | persist 前拦截，独立硬编码检查（不依赖 config） |
| L1 是否依赖 auto_advance 配置 | 复用 R8 逻辑减少重复 | L1 是 SOP 合规性检查，不是自动推进策略，不应受 config 影响 | 不依赖，独立硬编码检查 disposition |
| Confirm 按钮是否需要引擎门控 | 防止手动绕过 R8 | 增加 advanceStage 复杂度 | 需要，纯内存操作无性能风险 |
| 前端是否需要展示评估状态 | 用户能看到 blocked 原因 | 需要改 API + 前端 | MVP 靠轮询收敛，WebSocket 推送降级为 follow-up |
| server 重启边界 | 需覆盖内存缓存丢失场景 | 增加验收标准 | 纳入，安全默认行为（evaluate 空 suggestions → blocked） |
| Prompt 强化是否纳入本 feature | 从根本上减少 agent 违规 | Prompt 调优周期长，不应阻塞系统级兜底 | 不纳入，记录为 follow-up |

## [design-time] 设计方案

### 核心业务行为

1. **当 review stage 的 adversarial_artifact 含未解决 findings（disposition=none）时，信号不得持久化、不得显示卡片**
2. **当用户手动推进（Confirm）时，必须经过引擎评估；评估不通过则拒绝推进**
3. **当引擎评估为 auto_advanced 时，卡片应自动更新为"已推进"**
4. **当引擎评估为 escalated 时，卡片显示"需人工决策"，Confirm 可点击**

### 推荐方案：信号拦截 + 后端门控 + 前端状态展示

**L1 — 信号拦截（核心修复）**：
`detectStageTransition()` 中，在 `persistSuggestion()` 之前，对 `adversarial_consensus` 信号做独立检查：如果 `adversarial_findings` 中存在 `disposition === "none"` 或空的项，拦截信号——不持久化、不通知前端、记录日志、返回 rejection 信号给调用方。此检查不依赖 `auto_advance` 配置，是 SOP 合规性强制执行。

**L2 — 手动推进门控**：
`advanceStage()` 方法中，在调用 `stagePort.advanceStage()` 前，先调用 `autoAdvanceEngine.evaluate()`。若返回 `blocked`，拒绝推进并返回错误。

**L3 — 前端状态展示**：
`listStageTransitionSuggestions()` 返回值中增加 `evaluation` 字段。`StageSuggestionCard` 按 action 分态渲染：blocked → 红色 + 禁用 Confirm；auto_advanced → 绿色"已自动推进"；escalated → 黄色"需人工决策"。

**设计理由**：
- L1 从源头拦截违规信号，用户不会看到矛盾的"有问题但建议推进"卡片
- L2 防止 Confirm 按钮绕过引擎（`evaluate()` 是纯内存操作，无 I/O）
- L3 让用户看到评估结果，React Query 已有轮询机制，无需 WebSocket 推送

### 关键约束

1. L1 的检查必须在 `persistSuggestion()` 之前执行，确保违规信号不进入 DB
2. L1 是 SOP 合规性检查，**不依赖 `auto_advance` 配置**——硬编码检查 `disposition === "none"` 或空
3. L2 的引擎评估必须使用**当前最新的 suggestions 列表**，不能只评估当前点击的那个
4. 当内存缓存无 suggestions 时（如 server 重启后），`advanceStage()` 应从 `stageSuggestionRepo` 读取并评估
5. L1 拦截时必须返回 rejection 信号给调用方，不能只记录日志

### 不兼容更新

无。纯增量改动，不改变现有 API 契约。

## 验收标准

1. 当 adversarial_artifact 含未解决 findings（disposition=none 或空）时，`detectStageTransition()` 拦截信号：不持久化、不通知前端、日志记录拦截原因、返回 rejection 信号给调用方
2. 当用户手动 Confirm 时，后端调用引擎评估，blocked 则返回 4xx
3. 当引擎评估为 auto_advanced 时，卡片在下次轮询更新为"已自动推进"
4. 当引擎评估为 escalated 时，卡片显示"需人工决策"，Confirm 可点击
5. 当 server 重启后内存缓存为空时，Confirm 从 DB 读取评估，安全默认 blocked
