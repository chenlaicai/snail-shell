---
name: record-feature-repo-context
description: 将 Feature 的分支名、worktree 路径和 PR URL 记录到当前 Stage 的 output_artifacts。用于开发流程中创建或确认工作分支、worktree 和 PR 后的收尾记录。
---

# Record Feature Repo Context

## Purpose

将当前 Feature 的仓库相关信息（分支名、worktree 路径、PR URL）写入当前 Stage 的 `output_artifacts`（`Record<string, string>` map），使系统能够追踪和清理 worktree 资源。该 skill 只记录已存在 Feature/Stage 的 repo context，不负责创建 Feature。

## When To Use

在开发工作流中，创建或确认工作分支、worktree 和 PR 后调用。

## Command

```
node .meta/skills/record-feature-repo-context/scripts/record-feature-repo-context.js \
  --feature-id <feature-id> \
  --set branch_name=<branch> \
  --set worktree_path=<path> \
  --set pr_url=<url>
```

也可直接指定 Stage ID：

```
node .meta/skills/record-feature-repo-context/scripts/record-feature-repo-context.js \
  --stage-id <stage-id> \
  --set branch_name=<branch>
```

## Parameters

| 参数 | 必填 | 说明 |
|---|---|---|
| `--feature-id` | 与 `--stage-id` 二选一 | Feature 编号，如 `F2026051305`。自动查找当前活跃 Stage。 |
| `--stage-id` | 与 `--feature-id` 二选一 | Stage ID。直接指定目标 Stage。 |
| `--set key=value` | 至少一个 | 写入 output_artifacts 的 key-value 对。可多次使用。 |
| `--db-path` | 否 | 数据库路径；默认解析为脚本所属 Snail Shell git 主工作区的 `data/snail-shell.db` |

常用 key：
- `branch_name`：工作分支名
- `worktree_path`：worktree 绝对路径
- `pr_url`：PR 链接

## How It Works

1. 根据 `--feature-id` 查找当前活跃 Stage（或直接使用 `--stage-id`）
2. 将 `--set` 指定的 key-value 对 **merge** 到 Stage 已有 `output_artifacts` 中（不覆盖未指定的 key）
3. 更新后的 `output_artifacts` 写入 stage 表

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
  "stage_id": "...",
  "feature_id": "F2026051305",
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
3. 脚本调用失败时说明失败原因并继续当前主任务，不要阻塞主工作流。
4. 在隔离 worktree 内调用时，默认数据库仍应指向主工作区数据库；只有确实要操作其他 Snail Shell 实例时才传 `--db-path`。
5. 写入时使用 merge 语义：只更新 `--set` 指定的 key，保留已有 key。
