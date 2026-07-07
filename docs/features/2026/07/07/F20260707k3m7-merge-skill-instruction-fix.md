---
id: F20260707k3m7
title: merge-skill-instruction-fix
from_ids: []
tags: [issue-collaboration, sop, skill]
modules: [data/skills, data/sops]
doc_kind: spec
change_type: bugfix
---

# F20260707k3m7 合入者 Skill 指令矛盾修复 — PR 合入权回归用户

## 背景

PR #590（`[F20260707vrtv] Issue MCP 新增 create_issue 工具`）在 review 阶段完成后 86 秒内被合入。合入由合入者 agent 使用用户 GitHub 凭证执行 `gh pr merge` 完成，用户未参与。用户此前已明确要求"PR 合入必须由我执行"。

## 问题分析

### 根因：cd-merge SKILL.md 与 SOP 配置存在 7 处矛盾指令

`data/file/skills/cd-merge/SKILL.md` 和 `data/file/sops/code-delivery/code-delivery.yaml` 中共有 7 处指令指示合入者"执行合入"，与唯一 1 处约束"必须等待用户显式执行合入操作"矛盾。合入者 agent 按多数指令行事，执行了合入。

**矛盾指令清单：**

| # | 文件 | 位置 | 内容 | 效果 |
|---|------|------|------|------|
| 1 | code-delivery.yaml | L73 (stage desc) | "全部通过则使用 Squash Merge 合入 PR" | 指示合入者执行合入 |
| 2 | code-delivery.yaml | L77 (role desc) | "通过则合入，不通过则打回到审查阶段" | 指示合入者执行合入 |
| 3 | SKILL.md | L44 (决策) | "全部通过 → squash merge" | 指示合入者执行合入 |
| 4 | SKILL.md | L55 (自检) | "未完成自检不得执行合入" | 预设合入者会执行合入 |
| 5 | SKILL.md | L65 (gate 项) | "使用 Squash Merge 合入" | gate 项本身是执行指令 |
| 6 | SKILL.md | L86 (模板) | "所有 required 项通过，执行合入。" | 指示合入者执行合入 |
| 7 | SKILL.md | L89 (步骤) | "所有项通过后执行 squash merge" | 指示合入者执行合入 |

**唯一约束：**

| 文件 | 位置 | 内容 |
|------|------|------|
| SKILL.md | L49 (自动推进说明) | "必须等待用户显式执行合入操作" |

**矛盾本质**：L49 的约束被埋在"自动推进说明"标题下，被 6 处"执行合入"指令包围。合入者 agent 将"不自动推进"理解为"系统 auto-advance 机制不触发"（正确），但未将"必须等待用户显式执行合入操作"理解为对自己执行合入的禁止。

### 系统 auto-advance 不是根因

`code-delivery.yaml` 的 merge 阶段无 `auto_advance` 配置。`auto-advance.ts:52-54` 确认：无配置则返回 `escalated`，`executeAutoAdvance()` 不会被调用。系统层面不会自动推进 merge 阶段。根因完全在 skill 指令层。

## 用户意图锚

| ID | 用户原话 | 来源 | 关键修饰语 | 架构师解读 |
|----|---------|------|-----------|-----------|
| UA-1 | "pr合入必须由我执行" | 消息 #4150 | 空间：不适用；时序：不适用；数量：不适用；条件：由我执行；视觉属性：不适用 | PR 合入操作（`gh pr merge`）必须由用户手动执行，合入者 agent 不得代执行 |

## 设计方案

### 核心原则

**合入者的职责是检查 + 声明就绪，合入操作由用户执行。** 合入者完成所有硬条件检查后，呈现"合入就绪"状态并告知用户执行合入。合入者不得执行 `gh pr merge` 或任何 PR 合入命令。

### 变更 1：SOP 配置层（`data/file/sops/code-delivery/code-delivery.yaml`）

修改 merge 阶段的 stage description 和 role description，从"执行合入"收敛为"声明就绪"：

