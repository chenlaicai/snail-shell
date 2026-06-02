---
id: I2026060201
title: sop-role-handbook-refactor
from_ids: []
tags: [sop, workflow, boundary, prompt-center, refactoring]
modules: [prompts, workflow]
doc_kind: spec
---

# I2026060201 [prompts/workflow] SOP 角色手册归属重构 + 设计者角色边界定义

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

### 问题 1：设计者角色边界缺失

S-09 设计者手册定义了设计者"做什么"，但**完全没有定义"不做什么"**。具体缺失：

1. **无角色边界声明**——没有明确"设计者只产出设计，不碰实现"
2. **对抗性审视要点越界**——"实现复杂度是否合理？"直接引导设计者思考实现细节
3. **无反模式警示**——设计者自然滑向"我来改代码"时，没有任何机制拉回来

### 问题 2：角色手册归属错位

角色手册（S-03 研发者、S-04 检视者、S-09 设计者、S-10 合入者、S-08 演进执行者）当前存放在全局 prompt 池（`.meta/prompts/prompts/`）中，通过 `when.roles` 条件注入机制驱动。同时 SOP YAML 中的 `handbook_prompt_ref` 字段也存储了角色→手册的映射关系。

**两个独立机制做同一件事**：

| 机制 | 位置 | 作用 |
|---|---|---|
| `when.roles` on prompt docs | `.meta/prompts/prompts/S-0X.md` frontmatter | 实际驱动 prompt 注入 |
| `handbook_prompt_ref` on SOP roles | `.meta/sop/code-delivery.yaml` roles[] | 仅存储元数据，无实际调用者 |

这导致：
1. **归属不清** — 手册明明是角色的行为契约，却放在通用 prompt 池里，和 `S-05-mention提取`、`S-06-会话摘要` 这种平台能力混在一起
2. **条件注入冗余** — prompt 文件的 `when.roles` 和 SOP 的 `handbook_prompt_ref` 做了同一件事，维护两处容易不一致
3. **`handbook_prompt_ref` 成了死代码** — `resolveHandbookRef()` 已导出但无调用者

## 目标

### P1 — 设计者角色边界定义

在 S-09 设计者手册中新增角色边界约束，明确设计者的职责范围，防止越界到实现层面。

### P2 — 角色手册注入统一

消除双重注入机制，让 `handbook_prompt_ref` 成为角色手册注入的唯一驱动路径。

## 非目标

- 不改变设计/研发/检视/合入的工作流程
- 不改变 prompt 文件的物理位置（仍放在 `.meta/prompts/prompts/`）
- 不引入新的工具或自动化机制
- 不修改 S-08 演进执行者的注入方式（`when.owner_types` 按 conversation 类型匹配，语义不同，保留）

## 设计

### P1 详设：设计者角色边界

**方案**：在 S-09 中新增「角色边界」段落 + 修正审视要点

**具体修改（3 处）**：

**1. 新增角色边界段落**

在"设计者手册"标题下、工作流程之前，新增：

```markdown
## 角色边界

设计者**只负责**需求对齐、方案设计和交叉审视，**不负责**实现。

| 设计者职责 | 非设计者职责（禁止） |
|---|---|
| 理解需求、定义问题边界 | 编写或修改代码 |
| 提出设计方案、记录取舍 | 制定实现步骤或伪代码 |
| 交叉审视方案的完备性和风险 | 直接执行文件创建/修改 |
| 产出锁定的 Issue 文档 | 提议具体的代码修改方案 |

**自检规则**：如果发现自己在说"具体修改 XX 文件的 XX 行"，立即停止——这是研发者的活。
```

**2. 修正对抗性审视要点**

将"实现复杂度是否合理？"改为"设计复杂度是否合理？"，避免引导设计者关注实现细节。

**3. 新增自检清单行**

在自检清单表格中新增：

```markdown
| 角色边界 | 未提出代码修改方案 · 未越界到实现细节 · 输出仅为设计产物 |
```

### P2 详设：角色手册注入统一

