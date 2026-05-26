---
name: set-task-anchor
description: 将 Feature 的任务锚写入数据库。任务锚结构化记录本质目标、反目标、语义不变量和成功标准，复杂/长任务开始行动前设置，后续关键决策点必须重新对照。
---

# Set Feature Task Anchor

## Purpose

将当前 Feature 的任务锚（task anchor）写入 Feature 记录的 `task_anchor` 字段，该字段会被注入到后续系统提示词的 `<task_anchor> [HARD]` 区块中。任务锚用于在多轮对话中维持意图一致性，防止 AI 在冲突解决、错误修复等场景中偏离本质目标。

## When To Use

在开发工作流中，复杂或长任务开始行动前（通常在 Feature 需求收敛阶段）设置任务锚。可多次调用以更新任务锚。

## Command

```
node .meta/skills/set-task-anchor/scripts/set-task-anchor.js \
  --feature-id <feature-id> \
  --task-anchor <task-anchor-content>
```

## Parameters

| 参数 | 必填 | 说明 |
|---|---|---|
| `--feature-id` | 是 | Feature 编号，如 `F2026052105` |
| `--task-anchor` | 是 | 任务锚内容。建议结构化格式：本质目标、反目标、语义不变量、成功标准 |

## How It Works

1. 根据 `--feature-id` 查找 Feature 记录
2. 检查 Feature 存在且未被归档
3. 将 `--task-anchor` 的值写入 Feature 的 `task_anchor` 列
4. 系统提示词 builder 会自动读取 `task_anchor` 并渲染为 `<task_anchor> [HARD]` 区块

## Feature ID Boundary

`--feature-id` 必须是 Snail Shell 数据库中已经存在的 Feature 编号。如果脚本返回 `Feature not found`：

1. 确认 Feature 已通过 Snail Shell 工作流创建。
3. 不要手工往数据库补 Feature 行来绕过工作流。

## Output

成功后输出 JSON：

```json
{
  "feature_id": "F2026052105",
  "task_anchor": "本质目标: ...\n反目标: ...\n语义不变量: ...\n成功标准: ..."
}
```

## Hard Rules

1. Feature 必须已存在于 Snail Shell 数据库中（通过系统工作流创建）。
2. 已归档 Feature 不可更新。
3. 脚本调用失败时说明失败原因并继续当前主任务，不要阻塞主工作流。
4. 在隔离 worktree 内调用时，默认数据库仍应指向主工作区数据库。
