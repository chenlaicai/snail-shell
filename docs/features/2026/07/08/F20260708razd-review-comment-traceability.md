---
id: F20260708razd
title: review-comment-traceability
tags: [bugfix, review, prompt, system]
modules: [review, prompt, sop]
doc_kind: spec
---

# F20260708razd [review] 审查者复检评论可追溯性

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

**特性类型**: bugfix（提示词+系统修复）
**创建日期**: 2026-07-08
**状态**: implemented

## 背景 [required]

### 问题描述

审查者在复检时报告 "rev-03 ✅ PR 评论已签名" 并附上评论链接，但该链接指向的是上一轮审查的旧评论。开发者更新代码后，审查者声称已完成复检，但实际上并未发布新的 PR 评论。用户怀疑审查者根本没有重新检视。

### 根因分析

问题跨越系统层和提示词层，共 5 个根因。**RC-5 是核心根因** -- cd-review skill 的措辞直接导致 AI 误解为"评论是一次性动作，复检不需要发新评论"。

**RC-1: rev-03 是 prompt 级 gate，零系统校验**

`gate-check.ts` 第 37 行：`default: return true;` - rev-01/rev-02/rev-03 始终通过。系统信任 agent 在 `reason` 字符串中的自证，不验证评论是否真实发布、URL 是否属于当前轮次。

**RC-2: 无 PR 评论 URL 的逐轮追踪**

Issue context 只存储 `pr_url`（PR 本身），不存储 `review_comment_url`（审查评论 URL）。系统不记录每轮审查的评论链接，无法检测 URL 是否为旧值。

**RC-3: 重新进入阶段的 kickoff 消息过于泛化**

`collaboration.ts` 第 555-557 行：重新进入时 kickoff 为 "重新进入 [review] 阶段。请先了解前序阶段的情况和变更，再开始工作。" - 没有明确要求发布新评论、不提旧评论 URL、不含复检专项指令。

**RC-4: cd-review skill 的复检流程缺少评论新鲜度要求**

`workflow.md` 第 53 行仅说 "在 PR 上明确回复最终复核通过"，没有要求发布新评论、将评论 URL 写入 issue context、验证 URL 与上一轮不同。

**RC-5（核心）: cd-review skill 的措辞导致 AI 误解评论是一次性动作**

cd-review skill 中 5 处措辞让 AI 理解为"PR 评论在首次检视时已完成，复检无需发新评论"：

| # | 位置 | 当前措辞 | 误解原因 |
|---|------|----------|----------|
| W1 | SKILL.md:100 | "PR 评论**已**按签名模板收尾" | "已"是过去时，AI 理解为"第一轮做过就行" |
| W2 | SKILL.md:115 | "rev-03 ✅ [证据：签名评论链接]" | "签名评论链接"不限当前轮次，旧链接即可 |
| W3 | SKILL.md:134 | "PR #123 评论**已签名**" | "已签名"是过去时，同 W1 |
| W4 | workflow.md:53 | "在 PR 上明确**回复**最终复核通过" | "回复"≠"发布新评论"，AI 理解为内部确认 |
| W5 | SKILL.md:85 | "PR 评论按签名规则**收尾**" | "收尾"暗示一次性结束动作 |

**关键对比**：首次检视有明确的"问题在 PR 上**评论**"指令（SKILL.md:44），但复检流程只说"**回复**最终复核通过" -- 用词从"评论"降级为"回复"，AI 理解为复检不需要发新评论。

### 当前代码

| 文件 | 关键位置 | 当前行为 |
|------|----------|----------|
| `src/app/issue-collaboration/gate-check.ts:37` | `default: return true` | rev-03 始终通过，无系统校验 |
| `src/app/issue-collaboration/collaboration.ts:555` | re-entry kickoff | 泛化消息，无 review 专项指令 |
| `src/app/issue-collaboration/_internal/system-prompt-builder.ts:61` | `buildContextBlock` | 无复检提示，不展示旧 `review_comment_url` |
| `data/file/skills/cd-review/SKILL.md:85` | 关键约束 | "PR 评论按签名规则收尾"，"收尾"暗示一次性 |
| `data/file/skills/cd-review/SKILL.md:100` | rev-03 gate | "PR 评论已按签名模板收尾"，"已"是过去时 |
| `data/file/skills/cd-review/SKILL.md:115` | Gate 证据模板 | "签名评论链接"，不限当前轮次 |
| `data/file/skills/cd-review/SKILL.md:134` | 信号协议示例 | "评论已签名"，"已"是过去时 |
| `data/file/skills/cd-review/references/workflow.md:53` | 复检流程 | "在 PR 上明确回复"，"回复"≠"发布新评论" |

