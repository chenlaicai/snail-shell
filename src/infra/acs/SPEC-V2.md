# ACS v2 — Agent Interaction Spec

> ACS v2 是 Snail Shell 与底层 agent 运行时之间的交互协议规范。
> 基于 v1 遗留分析和 v2 设计讨论，从 agent 视角重新定义完整的交互协议。

---

## 设计原则

1. **Agent 视角**：协议定义 agent 看到什么，不暴露编排层内部概念（role、conversation、workspace、stage）
2. **接口驱动**：协议最终落实为方法契约（方法 + 入参 + 出参），不只是类型定义
3. **完整性**：覆盖首次调用 + 后续 resume + 流式响应的全生命周期
4. **可扩展**：先做少，后面可以扩；现在做多了后面不方便减
5. **非交互式**：所有 agent 均为非交互式调用，权限审批由编排层在调用外部处理

---

## 协议总览

```
AgentRuntimePort.invoke(request, onEvent, options) → InvokeResult
         │
         ├── request: AgentRequest = FirstCallRequest | ResumeRequest
         │     ├── FirstCallRequest
         │     │     ├── prompt: PromptSpec           # 系统提示词
         │     │     ├── capabilities: CapabilitiesSpec # 可用工具
         │     │     ├── security: SecuritySpec        # 权限边界
         │     │     ├── messages: Message[]           # 全量对话历史
         │     │     └── workspaceRoot: string
         │     └── ResumeRequest
         │           ├── sessionId: string             # 首次调用返回的
         │           ├── systemReminder: string        # 动态上下文（仅变化时）
         │           ├── messages: Message[]           # 增量消息
         │           └── workspaceRoot: string
         │
         ├── onEvent: (event: AgentEvent) → 流式回调
         │     └── AgentEvent.message_event: MessageEvent
         │           ├── text            # 文本输出
         │           ├── tool_call       # 工具调用
         │           ├── tool_result     # 工具结果
         │           ├── signal          # 生命周期信号
         │           ├── error           # 错误
         │           └── message_failure # 消息失败
         │
         └── returns: InvokeResult
               ├── sessionId?: string              # 供后续 ResumeRequest
               └── waitForStop?: () => Promise<void>
```

---

## 接口契约

### AgentRuntimePort — Agent Runtime 端口

Snail Shell 调用 agent 的唯一入口。每个 agent runtime（Claude Code、Codex、OpenCode）实现此接口。

```typescript
interface AgentRuntimePort {
  readonly name: string;
  readonly runtime: string;

  /**
   * 调用 agent 处理一条消息。
   *
   * 首次调用：传入 FirstCallRequest（prompt + capabilities + security + 全量消息）。
   * 后续调用：传入 ResumeRequest（sessionId + 增量消息）。
   *
   * 流式事件通过 onEvent 回调实时传递。
   * 返回 InvokeResult（含 sessionId，供后续 ResumeRequest 使用）。
   */
  invoke(
    request: AgentRequest,
    onEvent: (event: AgentEvent) => void,
    options?: InvokeOptions,
  ): Promise<InvokeResult>;
}
```

---

## 数据模型

### AgentRequest — 请求

首次调用或 resume 调用的完整上下文。

```typescript
type AgentRequest = FirstCallRequest | ResumeRequest;
```

### FirstCallRequest — 首次调用

agent 首次被调用时，需要知道全部信息：系统规则、可用工具、权限边界、对话历史。

```typescript
interface FirstCallRequest {
  kind: "first_call";
  /** 系统提示词 */
  prompt: PromptSpec;
  /** 可用工具 */
  capabilities: CapabilitiesSpec;
  /** 安全策略 */
  security: SecuritySpec;
  /** 对话历史（全量） */
  messages: Message[];
  /** 当前工作目录 */
  workspaceRoot: string;
}
```

### ResumeRequest — 后续调用

agent 已有 session 上下文，只需传入新消息和可能更新的 system-reminder。

```typescript
interface ResumeRequest {
  kind: "resume";
  /** session ID（首次调用返回的） */
  sessionId: string;
  /** 动态上下文（仅变化时传入，空字符串表示不更新） */
  systemReminder: string;
  /** 增量消息（首次调用后的新消息） */
  messages: Message[];
  /** 当前工作目录 */
  workspaceRoot: string;
}
```

### PromptSpec — 系统提示词

agent 消费的全部文本内容。首次调用时通过 agent 原生方式注入，后续调用仅 systemReminder 可能更新。

```typescript
interface PromptSpec {
  /**
   * 静态系统提示词：constitution、角色手册、skill 引用。
   * 整场对话不变，可被 LLM API 缓存。
   */
  systemPrompt: string;

  /**
   * 动态运行时上下文：workspace/stage 状态、日期、剩余轮次等。
   * 仅在内容变化时注入当前消息（通过 <system-reminder> 标签）。
   */
  systemReminder: string;

  /**
   * 调用上下文：conversation_id、message_id 等标识。
   * Append 到 system prompt 尾部（通过 <mcp_context> 标签）。
   */
  mcpContext: string;
}
```

