---
id: F2026060311
title: fix-feature-terminology
from_ids: [F2026060111]
tags: [terminology, rename]
modules: [prompt, workflow, skill, sop]
doc_kind: spec
---

# F2026060311 [prompt] 研发层 feature 术语回退

## 背景

F2026060111 将 workspace 工作项从 "Feature" 重命名为 "Issue"，但变更范围过度泛化——把软件研发层的 feature 术语也一并改成了 issue。实际上存在两个不同层次的概念：

- **Workspace 管理层**：工作项容器 → issue（正确）
- **软件研发层**：代码仓中正在开发的特性 → feature（不应被改）

导致 `docs/features/` 被改为 `docs/issues/`、commit 模板 `[Feature Update]` 被改为 `[Issue Update]`、所有 SOP/skills/prompts 中的 "Feature 文档" 被改为 "Issue 文档"。

## 目标

回退研发层的术语变更，恢复 feature 在软件研发语境中的正确使用。

## 非目标

- 不改变 workspace 管理层的 issue 概念（数据库表名、API 路由、代码类型等）
- 不改变 `record-issue-repo-context` skill（它记录的是 workspace 级上下文）

## 设计

### 两层概念区分

| 层次 | 概念 | 术语 |
|------|------|------|
| Workspace 管理层 | 工单/任务容器 | issue（`IYYYYMMDDNN`、issue_id 等） |
| 软件研发层 | 代码仓中正在开发的特性 | feature（`docs/features/`、`[Feature Update]`、Feature 文档） |

### 回退范围

1. 目录：`docs/issues/` → `docs/features/`
2. Skill：`issue-chain` → `feature-chain`
3. 脚本：`issue-chain.js` → `feature-chain.js`，CLI 命令 `issue-chain-*` → `feature-chain-*`
4. Commit 模板标签：`[Issue Update|BugFix|New Issue]` → `[Feature Update|BugFix|New Feature]`
5. Feature 文档 ID 格式：`IYYYYMMDDNN` → `FYYYYMMDDNN`
6. 文档引用：所有 SOP/skills/prompts 中 "Issue 文档" → "Feature 文档"
7. 目录路径：`docs/issues/YYYY/MM/DD/` → `docs/features/YYYY/MM/DD/`

### 保持不变

- `record-issue-repo-context` skill（workspace 级上下文记录）
- 所有 workspace 级 "issue" 引用（worktree、当前 issue、Stage 归属等）
- 数据库表名、API 路由、代码类型

## 生效路径

通过以下入口生效：
- `.githooks/commit-msg` — commit 模板校验
- `.meta/prompts/reference/` — 参考约束
- `config/sop/code-delivery/` — SOP 手册
- `.meta/skills/` — skill 手册和脚本
- `docs/README.md` — 文档目录准则
- `.meta/scripts/db-bridge.js` — CLI 命令路由

## 设计约束摘要

- **边界**：只改研发层术语，不动 workspace 管理层
- **关键决策**：`record-issue-repo-context` 保持不变，因为它记录的是 workspace 级上下文
- **语义不变量**：workspace 工作项始终叫 issue，代码仓中的特性始终叫 feature

## 改动范围

- `.githooks/commit-msg`
- `.meta/prompts/reference/检视.md`、`提交.md`、`实现.md`、`测试.md`
- `.meta/prompt-evaluations/prompt-behavior-samples.json`
- `.meta/scripts/db-bridge.js`
- `.meta/skills/developer-handbook/SKILL.md`
- `.meta/skills/reviewer-handbook/SKILL.md`
- `.meta/skills/feature-chain/SKILL.md`（原 issue-chain）
- `.meta/skills/feature-chain/scripts/feature-chain.js`（原 issue-chain.js）
- `.meta/skills/prompt-constraints/SKILL.md`
- `.meta/skills/record-issue-repo-context/SKILL.md`（仅 ID 格式引用）
- `config/sop/code-delivery/design#designer.handbook.md`
- `config/sop/code-delivery/development#developer.handbook.md`
- `config/sop/code-delivery/review#developer.handbook.md`
- `config/sop/code-delivery/review#reviewer.handbook.md`
- `config/sop/code-delivery/merge#merger.handbook.md`
- `config/sop/code-delivery/shared.handbook.md`
- `docs/README.md`
- `docs/features/`（原 docs/issues/，目录重命名）

## 验证

- [ ] grep 确认非 historical 文件中无残留 `Issue 文档`、`Issue Update`、`docs/issues`、`IYYYYMMDDNN`
- [ ] grep 确认 `record-issue-repo-context` 保持不变
- [ ] commit hook 正确校验 `[FYYYYMMDDNN][module][Feature Update|BugFix|New Feature]` 模板

## 关联

- **前置**: {F2026060111}（Feature to Issue 重命名）