## 目标 [required]

1. cd-review skill 的措辞消除"评论是一次性动作"的误解，明确每轮检视（含复检）必须发布新评论
2. 审查者必须将 PR 评论 URL 写入 issue context，系统通过 gate 校验其存在（防御纵深）
3. 重新进入 review 阶段时，系统提示中展示上一轮的 `review_comment_url`，明确要求发布新评论

## 非目标 [required]

- 不实现 GitHub API 级别的评论验证（如验证评论时间戳、评论内容签名）- 留作未来增强
- 不修改 Issue context 数据模型（不引入 per-reviewer 字段）- 当前使用共享 `review_comment_url` 字段
- 不修改 `review_round` 追踪机制 - 现有 `review_round` 仅用于 disagreement 升级，不扩展到普通复检轮次
- 不修改 kickoff 消息生成逻辑 - 复检提示通过 system prompt 注入，kickoff 保持泛化

## 用户意图锚 [required]

| # | 用户原话 | 来源 | 关键修饰语 | 架构师解读 |
|---|----------|------|------------|------------|
| UA-1 | "其实这一条评论是旧的评论" | 消息 #1 | 时序：旧的；条件：其实（与声明矛盾） | 审查者报告的评论 URL 属于上一轮审查，非当前复检轮次产生 |
| UA-2 | "开发者重新更新代码后" | 消息 #1 | 时序：更新代码后；主体：开发者 | 复检发生在开发者修复代码之后，是代码变更触发的重新审查 |
| UA-3 | "审查者重新检视完后并没有新评论" | 消息 #1 | 时序：重新检视完后；数量：并没有新评论；状态：没有 | 复检完成后 PR 上无新评论，审查者未留下复检证据 |
| UA-4 | "是否就没有重新检视呢" | 消息 #1 | 条件：是否就（质疑根本未执行） | 用户怀疑审查者根本没有执行复检，评论 URL 造假只是表象 |
| UA-5 | "为什么ai第一次检视就会评论，但第二次第三次后面的检视就不评论了，是否是当前的cd-review中写的让ai误解了" | 消息 #2 | 时序：第一次/第二次第三次；条件：是否让ai误解；主体：cd-review | 核心问题不在系统校验，而在 cd-review skill 的措辞本身导致 AI 误解评论是一次性动作 |

## 核心业务行为 [required]

| # | 场景 | 预期行为 | 追溯 | 测试覆盖 |
|---|------|----------|------|----------|
| B1 | 当审查者执行复检时 | cd-review skill 明确要求发布新 PR 评论（不得复用旧链接）、更新 `review_comment_url`、完整重新检视 PR diff | ← UA-1, UA-3, UA-4, UA-5 | P2 手动验证 |
| B2 | 当审查者完成 PR 评论发布时 | 必须通过 `set_context` 将评论 URL 写入 issue context 的 `review_comment_url` 字段 | ← UA-3 | P1 单元测试 + 手动验证 |
| B3 | 当审查者调用 `request_stage_transition` 时 | 系统校验 `review_comment_url` 存在于 issue context，不存在则 gate 失败阻断推进 | ← UA-3, UA-4 | P1 单元测试 |
| B4 | 当审查者重新进入 review 阶段时 | 系统提示中展示上一轮 `review_comment_url`，并明确指示发布新评论、更新该字段 | ← UA-1, UA-2 | P1 手动验证 |

## 设计 [required]

### 层 1（核心修复）：cd-review skill 措辞修正

修复 RC-5 识别的 5 处误导性措辞，消除 AI 对"评论是一次性动作"的误解。

#### 修改点 1a：rev-03 gate 措辞修正（W1）

**文件**: `data/file/skills/cd-review/SKILL.md` 第 100 行

