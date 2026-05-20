# F2026052005 Claude 运行时错误韧性修复

## 背景

在接入 Claude Agent 过程中，系统间歇性遇到两类报错：

1. **OpenAI 503 错误**：`Error: OpenAI request failed (503): {"error":{"message":"Service temporarily unavailable",...}}`
2. **Claude Code 超时**：`Error: ClaudeCodeStateful invocation stopped: system_timeout`

这两个错误直接影响用户体验——消息处理中断，用户得不到任何响应。

## 目标

- OpenAI API 调用具备基本韧性：遇到 503 时自动重试而非立即失败
- OpenAI 调用失败时，系统可降级运行（非核心功能不阻塞主流程）
- system_timeout 可配置化，允许按角色调整超时值

## 非目标

- 不引入复杂的熔断器/断路器模式
- 不改变 OpenAI API 调用方式（继续使用 fetch，不引入 SDK）
- 不改变 Claude Code CLI 的进程管理架构

## 设计

### 1. OpenAI 重试机制

给 `OpenAIClient` 增加简单指数退避重试：
- 最多 3 次重试
- 退避间隔：1s / 2s / 4s
- 仅在 5xx 和 429 状态码时重试
- 超时错误（AbortError）也重试

### 2. OpenAI 调用容错

- `refreshConversationSummary()` 用 try-catch 包裹：summary 生成失败只 log warning，不抛异常
- `resolveMentions()` 中 LLM fallback 用 try-catch 包裹：失败时回退到结构化 mention（已有路径）

### 3. system_timeout 可配置化

- 在 `SnailTemplate` 和 `SnailRuntimeInstance` 接口中增加可选的 `invocationTimeoutMs` 字段；`AgentInvocationOptions` 同步新增透传字段
- 各 agent（ClaudeCodeStateful、ClaudeCode、Codex、StatefulCLIAgent）从 `options.invocationTimeoutMs ?? config.timeoutMs ?? 30 * 60 * 1000` 读取超时值，未配置时使用默认 30min
- 保持已有的 3 阶段停止协议不变

## 生效路径

- 代码：`src/llm/openai.ts`、`src/project-workflow/manager.ts`、`src/message-bus/collaboration.ts`
- 配置：`SnailTemplate` 中新增 `invocationTimeoutMs` 可选字段，由 `resolveTimeoutForRole` 从 template 读取并传入 `AgentInvocationOptions`
- 已有错误分类 `src/shared/runtime-error.ts` 中 503 识别逻辑保持不变

## 改动范围

- `src/llm/openai.ts` — 新增 `maxRetries` 选项、`executeWithRetry` 方法及 `isRetryableError`/`sleep` 辅助函数
- `src/project-workflow/manager.ts` — `resolveMentions()` LLM fallback 加 try-catch；新增 `resolveTimeoutForRole`
- `src/message-bus/collaboration.ts` — 新增 `resolveTimeoutForRole` 到 `CollaborationDeps`；summary 调用改用 `refreshConversationSummarySafely`
- `src/agent/interface.ts` — `AgentInvocationOptions` 新增 `invocationTimeoutMs` 可选字段
- `src/snail-den/index.ts` — `SnailTemplate` 和 `SnailRuntimeInstance` 新增 `invocationTimeoutMs` 可选字段
- `src/agent/stateful-cli-agent.ts` — `executeCLI()` 调用 `manageInvocationProcess` 时使用 `options.invocationTimeoutMs ?? config.timeoutMs ?? 30 * 60 * 1000`
- `src/agent/claude-code-stateful.ts` — 使用 `options.invocationTimeoutMs ?? 30 * 60 * 1000`
- `src/agent/claude-code.ts` — 同上
- `src/agent/codex.ts` — 同上

## 验证

- TypeScript 编译通过（tsc --noEmit）
- 所有现有测试通过：claude-code-stateful、claude-code、managed-process、collaboration、runtime-error、mention-extractor、message-interrupt、codex parser/buildargs、message-out、stage-cycle、startup-recovery
- ESLint 已变更文件无新增问题
- `classifyRuntimeError` 已有 503 检测逻辑，重试后仍可正确分类错误

## 风险与决策记录

- 重试会增加 OpenAI API 调用量，最多 4 次（1 次原始 + 3 次重试）/请求
- summary 降级后，conversation 列表会缺少摘要文本 → 属于可接受降级
- 403/401 等认证错误不重试，只重试临时性故障

### OpenAI Client 调用场景分析（2026-05-20）

OpenAI client 在系统中承担三项辅助任务，均与 stateful CLI agent 的主对话路径独立：

| 调用点 | 触发频率 | Stateful agent 下的必要性 | 容错状态 |
|---|---|---|---|
| Mention 提取（LLM fallback） | 用户消息含 `@` 且无结构化 mention 时 | 必要，是结构化 mention 的兜底 | 本次加 try-catch |
| Conversation Summary | **每次消息**结束都调用 | resume 时 agent 不用，但 UI 列表和未来切 snail 场景需要实时摘要。调用成本极低（~4000 input + ~300 output tokens，约 $0.001/次） | 本次改 `refreshConversationSummarySafely` |
| Message Context Summary | 仅当消息无最终文本输出且 event summary >12,000 字符时 | 正常 agent 回复有 final text，直接短路返回，极少触发。触发时本就有 try-catch→截断 fallback | 已有容错，本次未改动 |

**决策：保留每次消息的 Conversation Summary 刷新。** 理由：
1. 成本可忽略（gpt-4.1-mini 单次约 $0.001）
2. 后续支持对话中途切换 snail 时，新 snail 需要实时 summary 快速理解上下文
3. 已有容错保护，失败不阻塞主流程

## 范围变更记录

- `src/agent/stateful-cli-agent.ts` 在检视阶段追加，覆盖 OpenCode/Gemini 继承路径的超时配置接入。
- `createChatCompletion()` 返回值处理逻辑在检视阶段修正：由 `throw lastError` 改为直接 `return await this.executeWithRetry(...)`。
