---
id: F20260706fgp5
title: post-refactor-cleanup
from_ids: [F20260706x7kq]
tags: [issue-collaboration, cleanup, documentation]
modules: [issue-collaboration, snail-mcp-server, sop]
doc_kind: spec
change_type: refactor
---

# F20260706fgp5 F20260706x7kq 后续清理：过时文档 + 代码重复 + 死代码

## 背景

F20260706x7kq（Stage 推进工具：分离推进意图与产物校验）移除了 `adversarial_artifact`、`gate_evidence`、`decision_mode` 等字段和 R1-R8 校验规则，但留下一批残留物：过时文档、引用已移除字段的 fix_guidance、L1/L2 校验逻辑重复、死代码、持久化层 null 写入。

本 Feature 不改变系统行为，只清理残留，使代码库与 F20260706x7kq 的设计意图一致。

## 用户意图锚

| ID | 用户原话 | 来源 | 关键修饰语 | 架构师解读 |
|----|---------|------|-----------|-----------|
| UA-1 | "架构师每次答复中的一大坨是啥内容啊{"stage_transition"}，这一大部分感觉消耗了很多token" | 消息 #1 | 每次答复、一大坨、消耗很多token | 用户关注 token 消耗，F20260706x7kq 已解决核心问题 |
| UA-2 | "每个agent会发大片的这些，但是实际校验又老是报错" | 消息 #3 | 每个agent、大片、老是报错 | 校验常错是用户体验问题，F20260706x7kq 已移除复杂校验 |
| UA-3 | "如果我要你基于当前代码继续优化分析呢" | 消息 #7 | 基于当前代码、继续优化 | 用户要求在 F20260706x7kq 基础上识别后续优化点 |
| UA-4 | "按照流程来，你调整本issue目标为这个" | 消息 #9 | 按照流程、调整目标 | 用户要求按正式流程产出 Feature 文档 |

## 设计方案

### 变更范围

#### 变更 1：删除 `adversarial-artifact-protocol.md`

**问题**：该文件（156 行）描述的 `AdversarialArtifact` 接口、R1-R8 规则、`disposition` 取值表全部对应已移除的功能。agent 通过 skill 加载后会遵循废弃协议。

**处置**：删除文件。R2-R5 降级后的 prompt 级约束已在各 SKILL.md 中体现，不需要独立协议文档。

← UA-1, UA-2

#### 变更 2：修复 `gate-metadata.ts` 中的过时引用

**问题**：5 处引用已移除的字段：

| 位置 | 当前值 | 修正为 |
|------|--------|--------|
| `rev-01` check | "确认两位审查者的 adversarial_artifact 均已提交" | "确认两位审查者都已调用 request_stage_transition 发出共识信号" |
| `rev-02` check | "确认 adversarial_findings 中每项 disposition 已填写且不为 'none'" | "确认所有 PR 评论中的问题已得到开发者回应" |
| `rev-03` check | "确认 file_coverage.coverage_ratio = 1.0" | "确认 PR diff 中的所有文件均已审查" |
| fallback check | "确认 gate_evidence[\"${gate}\"] 为非空字符串" | "确认系统检查条件满足" |
| fallback doc_ref | "cd-shared/references/adversarial-artifact-protocol.md" | "cd-shared/references/stage-gate.md" |

同时修复 `gate-metadata.ts` line 3 注释：`snail-signal-validation` → `signal-validation`。

← UA-3

#### 变更 3：修复 `sop/model.ts` 注释残留

**问题**：`AutoAdvanceConfig` 注释引用 `gate_evidence`，已移除。

**处置**：注释改为描述当前语义——"系统自动检查的 gate ID 列表"。

← UA-3

#### 变更 4：提取 L1/L2 共享校验函数

**问题**：`signal-validation.ts`（L1）和 `auto-advance.ts`（L2）各自实现部分相同逻辑。gate 检查逻辑已通过 `gate-check.ts` 共享（F20260706x7kq 已完成），但 context fields 和 blocking rules 仍重复：

| L1 函数 | L2 函数 | 逻辑 | 状态 |
|---------|---------|------|------|
| `validateContextFields` | `getMissingContextFields` | 检查 required_context_fields | **重复** — 相同逻辑，不同数据源 |
| `validateSystemGates` | `getFailedGates` | 检查 system gate 条件 | **已共享** — 均调用 `gate-check.ts` |
| `validateBlockingRules` | `checkBlockingRules` | 检查 incompatible_tag | **重复** — 相同逻辑，不同数据源 |

**处置**：在 `gate-check.ts` 中新增 2 个共享函数（context fields、blocking rules），L1 和 L2 各自调用。保留 L1/L2 各自的编排逻辑（L1 fast-fail 单信号，L2 聚合多信号）。

