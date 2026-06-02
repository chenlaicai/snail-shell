---
id: I2026052707
title: prompt-architecture-3-plus-3
tags: [prompt, architecture, optimization, progressive-disclosure]
modules: [project_management]
doc_kind: spec
---
# [I2026052707][project_management][Feature Update] 系统提示词 3+3 架构重构——渐进式披露与参考约束收敛

## 背景与动机

### 上下文压力

Snail Shell 系统提示词在单次会话中注入约 3000 tokens 的规则内容（不含 Claude Code 框架层）。B-01（身份与责任契约）膨胀至 21 条，S-03（研发者手册）24 条。大量规则在「流程上正确但当前对话不触发」的时间点被同等注入——研发者在需求讨论阶段不需要知道 DB migration 约束，检视者在检视前不需要知道「UI/UX 歧义时可视化对齐」。

### 问题本质

不是规则太多，而是规则没有分层注入。缺少「核心行为边界始终可见 + 详细操作规则按需查阅」的双层模型。没有架构约束的系统会自然熵增——允许无限制地新增 prompt 文件且每条新增都合理，但累加起来上下文压力不可接受。

### 初始分析

对当前系统提示词的诊断（此分析形成于对话初期，指导了后续全部设计决策）：

**1. 分层拆分**

系统提示词由 Base 层（B-XX，始终注入）和 Scenario 层（S-XX，条件注入）构成。Base 层 3 条（B-01 身份行为、B-02 知识治理触发、B-03 运行时边界）覆盖三个正交关切；Scenario 层按会话类型注入不同的角色手册。

**2. 规则膨胀点**

| 文件 | 优化前规则数 | 主要问题 |
|------|-------------|---------|
| B-01 | 21（8H+11S+2G） | 同类规则分散（worktree 分 2 条，message-out 分 4 条，决策分 2 条） |
| S-03 | 24（5H+17S+2G） | 混入大量程序性规则（commit 模板、DB 约束、测试质量详细规则） |
| S-04 | 15 | 同上，检视流程中混入格式偏好 |
| S-08 | 17 | 同上，API 字段映射等详细操作步骤 |

**3. 结构冗余**

- `<constitution>` `<protocol>` `<identity>` `<guideline>` XML 包装块：文件标题已经是分类，`[HARD]`/`[STD]` 标签已携带严重性。XML 块是冗余层级。
- Frame 文件（F-01~F-04）通过 `{{prompt:ID}}` 引用和 `{{#when:}}` 条件感知 Role 细节，形成依赖倒置。
- S-07（知识库能力）和 B-01 末尾的知识库概览段存在职责重叠。

### LLM 模型特化分析

曾考虑是否按 LLM 模型（Opus/Sonnet/Haiku）分别设定提示词条数约束。结论：不做。原因：
- 当前目标模型都是 200k 上下文窗口，没有差异化上下文压力
- 按模型分条数意味着 N 套 prompt 变体、N 倍测试矩阵
- 「参考约束按需查阅」的方案对所有模型等效——上下文紧张时 AI 自动少查参考约束
- 模型能力差异应由框架层处理，不是 Snail Shell prompt 层的职责

## 设计

### 核心决策：主库与参考约束的分界

整个架构重构围绕一个关键问题展开：**如何决定一条规则应该始终注入主库，还是放入按需查阅的参考约束？**

经过多轮讨论，最终确定分界标准不是规则标签（`[HARD]`/`[STD]`/`[GUIDE]`），而是**缺失后果**：

| 缺失后果 | 归宿 | 说明 |
|---------|------|------|
| 灾难性（数据丢失、安全、不可恢复） | 主库 | AI 必须始终知道 |
| 重大（错误方向、大量返工、协作链路断裂） | 主库 | AI 必须始终知道 |
| 程序性（质量缺陷，review 可捕获） | 参考 | AI 按需查阅 |
| 偏好性（都能用，但有一种更优） | 参考 | AI 按需查阅 |

`[HARD]`/`[STD]`/`[GUIDE]` 是规则内部的严重性标注。在正确的系统中，冲突规则不应被批准入库——冲突应在 review 阶段解决，不是留给 AI 运行时判断。因此严重性标签在主库中没有信息增量：**主库全部规则都是缺失后果灾难/重大的，AI 必须全部遵守。**