### CapabilitiesSpec — 可用能力

agent 可使用的工具和资源。首次调用时注入（符号链接 / 配置文件），后续调用不重复注入。当前仅包含已实现的能力。

```typescript
interface CapabilitiesSpec {
  /** Skill 列表：agent 可调用的结构化能力包 */
  skills: SkillCapability[];
  /** MCP 服务器列表：agent 可连接的外部工具服务 */
  mcpServers: MCPServerCapability[];
}
```

**SkillCapability**：

```typescript
/**
 * Skill 能力声明。
 *
 * 注入策略（已实现）：
 *  - Claude Code → 符号链接暴露为 .claude/skills/，CLI 原生扫描
 *  - Codex → 符号链接暴露为 .agents/skills/，CLI 原生扫描
 *  - OpenCode → 同时扫描 .claude/skills/ 和 .agents/skills/
 */
interface SkillCapability {
  name: string;
  description: string;
  filePath: string;
  directory: string;
  content: string;
  source: "platform" | "workspace";
}
```

**MCPServerCapability**：

```typescript
/**
 * MCP 服务器声明。
 *
 * 支持两种 transport：
 * - stdio: command + args + env（独立进程，JSON-RPC over stdin/stdout）
 * - HTTP: url（挂载到现有 HTTP server，JSON-RPC over HTTP POST）
 *
 * 注入策略（已实现）：
 *  - Claude Code → <wsRoot>/.claude/mcp.json
 *  - OpenCode → <wsRoot>/opencode.json
 *  - Codex → <wsRoot>/.codex/config.toml
 */
interface MCPServerCapability {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}
```

### SecuritySpec — 安全策略

agent 的工具使用权限边界。扁平 allow/deny 模型，deny 优先于 allow。首次调用时注入，后续不重复注入。

```typescript
interface SecuritySpec {
  /** 工具/命令黑名单。匹配的工具被拒绝，优先于 allow。 */
  deny: string[];
  /** 工具/命令白名单。匹配的工具绕过审批。 */
  allow: string[];
}
```

### Message — 对话消息

agent 看到的单条消息。消息格式由 adapter 层根据调用模型渲染（stateless → JSON envelope，stateful → markdown）。

```typescript
interface Message {
  /** 消息角色 */
  role: "user" | "assistant";
  /** 消息内容（文本，可能包含结构化标签） */
  content: string;
  /** 消息来源角色名（多角色对话时，用于区分谁说的） */
  speaker?: string;
}
```

### InvokeResult — 调用结果

agent 调用完成后的返回值。

```typescript
interface InvokeResult {
  /** session ID（stateful 模型返回，供后续 ResumeRequest 使用） */
  sessionId?: string | null;
  /** 等待 agent 子进程完全停止（shutdown 时确保所有子进程退出） */
  waitForStop?: () => Promise<void>;
}
```

### AgentEvent — 流式事件

agent 在执行过程中产出的事件，通过 onEvent 回调实时传递给编排层。

```typescript
interface AgentEvent {
  type: "message_event";
  event: MessageEvent;
}
```

### MessageEvent — 消息事件

agent 产出的核心事件类型。每个 runtime 的原生输出格式不同，adapter 按规则映射。

```typescript
type MessageEvent =
  /** 文本输出：agent 的自然语言回复 */
  | { kind: "text"; payload: { text: string; mentions: string[] }; source: EventSource }
  /** 工具调用：agent 调用工具的请求 */
  | { kind: "tool_call"; payload: { tool_name: string; call_id: string; input: unknown; title: string | null }; source: EventSource }
  /** 工具结果：工具执行结果（由 runtime 生成） */
  | { kind: "tool_result"; payload: { call_id: string; output: string; is_error: boolean }; source: EventSource }
  /** 生命周期信号：runtime 生成的会话生命周期事件 */
  | { kind: "signal"; payload: { signal_type: LifecycleSignal; data: unknown }; source: EventSource }
  /** 错误事件 */
  | { kind: "error"; payload: { message: string }; source: EventSource }
  /** 消息失败：agent 调用失败 */
  | { kind: "message_failure"; payload: { error: string }; source: EventSource };
```

**事件映射规则**：

| Runtime | 原生输出 | 映射到 |
|---------|---------|--------|
| Claude Code | `assistant.content[].type="text"` | `text` |
| Claude Code | `assistant.content[].type="tool_use"` | `tool_call` |
| Claude Code | `result` envelope | `signal` (runtime_usage + message_completed) |
| Codex | `turn.completed.message.content[]` | `text` |
| Codex | `turn.failed` | `error` + `signal` (message_failed) |
| OpenCode | `part.type="text"` | `text` |
| OpenCode | `part.type="tool_use"` | `tool_call` |
| OpenCode | `step_finish` | `signal` (runtime_usage + step_finish) |