**关键约束**：不改变校验的语义和行为，只消除代码重复。统一 fix_guidance 产出——不一致性来自 `gate-metadata.ts` 的 `buildGateFixGuidance` fallback（变更 2 修复后自动统一），L1 无需改动。

← UA-3

#### 变更 5：删除死代码

- `auto-advance.ts`：删除 `allGatesPassed` 方法（零调用者，架构师-2 已验证）
- `signal-validation.ts`：删除未使用的 `SignalType` 导入

← UA-3

#### 变更 6：清理持久化层 null 写入

**问题**：`collaboration.ts` `persistSuggestion` 永远写 `gate_evidence: null, adversarial_artifact: null, decision_mode: null, recommendation: null, alternatives: null`。`restoreSuggestions` 不读这些字段。

**处置**：`persistSuggestion` 中移除这 5 个 null 写入。`StageSuggestionRecord` 类型定义中移除这 5 个字段。DB 列保留（铁律：不删列），但代码不再引用。

**关键约束**：不执行 ALTER TABLE，DB 列保留为 nullable TEXT。`restoreSuggestions` 中对应的解析逻辑也已移除（不读这些字段）。

← UA-3

#### 变更 7：更新 3 个 skill reference 文件中的过时引用

**问题**：主 SKILL.md 已在 F20260706x7kq 中更新，但 3 个 reference 文件仍引用已废弃的 `adversarial_artifact` 和将被删除的 `adversarial-artifact-protocol.md`：

| 文件 | 问题内容 |
|------|----------|
| `cd-design/references/cross-review.md` L7-14 | "对抗产物协议"段落，要求 `adversarial_artifact` + `critique_obligation` + `scenario_coverage` |
| `cd-design/references/cross-review.md` L150-152 | 战术适配引用 `scenario_coverage.constructed_scenarios` 和 `adversarial_findings` |
| `cd-review/references/cross-review.md` L7-15 | "对抗产物协议"段落，要求 `file_dispositions` + `cross_review` + `ci_independence` + `file_coverage` |
| `cd-review/references/adversarial-check.md` L7-9 | "对抗产物要求"段落，要求 `adversarial_artifact` |
| `cd-review/references/adversarial-check.md` L18 | 检查维度引用 `adversarial_findings` |
| `cd-review/references/adversarial-check.md` L26 | 战术适配引用 `file_coverage` |

**处置**：
- 移除"对抗产物协议"段落（`adversarial_artifact` 字段要求）
- 保留方法论内容（质疑义务、检查维度、禁用话术等仍有价值）
- 移除对 `scenario_coverage`、`adversarial_findings`、`file_coverage` 字段的引用
- 将"详见 adversarial-artifact-protocol.md"的引用替换为对当前 SKILL.md 信号协议的引用

← UA-1, UA-2, UA-3

## 核心业务行为

| ID | 场景 | 预期行为 | 追溯 |
|----|------|---------|------|
| B1 | Agent 通过 skill 加载参考文件时 | 不再加载 `adversarial-artifact-protocol.md`（文件已删除） | ← UA-1, UA-2 |
| B2 | Gate 校验失败时，系统返回 fix_guidance | fix_guidance 中的 check 描述引用当前机制（request_stage_transition、PR 评论），不引用已移除的字段 | ← UA-3 |
| B3 | L1 校验和 L2 校验对同一个 gate 失败 | 返回相同的 fix_guidance（使用同一份 GATE_METADATA 查询） | ← UA-3 |
| B4 | 信号持久化时 | `persistSuggestion` 不再写入 5 个 always-null 字段，DB 列保留但不引用 | ← UA-3 |

## 非目标

- 不改变校验语义或阻断行为
- 不删除 DB 列（铁律禁止 ALTER TABLE）
- 不新增系统侧检查
- 不改变 `request_stage_transition` 工具行为
- 不改变 SOP 配置

## 关键决策记录

### 决策 1：删除 vs 重写 `adversarial-artifact-protocol.md`

- **决策点**：是删除文件还是重写为 prompt 级约束说明？
- **正方论点（架构师-1）**：R2-R5 降级后的 prompt 级约束已在各 SKILL.md 中体现，独立协议文档是冗余
- **反方论点（架构师-2）**：3 个 reference 文件（`cd-design/references/cross-review.md`、`cd-review/references/cross-review.md`、`cd-review/references/adversarial-check.md`）引用该文档，删除前需同步更新
- **最终决策**：删除 + 更新 3 个 reference 文件（变更 7）。prompt 级约束分散在各 SKILL.md 中更合理——设计约束在 cd-design，审查约束在 cd-review
- **决策依据**：避免文档分散导致不一致。SKILL.md 是 agent 直接加载的文件，协议文档需要额外加载
- **参与者**：架构师-1、架构师-2

### 决策 2：L1/L2 共享函数的放置位置

