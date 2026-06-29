---
id: F20260629v7k7
title: sop-context-enforcement
from_ids: [F2026052104, F2026060303, F2026062310, F20260624d5pg]
tags: [sop, context, enforcement]
modules: [sop, collaboration]
doc_kind: spec
---

# F20260629v7k7 [sop] SOP Context 记录强制执行

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

SOP 中 context 记录（worktree_path、branch_name、pr_url）是跨 stage 信息传递的关键机制，但长期存在"时灵时不灵"问题。从 2026-05-21 至今已有 4 次修复尝试，每次都只修了其中一层：

| 时间 | Feature | 修了什么 | 漏了什么 |
|------|---------|---------|---------|
| 05-21 | F2026052104 | 统一了 context 存储模型 | 没修 enforcement |
| 06-03 | F2026060303 | 对齐了 designer/developer handbook | 只修了 SOP 文档层，没修系统层 |
| 06-23 | F2026062310 | 迁移到 MCP set_context | 没更新 SOP 文档引用（仍指向已废弃的 record-issue-repo-context） |
| 06-24 | F20260624d5pg | 修了 context 滥用 | 选了软约束（工具描述），无硬执行 |

根因是四层结构性断裂：
1. **命令引用断裂**：SOP 文档引用已废弃的 `record-issue-repo-context`，AI 执行失败后跳过
2. **Gate 定义断裂**：SKILL.md 验收清单不含 context 记录项，AI 跟着 gate checklist 走时自然跳过
3. **系统执行断裂**：AutoAdvanceEngine 只校验 gate_evidence 信号，不校验 Issue.context 字段
4. **心智模型断裂**：AI 把 context 记录视为"副作用"而非"必须交付的产物"

## 目标

在 SOP 文档层和系统执行层同时建立 enforcement 链路，使 context 记录成为 stage 推进的硬性前置条件。

### P1 — SOP 文档层修复

- 更新所有 SOP 文档中对已废弃 `record-issue-repo-context` 的引用，统一使用 `set_context` MCP 工具
- 在每个角色的 SKILL.md Stage Gate 验收清单中增加 context 记录项
- 在信号协议的 gate_evidence 模板中显式包含 context 字段

### P2 — 系统执行层修复

- AutoAdvanceEngine 的 `evaluate()` 各 stage 方法中，在 `allGatesPassed()` 调用前增加 Issue.context 必要字段前置校验
- 缺失字段时阻断推进，返回具体缺失字段列表
- system reminder 中 context 为空时增加警告标记

## 非目标

- 不修改 `set_context` MCP 工具的实现（F2026062310 已完成）
- 不清理 `Stage.output_artifacts` 遗留字段（独立 tech-debt，不在本 feature 范围）
- 不修改 context 使用边界规则（F20260624d5pg 已定义）
- 不增加 context 值的内容校验（如验证 pr_url 是否为合法 URL）

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当 design stage 发出 stage_transition 信号时 | 系统应校验 Issue.context 中 `worktree_path` 和 `branch_name` 非空；缺失时阻断自动推进并报告缺失字段 | |
| B2 | 当 development stage 发出 stage_transition 信号时 | 系统应校验 Issue.context 中 `worktree_path`、`branch_name` 和 `pr_url` 非空；缺失时阻断自动推进并报告缺失字段 | |
| B3 | 当 AI 执行 SOP 的 GATE-1（进入 worktree）时 | AI 应调用 `set_context` MCP 工具记录 `worktree_path` 和 `branch_name`，而非引用已废弃的 `record-issue-repo-context` | |
| B4 | 当 AI 完成 development stage 的 PR 创建时 | AI 应调用 `set_context` MCP 工具记录 `pr_url` | |
| B5 | 当 AI 执行 Stage Gate 自检时 | gate evidence 模板应包含已记录的 context 字段作为 evidence 项 | |
| B6 | 当 review stage 发出 stage_transition 信号时 | 系统应校验 Issue.context 中 `pr_url` 非空；缺失时阻断自动推进并报告缺失字段 | |

## 设计

### P1 详设：SOP 文档层

#### 1. 更新命令引用

将以下三处 `record-issue-repo-context` 引用更新为 `set_context` MCP 工具调用：

- `data/file/skills/cd-shared/references/worktree-discipline.md` Rule 5 和执行流程
- `data/file/skills/cd-design/references/workflow.md` GATE-1
- `data/file/skills/cd-development/references/workflow.md` GATE-1