**当前**：
```
| rev-03 | PR 评论已按签名模板收尾 | ✅ |
```

**修改后**：
```
| rev-03 | 每轮检视（含复检）均已在 PR 上发布新的签名评论，且评论 URL 已通过 set_context 写入 issue context 的 review_comment_url 字段 | ✅ |
```

**修正原因**：消除"已"的过去时误解，明确"每轮"和"新"。

#### 修改点 1b：Gate 自检证据格式修正（W2）

**文件**: `data/file/skills/cd-review/SKILL.md` 第 115 行

**当前**：
```
- rev-03 ✅ [证据：签名评论链接]
```

**修改后**：
```
- rev-03 ✅ [证据：本轮新发布的签名评论链接 + set_context review_comment_url 调用记录]
```

**修正原因**：明确"本轮新发布"，防止使用旧链接作为证据。

#### 修改点 1c：信号协议示例修正（W3）

**文件**: `data/file/skills/cd-review/SKILL.md` 第 134 行

**当前**：
```
rev-03: PR #123 评论已签名
```

**修改后**：
```
rev-03: PR #123 本轮新评论已签名，review_comment_url 已写入
```

**修正原因**：消除"已签名"的过去时误解，明确"本轮新评论"。

#### 修改点 1d：复检流程措辞修正（W4）

**文件**: `data/file/skills/cd-review/references/workflow.md` 第 53 行

**当前**：
```
5. 没有待处理问题时，在 PR 上明确回复最终复核通过
```

**修改后**：
```
5. 没有待处理问题时，在 PR 上**发布新的评论**明确回复最终复核通过（不得复用上一轮评论链接）
6. 通过 `set_context` 将新评论 URL 写入 issue context 的 `review_comment_url` 字段
```

**修正原因**：将"回复"改为"发布新的评论"，消除歧义；新增 set_context 步骤。

#### 修改点 1e：关键约束措辞修正（W5）

**文件**: `data/file/skills/cd-review/SKILL.md` 第 85 行

**当前**：
```
- PR 评论按签名规则收尾（规则见 cd-shared 的 `references/pr-signature.md`）
```

**修改后**：
```
- 每轮检视（含复检）均必须在 PR 上发布新的签名评论（规则见 cd-shared 的 `references/pr-signature.md`）
```

**修正原因**：消除"收尾"的一次性暗示，明确"每轮"和"新"。

#### 修改点 1f：Gotcha 新增

**文件**: `data/file/skills/cd-review/SKILL.md` Gotchas 列表

新增：
```
- **[HARD] 复检必须发布新评论**：重新进入 review 阶段时，必须在 PR 上发布新的评论（不得复用上一轮评论链接），并通过 set_context 更新 review_comment_url。rev-03 gate 每轮都需满足，不是一次性检查。
```

### 层 2（防御纵深）：系统级 gate + system prompt 复检提示

#### 修改点 2a：rev-03 升级为系统级 gate

**文件**: `src/app/issue-collaboration/gate-check.ts`

在 `default` 之前添加 `rev-03` case：
```typescript
case "rev-03": {
  /** 检查 issue context 中是否有 review_comment_url */
  return !!resolveContextValue(ctx, "review_comment_url");
}
```

**原理**：与 `rev-04`（检查 `feature_number`）和 `dev-04`（检查 `pr_url`）一致的模式。系统校验 `review_comment_url` 字段存在，作为提示词修复的防御纵深。

**gate_ids 注释更新**：`default` 注释从 `rev-01, rev-02, rev-03` 改为 `rev-01, rev-02`。

#### 修改点 2b：system prompt 复检提示

**文件**: `src/app/issue-collaboration/_internal/system-prompt-builder.ts`

在 `buildContextBlock` 方法中，阶段历史之后、当前阶段之前，添加复检提示区块。

**触发条件**：
1. `isStageReEntry(stages, stage.id)` 为 true
2. `stage.key === "review"`
3. issue context 中存在 `review_comment_url`

**注入内容**：
```
## 复检提示
检测到重新进入 review 阶段。
上一轮 review_comment_url: {当前 context 中的值}
复检时必须：
1. 发布新的 PR 评论（不得复用上一轮的评论链接）
2. 通过 set_context 更新 issue context 中的 review_comment_url 字段
3. 完整重新检视 PR diff（不能只确认单条评论是否已处理）
```