| 位置 | 原文 | 改为 |
|------|------|------|
| L73 (stage desc) | "维护者执行硬性条件检查，全部通过则使用 Squash Merge 合入 PR，任一不通过则打回到审查阶段。" | "维护者执行硬性条件检查，全部通过则声明合入就绪，等待用户执行合入，任一不通过则打回到审查阶段。" |
| L77 (role desc) | "负责 PR 合入前的硬性条件检查，通过则合入，不通过则打回到审查阶段。" | "负责 PR 合入前的硬性条件检查，通过则声明合入就绪，不通过则打回到审查阶段。合入操作由用户执行。" |

← UA-1（合入权回归用户）

### 变更 2：Skill 指令层（`data/file/skills/cd-merge/SKILL.md`）

**新增显式禁令**（在"硬条件检查"段开头，L29 附近）：

> **[HARD] 合入者不得执行 `gh pr merge` 或任何 PR 合入命令。合入者的职责是检查 + 声明就绪，合入操作由用户执行。**

**修改 5 处指令**：

| 位置 | 原文 | 改为 |
|------|------|------|
| L44 (决策) | "全部通过 → squash merge" | "全部通过 → 声明'合入就绪'，等待用户执行合入" |
| L55 (自检) | "在执行合入或建议推进之前，必须完成以下自检。未完成自检不得执行合入。" | "在声明合入就绪之前，必须完成以下自检。未完成自检不得声明就绪。" |
| L65 (gate 项) | "使用 Squash Merge 合入" | "声明 Squash Merge 合入就绪" |
| L86 (模板) | "所有 required 项通过，执行合入。" | "所有 required 项通过，声明合入就绪，等待用户操作。" |
| L89 (步骤) | "所有项通过后执行 squash merge" | "所有项通过后，声明合入就绪并告知用户执行合入操作" |

← UA-1（合入权回归用户）

### 变更 3：自动推进说明段强化（`data/file/skills/cd-merge/SKILL.md` L47-51）

现有 L49 的表述"必须等待用户显式执行合入操作"正确但位置隐蔽。将约束提升到段首并强化措辞：

**原文（L47-51）：**
> merge 阶段**不自动推进**。当 review 阶段的对抗机制达成共识且所有 gate 通过时，系统会呈现"合入就绪"状态，但必须等待用户显式执行合入操作。
>
> 原因：merge 是不可逆操作（代码进入 main），必须由用户控制。

**改为：**
> merge 阶段**不自动推进**，合入者**不得执行合入命令**。当 review 阶段的对抗机制达成共识且所有 gate 通过时，合入者声明"合入就绪"状态，**合入操作由用户显式执行**。
>
> 原因：merge 是不可逆操作（代码进入 main），必须由用户控制。

← UA-1（合入权回归用户）

## 核心业务行为

| ID | 场景 | 预期行为 | 追溯 |
|----|------|---------|------|
| B1 | 合入者完成所有硬条件检查且全部通过 | 合入者声明"合入就绪"，在对话中告知用户可以执行合入，不执行任何 `gh pr merge` 命令 | ← UA-1 |
| B2 | 合入者完成硬条件检查，任一未通过 | 合入者回退到 review stage 并说明具体失败项（行为不变） | ← UA-1 |
| B3 | 合入者在任何情况下 | 不得执行 `gh pr merge` 或任何 PR 合入命令 | ← UA-1 |

## 非目标

- 不重命名 stage/role/skill（"合入"/"合入者"/"cd-merge" 命名暗示"执行合入"，但重命名影响面大，记录为 evolution 候选项）
- 不修改系统 auto-advance 机制（merge 阶段已正确禁用 auto_advance）
- 不修改前端合入操作（前端不受影响，用户通过 GitHub UI 或命令行执行合入）

## 关键决策记录

### 决策 1：修复范围 — SKILL.md 单文件 vs SKILL.md + SOP 配置

