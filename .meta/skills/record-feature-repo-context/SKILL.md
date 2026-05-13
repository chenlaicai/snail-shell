---
name: record-feature-repo-context
description: 将 Feature 的分支名、worktree 路径和 PR URL 记录到 Snail Shell 数据库。用于开发流程中创建或确认工作分支、worktree 和 PR 后的收尾记录。
---

# Record Feature Repo Context

## Purpose

将当前 Feature 的仓库相关信息（分支名、worktree 路径、PR URL）写入 Snail Shell 数据库，使系统能够追踪和清理 worktree 资源。

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
| `--db-path` | 否 | 数据库路径，默认 `data/snail-shell.db` |

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
