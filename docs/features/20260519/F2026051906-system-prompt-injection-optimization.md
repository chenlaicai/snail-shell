# F2026051906 系统提示词注入优化

## 背景

当前部分 stateful CLI runtime 只能把 Snail Shell 的上下文压平成单段 prompt 传入。压平时使用 `SYSTEM:`、`USER:`、`ASSISTANT:` 这类伪 transcript 标签包装当前系统规则和消息内容，会让模型更容易把项目级规则识别为用户粘贴的 transcript 文本，而不是当前任务环境的一部分。

## 目标

1. 去除 stateful CLI prompt 中包装当前系统规则的 `SYSTEM:` 伪角色标签。
2. 去除 Snail Shell 自行拼接增量消息时的 `USER:`/`ASSISTANT:` 伪 transcript 外层标签。
3. 将只能以 prompt 文本传入的上下文表达为结构化的当前任务上下文和引用消息，降低来源误识别。
4. 保持 Claude Code 等支持真实 system prompt 参数的 runtime 使用真实系统提示词通道。

## 非目标

1. 不改写 `.meta/prompts` 中的项目规则正文。
2. 不改变 Snail Shell 持久化的消息模型和历史查询协议。
3. 不新增跨 runtime 的多角色 API 抽象；本次仅修正现有 CLI flattening 表达。

## 设计

Stateful CLI prompt 压平层是本次问题的实际发生点。OpenCode 和 Gemini 继承 `StatefulCLIAgent`，Codex 单独实现 stdin prompt，两者都应使用同一语义结构：

1. bootstrap 系统规则进入 `## 当前任务上下文` 段落。
2. bootstrap 历史消息进入 `## 引用消息` 段落，并使用 `角色: user/assistant` 元数据表达来源。
3. 增量消息进入 `## 新消息` 段落，同样使用角色元数据，不制造 transcript 边界。
4. 用户消息内容内部不再预置 `USER:`；assistant 消息内容保留具体 snail 名称作为业务来源，不冒充 runtime assistant 角色。

Claude Code 已通过 `--system-prompt` 使用真实 system prompt 通道，同时用 JSON payload 表达 stateless transcript，本次不改变该路径。

## 生效路径

1. `src/agent/stateful-cli-agent.ts`
2. `src/agent/codex.ts`
3. `src/agent/prompt-mapper.ts`
4. `tests/agent/stateful-prompt-format-test.ts`

## 改动范围

1. 新增 stateful prompt formatter，集中定义当前上下文、引用消息和新消息的文本结构。
2. OpenCode/Gemini stateful CLI 与 Codex 共用该 formatter。
3. 调整增量消息 mapper，去掉用户消息内容中的伪 `USER:` 标签。
4. 增加测试覆盖 OpenCode/Gemini 共享路径、Codex 路径和增量消息 mapper。

## 验证

1. `npm run build`：通过；lint 输出 22 条既有 restricted-import warning，无 error。
2. `npx tsc && node dist/tests/agent/stateful-prompt-format-test.js`：通过。
3. `npm run test`：通过；39 个 compiled test files 全部通过。

## 风险与决策记录

已查询设计决策库，未发现与本次提示词注入方式直接冲突的既有决策。

本次选择在 runtime flattening 边界修复，而不是调整 `.meta/prompts` 正文，因为提示词正文按 `docs/core/prompt-system-structure.md` 已属于规则组织层，问题实际来自 CLI 入参把该规则包装成伪 transcript。

## 范围变更记录

暂无。
