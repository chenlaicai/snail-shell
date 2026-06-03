---
id: I2026060205
title: sop-role-handbook-refactor
from_ids: []
tags: [sop, workflow, boundary, prompt-center, refactoring]
modules: [prompts, workflow]
doc_kind: spec
---

# I2026060205 [prompts/workflow] SOP 角色手册内联化 + 设计者角色边界定义

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

### P2 — 角色手册内联化

将角色手册内容从独立 prompt 文件内联进 SOP YAML 的 `content` 字段，删除独立 prompt 文件，消除双重机制。

## 非目标

- 不改变设计/研发/检视/合入的工作流程
- 不引入新的工具或自动化机制

## 设计

### P1 详设：设计者角色边界

**方案**：在内联进 SOP YAML 的设计者手册 content 中新增「角色边界」段落 + 修正审视要点。

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

### P2 详设：角色手册内联化

**方案**：将角色手册全文从独立 prompt 文件迁移到 SOP YAML 的 `handbook` 字段（block scalar），删除独立 prompt 文件。

**核心思路**：

```
改动前：
  .meta/prompts/prompts/S-03.md (独立文件, when.roles: [研发者])
  .meta/sop/code-delivery.yaml → roles[].handbook_prompt_ref: "global:S-03"
  prompt-center 通过 when.roles 条件发现 S-03 → 注入

改动后：
  .meta/sop/code-delivery.yaml → roles[].handbook: |
    ## 研发者手册
    ...（完整手册全文，包含工作规则）
  builder.ts 读取 activeRole.handbook → 渲染模板变量 → 注入
  独立 prompt 文件 S-03/S-04/S-09/S-10 已删除
  独立 prompt 文件 S-08 已删除（evolution.yaml 同理内联）
```

**为什么选内联而非其他方案**：

| 方案 | 否决理由 |
|---|---|
| 保留独立文件 + `when.roles` | 与 SOP YAML 中角色定义分离，修改手册要改两个地方；`handbook_prompt_ref` 成为无用元数据 |
| `handbook_prompt_ref` 指向文件 + builder 读文件 | 增加文件读取层，间接引用不如直接内联；仍然存在两处定义 |
| workspace 级 handbook 覆盖 | 当前所有手册都是 global 级，无 workspace 覆盖需求；过早抽象 |

**具体修改**：

**1. SOP YAML 新增 `handbook` 字段**

在 `.meta/sop/code-delivery.yaml` 和 `.meta/sop/evolution.yaml` 的每个角色定义中，将 `handbook_prompt_ref` + `working_rules` + `content` 合并为 `handbook`（block scalar 内联手册全文，包含工作规则）。

**2. 类型变更**

`StageRoleDefinition`（`domain-types.ts`）：
```typescript
// 移除
handbook_prompt_ref: string | null;
content: string | null;
working_rules: string[];
// 新增
handbook: string | null;
```

`YamlStageRoleDefinition`（`snail-loader.ts`）同步改字段名。

`SopYamlFile`（`file-config-store.ts`）roles 数组中同步改字段名。

**3. builder.ts 新增 `buildRoleContent()`**

```typescript
function buildRoleContent(c: PromptBuildContext, variables: Record<string, string>): string {
  const handbook = c.activeRole?.handbook;
  if (!handbook) return "";
  return renderPromptTemplate(handbook, variables);
}
```

在 `buildConversationCapability()` 中，将 roleContent 拼入 systemReminder（stability=static 级别，因为它是身份定义）。

**4. 删除独立 prompt 文件**

- `.meta/prompts/prompts/S-03-研发者手册.md` — **删除**
- `.meta/prompts/prompts/S-04-检视者手册.md` — **删除**
- `.meta/prompts/prompts/S-08-演进执行者手册.md` — **删除**
- `.meta/prompts/prompts/S-09-设计者手册.md` — **删除**
- `.meta/prompts/prompts/S-10-合入者手册.md` — **删除**

**5. 移除 `resolveHandbookRef()`**

builder.ts 中的 `resolveHandbookRef()` 和 `HandbookRef` 接口不再需要，移除。

**模板变量兼容**：S-03 中使用了 `{{stage_acceptance_checklist_block}}` 等模板变量。`handbook` 通过 `renderPromptTemplate()` 渲染，与现有 prompt 文件的处理方式完全一致，无兼容性问题。

