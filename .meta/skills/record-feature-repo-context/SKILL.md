---
name: record-feature-repo-context
description: 将 Feature 的分支名、worktree 路径和 PR URL 记录到当前 Stage 的 output_artifacts。首次记录应传 --stage-id {{stage_id}}（系统提示词注入）；已记录后可在 worktree 内无参数自动发现。
---

# Record Feature Repo Context

## Purpose

将当前 Feature 的仓库相关信息（分支名、worktree 路径、PR URL）写入当前 Stage 的 `output_artifacts`（`Record<string, string>` map），使系统能够追踪和清理 worktree 资源。该 skill 只记录已存在 Feature/Stage 的 repo context，不负责创建 Feature。

[HARD] 本记录是推进阶段的硬性依赖——下一 Stage 的检视者从 `input_artifacts` 读取 `worktree_path` 确定检视目录，缺少此记录则检视者无法工作。调用失败不得静默跳过；必须先排查并修复根因，确认记录成功后再继续后续步骤。

## When To Use

在开发工作流中，创建或确认工作分支、worktree 和 PR 后调用。

## Command

**首次记录（可靠）**——传入系统提示词注入的 `{{stage_id}}`：

```
node .meta/skills/record-feature-repo-context/scripts/record-feature-repo-context.js \
  --stage-id {{stage_id}} \
  --set branch_name=<branch> \
  --set worktree_path=<path> \
  --set pr_url=<url>
```

**已记录后（便捷）**——在 worktree 内直接调用，脚本通过 `output_artifacts.worktree_path` 匹配 cwd 自动发现：

```
node .meta/skills/record-feature-repo-context/scripts/record-feature-repo-context.js \
  --set branch_name=<branch> \
  --set worktree_path=<path> \
  --set pr_url=<url>
```

## Parameters

| 参数 | 必填 | 说明 |
|---|---|---|
| `--set key=value` | 至少一个 | 写入 output_artifacts 的 key-value 对。可多次使用。 |
| `--stage-id` | 暂无可用 ID 时必填 | Stage 的数据库 UUID。值从系统提示词 `{{stage_id}}` 获取。 |
| `--feature-id` | 否 | Feature 的**数据库 UUID**（不是文档编号）。通过 Feature 查找活跃 Stage。 |

常用 key：
- `branch_name`：工作分支名
- `worktree_path`：worktree 绝对路径
- `pr_url`：PR 链接

## How It Works

定位顺序：
1. 传入 `--stage-id` → 直接定位 Stage
2. 未传 → 自动发现：遍历 Stage 的 `output_artifacts.worktree_path` 匹配 `cwd` 前缀
3. 仍未找到且传了 `--feature-id` → 通过 Feature 查找活跃 Stage

定位到 Stage 后，将 `--set` 指定的 key-value 对 **merge** 到 Stage 已有 `output_artifacts` 中（不覆盖未指定的 key），写入 stage 表。

### 自发现的限制

自发现依赖已记录的 `worktree_path`，只能用于 **re-recording**（已记录过 worktree_path 后再次更新）。**首次记录时 output_artifacts 为空，自发现无法工作，必须传 `--stage-id`**。

## 数据库 ID 与文档编号的区别

文档编号 `FYYYYMMDDNN`（如 `F2026052301`）是 feature 设计文档的文件命名约定，**不是数据库 ID**。数据库中的 Feature/Stage 使用 UUID。

`--stage-id` 和 `--feature-id` 接受数据库 UUID，不是文档编号。

## Output

成功后输出 JSON：

```json
{
  "stage_id": "...",
  "feature_id": "...",
  "feature_title": "...",
  "stage_type": "...",
  "discovered_by": "stage-id",
  "output_artifacts": {
    "branch_name": "...",
    "worktree_path": "...",
    "pr_url": "..."
  }
}
```

## Hard Rules

1. Feature 必须已存在于 Snail Shell 数据库中（通过系统工作流创建）。
2. 已归档 Feature 的 Stage 不可更新。
3. 脚本调用失败不得静默跳过——必须排查根因、修复后重试，确认记录成功后再继续。
4. 在隔离 worktree 内调用时，默认数据库仍应指向主工作区数据库。
5. 写入时使用 merge 语义：只更新 `--set` 指定的 key，保留已有 key。
