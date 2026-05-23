---
name: record-feature-repo-context
description: 将 Feature 的分支名、worktree 路径和 PR URL 记录到当前 Stage 的 output_artifacts。用于开发流程中创建或确认工作分支、worktree 和 PR 后的收尾记录。优先使用 `--stage-id` 参数（值来自系统提示词注入的 `{{stage_id}}` 变量）。
---

# Record Feature Repo Context

## Purpose

将当前 Feature 的仓库相关信息（分支名、worktree 路径、PR URL）写入当前 Stage 的 `output_artifacts`（`Record<string, string>` map），使系统能够追踪和清理 worktree 资源。该 skill 只记录已存在 Feature/Stage 的 repo context，不负责创建 Feature。

[HARD] 本记录是推进阶段的硬性依赖——下一 Stage 的检视者从 `input_artifacts` 读取 `worktree_path` 确定检视目录，缺少此记录则检视者无法工作。调用失败不得静默跳过；必须先排查并修复根因，确认记录成功后再继续后续步骤。

## When To Use

在开发工作流中，创建或确认工作分支、worktree 和 PR 后调用。

## Command

**推荐方式（使用 Stage ID）**：

```
node .meta/skills/record-feature-repo-context/scripts/record-feature-repo-context.js \
  --stage-id <stage-id> \
  --set branch_name=<branch> \
  --set worktree_path=<path> \
  --set pr_url=<url>
```

也可通过 Feature ID 指定：

```
node .meta/skills/record-feature-repo-context/scripts/record-feature-repo-context.js \
  --feature-id <feature-id> \
  --set branch_name=<branch> \
  --set worktree_path=<path> \
  --set pr_url=<url>
```

## Parameters

| 参数 | 必填 | 说明 |
|---|---|---|
| `--stage-id` | 与 `--feature-id` 二选一 | Stage 的数据库 UUID。**AI 优先使用此参数**——值从系统提示词注入的 `{{stage_id}}` 模板变量获取。 |
| `--feature-id` | 与 `--stage-id` 二选一 | Feature 的**数据库 UUID**（不是 `docs/features/` 目录下的 `FYYYYMMDDNN` 文档编号）。自动查找当前活跃 Stage。 |
| `--set key=value` | 至少一个 | 写入 output_artifacts 的 key-value 对。可多次使用。 |
| `--db-path` | 否 | 数据库路径；默认解析为脚本所属 Snail Shell git 主工作区的 `data/snail-shell.db` |

常用 key：
- `branch_name`：工作分支名
- `worktree_path`：worktree 绝对路径
- `pr_url`：PR 链接

## How It Works

1. 根据 `--stage-id` 直接定位 Stage，或根据 `--feature-id` 查找当前活跃 Stage
2. 将 `--set` 指定的 key-value 对 **merge** 到 Stage 已有 `output_artifacts` 中（不覆盖未指定的 key）
3. 更新后的 `output_artifacts` 写入 stage 表

## 数据库 ID 与文档编号的区别

`--feature-id` 和 `--stage-id` 接受的是**数据库内部 UUID**（如 `1a0439f2-585e-43b7-bfbb-29f383ef2dcb`），而不是 `docs/features/YYYYMMDD/` 目录下的文档编号（如 `F2026052301`）。两者是不同的标识体系。

- 文档编号 `FYYYYMMDDNN`：feature 设计文档的文件命名约定，用于 `docs/features/` 目录组织。
- 数据库 UUID：Snail Shell 系统创建 Feature/Stage 时自动生成的唯一标识，存储在 `feature` 和 `stage` 表中。

**AI 获取正确 ID 的方式**：
- `{{stage_id}}` 模板变量已注入到系统提示词中，直接使用此值作为 `--stage-id` 参数。
- 若因特殊情况无法获取 `{{stage_id}}`，可通过 Snail Shell API 查询：`GET /api/features/:featureId/stages`（需服务器运行）。

## 脚本调用失败处理

脚本返回以下错误时，**不得静默跳过**：

- `No active stage found for feature: <id>`：传入的是文档编号而非数据库 UUID，或 Feature 无活跃 Stage。优先改用 `--stage-id {{stage_id}}`。
- `Feature not found: <id>`：数据库中没有该 ID 的 Feature。确认 ID 是数据库 UUID 而非文档编号。

调用失败必须先排查根因并修复后重试。记录成功是推进 Stage 的前置条件——失败时继续会导致后续 Stage 无法启动。

## Output

成功后输出 JSON：

```json
{
  "stage_id": "...",
  "feature_id": "...",
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
4. 在隔离 worktree 内调用时，默认数据库仍应指向主工作区数据库；只有确实要操作其他 Snail Shell 实例时才传 `--db-path`。
5. 写入时使用 merge 语义：只更新 `--set` 指定的 key，保留已有 key。
6. AI 优先使用 `--stage-id` 参数，值从系统提示词注入的 `{{stage_id}}` 模板变量获取。
