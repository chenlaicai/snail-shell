---
id: I2026052801
title: system-prompt-injection-order-and-codex-native
from_ids: [I2026052602, I2026051907]
tags: [prompt, agent, codex]
modules: [project_management]
doc_kind: spec
---

# I2026052801 [project_management] system-prompt 注入顺序修复 + Codex 原生 developer_instructions 注入

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

OpenCode 和 Codex 两个 stateful CLI agent 的 system-prompt 存在两个问题：

1. **顺序错误**：`renderStatefulPrompt()` 中 `<system-reminder>`（动态上下文）排在 `## 当前任务上下文`（静态规则）前面。systemPrompt 是基础宪法，应优先注入。
2. **注入方式不一致**：Claude Code 通过 `--append-system-prompt-file` 原生注入 system prompt，与对话内容分离；OpenCode/Codex 把 system prompt 混在 stdin 文本里，模型无法从结构上区分规则和对话。

Codex CLI 支持 `-c developer_instructions=...` 原生配置注入，可将 system prompt 作为系统级指令传递，与对话内容分离。

## 目标

1. 修复 `renderStatefulPrompt` 顺序：systemPrompt → system-reminder → 消息
2. Codex 新 session 通过 `-c developer_instructions=...` 原生注入 systemPrompt
3. Codex prompt 文本跳过 `## 当前任务上下文` 避免重复

## 非目标

- OpenCode 无原生 system-prompt 参数，保持 prompt 文本注入方式
- 不修改 Claude Code 的注入方式（已通过 `--append-system-prompt-file` 正确实现）
- 不修改 systemPrompt/systemReminder 的拆分逻辑（I2026052602 已完成）

## 设计

### 顺序修复

`renderStatefulPrompt()` 调整为：
1. systemPrompt（`## 当前任务上下文`）— 基础宪法
2. system-reminder（`<system-reminder>`）— 动态运行时上下文
3. `## 引用消息` — bootstrap 历史
4. `## 新消息` — 增量消息

新增 `RenderStatefulPromptOptions.skipSystemPrompt` 参数，支持运行时跳过 systemPrompt 渲染。

### Codex 原生注入

- 新 session：`codex exec --json --model <model> -c 'developer_instructions=<TOML escaped string>' -`
- Resume session：不注入（使用 thread 已有上下文）
- `escapeTomlBasicString()` 处理 TOML 特殊字符：`"` → `\"`，`\` → `\\`，`\n` → `\\n`

## 生效路径

- `src/agent/stateful-prompt-format.ts`：顺序修复 + skipSystemPrompt 选项
- `src/agent/codex.ts`：buildArgs() 新增 `-c developer_instructions` 注入 + escapeTomlBasicString()

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 变更说明 |
|---|---|
| `src/agent/stateful-prompt-format.ts` | 顺序修复 + skipSystemPrompt 选项 |
| `src/agent/codex.ts` | buildArgs 新增 `-c developer_instructions` + TOML 转义 |
| `tests/agent/stateful-prompt-format-test.ts` | 新增 3 项测试 |
| `tests/agent/codex-buildargs-test.ts` | 新增 2 项测试 + 更新 2 项 |

## 验证

- [x] TypeScript 编译零错误
- [x] ESLint 零错误
- [x] 全部 42 项测试通过
- [x] Codex 新 session 包含 `-c developer_instructions`
- [x] Codex resume session 不包含 `-c`
- [x] systemPrompt 在 system-reminder 之前注入
- [x] skipSystemPrompt=true 时跳过 systemPrompt 渲染

## 关联

- **前置**: I2026052602（systemPrompt/systemReminder 拆分）
- **前置**: I2026051907（stateful prompt 格式优化）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | Codex developer_instructions 作为 CLI 参数可能超长 | 系统 prompt 通常 5-20KB，远低于 ARG_MAX（256KB）；如后续超长可改用临时文件 | 2026-05-28 |
| 2 | OpenCode 无原生注入机制 | 保持 prompt 文本注入；后续 OpenCode 支持类似参数时再适配 | 2026-05-28 |
