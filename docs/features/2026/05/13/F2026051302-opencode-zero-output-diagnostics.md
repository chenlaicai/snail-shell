---
id: F2026051302
title: OpenCode 零输出诊断信息完善
from_ids: []
tags: [diagnostics, error-handling, agent]
modules: [project_management]
---
# F2026051302 OpenCode 零输出诊断信息完善

## 背景

"知识飞轮优化0512"任务反复报 `OpenCode returned no output events` 错误，但用户无法看到真正原因。排查发现根因是 MiMo API 的 `mimo-v2.5-pro` 模型默认启用 thinking mode，MiMo API 要求在多轮对话中传回 `reasoning_content`，但 OpenCode CLI 使用的 `@ai-sdk/openai-compatible` SDK 不知道这个非标准要求，导致缓存失效后 API 返回 400 错误。

当前 Snail Shell 的 `assertOutputEvents` 在 `exitCode === 0` 但 `outputEventCount === 0` 时只抛出 "no output events" 错误，不包含 stderr 和 rawOutput，导致用户无法看到真正原因。

## 目标

1. 当 `outputEventCount === 0` 时，错误信息包含 stderr 和 rawOutput，帮助用户诊断真正原因。
2. 对 stderr 和 rawOutput 进行截断（500 字符），避免错误信息过长。
3. 保持 `exitCode !== 0` 时的错误信息不变。
4. 不改变 `outputEventCount` 的计算逻辑。

## 非目标

1. 本次不修复 OpenCode CLI / @ai-sdk/openai-compatible 的 reasoning_content 回传 bug。
2. 本次不自动清理或重建 runtime session。
3. 本次不改变 MiMo API 的 thinking mode 配置。

## 设计

修改 `stateful-cli-agent.ts` 中的 `assertOutputEvents` 方法，让它接收 `stderr` 参数，在 `outputEventCount === 0` 时把 stderr 和 rawOutput 包含在错误信息中，并截断到 500 字符。

修改 `invokeStateful` 方法，把 `stderr` 传递给 `assertOutputEvents`。

`claude-code.ts` 因架构不同（独立实现，没有 ParseState/rawOutput），只添加 stderr。

## 生效路径

1. `src/agent/stateful-cli-agent.ts` - OpenCode/Gemini 的 `assertOutputEvents` 和 `invokeStateful`
2. `src/agent/codex.ts` - Codex 的 `assertCodexOutputEvents` 和 `invokeStateful`
3. `src/agent/claude-code.ts` - Claude Code 的 `invokeMessage`
4. `tests/agent/opencode-parser-test.ts` - 补充测试覆盖

## 改动范围

1. 修改 `src/agent/stateful-cli-agent.ts`
2. 修改 `src/agent/codex.ts`
3. 修改 `src/agent/claude-code.ts`
4. 修改 `tests/agent/opencode-parser-test.ts`
5. 新增本 feature 文档

## 验证

1. `npm run build` ✓
2. `npm run lint` ✓
3. `npm run test` ✓（35 个测试文件全部通过）
4. PR: https://github.com/chenlaicai/snail-shell/pull/166

## 风险与决策记录

1. 决策：错误信息包含 stderr 和 rawOutput，截断到 500 字符。原因是避免错误信息过长导致日志难以阅读。
2. 决策：`claude-code.ts` 只添加 stderr，不添加 rawOutput。原因是 Claude Code 的架构不同，没有 ParseState/rawOutput。
3. 决策：不改变 `outputEventCount` 的计算逻辑，只改进错误信息。原因是 `outputEventCount` 的计算逻辑是正确的，问题在于错误信息不够详细。
