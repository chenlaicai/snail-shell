---
name: set-task-anchor
description: 将 Issue 的任务锚写入数据库。任务锚结构化记录本质目标、反目标、语义不变量和成功标准，复杂/长任务开始行动前设置，后续关键决策点必须重新对照。
---

# Set Issue Task Anchor

## Purpose

将当前 Issue 的任务锚（task anchor）写入 Issue 记录的 `task_anchor` 字段，该字段会被注入到后续系统提示词的 `<task_anchor> [HARD]` 区块中。任务锚用于在多轮对话中维持意图一致性，防止 AI 在冲突解决、错误修复等场景中偏离本质目标。

## When To Use

在开发工作流中，复杂或长任务开始行动前（通常在 Issue 需求收敛阶段）设置任务锚。可多次调用以更新任务锚。

## Instructions

调用 MCP Tool `snail-issue.set_task_anchor`，传入以下参数：

- `task_anchor`：任务锚内容
- `issue_id`（可选）：Issue ID。如果未传入，将从环境变量 `SNAIL_CTX_ISSUE_ID` 自动获取。

## Task Anchor 结构

task_anchor 建议包含以下字段（纯文本，用换行分隔）：

| 字段 | 必填 | 说明 |
|---|---|---|
| 本质目标 | 建议 | 为什么做这件事，要达成什么语义状态 |
| 反目标 | 建议 | 不得做什么，具体后果 |
| 语义不变量 | 建议 | 已确认的事实/决定，不可被覆盖 |
| 成功标准 | 建议 | 可验证的检验方式 |
| change_type | 建议 | 变更类型标签：`rename` / `migration` / `config-sync` / `refactor` / `feature` / `bugfix`。用于阶段门控的证据验证——决定开发者和审查者应执行哪组验证命令。未指定时按通用规则中的默认模板推断 |
| verification_commands | 否 | 开发者和审查者都应执行的验证命令列表。未指定时按 change_type 使用默认验证模板 |

`change_type` 和 `verification_commands` 被用于阶段门控的证据验证：开发者在提交 PR 前执行并记录输出（dev-06），审查者在检视时独立执行同一组命令（rev-02）。

## Issue ID Boundary

`issue_id` 必须是 Snail Shell 数据库中已经存在的 Issue 编号。如果返回 `Issue not found`：

1. 确认 Issue 已通过 Snail Shell 工作流创建。
2. 不要手工往数据库补 Issue 行来绕过工作流。

## Output

成功后输出 JSON：

```json
{
  "ok": true,
  "issue_id": "...",
  "task_anchor": "本质目标: ...\n反目标: ...\n语义不变量: ...\n成功标准: ...\nchange_type: rename\nverification_commands:\n- grep -r \"旧名字\" --include=\"*.ts\" → 预期 0 匹配"
}
```

## Hard Rules

1. Issue 必须已存在于 Snail Shell 数据库中（通过系统工作流创建）。
2. 已归档 Issue 不可更新。
3. 调用失败时说明失败原因并继续当前主任务，不要阻塞主工作流。