### 决策链

以下按对话演进顺序记录核心决策及其理由：

**1. 3+3 架构约束**

Base 层 ≤3 条，Scenario 层 ≤3 条，单次会话 ≤6 条。选择 3 而非其他数字的理由：
- Base 层恰好覆盖三个正交关切：身份行为、知识治理触发、平台边界。没有清晰的第 4 个。
- Scenario 层覆盖：工作锚点、能力入口、角色规则。两条会话路径各选一个角色手册。
- 6 条之上每增加一条，边际收益下降——新关切更可能是现有关切的子类或参考约束。

约束写入 `.meta/README.md` 和 `registry.ts` 的 `validatePromptCount()` 函数（超限输出 warn，不阻断构建），确保后续 AI 感知边界。

**2. 内容精简**

合并同类规则，移出程序性/偏好性规则：
- B-01：21→13（后进一步缩减至 10，见后续决策）
- S-03：24→19（后进一步缩减，见后续决策）
- S-04：15→12
- S-08：17→11

**3. PR #293 适配**

`I2026052706` 移除了 Frame 抽象，引入 `layer`/`priority`/`when` 元数据驱动组装引擎。本 PR 同步适配：删除 F-01/F-02 frame 文件，提示词添加 `layer: platform|sop` + `priority` + `when` 元数据。

**4. 参考约束独立文件化**

最初将参考约束放入单个 `prompt-constraints/SKILL.md`。这导致两个问题：
- 所有约束混在一个文件，不清晰
- 文件正交性差——「验证与提交」混合了测试质量、diff 校验、收口 checklist、review 修复验证四个不同关切

改进为 `.meta/prompts/reference/` 目录，8 个独立文件按单一关切组织。`prompt-constraints` skill 转为轻量索引指南，指向 reference 目录。

**5. [GUIDE] 移出主库**

根据缺失后果标准，`[GUIDE]` 规则（"建议参考的偏好，有理由可偏离"）全部移入 reference：
- B-01：「一步到位优于分步」
- S-03：「先交付排查结论再实现」「持续执行到可交付结果」
- S-04：「持续执行到检视结论完成」
- S-08：「先分析内容再判断」

清理后主库不再有 `<guideline>` XML 块和 `[GUIDE]` 标签。

**6. XML 块移除**

文件标题已提供分类，`[HARD]`/`[STD]` 标签已携带严重性（当时仍存在）。`<constitution>` `<protocol>` `<identity>` `<guideline>` 是冗余层级，全部移除。`<context>` 块保留——它们服务于动态数据注入（`{{variable}}`），不是组织结构。

**7. 触发时机代替严重标签**

引入 `[全阶段]` `[设计阶段]` `[实现中]` `[验证阶段]` `[提交前]` `[检视中]` `[协作]` `[治理中]` `[环境准备]` 标注。这些标注告诉 AI **何时**关注规则，而非**多重要**。

**8. 程序性 [STD] 移出主库**

逐条审查主库中的 `[STD]` 规则，按缺失后果标准将程序性规则移入 reference：

| 移出规则 | 来源 | 移入 |
|---------|------|------|
| 表层要求上升到正确层级 | B-01 | reference/通用指南.md |
| 完成判定以语义正确为标准 | B-01 | reference/通用指南.md |
| 自检覆盖触发场景和既有路径 | S-03 | reference/测试.md |
| commit/PR 标题模板 | S-03 | reference/提交.md |
| 提交前收口 checklist | S-03 | reference/提交.md |
| 修复检视意见后重新验证 | S-03 | reference/提交.md |
| 调整提示词前对照 README | S-03 | reference/提示词治理.md |
| 合并评论+签名模板 | S-04 | reference/检视.md |
| API 回写详细字段映射 | S-08 | reference/知识治理.md |

保留在主库的 `[STD]` 全部满足：缺失 = 灾难性/重大，或是 trigger 机制（如「查阅 prompt-constraints」）。

**9. 移除严重性标签**

当主库全部规则都经过缺失后果审查后，`[HARD]`/`[STD]` 标签失去信息增量——未经过这层审查的规则根本不会进入主库。唯一保留的标注是触发时机。