更新后的 GATE-1 步骤：
```
创建 worktree 和分支后，调用 set_context 写入 Issue.context：
- key: worktree_path, value: <worktree 绝对路径>
- key: branch_name, value: <分支名>
```

同步更新 worktree-discipline.md Rule 5 措辞：将"记录到 stage output_artifacts"改为"写入 Issue.context"。

#### 2. Gate 清单增加 context 项

**Design SKILL.md 验收清单**新增：

| ID | 清单项 | 必须 |
|---|--------|------|
| design-ctx | worktree_path 和 branch_name 已通过 set_context 写入 Issue.context | ✅ |

**Development SKILL.md 验收清单**新增：

| ID | 清单项 | 必须 |
|---|--------|------|
| dev-ctx | worktree_path、branch_name、pr_url 已通过 set_context 写入 Issue.context | ✅ |

**Review SKILL.md 验收清单**新增：

| ID | 清单项 | 必须 |
|---|--------|------|
| rev-ctx | pr_url 已通过 set_context 写入 Issue.context（reviewer 需据此定位 PR） | ✅ |

#### 3. 信号协议模板更新

Design 信号模板 gate_evidence 新增：
```json
"design-ctx": "worktree_path=/Users/.../worktrees/xxx, branch_name=feature-xxx"
```

Development 信号模板 gate_evidence 新增：
```json
"dev-ctx": "worktree_path=/Users/.../worktrees/xxx, branch_name=feature-xxx, pr_url=https://github.com/..."
```

Review 信号模板 gate_evidence 新增：
```json
"rev-ctx": "pr_url=https://github.com/..."
```

### P2 详设：系统执行层

#### 1. AutoAdvanceEngine context 校验

**校验位置**：在 `evaluate()` 的各 stage 专属方法（`evaluateDevelopmentAutoAdvance()`、`evaluateAdversarialAutoAdvance()`）中，作为 `allGatesPassed()` 调用之前的**前置条件检查**。不在 `allGatesPassed()` 内部——该方法职责单一（校验 gate_evidence），不应混入 Issue.context 校验。

**校验逻辑**：

- **design stage**：校验 `worktree_path`、`branch_name` 非空
- **development stage**：校验 `worktree_path`、`branch_name`、`pr_url` 非空
- **review stage**：校验 `pr_url` 非空（reviewer 需要知道 PR 链接）

校验失败时直接返回，不进入 gate 校验逻辑。返回值包含缺失字段列表，AutoAdvanceEngine 据此阻断推进并生成升级卡片。

#### 2. Context key 命名约定

采用**无前缀策略**：`worktree_path`、`branch_name`、`pr_url` 不带 stage_key 前缀。

理由：
- 这些是跨 stage 共享的基础设施信息（"当前 issue 的仓库操作环境"），不是某个 stage 的专属产物
- 下游 stage 需要直接读取上游 stage 记录的值，无前缀避免跨 stage key 查找
- 如果后续 stage 更新了 worktree（如 developer 重新创建），覆盖写入即可，语义一致

与现有带前缀的 key（如 `design.feature_doc_path`）的关系：两类 key 共存，带前缀的用于 stage 专属产物指针，无前缀的用于跨 stage 共享基础设施。

#### 3. System reminder 警告

`buildContextBlock()` 中，当 `worktree_path` 或 `branch_name` 为空时，在 context 只读视图中标注警告：

```
## Issue 上下文（只读视图）
- **worktree_path**: ⚠️ 未记录
- **branch_name**: ⚠️ 未记录
> **注意**：...
```

## 生效路径

- SOP 文档：`data/file/skills/cd-shared/references/worktree-discipline.md`、`cd-design/SKILL.md`、`cd-development/SKILL.md`、`cd-review/SKILL.md`、`cd-design/references/workflow.md`、`cd-development/references/workflow.md`
- 代码：`src/app/issue-collaboration/auto-advance.ts`（context 校验逻辑）
- 代码：`src/app/issue-collaboration/collaboration.ts`（system reminder 警告）

## 设计约束摘要

