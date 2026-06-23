---
name: record-issue-repo-context
description: 将 Issue 的分支名、worktree 路径和 PR URL 记录到当前 Stage 的 output_artifacts。通过 MCP Tool 调用，自动从环境变量获取 stage_id。
---

# Record Issue Repo Context

## Purpose

将当前 Issue 的仓库相关信息（分支名、worktree 路径、PR URL）写入当前 Stage 的 `output_artifacts`（`Record<string, string>` map），使系统能够追踪和清理 worktree 资源。该 skill 只记录已存在 Issue/Stage 的 repo context，不负责创建 Issue。

[HARD] 本记录是推进阶段的硬性依赖——下一 Stage 的审查者从 `input_artifacts` 读取 `worktree_path` 确定检视目录，缺少此记录则审查者无法工作。调用失败不得静默跳过；必须先排查并修复根因，确认记录成功后再继续后续步骤。

## When To Use

在开发工作流中，创建或确认工作分支、worktree 和 PR 后调用。

## Instructions

调用 MCP Tool `snail-issue.record_repo_context`，传入以下参数：

- `entries`：要记录的键值对，如 `{ "worktree_path": "/path/to/worktree", "branch_name": "feature/xxx" }`
- `stage_id`（可选）：Stage ID。如果未传入，将从环境变量 `SNAIL_CTX_STAGE_ID` 自动获取。

常用 key：
- `branch_name`：工作分支名
- `worktree_path`：worktree 绝对路径
- `pr_url`：PR 链接

值可以是普通字符串，也可以是 `{"value":"xxx","keep":true}` 对象。`keep: true` 表示永久保留，归档时跳过清理。仅在用户显式要求永久保留时使用。

## How It Works

MCP Tool 会自动从环境变量 `SNAIL_CTX_STAGE_ID` 获取当前 Stage ID。如果环境变量未设置且未传入 `stage_id` 参数，将返回明确的错误信息。

调用成功后，将 `entries` 中的键值对 **merge** 到 Stage 已有 `output_artifacts` 中。

### Merge 语义

Merge 是**浅合并**（JavaScript spread operator: `{ ...current, ...entries }`）：
- 顶层 key：新 key 添加，已有 key 更新，未指定的 key 保留
- 嵌套对象：整体替换，不做深度合并

例如：当前 `{"key": {"a": 1, "b": 2}}`，写入 `{"key": {"a": 99}}`，结果为 `{"key": {"a": 99}}`（`b` 丢失）。

## 归档清理行为

归档时系统遍历所有 stage 的 `output_artifacts`，对每个值进行清理判断：
- 值在约定 worktree 目录内（`.claude/worktrees/`、`.snail/worktrees/`）→ 移除 worktree
- 值是合法本地分支名 → 删除分支
- 其他值（如 URL、绝对路径等）→ 跳过

通过 `--set key='{"value":"xxx","keep":true}'` 可标记特定值为永久保留，归档时跳过清理。仅在用户显式要求时使用。

## Output

成功后输出 JSON：

```json
{
  "ok": true,
  "stage_id": "...",
  "output_artifacts": {
    "branch_name": "...",
    "worktree_path": "...",
    "pr_url": "..."
  }
}
```

## Hard Rules

1. Issue 必须已存在于 Snail Shell 数据库中（通过系统工作流创建）。
2. 已归档 Issue 的 Stage 不可更新。
3. 调用失败不得静默跳过——必须排查根因、修复后重试，确认记录成功后再继续。
4. 写入时使用 merge 语义：只更新指定的 key，保留已有 key。
5. 任何角色创建 worktree 或分支后，必须记录 `worktree_path`/`branch_name` 到 output_artifacts，确保归档时能清理。未记录的资源等同于泄漏。