在主库规则中，规则前不加括号 = 全阶段生效（最常见），`[提交前]` = 仅提交前需关注。

**10. S-02/S-07 去重**

S-02（能力引用）最初合并了 S-07（知识库能力）的全部内容，导致知识库规则在主库中出现两次。最终方案：S-07 保留为独立提示词（含知识库行为规则），S-02 仅保留「使用 knowledge-library skill 查询」的触发引用。S-05（mention 提取）和 S-06（会话摘要）保留严重性标签——它们是工具级 standalone prompt，不是对话级行为规则。

### 为什么不是其他方案

**为什么参考约束入 skill 目录而非知识库**

知识库是运行时经治理审批的持久化条目，适合已稳定的长期结论。参考约束是系统提示词的补充规则，与 prompt 文件同属源码资产，需要版本控制和 diff 追踪。放入 skill 目录（`prompt-constraints`）保持相同的代码仓管理方式。

**为什么 reference 保持文件形式而非合并**

Reference 文件按单一关切独立组织，每个文件覆盖一个明确的操作场景。AI 在特定阶段只需查阅 1-2 个文件。如果合并为单文件，AI 需要遍历大量无关规则才能找到当前阶段相关的内容。

### 规则标注演变

整个优化过程中，提示词规则的标注格式经历了完整演变：

```
演变路径:
1. <constitution>[HARD] 规则内容</constitution>
   → 原始格式：XML 包装 + 严重性标签

2. [HARD] 规则内容
   → 去 XML，保留严重性标签（合并同类规则后）

3. [HARD][全阶段] 规则内容  |  [STD][提交前] 规则内容
   → 添加触发时机标注

4. [全阶段] 规则内容  |  [提交前] 规则内容
   → 移除 [GUIDE]（移入 reference）
   → 移除程序性 [STD]（按缺失后果标准移入 reference）

5. 规则内容根本不需要标注（全阶段生效）
   [全阶段] 仅在明确限定阶段时才标注
   [提交前] 规则内容
   → 移除全部 [HARD]/[STD]——主库规则都通过缺失后果审查，严重性标签无信息增量

六步演变的最终形态：

Before:                          After:
<constitution>                    工作语言：简体中文（全阶段，不标注）
[HARD] 工作语言：简体中文          多方案决策必须列出选项及利弊
[HARD] 多方案决策...
</constitution>                   [提交前] 禁止使用 --no-verify
<protocol>                        [协作] 跨角色协作使用 message-out
[STD] 跨角色协作...                [全阶段] 行动前识别：...
[STD] 行动前识别...
[STD][提交前] commit/PR 模板      → reference/提交.md
</protocol>
```

### 架构约束如何让后续 AI 感知

三层保障：
1. `.meta/README.md` 的「prompt 条数约束」章节和写法规则第 9 条
2. `registry.ts` 的 `validatePromptCount()` 函数——由 `assembleSystemPrompt()` 在每次组装时调用，超限输出 warn 日志
3. `.meta/prompts/reference/` 目录的存在本身——AI 看到此目录即可理解主库/参考库的分层设计

## 最终架构

```
.meta/prompts/
├── prompts/          ← 主库：缺失后果灾难/重大的规则
│   ├── B-01 身份与责任契约    5 条全阶段 + 5 条时机标注
│   ├── B-02 知识治理          2 + 2
│   ├── B-03 运行时边界        3 + 2
│   ├── S-01 项目上下文        2 + 5（含动态变量 context 块）
│   ├── S-02 能力引用          0 + 6（含知识库行为规则合并）
│   ├── S-03 研发者手册        6 原则 + 23 步操作流程（含 developer-handbook 合并）
│   ├── S-04 检视者手册        2 + 8
│   ├── S-05 mention 提取      工具级 standalone（保留标签）
│   ├── S-06 会话摘要          工具级 standalone（保留标签）
│   └── S-08 知识执行者手册    5 + 4
│
├── reference/        ← 参考库：程序性/偏好性规则
│   ├── 设计分析.md   全链路影响分析 + 可视化对齐触发条件
│   ├── 实现.md       DB schema/migration + 不兼容变更
│   ├── 测试.md       测试质量 + diff 范围校验 + 自检覆盖
│   ├── 提交.md       收口 checklist + review 修复验证 + 完成判定
│   ├── 检视.md       代码结构/文档/模板/模块/测试审查 + 复检步骤
│   ├── 知识治理.md    API 字段映射 + 产物决策 + PR 边界 + 查重
│   ├── 提示词治理.md  归属判断 + 跨层污染 + 3+3 约束
│   └── 通用指南.md    5 条 GUIDE + 2 条 STD（上升原则、完成判定）
│
└── skills/
    └── prompt-constraints/SKILL.md ← 轻量索引（告知 AI 如何查 reference）
```