- **决策点**：共享校验函数放在 `gate-check.ts` 还是新建文件？
- **正方论点（架构师-1）**：`gate-check.ts` 已有 `checkSystemGate` 和 `inferSignalType`，同属"gate 检查"领域
- **反方论点**：无
- **最终决策**：放在 `gate-check.ts`，扩展已有文件
- **决策依据**：功能内聚，减少文件数量
- **参与者**：架构师-1、架构师-2
### 决策 3：DB 列处置

- **决策点**：DB 中 5 个 always-null 列如何处置？
- **正方论点**：代码不再引用，DB 列保留（铁律）
- **反方论点**：无
- **最终决策**：代码层移除引用，DB 列保留为 nullable TEXT，在 `## 不兼容更新` 中记录
- **决策依据**：系统铁律禁止 ALTER TABLE，CREATE TABLE IF NOT EXISTS 中保留列定义
- **参与者**：架构师-1、架构师-2
## 变更影响分析

### 后端

- **`gate-check.ts`**：新增 2 个共享校验函数（context fields、blocking rules），gate 检查已由 F20260706x7kq 共享
- **`signal-validation.ts`**：调用共享函数，删除重复实现，删除未使用导入
- **`auto-advance.ts`**：调用共享函数，删除重复实现，删除 `allGatesPassed` 死方法
- **`gate-metadata.ts`**：修复 5 处过时引用，修复注释
- **`sop/model.ts`**：修复注释
- **`collaboration.ts`**：`persistSuggestion` 移除 5 个 null 写入，`restoreSuggestions` 移除对应解析
- **`issue/_internal/repository.ts`**：`StageSuggestionRecord` 类型定义移除 5 个字段（DB 列保留）

### 文档

- **删除**：`data/file/skills/cd-shared/references/adversarial-artifact-protocol.md`
- **更新**：`data/file/skills/cd-design/references/cross-review.md`（移除对抗产物协议段落和字段引用）
- **更新**：`data/file/skills/cd-review/references/cross-review.md`（同上）
- **更新**：`data/file/skills/cd-review/references/adversarial-check.md`（移除对抗产物要求和字段引用）

### 前端

- 无影响

### 提示词/SOP

- **删除**：`data/file/skills/cd-shared/references/adversarial-artifact-protocol.md`
- **更新**：`cd-design/references/cross-review.md`（移除对抗产物协议段落和字段引用）
- **更新**：`cd-review/references/cross-review.md`（同上）
- **更新**：`cd-review/references/adversarial-check.md`（移除对抗产物要求和字段引用）

## 不兼容更新

- `adversarial-artifact-protocol.md` 文件删除——3 个 reference 文件中的引用已同步更新（变更 7）
- 3 个 skill reference 文件内容变更——移除对抗产物协议段落，保留方法论内容
- `StageSuggestionRecord` 类型移除 5 个字段——无外部消费者，仅 `issue-collaboration` 内部使用
- `stage_suggestion` 表的 5 列（`gate_evidence`、`adversarial_artifact`、`decision_mode`、`recommendation`、`alternatives`）保留在 schema 中但不再由代码写入或读取

## [design-time]

### 设计锁定状态

- 架构师-2 审视完成，阻断项（变更 7）已纳入，修正 1-4 已更新
- 双方无未解决争议

### 交叉审视记录

- **Phase 1（独立分析）**：架构师-1 完成 auto-advance 引擎深度分析 + 业界对比 + F20260706x7kq 后续审查
- **Phase 2（交换对抗）**：架构师-2 审视 F20260706x7kq 的方案，提出 3 个缺口（R8/findings_resolution、系统侧检查定义、三层架构保留）
- **Phase 3（合并收敛）**：双方就 F20260706x7kq 已实现部分达成共识（选项 A）。架构师-1 进一步审查发现 8 个残留问题，用户要求按流程产出 Feature 文档
- **Phase 4（文档审视）**：架构师-2 审视 Feature 文档，提出 1 个阻断项（3 个 reference 文件遗漏）+ 4 个修正项，全部采纳

### 质疑义务产出

**风险点**：
1. ~~删除 `adversarial-artifact-protocol.md` 后，如有其他 SKILL.md 文件引用它，会导致引用断裂~~ — 架构师-2 已确认 3 个 reference 文件引用，变更 7 已纳入
2. L1/L2 共享函数提取时，如果两层的 context 解析方式有细微差异（如 `resolveContextValue` 的使用），可能导致行为变化

**遗漏场景**：
1. ~~`gate-metadata.ts` 的 fallback fix_guidance 在 L1 和 L2 中可能对同一 gate 产生不同描述~~ — 变更 2 修复 `buildGateFixGuidance` 后自动统一

**替代方案**：
1. 不提取共享函数，只修复 fix_guidance 不一致——更小改动量，但重复代码保留