- **决策点**：是否需要修改 `code-delivery.yaml` 的 stage/role description？
- **正方论点（双文件）**：SOP 配置层的 description 是最高优先级指令源，agent system prompt 中直接注入 stage description 和 role description。仅修 SKILL.md 不够，agent 在读到 skill 之前已从 system prompt 中看到"通过则合入"的角色定义
- **反方论点（单文件）**：减少改动面
- **最终决策**：双文件修改
- **决策依据**：SOP 配置层是 agent 首先接触到的指令，必须与 skill 指令一致
- **参与者**：架构师-1、架构师-2

### 决策 2：命名问题 — 本次修复 vs 记录为 evolution

- **决策点**：stage 名"合入"、role 名"合入者"/"维护者"、skill 名"cd-merge" 是否重命名？
- **正方论点（重命名）**：命名暗示"执行合入"，即使修正文字指令，命名仍可能引入未来语义漂移
- **反方论点（不重命名）**：重命名影响面大（SOP 配置、skill 目录、前端展示），与本次 bugfix 范围不匹配
- **最终决策**：不重命名，记录为 evolution 候选项
- **决策依据**：本次修复目标是消除指令矛盾，命名问题属于结构性改进，应独立推进
- **参与者**：架构师-1、架构师-2

## 变更影响分析

### 数据文件

- **`data/file/sops/code-delivery/code-delivery.yaml`**：merge 阶段的 stage description 和 role description 文字修改
- **`data/file/skills/cd-merge/SKILL.md`**：新增 1 处 [HARD] 禁令，修改 5 处指令，强化 1 处自动推进说明

### 代码

- **无代码变更**。本次修复仅涉及 data 文件（skill 和 SOP 配置），不修改任何 TypeScript 代码。

### 前端

- **无影响**。前端不读取 skill 或 SOP 的 description 文字。

### 数据库

- **无变更**。

### 提示词/SOP

- **合入者行为变更**：合入者 agent 从"检查通过后执行合入"变为"检查通过后声明就绪并等待用户"。这是本次修复的核心目的。

## 不兼容更新

**本次变更含不兼容更新**：合入者 agent 行为变更（从"执行合入"到"声明就绪"）。此前依赖合入者自动合入 PR 的流程将不再自动完成，需用户手动执行 `gh pr merge`。PR 标题应标注 `[Incompatible]`。

## [design-time]

### 设计锁定状态

- 两位架构师已通过交叉审视达成共识
- 根因已定位：7 处矛盾指令 vs 1 处约束
- 修复方案已确认：7 处修改 + 1 处新增 + 1 处强化
- 无未解决争议

### 交叉审视记录

- **Phase 1（根因分析）**：架构师-1 识别 3 处 SKILL.md 矛盾指令 + 系统配置验证
- **Phase 2（交叉审视）**：架构师-2 补充 2 处 SKILL.md 遗漏（L55、L65）+ 2 处 SOP 配置层遗漏（L73、L77），共 7 处矛盾指令
- **Phase 3（共识确认）**：架构师-1 全部接受，产出最终修复方案

### 质疑义务产出

**风险点**：
1. 命名问题（"合入"/"合入者"/"cd-merge"）仍暗示"执行合入"，未来可能引入新的语义漂移。本次不修，记录为 evolution 候选项
2. 合入者声明"合入就绪"后，用户可能不知道如何执行合入。skill 应在声明就绪时提供明确的合入命令指引（如 `gh pr merge #xxx --squash`）

**遗漏场景**：
1. 合入者声明就绪后，用户长时间不执行合入 — 当前设计不处理此场景，合入者等待即可

### 实现指引

开发者修改两个 data 文件后，验证方式：
1. 读取修改后的文件，确认 7 处修改 + 1 处新增 + 1 处强化均已落实
2. 全文搜索 `data/file/skills/cd-merge/SKILL.md` 和 `data/file/sops/code-delivery/code-delivery.yaml`，确认不再存在"执行合入"、"执行 squash merge"等指示合入者执行合入命令的文字
