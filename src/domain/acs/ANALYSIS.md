# ACS + Agent 实现模块分析（v1 遗留）

> 本文档基于 `v1/` 目录下的遗留代码分析，用于指导 v2 重写。

---

## 一、业务场景

### 1.1 ACS 是什么

ACS（Agent Capability Spec）是 Snail Shell 向 Agent 声明**完整能力规格**的接口。它是 Agent 面向的抽象——Agent 只需要知道"我能做什么"，不需要知道能力从哪来。

9 个维度：systemPrompt、systemReminder、skills、mcpServers、hooks、permissions、tools、subAgents、guardProfile。

### 1.2 Agent 实现是什么

Agent 实现是 Snail Shell 与各 AI Agent CLI（Claude Code、OpenCode、Codex）之间的适配层。每个 Agent 适配器实现 `SnailRuntime` 接口，将统一的 `SnailRuntimeMessageInput` 翻译为各 CLI 的原生调用方式。

### 1.3 核心业务场景

| 场景 | 说明 |
|------|------|
| **能力组装** | `buildConversationCapability()` 将 workspace/issue/stage/role 上下文组装为完整 ACS |
| **无状态调用** | Claude Code 无状态模式：每次重建完整上下文窗口 |
| **有状态调用** | Claude Code Stateful / OpenCode / Codex：通过 sessionId 恢复，只发增量消息 |
| **进程生命周期管理** | 三阶段停止协议（SIGINT → SIGTERM → SIGKILL） |
| **Guard Profile** | 安全黑名单翻译为各 Agent 原生格式 |
| **流式事件** | Agent 输出通过 event 流实时推送到前端 |
| **权限审批** | Agent 请求工具权限时，转发到前端等待用户审批 |
| **Session 管理** | 跟踪每个 conversation+role 的 Agent 会话状态 |

---

## 二、ACS 数据模型

### 2.1 AgentCapability 接口

```typescript
interface AgentCapability {
  systemPrompt: string;              // 静态规则（宪法、角色手册、skill 引用）
  systemReminder: string;            // 动态运行时上下文（workspace/stage 状态、日期、剩余轮次）
  skills: SkillCapability[];         // 已实现
  mcpServers: MCPServerCapability[]; // 已实现
  hooks: HookCapability[];           // TODO
  permissions: PermissionCapability; // TODO
  tools: ToolCapability[];           // TODO
  subAgents: SubAgentCapability[];   // TODO
  guardProfile: GuardProfile;        // 已实现
}
```

### 2.2 各维度子类型

**SkillCapability**：
```typescript
interface SkillCapability {
  name: string;
  description: string;
  filePath: string;          // SKILL.md 绝对路径
  directory: string;         // Skill 目录（用于 symlink）
  content: string;           // Markdown body
  source: "platform" | "workspace";
}
```

**MCPServerCapability**：
```typescript
interface MCPServerCapability {
  name: string;
  command?: string;              // stdio transport
  args?: string[];               // stdio transport
  env?: Record<string, string>;  // stdio transport
  url?: string;                  // HTTP transport
}
```

**HookCapability**：
```typescript
interface HookCapability {
  event: HookEvent;  // "PreToolUse" | "PostToolUse" | "Notification" | "Stop" | "SubagentStop"
  matcher?: string;
  command: string;
  timeout?: number;
}
```

**PermissionCapability**：
```typescript
interface PermissionCapability {
  defaultMode: "allow" | "deny" | "ask";
  rules: Record<string, PermissionLevel>;
}
```

**ToolCapability**：
```typescript
interface ToolCapability {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
  command: string;
}
```

**SubAgentCapability**：
```typescript
interface SubAgentCapability {
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  model?: string;
}
```

**GuardProfile**：
```typescript
interface GuardProfile {
  allow: string[];   // 允许的工具模式
  deny: string[];    // 禁止的工具模式
}
```

---

## 三、Agent 运行时数据模型