## 生效路径

1. SOP YAML：`handbook_prompt_ref` + `working_rules` + `content` → `handbook`（block scalar 内联手册全文，包含工作规则）
2. `StageRoleDefinition` / `YamlStageRoleDefinition` / `SopYamlFile`：字段合并为 `handbook`
3. `snail-loader.ts`：解析 `handbook` 字段
4. `file-config-store.ts`：`expandStageRoles()` 写 `handbook`
5. `builder.ts`：新增 `buildRoleContent()`，删除 `resolveHandbookRef()`
6. 删除 5 个独立 prompt 文件
7. 更新测试断言

<!-- [design-time] 章节结束 -->

## 改动范围

- `.meta/sop/code-delivery.yaml` — `handbook_prompt_ref` + `working_rules` + `content` → `handbook`，内联 S-03/S-04/S-09/S-10 手册全文
- `.meta/sop/evolution.yaml` — `handbook_prompt_ref` + `working_rules` + `content` → `handbook`，内联 S-08 手册全文
- `src/shared/domain-types.ts` — `handbook_prompt_ref` + `working_rules` + `content` → `handbook`
- `src/workspace-workflow/snail-loader.ts` — `handbook_prompt_ref` + `working_rules` + `content` → `handbook`
- `src/persistence/file-config-store.ts` — `handbook_prompt_ref` + `working_rules` + `content` → `handbook`
- `src/prompt-center/builder.ts` — 新增 `buildRoleContent()`，删除 `resolveHandbookRef()`/`HandbookRef`
- `.meta/prompts/prompts/S-03-研发者手册.md` — **删除**
- `.meta/prompts/prompts/S-04-检视者手册.md` — **删除**
- `.meta/prompts/prompts/S-08-演进执行者手册.md` — **删除**
- `.meta/prompts/prompts/S-09-设计者手册.md` — **删除**
- `.meta/prompts/prompts/S-10-合入者手册.md` — **删除**
- `tests/meta/prompt-assets-test.ts` — 更新断言：手册不再在 prompt 池中

## 验证

### P1

- [x] S-09 中新增「角色边界」段落
- [x] 对抗性审视要点中"实现复杂度"已改为"设计复杂度"
- [x] 自检清单表格中新增角色边界行

### P2

- [x] SOP YAML 中 `handbook_prompt_ref` + `working_rules` + `content` 已合并为 `handbook`
- [x] 独立 prompt 文件 S-03/S-04/S-08/S-09/S-10 已删除
- [x] builder.ts 通过 `activeRole.handbook` 注入手册
- [x] `resolveHandbookRef()` 已移除
- [x] S-08 在 evolution.yaml 中同样内联
- [x] TypeScript 编译无报错
- [x] npm test 通过

## 关联

- **前置**: I2026060113（SOP 图驱动 stage 转移，引入了 `handbook_prompt_ref` 字段）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | 只改 S-09 是否足够？ | P1 足够。当前问题集中在设计者手册 | 2026-06-02 |
| 2 | 双重注入机制是否需要统一 | 需要。内联进 SOP YAML 是唯一来源 | 2026-06-02 |
| 3 | S-08 是否一并内联 | 是。evolution.yaml 中 evolution-executor 角色同样用 content 字段 | 2026-06-02 |
| 4 | prompt count 是否受影响 | 不受影响。手册从 prompt 池移除，通过 role content 注入，总数减少 | 2026-06-02 |

## 范围变更记录

| # | 变更内容 | 原范围 | 新范围 | 原因 | 日期 |
|---|---|---|---|---|---|
| 1 | 新增 P2：角色手册注入统一 | 仅 S-09 角色边界（P1） | P1 + P2 | 用户要求将角色手册归属重构纳入本次 PR | 2026-06-02 |
| 2 | P2 方案：内联化 | 恢复 when.roles + 移除 handbook_prompt_ref | 内联 content + 删除独立文件 | 用户要求手册内容直接写进 SOP YAML | 2026-06-02 |
| 3 | 字段合并 | content 字段 | handbook 字段（合并 working_rules + content） | 用户要求工作规则和手册内容整合为一个字段 | 2026-06-02 |