> **检视后修正**：初版架构 S-07（知识库能力）为独立 prompt 且无 `when` 条件，
> 导致实际注入 7 条（B-01~B-03 + S-01~S-02 + S-07 + 角色手册），突破 3+3=6 约束。
> 复检后将 S-07 的行为规则与 `{{knowledge_library_summary}}` 模板变量合并到 S-02，
> 删除独立 S-07 文件。`validatePromptCount()` 新增 `MAX_TOTAL=6` 校验。
>
> **stability 语义修正**：初版将 stability 按机械习惯分配（角色手册均设为 static）。
> 修正为按语义分工：身份/语言/平台边界（B-01~B-03）→ static → systemPrompt；
> 上下文/能力引用/角色操作流程（S-01~S-04, S-08）→ dynamic → systemReminder。
> systemReminder 位于系统消息末尾，对 AI 行为遵从度更高。
> 同时将 developer-handbook skill 的完整操作流程（GATE-1~4、四阶段步骤、自检清单、
> Review 工作流程、签名模板、场景细则）合并到 S-03，不再依赖 AI 主动触发 skill 查阅。

## 变更范围

### 主库精简

| 文件 | 优化前 | 最终 | 移出内容 |
|------|--------|------|----------|
| B-01 | 21（8H+11S+2G） | 6H+5S → 11 条 | 上升原则、完成判定、分步原则 |
| B-02 | 5 | 2H+2S → 4 条 | 合并触发时机 |
| S-01 | 6 | 3H+5S → 8 条 | 移除"默认项目就是 Snail Shell" |
| S-02 | 2+2 context | 0H+6S → 6 条 | 合并 S-07 知识库行为规则，含 knowledge_library_summary |
| S-03 | 24（5H+17S+2G） | 6 原则 + 23 步操作流程 + 自检清单 + 场景细则 | 自检覆盖/模板/收口/修复验证/提示词治理 5 条移入 reference；合并 developer-handbook skill 全部内容 |
| S-04 | 15（2H+12S+1G） | 2H+8S → 10 条 | 合并评论格式/持续执行 2 条。stability 改为 dynamic（systemReminder） |
| S-08 | 17（6H+7S+4G） | 5H+4S → 9 条 | API 字段映射/治理判断 2 条。stability 改为 dynamic（systemReminder） |

### 新建文件

- `.meta/prompts/reference/` 下 8 个参考约束文件
- `.meta/skills/prompt-constraints/SKILL.md` 轻量索引
- `docs/features/2026/05/27/I2026052707-prompt-architecture-3-plus-3.md` 本文档

### registry.ts

新增 `validatePromptCount()` 函数，由 `assembleSystemPrompt()` 在每次组装时调用，按 `layer`（platform/sop）维度 + 总条数（MAX_TOTAL=6）校验活跃 prompt 数量。超限输出 warn 日志，不阻断构建。`builder.ts` 中不再有重复实现。

## 验收标准

1. 编译通过：`npx tsc --noEmit`
2. 测试全通过：`npm test`（42 测试文件）
3. 主库无 [HARD]/[STD]/[GUIDE] 标签（S-05/S-06 工具级除外）
4. 主库无 `<constitution>` `<protocol>` `<identity>` `<guideline>` XML 块
5. `.meta/prompts/reference/` 目录存在且包含 8 个文件
6. `prompt-constraints` skill 可发现
7. S-02/S-03/S-04/S-08 均引用 `prompt-constraints`
8. S-07 知识库行为规则已合并到 S-02，S-07 文件已移除