**方案**：将 `handbook_prompt_ref` 从死元数据升级为实际注入路径，从手册 prompt 中移除 `when.roles` 条件过滤。

**核心思路**：

```
改动前：
  prompt-center 发现 S-03 (when.roles: [研发者]) → 注入  ← 实际路径
  SOP YAML handbook_prompt_ref: "global:S-03"            ← 死元数据

改动后：
  prompt-center 读取 activeRole → handbook_prompt_ref → 查找 S-03 → 注入  ← 唯一路径
  S-03 frontmatter 无 when.roles                                ← 不再参与条件发现
```

**具体修改（6 个文件）**：

**1. 四个角色手册 prompt 移除 `when.roles` 过滤**

从以下文件的 frontmatter 中移除 `when.roles` 块：

- `.meta/prompts/prompts/S-03-研发者手册.md` — 移除 `when: roles: [研发者]`
- `.meta/prompts/prompts/S-04-检视者手册.md` — 移除 `when: roles: [检视者]`
- `.meta/prompts/prompts/S-09-设计者手册.md` — 移除 `when: roles: [设计者]`
- `.meta/prompts/prompts/S-10-合入者手册.md` — 移除 `when: roles: [合入者]`

S-08 保留 `when.owner_types: [evolution]` 不变——它按 conversation 类型匹配，语义不同于角色手册。

**2. prompt-builder 新增 `resolveHandbookPrompt()` 并注入**

在 `src/prompt-center/builder.ts` 中：

```typescript
const HANDBOOK_IDS = new Set(["S-03", "S-04", "S-08", "S-09", "S-10"]);

function resolveHandbookPrompt(context: PromptBuildContext, allPrompts: PromptDocument[]): PromptDocument | null {
  // 从 stageDefinition.roles[] 中查找 activeRole 的 handbook_prompt_ref
  const activeRoleKey = context.activeRole?.key;
  if (!activeRoleKey) return null;
  const stageRole = context.stageDefinition.roles?.find((r: any) => r.key === activeRoleKey);
  if (!stageRole?.handbook_prompt_ref) return null;
  const ref = resolveHandbookRef(stageRole.handbook_prompt_ref);
  if (!ref) return null;
  return allPrompts.find((p) => p.id === ref.id) ?? null;
}
```

**3. prompt-builder 在 `assembleSystemPrompt` 之前注入手册**

在 `buildConversationCapability()` 中：

```typescript
// Exclude handbook prompts from normal discovery (now driven by handbook_prompt_ref)
const assemblyPrompts = allPrompts.filter(
  (p) => p.id !== "S-05" && p.id !== "S-06" && !HANDBOOK_IDS.has(p.id)
);

// Inject handbook via handbook_prompt_ref
const handbookPrompt = resolveHandbookPrompt(context, allPrompts);

const result = assembleSystemPrompt({
  prompts: assemblyPrompts,
  matchContext,
  variables,
});

// Append handbook to SOP layer
if (handbookPrompt) {
  const rendered = renderPromptTemplate(handbookPrompt.content, variables)
    .replace(/^## [^\n]*\n+/, "");
  result.systemReminder = rendered + "\n\n" + result.systemReminder;
  result.activePromptIds.unshift(handbookPrompt.id);
}
```

**为什么保留 S-08 在 HANDBOOK_IDS 中**：S-08 通过 `when.owner_types` 匹配，虽然不需要 `handbook_prompt_ref` 驱动，但从架构一致性角度，所有手册都应通过 HANDBOOK_IDS 排除正常发现路径。S-08 的 `when.owner_types` 仍会使其被正常发现——但因为我们把它排除在 assemblyPrompts 之外，它需要通过其他方式注入。实际上 S-08 由 evolution conversation 的 owner_type 匹配，不在 code-delivery SOP 中，所以需要保留其 `when.owner_types` 作为注入路径。

**修正**：S-08 不应加入 HANDBOOK_IDS。它不在 code-delivery SOP 的角色定义中，没有 `handbook_prompt_ref`，需要保留 `when.owner_types` 作为注入路径。

