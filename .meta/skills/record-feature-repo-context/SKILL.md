---
name: record-feature-repo-context
description: 将 Feature 的分支名、worktree 路径和 PR URL 记录到 Snail Shell 数据库。用于开发流程中创建或确认工作分支、worktree 和 PR 后的收尾记录。
---

# Record Feature Repo Context

## Purpose

将当前 Feature 的仓库相关信息（分支名、worktree 路径、PR URL）写入 Snail Shell 数据库，使系统能够追踪和清理 worktree 资源。该 skill 只记录已存在 Feature 的 repo context，不负责创建 Feature。

## When To Use

在开发工作流中，创建或确认工作分支、worktree 和 PR 后调用。

## Command

`.meta/skills/record-feature-repo-context/record-feature-repo-context --feature-id <feature-id> --branch-name <branch> --worktree-path <path> --pr-url <url>`

## Parameters

| 参数 | 必填 | 说明 |
|---|---|---|
| `--feature-id` | 是 | Feature 编号，如 `F2026051305` |
| `--branch-name` | 至少填一个 | 工作分支名 |
| `--worktree-path` | 至少填一个 | worktree 绝对路径 |
| `--pr-url` | 至少填一个 | PR 链接 |
| `--db-path` | 否 | 数据库路径；默认解析为脚本所属 Snail Shell git 主工作区的 `data/snail-shell.db`，在 worktree 内调用时不会落到 worktree 自己的空数据库 |

## Feature ID Boundary

`--feature-id` 必须是 Snail Shell 数据库中已经存在的 Feature 编号。`docs/features/YYYYMMDD/FYYYYMMDDNN-*.md` 文件名只是研发文档编号，不能替代数据库 Feature 记录。

如果脚本返回 `Feature not found: <feature-id>`：

1. 先查看错误里的 `Checked database`，确认脚本检查的是当前 Snail Shell 实例数据库。
2. 如果 Feature 存在于其他数据库，显式传入 `--db-path` 或设置 `DB_PATH`。
3. 如果该编号只存在于 feature 文档中，必须先通过 Snail Shell 工作流创建或选择对应 Feature，再重新记录 repo context。
4. 不要手工往数据库补 Feature 行来绕过工作流；Feature 生命周期、Stage 和 Conversation 归属必须由系统工作流维护。

## Output

成功后输出 JSON：

```json
{
  "feature_id": "F2026051305",
  "branch_name": "...",
  "worktree_path": "...",
  "pr_url": "..."
}
```

## Hard Rules

1. Feature 必须已存在于 Snail Shell 数据库中（通过系统工作流创建）。
2. 已归档的 Feature 不可更新。
3. 脚本调用失败时说明失败原因并继续当前主任务，不要阻塞主工作流。
4. 在隔离 worktree 内调用时，默认数据库仍应指向主工作区数据库；只有确实要操作其他 Snail Shell 实例时才传 `--db-path`。
