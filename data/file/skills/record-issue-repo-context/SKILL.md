---
name: record-issue-repo-context
description: 将 Issue 的分支名、worktree 路径和 PR URL 记录到 Issue 级别的 context。首次记录应传 --stage-id {{stage_id}}（系统提示词注入）；已记录后可在 worktree 内无参数自动发现。
---

# Record Issue Repo Context

## Purpose

将当前 Issue 的仓库相关信息（分支名、worktree 路径、PR URL）写入 Issue 级别的 `context`（`Record<string, string>` map），使系统能够追踪和清理 worktree 资源。该 skill 只记录已存在 Issue 的 repo context，不负责创建 Issue。

[HARD] 本记录是推进阶段的硬性依赖——下一 Stage 的审查者从 Issue.context 读取 `dev.worktree_path` 确定检视目录，缺少此记录则审查者无法工作。调用失败不得静默跳过；必须先排查并修复根因，确认记录成功后再继续后续步骤。

## When To Use

在开发工作流中，创建或确认工作分支、worktree 和 PR 后调用。

## Command

**首次记录（可靠）**——传入系统提示词注入的 `{{stage_id}}`：

```
node data/file/skills/record-issue-repo-context/scripts/record-issue-repo-context.js \
  --stage-id {{stage_id}} \
  --stage-key dev \
  --set branch_name=<branch> \
  --set worktree_path=<path> \
  --set pr_url=<url>
```

**已记录后（便捷）**——在 worktree 内直接调用，脚本通过 API 获取 issue_id：

```
node data/file/skills/record-issue-repo-context/scripts/record-issue-repo-context.js \
  --stage-id {{stage_id}} \
  --stage-key dev \
  --set branch_name=<branch> \
  --set worktree_path=<path> \
  --set pr_url=<url>
```

## Parameters

| 参数 | 必填 | 说明 |
|---|---|---|
| `--set key=value` | 至少一个 | 写入 Issue.context 的 key-value 对。可多次使用。 |
| `--stage-id` | 暂无可用 ID 时必填 | Stage 的数据库 UUID。值从系统提示词 `{{stage_id}}` 获取。 |
| `--stage-key` | 否 | Stage 的 key（如 `design`、`dev`、`review`），用于自动添加 key 前缀。 |
| `--issue-id` | 否 | Issue 的**数据库 UUID**（不是文档编号）。 |
| `--api-base` | 否 | API base URL，默认 `http://localhost:3000`。 |

常用 key：
- `branch_name`：工作分支名
- `worktree_path`：worktree 绝对路径
- `pr_url`：PR 链接

值可以是普通字符串，也可以是 `{"value":"xxx","keep":true}` 对象。`keep: true` 表示永久保留，归档时跳过清理。仅在用户显式要求永久保留时使用。例如：`--set worktree_path='{"value":"/path/to/report","keep":true}'`

## How It Works

定位顺序：
1. 传入 `--stage-id` → 通过 API 获取 stage 的 issue_id
2. 传入 `--issue-id` → 直接使用

定位到 Issue 后，将 `--set` 指定的 key-value 对 **merge** 到 Issue 已有 `context` 中，通过 `PATCH /api/issues/:issueId/context` API 写入。

### Key 前缀自动注入

如果传入 `--stage-key`，脚本会自动为每个 key 添加前缀。例如：
- `--stage-key dev --set worktree_path=/path/to/worktree` → 写入 `dev.worktree_path`
- `--stage-key design --set feature_doc_path=docs/xxx.md` → 写入 `design.feature_doc_path`

前缀的用途：
- 避免不同 Stage 产出同名 artifact 时的 key 冲突
- UI 展示时用户能一眼看出来源
- agent 不关心前缀（它只看 key-value），但也不受前缀影响

### Merge 语义

Merge 是**浅合并**（JavaScript spread operator: `{ ...current, ...entries }`）：
- 顶层 key：新 key 添加，已有 key 更新，未指定的 key 保留
- 嵌套对象：整体替换，不做深度合并

例如：当前 `{"key": {"a": 1, "b": 2}}`，写入 `{"key": {"a": 99}}`，结果为 `{"key": {"a": 99}}`（`b` 丢失）。

## 归档清理行为

归档时系统遍历 Issue.context，对每个值进行清理判断：
- 值在约定 worktree 目录内（`.claude/worktrees/`、`.snail/worktrees/`）→ 移除 worktree
- 值是合法本地分支名 → 删除分支
- 其他值（如 URL、绝对路径等）→ 跳过

通过 `--set key='{"value":"xxx","keep":true}'` 可标记特定值为永久保留，归档时跳过清理。仅在用户显式要求时使用。

## 数据库 ID 与文档编号的区别

文档编号 `FYYYYMMDDNN`（如 `F2026052301`）是 feature 设计文档的文件命名约定，**不是数据库 ID**。数据库中的 Issue/Stage 使用 UUID。

`--stage-id` 和 `--issue-id` 接受数据库 UUID，不是文档编号。

## Output

成功后输出 JSON：

```json
{
  "issue_id": "...",
  "discovered_by": "stage-id",
  "context": {
    "dev.branch_name": "...",
    "dev.worktree_path": "...",
    "dev.pr_url": "..."
  }
}
```

## Hard Rules

1. Issue 必须已存在于 Snail Shell 数据库中（通过系统工作流创建）。
2. 脚本调用失败不得静默跳过——必须排查根因、修复后重试，确认记录成功后再继续。
3. 写入时使用 merge 语义：只更新 `--set` 指定的 key，保留已有 key。
4. 任何角色创建 worktree 或分支后，必须记录 `worktree_path`/`branch_name` 到 Issue.context，确保归档时能清理。未记录的资源等同于泄漏。
