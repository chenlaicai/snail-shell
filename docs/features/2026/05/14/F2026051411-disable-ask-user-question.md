---
id: F2026051411
title: 禁止 AskUserQuestion tool
from_ids: []
tags: [general]
modules: [project_management]
---
# F2026051411 禁止 AskUserQuestion tool

## 背景

当 Claude Code CLI 使用 `--permission-mode bypassPermissions` 模式运行时，`AskUserQuestion` tool 会被权限系统拒绝。这是因为：

1. `bypassPermissions` 模式绕过了 Claude 的交互式权限检查
2. `AskUserQuestion` 是一个需要用户交互的 tool，不是普通的权限问题
3. Claude Code CLI 在 `bypassPermissions` 模式下会拒绝需要用户交互的 tool，返回错误而不是等待用户输入

这导致 Claude 尝试调用 `AskUserQuestion` 时收到错误后继续执行，用户看不到问题也无法回答。

## 目标

1. 在系统提示词中明确告诉 Claude，在 Snail Shell 环境中，`AskUserQuestion` tool 不可用
2. 引导 Claude 使用 `message-out question` 命令来向用户提问

## 非目标

1. 修改 Claude Code CLI 的权限模式
2. 在 Snail Shell 中特殊处理 `AskUserQuestion` 的逻辑

## 设计

在 `.meta/prompts/base/B-03-运行时边界.md` 中添加两条新规则：

1. **R06**: 明确禁止调用 `AskUserQuestion` tool，说明该 tool 在 Snail Shell 环境下不可用，调用会被拒绝并返回错误。

2. **R09**: 引导 Claude 使用 `message-out question` 命令生成问题卡片，并将生成的 payload 作为自己的消息内容返回。

同时修改 `when` 条件，让规则同时覆盖 `claude-code-cli` 和 `claude-code-stateful-cli`。

## 生效路径

通过 `.meta/prompts/base/B-03-运行时边界.md` 系统提示词生效。

## 改动范围

1. `.meta/prompts/base/B-03-运行时边界.md` - 添加 R06 和 R09 规则，修改 `when` 条件

## 验证

1. 运行 `npm run check` 验证代码检查通过
2. 验证系统提示词正确加载

## 风险与决策记录

无风险。这是一个纯提示词修改，不影响代码逻辑。

## 范围变更记录

无范围变更。