```typescript
const HANDBOOK_IDS = new Set(["S-03", "S-04", "S-09", "S-10"]);
// S-08 excluded: uses when.owner_types for evolution conversations, not handbook_prompt_ref
```

**设计取舍**：

| 取舍 | 选择 | 理由 |
|---|---|---|
| 手册文件是否迁移位置 | 不迁移 | 改动最小，prompt-center 发现机制不变，只改注入路径 |
| S-08 是否一并重构 | 不重构 | S-08 按 conversation 类型匹配（非角色），语义不同，保留 `when.owner_types` |
| 手册是否保留 `layer: sop` | 保留 | 手册是 SOP 层内容，排序优先级应高于 platform 层 |
| 是否修改 `validatePromptCount` | 不修改 | 手册从"发现+注入"变为"仅显式注入"，活跃 prompt 数不变（SOP 层：stage prompt + handbook = 2，在 3 以内） |

## 生效路径

- 修改 4 个角色手册 prompt 文件（移除 `when.roles`）
- 修改 `src/prompt-center/builder.ts`（新增 `resolveHandbookPrompt` + 注入逻辑）
- 下次加载系统提示词时自动生效

<!-- [design-time] 章节结束 -->

## 改动范围

- `.meta/prompts/prompts/S-03-研发者手册.md` — 新增 `when.roles: [研发者]`
- `.meta/prompts/prompts/S-04-检视者手册.md` — 新增 `when.roles: [检视者]`
- `.meta/prompts/prompts/S-09-设计者手册.md` — 新增 `when.roles: [设计者]` + 角色边界 + 修正审视要点 + 新增自检行
- `.meta/prompts/prompts/S-10-合入者手册.md` — 新增 `when.roles: [合入者]`
- `src/prompt-center/builder.ts` — 移除 `HANDBOOK_IDS`、`resolveHandbookPrompt()`、handbook 独立注入路径
- `tests/meta/prompt-assets-test.ts` — 更新断言：手册通过 `when.roles` 参与正常发现

## 验证

### P1

- [x] S-09 中新增「角色边界」段落
- [x] 对抗性审视要点中"实现复杂度"已改为"设计复杂度"
- [x] 自检清单表格中新增角色边界行

### P2

- [x] S-03/S-04/S-09/S-10 新增 `when.roles`，通过正常 prompt 发现机制注入
- [x] 移除 `HANDBOOK_IDS`、`resolveHandbookPrompt()`、独立 handbook 注入路径
- [x] S-08 保留 `when.owner_types`，evolution conversation 仍能加载手册
- [x] TypeScript 编译无报错
- [x] npm test 通过（45 个测试全部通过）
- [x] 下次加载系统提示词时，角色手册约束生效

## 关联

- **前置**: I2026060113（SOP 图驱动 stage 转移，引入了 `handbook_prompt_ref` 字段）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | 只改 S-09 是否足够？ | P1 足够。当前问题集中在设计者手册 | 2026-06-02 |
| 2 | 双重注入机制是否需要统一 | 需要。`handbook_prompt_ref` 是死元数据，`when.roles` 是隐式约定，统一到显式引用更清晰 | 2026-06-02 |
| 3 | S-08 是否一并重构 | 不重构。S-08 按 conversation 类型匹配，语义不同于角色手册 | 2026-06-02 |
| 4 | prompt count 是否受影响 | 不受影响。手册从"条件发现"变为"显式注入"，活跃数不变 | 2026-06-02 |

## 范围变更记录

| # | 变更内容 | 原范围 | 新范围 | 原因 | 日期 |
|---|---|---|---|---|---|
| 1 | 新增 P2：角色手册注入统一 | 仅 S-09 角色边界（P1） | P1 + P2 | 用户要求将角色手册归属重构纳入本次 PR | 2026-06-02 |
| 2 | P2 方案反转：恢复 when.roles 发现 | 移除 when.roles，改用 handbook_prompt_ref 注入 | 恢复 when.roles，移除 handbook_prompt_ref 注入路径 | 用户要求合并进 SOP prompt，删除独立注入机制 | 2026-06-02 |