**实现要点**：
- 需要在 `buildContextBlock` 中调用 `this.deps.stagePort.listStages(issue.id)` 和 `isStageReEntry`
- `isStageReEntry` 和 `buildStageChain` 从 `@domain/issue/_internal/stage-chain` 导入
- 复检提示区块插入位置：阶段历史区块之后、`## 当前阶段` 之前
- **可见范围**：`buildContextBlock` 是全角色共享方法，复检提示对 review 阶段所有角色可见（含开发者）。开发者看到上一轮 URL 有助于理解上下文，无害。

> **[D1]** 复检提示放在 system prompt 而非 kickoff 消息中。正方：(1) system prompt 每次调用都重建，始终可见；(2) kickoff 消息可能被后续对话淹没；(3) system prompt 中已有 issue context 和阶段历史，复检提示是自然延伸。反方：kickoff 消息更即时，agent 第一时间看到。依据：持久可见性优先于即时性。

### 不需要修改的部分

- `code-delivery.yaml` - rev-03 已在 `gate_ids` 中，无需新增配置
- `collaboration.ts` - kickoff 消息保持泛化，复检提示通过 system prompt 注入
- `auto-advance.ts` - `review_round` 逻辑不变，不扩展到普通复检轮次

## 生效路径 [required]

- 提示词（核心）：`data/file/skills/cd-review/SKILL.md`（5 处措辞修正 + Gotcha 新增）
- 提示词（核心）：`data/file/skills/cd-review/references/workflow.md`（复检流程措辞修正 + set_context 步骤）
- 系统代码（防御纵深）：`src/app/issue-collaboration/gate-check.ts`（rev-03 系统校验）
- 系统代码（防御纵深）：`src/app/issue-collaboration/_internal/system-prompt-builder.ts`（复检提示注入）
- 无配置变更、无 API 变更、无数据库 schema 变更

## 设计约束摘要 [required]

### 硬约束（违反即 bug）
- cd-review skill 中不得出现"已签名"、"收尾"等暗示一次性动作的措辞
- rev-03 系统校验必须与 rev-04 同模式（检查 context 字段存在性）
- 复检提示仅在 review 阶段重新进入时注入，不干扰其他阶段或其他 stage 重新进入
- `review_comment_url` 是共享字段，两个审查者都写入（最后写入者覆盖），gate 校验仅检查存在性

### 语义不变量（实现中必须保持为真）
- rev-03 gate 失败时，auto-advance 被阻断，返回 GATE_FAILED 错误
- 复检提示中的 `review_comment_url` 值来自 issue context 当前快照
- 首次进入 review 阶段时（非重新进入），不注入复检提示

### 非目标（不得扩展）
- 不实现 GitHub API 验证评论真实存在
- 不实现 per-reviewer 的 `review_comment_url` 字段
- 不修改 kickoff 消息内容
- 不修改 `review_round` 追踪逻辑

## 改动范围 [required]

| 文件 | 改动类型 | 层级 | 说明 |
|------|---------|------|------|
| `data/file/skills/cd-review/SKILL.md` | 修改 | 层 1 核心 | 5 处措辞修正（W1-W3, W5）+ Gotcha 新增 + Gate 证据格式更新 |
| `data/file/skills/cd-review/references/workflow.md` | 修改 | 层 1 核心 | 复检流程措辞修正（W4）+ 新增 set_context 步骤 |
| `src/app/issue-collaboration/gate-check.ts` | 修改 | 层 2 防御 | 添加 `rev-03` case，检查 `review_comment_url` 存在 |
| `src/app/issue-collaboration/_internal/system-prompt-builder.ts` | 修改 | 层 2 防御 | `buildContextBlock` 添加复检提示区块 |

## 验证 [required]

### P1 单元测试