### EventSource — 事件来源

```typescript
interface EventSource {
  runtime_event_type: string;
  runtime_message_id: string | null;
  runtime_call_id?: string | null;
}
```

### LifecycleSignal — 生命周期信号

runtime 在会话各阶段产出的信号。

```typescript
type LifecycleSignal =
  | "start"                    // 会话/角色初始化完成
  | "step_start"               // agent 内部执行步骤开始
  | "step_finish"              // agent 内部执行步骤结束
  | "turn_started"             // 对话轮次开始
  | "turn_completed"           // 对话轮次结束
  | "runtime_usage"            // token 使用量统计
  | "message_completed"        // 消息完成
  | "message_failed"           // 消息失败
  | "message_interrupted"      // 消息中断
  | "message_cancelled"        // 消息取消
  | "message_pending_approval"; // 消息等待权限审批
```

### InvokeOptions — 调用选项

编排层传给 agent runtime 的调用参数。不是 agent 能力声明，而是编排层对 runtime 的调用控制。

```typescript
interface InvokeOptions {
  /** 中断信号 */
  signal?: AbortSignal;
  /** 模型标识（由 Snail Den template 指定） */
  model?: string;
  /** 上下文窗口大小（用于 runtime 未返回时的兜底） */
  contextWindow?: number;
  /** 调用超时（毫秒，默认 30 分钟） */
  invocationTimeoutMs?: number;
}
```

---

## 首次 vs 后续调用差异

| 内容 | 首次 (FirstCallRequest) | 后续 (ResumeRequest) |
|------|------------------------|---------------------|
| prompt.systemPrompt | ✅ 注入 | ❌ 不注入 |
| prompt.systemReminder | ✅ 注入 | ✅ 仅变化时注入 |
| prompt.mcpContext | ✅ 注入 | ✅ 注入（新 message_id） |
| capabilities | ✅ 注入（符号链接/配置文件） | ❌ 不重复注入 |
| security | ✅ 注入（agent 原生配置） | ❌ 不重复注入 |
| messages | ✅ 全量历史 | ✅ 仅增量消息 |
| sessionId | ❌ 无 | ✅ 用于 resume |
| InvokeResult.sessionId | ✅ 返回 | ✅ 返回 |

---

## 各 Agent 适配器请求映射

### Claude Code (stateless)

每次调用都是 FirstCallRequest（全量重建）：
- `prompt.systemPrompt` → `--append-system-prompt-file <tempFile>`
- `prompt.mcpContext` → append 到 systemPrompt
- `security.deny` → `--disallowedTools <patterns>`
- `messages` → stdin JSON envelope
- 无 sessionId

### Claude Code (stateful)

首次 FirstCallRequest：
- 同 stateless，返回 sessionId

后续 ResumeRequest：
- `sessionId` → `--resume <sessionId>`
- `systemReminder` → `<system-reminder>` 标签注入 user message
- `messages` → stdin JSON（仅增量）

### Codex

首次 FirstCallRequest：
- `prompt.systemPrompt` → `-c developer_instructions=<content>`
- `security` → `.codex/config.toml` sandbox_mode
- `messages` → stdin（markdown 格式）
- 返回 thread_id 作为 sessionId

后续 ResumeRequest：
- `sessionId` → `codex exec resume --json <thread_id> -`
- `systemReminder` → `<system-reminder>` 标签
- `messages` → stdin（仅增量）

### OpenCode

首次 FirstCallRequest：
- `prompt.systemPrompt` → CLI args prompt
- `security` → `~/.config/opencode/opencode.jsonc` permission
- `messages` → CLI args（markdown 格式）
- 返回 sessionID

后续 ResumeRequest：
- `sessionId` → `--session <sessionId>`
- `systemReminder` → `<system-reminder>` 标签
- `messages` → CLI args（仅增量）

---

## 与 v1 的映射

| v1 | v2 | 变化 |
|----|-----|------|
| `AgentCapability` (8 字段平铺) | `PromptSpec` + `CapabilitiesSpec` + `SecuritySpec` | 分组，去掉 TODO 维度 |
| `SnailRuntimeMessageInput` (大扁平对象) | `FirstCallRequest \| ResumeRequest` | 联合类型，去掉编排层概念 |
| `SnailRuntime.invokeMessage()` | `AgentRuntimePort.invoke()` | 方法重命名 |
| `AgentInvocationResult` | `InvokeResult` | 简化 |
| `AgentEvent` (含 permission_required) | `AgentEvent` (仅 message_event) | 移除 permission_required |
| `AgentEvent.message_failure` | `MessageEvent.message_failure` | 归入 MessageEvent |
| `GuardProfile` | `SecuritySpec` | 类型重命名，语义不变 |
| `PermissionCapability` | 已移除 | 从未实现，与 GuardProfile 重叠 |
| `hooks/tools/subAgents` | 已移除 | 从未实现，先做少后面可扩 |
