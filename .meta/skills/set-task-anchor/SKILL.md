---
name: set-task-anchor
description: 将 Issue 的任务锚写入数据库。任务锚结构化记录本质目标、反目标、语义不变量和成功标准，复杂/长任务开始行动前设置，后续关键决策点必须重新对照。
---

# Set Issue Task Anchor

## Purpose

将当前 Issue 的任务锚（task anchor）写入 Issue 记录的 `task_anchor` 字段，该字段会被注入到后续系统提示词的 `<task_anchor> [HARD]` 区块中。任务锚用于在多轮对话中维持意图一致性，防止 AI 在冲突解决、错误修复等场景中偏离本质目标。

## When To Use

在开发工作流中，复杂或长任务开始行动前（通常在 Issue 需求收敛阶段）设置任务锚。可多次调用以更新任务锚。

## Command

```
node .meta/skills/set-task-anchor/scripts/set-task-anchor.js \
  --issue-id <issue-id> \
  --task-anchor <task-anchor-content>
```

## Parameters

| 参数 | 必填 | 说明 |
|---|---|---|
| `--issue-id` | 是 | Issue 编号，如 `I2026052105` |
| `--task-anchor` | 是 | 任务锚内容。建议结构化格式：本质目标、反目标、语义不变量、成功标准、change_type、verification_commands |

## How It Works

1. 根据 `--issue-id` 查找 Issue 记录
2. 检查 Issue 存在且未被归档
3. 将 `--task-anchor` 的值写入 Issue 的 `task_anchor` 列
4. 系统提示词 builder 会自动读取 `task_anchor` 并渲染为 `<task_anchor> [HARD]` 区块

## Task Anchor 结构

task_anchor 建议包含以下字段（纯文本，用换行分隔）：

| 字段 | 必填 | 说明 |
|---|---|---|
| 本质目标 | 是 | 为什么做这件事，要达成什么语义状态 |
| 反目标 | 是 | 不得做什么，具体后果 |
| 语义不变量 | 是 | 已确认的事实/决定，不可被覆盖 |
| 成功标准 | 是 | 可验证的检验方式 |
| change_type | 是 | 变更类型标签：`rename` / `migration` / `config-sync` / `refactor` / `feature` / `bugfix` |
| verification_commands | 否 | 开发者和检视者都应执行的验证命令列表。未指定时按 change_type 使用默认验证模板 |

`change_type` 和 `verification_commands` 被用于阶段门控的证据验证：开发者在提交 PR 前执行并记录输出（dev-06），检视者在检视时独立执行同一组命令（rev-02）。

## Issue ID Boundary

`--issue-id` 必须是 Snail Shell 数据库中已经存在的 Issue 编号。如果脚本返回 `Issue not found`：

1. 确认 Issue 已通过 Snail Shell 工作流创建。
3. 不要手工往数据库补 Issue 行来绕过工作流。

## Output

成功后输出 JSON：

```json
{
  "issue_id": "I2026052105",
  "task_anchor": "本质目标: ...\n反目标: ...\n语义不变量: ...\n成功标准: ...\nchange_type: rename\nverification_commands:\n- grep -r \"旧名字\" --include=\"*.ts\" → 预期 0 匹配"
}
```

## Hard Rules

1. Issue 必须已存在于 Snail Shell 数据库中（通过系统工作流创建）。
2. 已归档 Issue 不可更新。
3. 脚本调用失败时说明失败原因并继续当前主任务，不要阻塞主工作流。
4. 在隔离 worktree 内调用时，默认数据库仍应指向主工作区数据库。
