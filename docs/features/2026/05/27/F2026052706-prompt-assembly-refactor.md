---
id: F2026052706
title: prompt-assembly-refactor
tags: [prompt, architecture, refactor]
modules: [project_management]
doc_kind: spec
---
# [F2026052706][project_management][Feature Update] 移除 Frame 抽象，引入元数据驱动组装引擎

## 背景与动机

本改动源于「数据源统一到数据库」Feature 的架构讨论。关键问题：系统提示词是保留文件形式，还是也初始化到数据库中？

### 提示词 ≠ 结构化数据

| 维度 | 项目配置数据（已入 DB） | 系统提示词 |
|---|---|---|
| **性质** | 结构化关系数据（FK、多对多） | 长文本内容文档（Markdown） |
| **运行时查询** | 需要：按 project 查 SOP、按 SOP 查角色/阶段 | 简单：给定 frame 解析引用 |
| **变更频率** | 低（项目创建/配置时） | 高（开发迭代中频繁调整） |
| **编辑体验** | JSON seed 即可，字段短 | Markdown 可读可 diff |
| **多 project** | 全局 seed + project 绑定 | 全局 `.meta/prompts/` + `project/.snail/prompts/` overlay |

**结论**：提示词是内容资产，文件系统是其自然载体，不进入数据库。Seed 机制的核心价值是「通过可审查的代码仓文件管理结构化配置的初始化」，不应该扩展到所有文件内容。

这个决策反过来暴露了当前提示词组装机制的问题：当前机制为单项目（Snail Shell 自身）设计，没有区分「平台」和「项目」两个层次的提示词。在多项目场景下需要重构。

### Frame 的依赖倒置问题

当前 Frame（F-01~F-04）作为中心化模板，直接通过 `{{prompt:ID}}` 引用和 `{{#when:roles=...}}` 条件感知 SOP 和 Role 的具体细节。这是依赖倒置——底层的模板结构反向依赖了上层的 SOP/Role 知识。

在多 SOP、多项目场景下：
- 不同 SOP 的 stage 结构不同，单一 F-01 无法覆盖
- Frame 选型硬编码为 `owner_type === "knowledge_governance" ? F-02 : F-01`，无法按 SOP/Stage 动态匹配
- Frame 无法表达「这一段来自平台层，那一段来自 SOP 层」的语义

### 不再使用 ID 覆盖

当前 overlay 使用「同 ID 覆盖」语义。但提示词效果看语义，不是看 ID 匹配——两段不同 ID 的提示词可能在语义上冲突，两段同 ID 的提示词可能说的是不同层面的事。用 ID 做判定维度是错的。

正确的模型是**层级优先级**：SOP → Project → Platform（越后渲染 LLM 注意力权重越高）。当不同层的提示词在语义上有冲突时，高优先级层的规则自然覆盖低优先级层。

## 设计

### 三层模型

```
Layer 1: Platform  (.meta/prompts/prompts/)
  内容: B-01~B-03, S-01~S-08（11 个文件）
  特性: 平台宪法级规则 + SOP 角色手册，所有项目可见，可被项目 overlay 同 ID 覆盖

Layer 2: SOP       (语义层，通过在 platform 提示词上标记 layer: sop 实现)
  内容: S-03, S-04, S-08（由 listPrompts() 加载，所有项目可见）
  特性: 通过 when: roles/owner_types 条件自动匹配

Layer 3: Project   (project/.snail/prompts/)
  内容: 项目特定约束、补充规则
  特性: 同 ID 覆盖 Platform 层
```

渲染顺序：SOP（先，LLM 注意力最低）→ Project → Platform（后，LLM 注意力最高）。

### layer 与文件位置的分离

`layer` 和文件路径是正交的两个维度：

| 维度 | 含义 | 示例 |
|---|---|---|
| `layer` | 语义角色，控制组装优先级 | S-03 的 `layer: sop` — 表示它是 SOP 手册，渲染时排 Platform 前 |
| 文件位置 | 加载范围，控制哪些项目可见 | S-03 在 `.meta/prompts/prompts/` — 所有项目通过 `listPrompts()` 加载 |

### Snail Shell 自身 dogfooding

