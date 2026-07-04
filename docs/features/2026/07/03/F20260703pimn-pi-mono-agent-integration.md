---
id: F20260703pimn
title: pi-mono-agent-integration
from_ids: []
tags: [infra, acs, agent, pi-mono]
modules: [infra]
doc_kind: spec
change_type: feature
---

# F20260703pimn [infra] Pi Mono Agent 集成

## 用户意图锚

| # | 用户原话 | 来源 | 关键修饰语 | 架构师解读 |
|---|---------|------|-----------|-----------|
| UA-1 | 集成pi mono这个agent进来 | 消息 1 | 空间：无；时序：无；数量：单个 agent；条件：无；视觉属性：无 | 将 pi-mono（`pi` CLI）作为新的 agent runtime 集成到 ACS 层，遵循现有适配器模式，使其可作为 snail 配置使用 |

> 备注：此需求为纯功能集成，无额外修饰语。用户指令明确——"集成进来"= 纳入系统。

## 背景

### Pi Mono 是什么

[Pi Mono](https://github.com/earendil-works/pi) 是由 Mario Zechner（badlogic）和 Armin Ronacher（mitsuhiko）维护的开源 AI 编程 agent CLI。npm 包 `@earendil-works/pi-coding-agent`，CLI 命令 `pi`。支持多 provider（Anthropic、OpenAI、Google 等）、会话管理、技能系统、扩展系统。

### 现有适配器模式

Snail Shell 的 ACS 层通过 `AgentRuntimePort` 接口抽象 agent 运行时。每个 agent（Claude Code、Codex、OpenCode）有一个适配器文件，实现该接口。initor 自动扫描 `agents/` 目录注册适配器。Snail 配置（`snails.json`）通过 `agent_name` 字段关联到注册的适配器。

### Pi Mono 与现有 agent 的关键差异

| 维度 | Claude Code | OpenCode | Pi Mono |
|------|------------|----------|---------|
| CLI 命令 | `claude` | `opencode` | `pi` |
| 非交互输出 | `--output-format stream-json` | `--format json` | `--mode json` |
| Session resume | `--resume <id>` | `--session <id>` | `--session <id>` |
| 系统提示词注入 | `--append-system-prompt-file` | prompt 文本直接传入 | `--append-system-prompt` |
| 消息传递 | stdin JSON stream | CLI 参数 | CLI 参数 |
| MCP 支持 | `.claude/mcp.json` | `opencode.json` | **不支持** |
| 权限控制 | `--disallowedTools` | `opencode.json` permission | `--exclude-tools` / `--tools` |
| Skills 发现 | `.claude/skills/` | `.claude/skills/` + `.agents/skills/` | `.pi/skills/` + `.agents/skills/` + `~/.pi/agent/skills/` |
| 输出格式 | NDJSON (assistant/result events) | NDJSON (text/tool_use/step_finish events) | NDJSON (session/agent_start/agent_end/turn_*/message_*/tool_execution_* events) |

## 目标

- 创建 `PiMonoAgent` 适配器，实现 `AgentRuntimePort` 接口
- 支持 stateful 模式：首次调用注入配置 + 会话创建，后续调用 `--session <id>` resume
- 支持技能注入（通过 `.agents/skills/` 符号链接，pi 原生扫描）
- 支持系统提示词注入（通过 `--append-system-prompt`）
- 支持上下文环境变量注入（`SNAIL_CTX_*`）
- 正确解析 pi 的 NDJSON 输出为 ACS `AgentEvent`

## 非目标

- **不实现 MCP 支持**：Pi Mono 明确不支持 MCP（设计决策，非缺陷）。MCP 服务器配置在 pi-mono 适配器中被跳过。需要 MCP 工具的 snail 角色不应配置为 pi-mono agent。
- **不实现权限系统桥接**：Pi Mono 无内置权限系统，通过 `--exclude-tools` 做粗粒度工具排除即可。
- **不实现 RPC 模式**：使用 `--mode json` 输出模式，RPC 模式是未来的扩展方向。

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 | 追溯 |
|---|------|----------|----------|------|
| B1 | When 首次调用 pi-mono agent | 注入 skills 符号链接到 `.agents/skills/`，通过 `--append-system-prompt` 注入系统提示词，通过 `--mode json` 启动 NDJSON 输出，通过 CLI 参数传递 prompt，spawn `pi` 进程 | 单元测试 | ← UA-1 |
| B2 | When pi-mono 进程输出 `session` 事件 | 提取 session ID，记录到 InvokeResult.sessionId | 单元测试 | ← UA-1 |
| B3 | When pi-mono 进程输出 `message_end` 事件且包含 text 内容 | 发出 ACS `text` 事件 | 单元测试 | ← UA-1 |
| B4 | When pi-mono 进程输出 `tool_execution_start` 事件 | 发出 ACS `tool_call` 事件 | 单元测试 | ← UA-1 |
| B5 | When pi-mono 进程输出 `tool_execution_end` 事件 | 发出 ACS `tool_result` 事件 | 单元测试 | ← UA-1 |
| B6 | When pi-mono 进程输出 `turn_start` 事件 | 发出 ACS `signal` 事件 (turn_started) | 单元测试 | ← UA-1 |
| B7 | When pi-mono 进程输出 `turn_end` 事件 | 发出 ACS `signal` 事件 (turn_completed) | 单元测试 | ← UA-1 |
| B8 | When pi-mono 进程输出 `agent_end` 事件 | 发出 ACS `signal` 事件 (message_completed)；如事件携带 usage/token 数据，发射 `runtime_usage` signal | 单元测试 | ← UA-1 |
| B9 | When pi-mono 进程输出 `error` 类型事件 | 发出 ACS `error` 事件，记录错误信息 | 单元测试 | ← UA-1 |
| B10 | When 后续调用（resume） | 使用 `--session <sessionId>` 参数恢复会话，仅传入增量消息和 system-reminder | 单元测试 | ← UA-1 |
| B11 | When guard_profile.deny 非空 | 将 deny 列表翻译为 pi 的 `--exclude-tools` 参数 | 单元测试 | ← UA-1 |
| B12 | When 进程退出码非 0 或无输出事件 | 抛出错误，包含 stderr 和原始输出摘要 | 单元测试 | ← UA-1 |
| B13 | When snails.json 配置了 agent_name 为 "pi-mono" 的 snail | ACS registry 能找到 PiMonoAgent 适配器并实例化 | 集成测试 | ← UA-1 |
| B14 | When pi-mono 进程输出 `agent_start` 事件 | 发出 ACS `signal` 事件 (start) | 单元测试 | ← UA-1 |
| B15 | When pi-mono 进程输出 `message_end` 事件且不含 text 内容（仅 tool_use） | No-op，不发射事件（text 提取仅在 content 含 `type: "text"` 时触发） | 单元测试 | ← UA-1 |
| B16 | When pi-mono 进程输出 `turn_end` 或 `agent_end` 事件携带 usage/token 数据 | 新增 `usageDetailFromPiMono()` 函数提取 token 数据，发射 `runtime_usage` signal 事件 | 单元测试 | ← UA-1 |
| B17 | When pi-mono 进程输出 `message_update` 事件 | 忽略（所有 `message_update` 增量事件均跳过，文本内容从 `message_end` 完整提取） | 单元测试 | ← UA-1 |
| B18 | When pi-mono 进程输出 `message_start` 事件 | 忽略（无 ACS 对应事件） | 单元测试 | ← UA-1 |

## 设计

### 1. 适配器文件结构

新建文件：`src/infra/acs/_internal/agents/pi-mono.ts`

```
PiMonoAgent (implements AgentRuntimePort)
├── name = "pi-mono"
├── invokeFirstCall(request, onEvent, options)
│   ├── ensureSkillSymlinks() — 复用现有工具函数
│   ├── 构建 CLI args:
│   │   ├── --mode json
│   │   ├── --model <model>
│   │   ├── --append-system-prompt <systemPrompt>
│   │   ├── --exclude-tools <translated deny list>
│   │   ├── --approve (信任项目本地文件)
│   │   └── <rendered prompt text>
│   ├── spawn("pi", args, { cwd, env, stdio })
│   └── processOutput() — 解析 NDJSON
├── invokeResume(request, onEvent, options)
│   ├── 构建 CLI args:
│   │   ├── --mode json
│   │   ├── --model <model>
│   │   ├── --session <sessionId>
│   │   ├── --approve
│   │   └── <rendered prompt text>
│   ├── spawn("pi", args, { cwd, env, stdio })
│   └── processOutput()
└── export const agent = new PiMonoAgent()
```

### 2. CLI 参数构建

**首次调用**：
```bash
pi --mode json \
   --model <model> \
   --append-system-prompt "<systemPrompt>" \
   --exclude-tools <denyList> \
   --approve \
   "<rendered prompt>"
```

**Resume 调用**：
```bash
pi --mode json \
   --model <model> \
   --session <sessionId> \
   --approve \
   "<rendered prompt>"
```

**`--approve` 参数**：pi 在非交互模式下默认使用 `defaultProjectTrust` 设置（默认 `"ask"`）。`--approve` 确保项目本地文件（skills、extensions）被信任加载，无需交互确认。

### 3. Prompt 渲染

复用现有 `renderStatefulPrompt` 工具函数。pi 的 prompt 通过 CLI 参数传递（与 OpenCode 相同模式），不通过 stdin。

- 首次调用：渲染 systemPrompt + systemReminder + bootstrapMessages
- Resume 调用：渲染 systemReminder + incrementalMessages

### 4. 输出解析

Pi `--mode json` 输出 NDJSON，每行一个 JSON 事件。事件类型映射：

| Pi 事件类型 | ACS 事件 | 说明 |
|------------|----------|------|
| `session` | (内部) 提取 sessionId | 首行，包含 `id` 字段 |
| `agent_start` | `signal(start)` | agent 开始处理 |
| `agent_end` | `signal(message_completed)` + 可能含 `runtime_usage` | agent 完成，可能携带 usage/token 数据 |
| `turn_start` | `signal(turn_started)` | 新轮次开始 |
| `turn_end` | `signal(turn_completed)` + 可能含 `runtime_usage` | 轮次完成，可能携带 usage/token 数据 |
| `message_start` | (忽略) | 无 ACS 对应事件 |
| `message_end` (含 text) | `text` | 从 message 对象提取文本内容 |
| `message_end` (不含 text) | (no-op) | 仅含 tool_use 时跳过 |
| `message_update` | (忽略) | 所有增量事件均跳过，文本从 message_end 完整提取 |
| `tool_execution_start` | `tool_call` | 提取 tool name、id、input |
| `tool_execution_end` | `tool_result` | 提取 tool result、is_error |
| `message_update` (含 error) | `error` | 错误事件 |
| `error` (顶层) | `error` | 运行时错误 |

**文本内容提取**：pi 的 `message_end` 事件包含完整的 message 对象，其中 `content` 数组中 `type: "text"` 的项即为文本输出。`message_update` 事件包含流式增量（`text_delta`），但在 `--mode json` 非交互模式下，我们使用 `message_end` 的完整内容，不需要拼接增量。

**工具调用提取**：`tool_execution_start` 事件包含 `tool` 字段（工具名）和 `input` 字段（输入参数）。`tool_execution_end` 事件包含 `output` 字段和 `error` 字段。

**Session ID 提取**：`session` 事件的 `id` 字段即为 session ID，用于后续 resume。

### 5. Guard Profile 翻译

Pi 支持 `--exclude-tools`（工具黑名单）和 `--tools`（工具白名单）。ACS GuardProfile 的 `deny` 列表使用 Claude Code 风格的工具名（如 `Bash(rm:*)`、`AskUserQuestion`），需要翻译为 pi 的工具名。

Pi 的内置工具：`read`、`bash`、`edit`、`write`、`grep`、`find`、`ls`。

翻译规则：
- `Bash(...)` → `bash`（pi 不支持命令级别的细粒度控制，只能整体排除）
- `Read` → `read`
- `Write` → `write`
- `Edit` → `edit`
- 其他工具名保持原样（pi 的扩展工具名由 extension 注册）
- `AskUserQuestion`、`EnterPlanMode`、`ExitPlanMode` 等 Claude Code 特有工具 → 跳过（pi 无对应概念）

### 6. MCP 处理

**跳过 MCP 注入**。`ensureMcpServers()` 不对 pi-mono 调用。适配器在 `invokeFirstCall` 中仅调用 `ensureSkillSymlinks()`，不调用 `ensureMcpServers()`。

**影响**：pi-mono snail 无法使用 snail MCP 工具（如 `set_final_body`、`get_current_message_id`、`get_context`、`set_context` 等）。这意味着 pi-mono snail 不能作为需要 MCP 工具的角色（如架构师、开发者、审查者）参与 staged 协作流程。

**适用场景**：
- 独立任务执行（不依赖 MCP 工具的工作流）
- 代码生成、文件操作、命令执行
- 作为知识问答或通用 assistant 使用

### 7. 环境变量处理

与 OpenCode 适配器一致：
- 继承 `process.env`
- 注入 `options.contextEnv`（包含 `SNAIL_CTX_*` 变量）
- 清理 pi 自身的环境变量（`PI_CODING_AGENT_DIR`、`PI_CODING_AGENT_SESSION_DIR`、`PI_OFFLINE` 等），避免全局配置污染 worktree 级别的调用

### 8. Snail 配置

在 `data/file/snails.json.example` 中添加示例配置：

```json
{
  "id": "pi-mono",
  "name": "Pi Mono",
  "agent_name": "pi-mono",
  "model": "anthropic/claude-sonnet-4-20250514",
  "context_window": 200000,
  "invocation_timeout_ms": 1800000
}
```

`model` 使用 pi 的 `provider/model` 格式（如 `anthropic/claude-sonnet-4-20250514`）。用户可按需配置为任意 provider/model 组合。

### 9. 错误处理

与 OpenCode 适配器一致：
- 进程退出码非 0 → 抛出错误（含 stderr 和 rawOutput 摘要）
- 运行时错误事件 → 记录到 errors 数组，进程结束后抛出
- 无输出事件 → 抛出错误（含诊断信息）
- stdout 解析失败 → 记录 warn 日志，跳过该行

### 10. 进程生命周期管理

使用 `manageInvocationProcess()`（复用现有工具函数 `@infra/acs/_internal/utils/managed-process`），覆盖：
- **AbortSignal 中断**：options.signal 触发时，SIGINT → SIGTERM → SIGKILL 优雅停止协议
- **调用超时**：options.invocationTimeoutMs（默认 30 分钟），超时后执行停止协议
- **进程清理**：进程退出后 cleanup，返回 waitForStop() 供编排层等待子进程完全停止

与 OpenCode 适配器的 `processOutput` 方法中 `manageInvocationProcess` 调用方式完全一致。

### 11. Runtime Usage 追踪

新增 `usageDetailFromPiMono()` 函数到 `src/infra/acs/_internal/utils/runtime-usage.ts`，从 pi 的 `turn_end` 或 `agent_end` 事件中提取 token 数据。

Pi 的 usage 数据可能出现在事件的 `usage` 或 `tokens` 字段中（具体字段名需在开发阶段通过实际 `pi --mode json` 输出验证）。提取逻辑参考 `usageDetailFromOpenCodeTokens()`：
- input_tokens / output_tokens / total_tokens 从事件 usage 对象提取
- context_window 优先从 runtime 数据提取，兜底使用 options.contextWindow
- 如事件不含 usage 数据，不发射 `runtime_usage` signal（静默跳过）

**约束**：实际 usage 字段结构需在开发阶段验证。适配器应使用宽松解析，字段缺失时不崩溃、不发射 usage 事件。

## 验收标准

| # | 标准 | 验证方式 |
|---|------|----------|
| AC-1 | `src/infra/acs/_internal/agents/pi-mono.ts` 文件存在且导出 `PiMonoAgent` 类和 `agent` 单例 | 文件检查 |
| AC-2 | `PiMonoAgent.name` 等于 `"pi-mono"` | 单元测试 |
| AC-3 | ACS initor 启动后 `listAgentRuntimes()` 包含 `"pi-mono"` | 集成测试 |
| AC-4 | `invokeFirstCall` 正确构建 CLI args（`--mode json`、`--model`、`--append-system-prompt`、`--approve`） | 单元测试 |
| AC-5 | `invokeResume` 正确构建 CLI args（`--session <id>`） | 单元测试 |
| AC-6 | NDJSON 输出正确解析为 ACS 事件（覆盖所有事件类型映射） | 单元测试 |
| AC-7 | session ID 从 `session` 事件中提取 | 单元测试 |
| AC-8 | guard_profile.deny 正确翻译为 `--exclude-tools` 参数 | 单元测试 |
| AC-9 | `data/file/snails.json.example` 包含 pi-mono 配置示例 | 文件检查 |
| AC-10 | `--mode json` 输出模式使用，非 `--print` 或交互模式 | 代码审查 |

## 实现指引

### 输出解析器参考

pi 的 NDJSON 输出格式参考 pi-mono 仓库 `packages/coding-agent/docs/json.md`。关键事件结构：

```typescript
// session 事件（首行）
{ type: "session", version: 3, id: "<uuid>", timestamp: "...", cwd: "..." }

// message_end 事件（含完整消息）
{ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "..." }] } }

// tool_execution_start 事件
{ type: "tool_execution_start", tool: "bash", input: { command: "ls -la" }, id: "<call_id>" }

// tool_execution_end 事件
{ type: "tool_execution_end", tool: "bash", output: "...", error: null, id: "<call_id>" }

// turn_start / turn_end 事件
{ type: "turn_start" }
{ type: "turn_end" }

// agent_start / agent_end 事件
{ type: "agent_start" }
{ type: "agent_end" }
```

**约束**：实际事件结构可能因 pi 版本而异。开发者在实现时应以实际 `pi --mode json` 输出为准，通过手动运行 pi 命令验证事件格式。适配器应使用宽松解析（optional chaining + 类型断言），避免因字段缺失而崩溃。

### Guard Profile 翻译参考

参考 OpenCode 适配器的 `translateOpenCodePermission` 函数实现类似的 `translatePiMonoTools` 函数。关键差异：pi 的工具控制是 CLI 参数级别（`--exclude-tools tool1,tool2`），不是配置文件级别。

### Prompt 传递策略

Prompt 通过 CLI 参数传递（与 OpenCode 一致）。Snail 系统提示词通常数千字，加上 systemReminder 和消息历史，总长度可达数十 KB。

**风险评估**：操作系统 CLI 参数长度限制通常为 128KB-2MB（macOS `ARG_MAX` 约 256KB）。snail 系统提示词 + 消息历史在极端情况下（大量 bootstrap 消息）可能接近此限制。

**实现策略**：
1. 默认使用 CLI 参数传递（简单，与 OpenCode 一致）
2. 如渲染后 prompt 文本超过 64KB（安全阈值），改用 stdin 管道传递（`echo "<prompt>" | pi --mode json ...` 或通过 proc.stdin.write + end）
3. 64KB 阈值的选择依据：为 CLI 其他参数（`--mode json`、`--model`、`--append-system-prompt` 等）和 OS 开销预留空间

### Session Resume 行为验证

**需在开发阶段验证**：pi `--session <id>` resume 是否保留首次调用的 `--append-system-prompt` 内容。这与 ClaudeCode `--resume` 和 OpenCode `--session` 行为一致（session 内部保存系统提示词），但 pi 的实现需实际验证。

**验证方法**：
1. 运行 `pi --mode json --append-system-prompt "TEST_MARKER_XYZ" "hello"`
2. 记录返回的 session ID
3. 运行 `pi --mode json --session <sessionId> "what was your system prompt?"`
4. 检查输出是否包含 "TEST_MARKER_XYZ"
5. 如不保留 → resume 调用也需要传 `--append-system-prompt`（将 systemPrompt 从首次调用传入）

### Context Files 防御

Pi 会自动加载 `AGENTS.md` 和 `CLAUDE.md`（从 cwd 和父目录）。当前 worktree 中不存在这些文件，不影响行为。

**风险**：如未来 worktree 中出现 `AGENTS.md`（例如通过 skill 注入或其他流程创建），pi 会自动加载并与注入的系统提示词冲突。

**建议**：在开发阶段评估是否添加 `--no-context-files`（`-nc`）作为防御措施。如添加，需验证 pi 在 `-nc` 模式下是否仍正常加载 `.agents/skills/` 下的 skill 文件（skills 和 context files 是独立的发现机制，应互不影响）。

### 测试策略

- 单元测试覆盖 NDJSON 解析器的所有事件类型
- 单元测试覆盖 CLI args 构建（first call 和 resume）
- 单元测试覆盖 guard profile 翻译
- 单元测试覆盖 runtime usage 提取（含"无 usage 数据"的 fallback）
- Mock spawn 进程，验证 processOutput 的事件发射
- 不需要端到端测试（需要实际安装 pi CLI）

## [design-time]

- 状态：已锁定（架构师-1 与 架构师-2 对抗共识，F1-F10 全部修复并验证）
- 设计取舍：
  - **MCP 不支持**：Pi Mono 设计上排除了 MCP。选择跳过 MCP 注入而非实现 MCP 桥接，因为桥接需要开发 pi extension，超出本次集成范围。如未来需要 MCP 支持，应创建独立 feature 文档。
  - **使用 `--mode json` 而非 RPC 模式**：JSON 模式输出更简单（NDJSON 单向流），与现有 OpenCode 适配器模式一致。RPC 模式提供双向通信但增加复杂度，当前无需求驱动。
  - **Prompt 通过 CLI 参数传递**：与 OpenCode 一致。默认 CLI 参数传递，超过 64KB 改用 stdin 管道（见实现指引）。
  - **不使用 `--no-context-files`**：当前 worktree 无 `AGENTS.md`/`CLAUDE.md`，不影响行为。开发阶段评估是否添加 `-nc` 作为防御措施（见实现指引）。
- 审视修复记录（架构师-2 对抗审视）：
  - F1 ✅ 新增 §11 Runtime Usage 追踪 + B16 行为条目
  - F2 ✅ 新增 B14 agent_start 行为条目
  - F3 ✅ 新增 B15 message_end 不含 text 的 no-op 行为
  - F4 ✅ 新增 §10 进程生命周期管理
  - F5 ✅ 统一为 snails.json.example
  - F6 ✅ 新增 B17 message_update 忽略行为 + 事件映射表标注
  - F7 ✅ 新增实现指引 Prompt 传递策略（64KB 阈值 + stdin fallback）
  - F8 ✅ 新增实现指引 Session Resume 行为验证
  - F9 ✅ 新增 B18 message_start 忽略 + 事件映射表标注
  - F10 ✅ 新增实现指引 Context Files 防御