- **边界**：只校验 context 字段存在性，不校验值内容（不验证路径是否存在、URL 是否合法）
- **关键决策**：context key 采用无前缀策略（`worktree_path` 而非 `design.worktree_path`），跨 stage 共享
- **关键决策**：系统层做硬检查（阻断推进），SOP 文档层做软引导（gate checklist），双层互补
- **关键决策**：context 校验在 `evaluate()` 的前置条件中执行，不在 `allGatesPassed()` 内部（职责分离）
- **非目标约束**：不修改 set_context MCP 工具实现，不清理 output_artifacts 遗留字段
- **语义不变量**：Issue.context 是跨 stage 信息传递的唯一真相源

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `data/file/skills/cd-shared/references/worktree-discipline.md` | 修改 | Rule 5 和执行流程更新为 set_context |
| `data/file/skills/cd-design/references/workflow.md` | 修改 | GATE-1 更新为 set_context |
| `data/file/skills/cd-development/references/workflow.md` | 修改 | GATE-1 更新为 set_context |
| `data/file/skills/cd-design/SKILL.md` | 修改 | 验收清单新增 design-ctx，信号模板更新 |
| `data/file/skills/cd-development/SKILL.md` | 修改 | 验收清单新增 dev-ctx，信号模板更新 |
| `data/file/skills/cd-review/SKILL.md` | 修改 | 验收清单新增 rev-ctx，信号模板更新 |
| `src/app/issue-collaboration/auto-advance.ts` | 修改 | evaluate() 各 stage 方法增加 context 前置条件校验 |
| `src/app/issue-collaboration/collaboration.ts` | 修改 | buildContextBlock() 增加空值警告 |

## 验证

### P1 验证

- [ ] `cd-design/references/workflow.md` GATE-1 不再引用 `record-issue-repo-context`
- [ ] `cd-development/references/workflow.md` GATE-1 不再引用 `record-issue-repo-context`
- [ ] `cd-shared/references/worktree-discipline.md` 不再引用 `record-issue-repo-context`
- [ ] `cd-design/SKILL.md` 验收清单包含 `design-ctx` 项
- [ ] `cd-development/SKILL.md` 验收清单包含 `dev-ctx` 项
- [ ] `cd-review/SKILL.md` 验收清单包含 `rev-ctx` 项
- [ ] 信号协议模板包含 context 字段

### P2 验证

- [ ] AutoAdvanceEngine 在 context 字段缺失时阻断 design → development 推进
- [ ] AutoAdvanceEngine 在 context 字段缺失时阻断 development → review 推进
- [ ] AutoAdvanceEngine 在 context 字段缺失时阻断 review → merge 推进
- [ ] AutoAdvanceEngine 在 context 字段完整时正常推进
- [ ] system reminder 在 context 为空时显示警告标记
- [ ] `npm run check` 通过
- [ ] 相关测试通过

## 关联

- **前置**: F2026062310（Issue Context MCP 方案，本 feature 的基础设施）
- **前置**: F20260624d5pg（Context 使用边界，本 feature 不重复定义）
- **相关**: F2026052104（Stage Artifact Context Unification，首次识别 enforcement gap）
- **相关**: F2026060303（Stage Transition Verification，上次修复尝试）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|---------|---------|---------|---------|--------|------|
| D1 | Context key 命名策略：无前缀 vs 带 stage 前缀 | 无前缀：跨 stage 自然传递，下游直接读取，语义清晰（"当前 issue 的仓库环境"） | 带前缀：来源可追溯，与现有 key 命名一致 | 无前缀策略 | worktree_path/branch_name/pr_url 是跨 stage 共享基础设施，不是 stage 专属产物；下游 stage 需要直接读取上游值 | 架构师-1 | 2026-06-29 |
| D2 | Enforcement 强度：硬检查 vs 软引导 | 硬检查：4 次修复证明软约束无效，必须系统级阻断 | 软引导：避免阻断正常流程，给 AI 灵活性 | 双层互补：系统硬检查 + SOP 软引导 | 历史 4 次修复全部采用软约束，均未解决问题；硬检查是唯一可靠的 enforcement 机制 | 架构师-1 | 2026-06-29 |
| D3 | 校验范围：只检查存在性 vs 校验值内容 | 只检查存在性：实现简单，覆盖核心问题 | 校验值内容：更严格，防止记录错误值 | 只检查存在性 | 核心问题是"忘记记录"，不是"记录错误值"；值内容校验增加复杂度但收益低 | 架构师-1 | 2026-06-29 |
| D4 | P2 校验位置：allGatesPassed() 内部 vs evaluate() 前置条件 | evaluate() 前置条件：职责分离，gate_evidence 校验和 context 校验是两个独立关注点 | allGatesPassed() 内部：改动集中，减少代码分散 | evaluate() 前置条件 | allGatesPassed() 签名不含 Issue 对象，强行传入会污染接口；前置条件检查失败时直接返回，不进入 gate 校验逻辑 | 架构师-2 | 2026-06-29 |

## 范围变更记录

（无）