### 3.1 SnailRuntime 接口

```typescript
interface SnailRuntime {
  readonly name: string;
  readonly runtime: AgentRuntime;
  invokeMessage(
    input: SnailRuntimeMessageInput,
    onEvent: (event: AgentEvent) => void,
    options?: AgentInvocationOptions,
  ): Promise<AgentInvocationResult>;
}
```

### 3.2 两种调用模型

**无状态（StatelessAgentInvoker）**：
```typescript
interface StatelessInvocationInput {
  systemPrompt: string;
  systemReminder: string;
  messages: AgentMessage[];  // 完整对话窗口
}
```

**有状态（StatefulAgentInvoker）**：
```typescript
interface StatefulInvocationInput {
  sessionId: string | null;          // null = 首次调用
  bootstrap: { systemPrompt, messages } | null;  // 首次调用时的完整上下文
  incrementalMessages: AgentMessage[];  // 增量消息
  systemReminder: string;
}
```

### 3.3 SnailRuntimeMessageInput（上层输入）

```typescript
interface SnailRuntimeMessageInput {
  workspaceRoot: string;
  conversation: Conversation;
  role: RoleDefinition;
  capability: AgentCapability;       // 完整 ACS
  history: AgentMessage[];           // 对话历史
  latestUserEvents: CreateMessageEventInput[];  // 最新用户事件
  incrementalMessages: MessageWithEvents[];     // 增量消息
  externalSessionId: string | null;  // 有状态 Agent 的 sessionId
}
```

### 3.4 AgentEvent（事件类型）

```typescript
type AgentEvent =
  | { type: "message_event"; event: CreateMessageEventInput }
  | { type: "permission_required"; request: ToolPermissionRequest }
  | { type: "message_failure"; error: string };
```

### 3.5 AgentInvocationResult（调用结果）

```typescript
interface AgentInvocationResult {
  sessionId?: string | null;         // 有状态 Agent 返回的 sessionId
  waitForStop?: () => Promise<void>; // 等待进程完全停止
}
```

### 3.6 AgentInvocationOptions（调用选项）

```typescript
interface AgentInvocationOptions {
  signal?: AbortSignal;
  model?: string;
  contextWindow?: number;
  invocationTimeoutMs?: number;
  contextEnv?: Record<string, string>;
}
```

---

## 四、四个 Agent 适配器

### 4.1 适配器对比

| 特性 | ClaudeCodeAgent | ClaudeCodeStatefulAgent | OpenCodeAgent | CodexAgent |
|------|----------------|------------------------|---------------|------------|
| runtime | claude-code-cli | claude-code-stateful-cli | opencode-cli | codex-cli |
| 调用模型 | 无状态 | 有状态 | 有状态 | 有状态 |
| 继承 | - | - | StatefulCLIAgent | 独立实现 |
| 默认模型 | - | - | my-geek/gpt-5.5 | claude-opus-4 |
| Session 恢复 | 无 | --resume sessionId | --session sessionId | codex exec resume thread_id |
| Prompt 注入 | --append-system-prompt-file | --append-system-prompt-file | CLI args prompt | -c developer_instructions |
| stdin 消息 | JSON stdin | JSON stdin | CLI args | CLI args + stdin |
| GuardProfile | --disallowedTools | --disallowedTools | opencode.jsonc permissions | sandbox_mode |
| MCP 配置 | .claude/mcp.json | .claude/mcp.json | opencode.json | .codex/config.toml |

### 4.2 ClaudeCodeAgent（无状态）