Snail Shell 同时是平台运行时和 code-delivery SOP 的项目实例。其 project overlay 机制通过 `loadProjectPrompts(process.cwd())` 加载 `./.snail/prompts/` 下的项目特定 prompt，验证 project overlay 对 Snail Shell 自身同样适用。

SOP 角色手册（S-03/S-04/S-08）属于平台层，放在 `.meta/prompts/prompts/` 下，由 `listPrompts()` 对所有项目统一加载，通过 `when: roles/owner_types` 条件自动匹配对应的角色。

所有项目使用 Snail Shell 时均获得完整的 11 个平台 prompt（B-01~B-03, S-01~S-08），包括 SOP 角色手册。项目可通过 `project/.snail/prompts/` 下的同 ID 文件覆盖任意平台 prompt。

### 组装引擎

```
assembleSystemPrompt({ prompts, matchContext, variables }):
  1. 过滤: 按每个 prompt 的 when 条件 + matchContext 过滤
  2. 排序: 按 layer（sop→project→platform）+ priority 升序
  3. 分流: stability=static → systemPrompt, dynamic → systemReminder
  4. 渲染: 去掉 ## 标题行 → 变量替换 → 追加 skill_references
```

### SOP Handbook 继承的前置设计

本次用 `when: roles` 条件匹配替代 `resolveHandbookRef` 动态注入，让角色手册随 SOP 自然参与组装。

后续 SOP handbook 引用机制的设计预判：

- **实时引用，非快照**：与 role→snail mapping（Feature 创建时快照，隔离运行时稳定性）不同，handbook 是教学文本，源头更新后引用方也应该跟着变好
- **引用完整性**：删除 SOP 时检查是否有其他 SOP 引用其 handbook，有依赖则拒绝删除
- **降低自定义门槛**：用户可 `handbook_from: sop:code-delivery:developer` 复用已有高质量手册，再追加项目特定规则

### Prompt 元数据分配

| Prompt | layer | priority | stability | when |
|---|---|---|---|---|
| B-01 身份与责任契约 | platform | 10 | static | — |
| B-02 知识治理 | platform | 20 | static | — |
| B-03 运行时边界 | platform | 30 | static | runtimes: [claude-code-cli, claude-code-stateful-cli] |
| S-01 项目上下文 | platform | 40 | dynamic | — |
| S-02 历史能力 | platform | 50 | dynamic | — |
| S-07 知识库能力 | platform | 60 | static | — |
| S-03 研发者手册 | sop | 70 | static | roles: [研发者] |
| S-04 检视者手册 | sop | 70 | static | roles: [检视者] |
| S-08 知识执行者手册 | sop | 70 | static | owner_types: [knowledge_governance] |
| S-05 mention提取 | platform | 10 | static | 排除在组装池外，直接调用 |
| S-06 会话摘要 | platform | 10 | static | 排除在组装池外，直接调用 |

## 改动范围

- **删除**: `.meta/prompts/frames/` 全部 4 个 Frame 文件 + `_template-frame.md`
- **重写**: `registry.ts`（新增 `assembleSystemPrompt`、`matchesWhen`）、`builder.ts`（移除 Frame 渲染管线、移除 `buildFromFrame`/`filterActivePromptIds`/`extractPromptReferences`）
- **更新**: 11 个 prompt `.md` 文件（添加 `layer`/`priority`/`when` frontmatter）、`index.ts`、`summary.ts`、`mention-extractor.ts`、`server.ts`、`app.js`、`prompt-library.js`、3 个测试文件
- **统计**: 29 文件，+740 / -1449 行

## 验证结果

- ESLint 通过
- TypeScript 编译：`npx tsc --noEmit` 通过
- 全量测试：42 个测试套件全部通过，包括：
  - `tests/meta/prompt-assets-test.ts` — prompt 注册表元数据、`matchesWhen` 条件匹配、`assembleSystemPrompt` 组装引擎、渲染内容完整性
  - `tests/prompt-center/project-overlay-test.ts` — 项目 overlay 加载、merge、组装使用合并 prompt 集
  - `tests/agent/capability-spec-test.ts` — capability 协议、skill 收集

## PR

- [#293](https://github.com/chenlaicai/snail-shell/pull/293)

## 后续

- SOP handbook 实时引用继承机制（独立的 Feature）