- [ ] `gate-check.ts`: `rev-03` 在 `review_comment_url` 不存在时返回 `false`
- [ ] `gate-check.ts`: `rev-03` 在 `review_comment_url` 存在时返回 `true`
- [ ] `gate-check.ts`: `rev-01`、`rev-02` 仍然返回 `true`（prompt 级不变）
- [ ] `system-prompt-builder.ts`: 重新进入 review 阶段且 context 有 `review_comment_url` 时，输出包含"复检提示"
- [ ] `system-prompt-builder.ts`: 首次进入 review 阶段时，输出不包含"复检提示"
- [ ] `system-prompt-builder.ts`: 重新进入非 review 阶段时，输出不包含"复检提示"

### P1 手动验证

- [ ] 审查者完成首次审查，存储 `review_comment_url`，rev-03 gate 通过
- [ ] 审查者未存储 `review_comment_url`，rev-03 gate 失败，auto-advance 被阻断
- [ ] 重新进入 review 阶段时，系统提示包含"复检提示"和上一轮 `review_comment_url`
- [ ] 审查者发布新评论并更新 `review_comment_url`，rev-03 gate 通过

### P2 手动验证

- [ ] cd-review skill 加载后，rev-03 gate 描述包含"每轮检视"和"新评论"
- [ ] cd-review SKILL.md 中无"已签名"、"收尾"等过去时措辞
- [ ] cd-review workflow.md 复检流程包含"发布新的评论"和"set_context"步骤
- [ ] 复检时 AI 实际发布新 PR 评论（端到端验证）

### 通用

- [ ] `npm run check` 通过

## 关联 [required]

- **相关 SOP**: `data/file/sops/code-delivery/code-delivery.yaml`（review 阶段定义）
- **相关 skill**: `data/file/skills/cd-review/SKILL.md`、`data/file/skills/cd-shared/references/pr-signature.md`
- **gate 模式参考**: `rev-04`（feature_number 格式校验）、`dev-04`（pr_url 存在性校验）

## 关键决策记录 [required]

| # | 决策点 | 最终决策 | 正方 | 反方 | 状态 |
|---|--------|----------|------|------|------|
| D1 | 复检提示位置 | system prompt 注入 | 每次调用都重建，始终可见；已有 context 和 stage history 作为自然延伸 | kickoff 消息更即时，agent 第一时间看到 | 已确认（架构师-2 审视通过） |
| D2 | review_comment_url 存储方式 | 共享字段，最后写入者覆盖 | 简单，gate 仅检查存在性；PR 评论本身在 GitHub 可追溯 | 两个审查者互相覆盖，丢失一方 URL | 已确认（架构师-2 审视通过，风险调为中级） |
| D3 | URL 新鲜度校验 | 不实现系统级新鲜度校验 | 避免快照上下文的复杂度；system prompt 展示旧值提供可见性 | 无法技术性阻止复用旧 URL | 已确认（架构师-2 审视通过） |
| D4 | 修复优先级 | 提示词修复为层 1 核心，系统级为层 2 防御纵深 | 用户指出核心问题在 cd-review 措辞误导 AI，提示词修复直接解决根因 | 系统级 gate 提供更强校验 | 已确认（用户反馈驱动） |

## 风险与缓解 [required]

| # | 风险 | 严重程度 | 影响 | 缓解策略 | 负责方 |
|---|------|----------|------|----------|--------|
| R1 | 审查者存储旧 URL 仍能通过 gate | 中 | gate 仅检查存在性，不检查 URL 是否为当前轮次产生 | 层 1 措辞修正从源头消除误解；system prompt 展示上一轮 URL 提供可见性 | 架构师 |
| R2 | 两个审查者共享 `review_comment_url` 字段 | 中 | 审查者-2 覆盖审查者-1 的 URL，gate 无法检测单个审查者是否写了 URL | gate 仅检查存在性，PR 评论本身在 GitHub 可追溯；system prompt 展示旧 URL + skill 要求新评论 = 多层防御；如需 per-reviewer 追踪可在未来迭代扩展 | 架构师 |
| R3 | system-prompt-builder 新增 stagePort 调用 | 低 | 每次 system prompt 构建多一次 `listStages` 调用 | `listStages` 已在 `buildStageHistoryBlock` 中调用，可复用结果 | 开发者 |
| R4 | 提示词修正后 AI 仍不发布新评论 | 低 | 措辞修正无法 100% 保证 AI 行为 | 层 2 系统级 gate 阻断推进 + system prompt 复检提示提供双重保障 | 架构师 |