```
invokeMessage()
  → extract systemPrompt, systemReminder
  → ensureMcpServers() → .claude/mcp.json + settings.json
  → ensureSkillSymlinks() → .claude/skills/ + .agents/skills/
  → buildStatelessMessages(input) → input.history
  → invokeStateless()
    → CLI args: -p, --no-session-persistence, --output-format stream-json, --input-format stream-json, --verbose, --permission-mode bypassPermissions
    → --model (可选), --disallowedTools (guard), --mcp-config
    → --append-system-prompt-file (tempFile)
    → spawn "claude" (detached, piped stdin/stdout/stderr)
    → stdin: { type: "user", message: { role: "user", content: <system-reminder>... + renderStatelessTranscript() } }
    → stdout: JSON lines → assistant (text/tool_use) / result (final content)
    → manageInvocationProcess() → 生命周期管理
```

### 4.3 ClaudeCodeStatefulAgent（有状态）

```
invokeMessage()
  → 判断 bootstrap vs resume
  → bootstrap: buildStatefulBootstrap() → { systemPrompt, messages }
  → resume: 无 bootstrap，仅增量消息
  → ensureMcpServers(), ensureSkillSymlinks()
  → invokeStateful()
    → bootstrap: --append-system-prompt-file + stdin messages
    → resume: --resume <sessionId> + stdin incremental messages
    → stdout: JSON lines → 提取 session_id
    → 返回 { sessionId, waitForStop }
```

### 4.4 OpenCodeAgent（有状态，extends StatefulCLIAgent）

```
invokeMessage()
  → ensureMcpServers() → opencode.json
  → ensureSkillSymlinks()
  → translateGuardProfile() → ~/.config/opencode/opencode.jsonc
  → invokeStateful()
    → renderStatefulPrompt() → systemPrompt + systemReminder + bootstrap + incremental
    → CLI: opencode run --format json --model <model> [--session <sessionId>]
    → stdout: JSON events → step_start/text/tool_use/step_finish
    → 提取 sessionID
```

### 4.5 CodexAgent（有状态，独立实现）

```
invokeMessage()
  → ensureMcpServers() → .codex/config.toml
  → ensureSkillSymlinks()
  → translateGuardProfile() → .codex/config.toml sandbox_mode
  → invokeStateful()
    → renderStatefulPrompt({ skipSystemPrompt: true }) → systemReminder + bootstrap + incremental
    → 新 session: codex exec --json --model <model> -c 'developer_instructions=...' -
    → 恢复: codex exec resume --json <thread_id> -
    → CODEX_HOME=<wsRoot>/.codex/
    → stdout: JSON events → thread.started/turn.started/turn.completed/turn.failed/error
    → 提取 thread_id
```

---

## 五、核心流程

### 5.1 ACS 组装流程

```
buildConversationCapability(context)
  → 构建模板变量（workspace, issue, stage, role, conversation, history, evolution, knowledge）
  → 断言关键变量非空（stage_id, issue_id, workspace_name, active_role_name）
  → 合并平台 + workspace prompt
  → assembleSystemPrompt()
    → 按 when 条件过滤
    → 按 layer 优先级排序（sop < workspace < platform）→ 按 priority 排序
    → 模板变量替换 {{variable_name}}
    → 分离 systemPrompt（static）和 systemReminder（dynamic）
  → 注入 role handbook 到 systemReminder
  → evolution 对话注入治理上下文
  → collectActiveSkills() → 合并平台 + workspace skill
  → resolveGuardProfile()
  → collectActiveMcpServers()
  → 返回 AgentCapability
```

### 5.2 Guard Profile 翻译流程

```
translateGuardProfile(guardProfile, agentType)
  → Claude Code: deny → --disallowedTools <patterns>
  → Codex: deny 含 rm -rf/chmod → sandbox_mode=read-only; 否则 workspace-write
  → OpenCode: deny → opencode.jsonc permissions (Bash(...) → bash sub-rules, tool names → permission keys)
```

### 5.3 System Prompt 注入方式

| Agent | systemPrompt | systemReminder |
|-------|-------------|----------------|
| Claude Code | --append-system-prompt-file（tempFile） | \<system-reminder\> 标签包裹，前置到 user content |
| Claude Code Stateful | --append-system-prompt-file（仅 bootstrap） | \<system-reminder\> 标签包裹，前置到 user content |
| OpenCode | 作为 prompt 的 "## 当前任务上下文" 段 | \<system-reminder\> 标签包裹 |
| Codex | -c developer_instructions=...（原生 flag） | \<system-reminder\> 标签包裹 |

### 5.4 进程生命周期管理

```
manageInvocationProcess(childProcess, options)
  → 监听 abort signal + invocation timeout
  → 停止协议（三阶段升级）：
    1. SIGINT → 进程组，等待 15s
    2. SIGTERM → 进程组，等待 5s（标记为强制）
    3. SIGKILL → 进程组，等待 2s（强制）
    → 仍存活：标记 kill_unconfirmed
  → 进程组信号：process.kill(-pid, signal)，fallback proc.kill(signal)
  → 返回 ManagedProcessController { stopDetail, waitForStop, throwIfStopped, cleanup }
```

### 5.5 流式事件处理

```
Agent stdout → JSON lines
  → 适配器解析为 AgentEvent
  → onEvent 回调
  → handleStreamingEvent()
    → message_event → 持久化 + emitAgentEvent()
    → message_failure → 记录终端失败
    → permission_required → 存入 PermissionStore + 转发前端
  → WorkspaceManager.emit("agent-event", ...)
  → ConversationGateway → per-conversation handlers
  → WebSocket/SSE → 前端
```

### 5.6 权限审批流程

```
Agent 请求权限
  → emit { type: "permission_required", request: ToolPermissionRequest }
  → PermissionStore.setPendingApproval(conversationId, messageId, request)
  → 前端显示 approve/deny 按钮
  → 用户点击 → POST /api/conversations/:id/messages/:id/approve-tool
  → PermissionStore.resolve(decision)
  → Agent 继续执行
```

---

## 六、关键设计决策（v1）

1. **ACS 面向 Agent** — Agent 只需知道"我能做什么"，不需要知道能力从哪来
2. **9 维度设计** — 4 个已实现（systemPrompt, systemReminder, skills, mcpServers, guardProfile），5 个 TODO
3. **无状态/有状态分流** — contextProvider 决定调用模型，影响上下文管理策略
4. **适配器模式** — 每个 Agent CLI 有独立适配器，统一 SnailRuntime 接口
5. **进程组信号** — 停止时发进程组信号（-pid），确保子进程也被终止
6. **三阶段停止升级** — SIGINT → SIGTERM → SIGKILL，优雅降级
7. **GuardProfile 翻译** — 统一的 allow/deny 模型翻译为各 Agent 原生格式
8. **StatefulCLIAgent 基类** — OpenCode 等 CLI args 方式的 Agent 共享基类
9. **Session handoff** — runtime/model 变更时创建新 session，handoff_from_id 追溯

---

## 七、v2 重写待决问题

1. **TODO 维度是否实现？** hooks、permissions、tools、subAgents 5 个维度是否在 v2 实现？
2. **无状态/有状态是否统一？** 当前两个调用模型是否需要统一抽象？
3. **进程管理是否优化？** 当前 spawn 子进程方式，是否需要进程池或复用？
4. **GuardProfile 是否需要更细粒度？** 当前 flat allow/deny，是否需要参数级拦截？
5. **Agent 适配器是否需要插件化？** 当前硬编码 4 个适配器，是否需要动态注册？
6. **流式事件协议是否标准化？** 当前各 Agent 的 stdout JSON 格式不同，是否需要统一？
7. **权限审批是否需要更丰富的交互？** 当前仅 approve/deny，是否需要条件批准？
8. **Context window 管理是否优化？** 当前无状态模式每次重建完整窗口，是否需要智能截断？
9. **Agent 错误恢复？** Agent 崩溃后是否需要自动重试或降级？
10. **Runtime usage 追踪是否需要持久化？** 当前仅作为 signal event，是否需要入库？
