/**
 * ACS (Agent Interaction Spec) v2 — 数据模型
 *
 * Snail Shell 与 agent 运行时之间交互协议的全部数据类型。
 * 不含方法契约（见 port.ts），不含实现细节（见 _internal/）。
 *
 * 设计原则：
 *  - Agent 视角：不暴露编排层内部概念（role、conversation、workspace、stage）
 *  - 只含已实现的能力，TODO 维度不入模型
 *  - 可扩展：先做少，后面可以扩
 */

// ═══════════════════════════════════════════════════════════
// 请求协议 — Snail Shell → Agent
// ═══════════════════════════════════════════════════════════

/**
 * 首次调用请求：完整上下文。
 *
 * agent 首次被调用时，需要知道全部信息：系统规则、可用工具、权限边界、对话历史。
 */
export interface FirstCallRequest {
  /** 系统提示词 */
  prompt: PromptSpec;
  /** 可用工具 */
  capabilities: CapabilitiesSpec;
  /** 安全策略 */
  guard_profile: GuardProfile;
  /** 对话历史（全量） */
  messages: Message[];
  /** 当前工作目录 */
  workspacePath: string;
  /** 日志关联标识（由编排层传入，仅用于日志） */
  snailKey?: string;
  messageId?: string;
}

/**
 * Resume 请求：后续调用，仅增量上下文。
 *
 * agent 已有 session 上下文，只需传入新消息和可能更新的 system-reminder。
 */
export interface ResumeRequest {
  /** session ID（首次调用返回的） */
  sessionId: string;
  /** 动态上下文（仅变化时传入，空字符串表示不更新） */
  systemReminder: string;
  /** 增量消息（首次调用后的新消息） */
  messages: Message[];
  /** 当前工作目录 */
  workspacePath: string;
  /** 日志关联标识（由编排层传入，仅用于日志） */
  snailKey?: string;
  messageId?: string;
}

// ═══════════════════════════════════════════════════════════
// Prompt — 系统提示词
// ═══════════════════════════════════════════════════════════

/**
 * 系统提示词：agent 消费的全部文本内容。
 *
 * 首次调用时通过 agent 原生方式注入。
 * 后续调用仅 systemReminder 可能更新（通过 <system-reminder> 标签）。
 */
interface PromptSpec {
  /** 静态系统提示词：constitution、角色手册、skill 引用。整场不变，可被 LLM 缓存。 */
  systemPrompt: string;
  /** 动态运行时上下文：workspace/stage 状态、日期、剩余轮次等。仅变化时注入。 */
  systemReminder: string;
}

// ═══════════════════════════════════════════════════════════
// Capabilities — 可用能力
// ═══════════════════════════════════════════════════════════

/**
 * 可用能力：agent 可使用的工具和资源。
 * 首次调用时注入（符号链接 / 配置文件），后续调用不重复注入。
 * 当前仅包含已实现的能力，后续可扩展。
 */
export interface CapabilitiesSpec {
  /** Skill 列表：agent 可调用的结构化能力包 */
  skills: SkillCapability[];
  /** MCP 服务器列表：agent 可连接的外部工具服务 */
  mcpServers: MCPServerCapability[];
}

/**
 * Skill 能力声明。
 *
 * 注入策略（已实现）：
 *  - Claude Code → 符号链接暴露为 .claude/skills/，CLI 原生扫描
 *  - Codex → 符号链接暴露为 .agents/skills/，CLI 原生扫描
 *  - OpenCode → 同时扫描 .claude/skills/ 和 .agents/skills/
 */
export interface SkillCapability {
  name: string;
  description: string;
  filePath: string;
  directory: string;
  content: string;
  source: "platform" | "workspace";
}

/**
 * MCP 服务器声明。
 *
 * 支持两种 transport：
 * - stdio: command + args + env（独立进程，JSON-RPC over stdin/stdout）
 * - HTTP: url（挂载到现有 HTTP server，JSON-RPC over HTTP POST）
 *
 * 注入策略（已实现）：
 *  - Claude Code → <workspaceRoot>/.claude/mcp.json
 *  - OpenCode → <workspaceRoot>/opencode.json
 *  - Codex → <workspaceRoot>/.codex/config.toml
 */
export interface MCPServerCapability {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

// ═══════════════════════════════════════════════════════════
// Guard Profile — 安全策略
// ═══════════════════════════════════════════════════════════

/**
 * 安全策略：agent 的工具使用权限边界。
 *
 * 扁平 allow/deny 模型，deny 优先于 allow。
 * 首次调用时注入（agent 原生配置文件），后续调用不重复注入。
 */
export interface GuardProfile {
  /** 工具/命令黑名单。匹配的工具被拒绝，优先于 allow。 */
  deny: string[];
  /** 工具/命令白名单。匹配的工具绕过审批。 */
  allow: string[];
}

// ═══════════════════════════════════════════════════════════
// Message — 对话消息
// ═══════════════════════════════════════════════════════════

/**
 * 对话消息：业务语义的多角色消息。
 *
 * role 区分人类/agent/系统，speaker 标识谁在说话。
 * Adapter 层负责翻译为 LLM 格式（user/assistant）。
 */
export interface Message {
  /** 业务角色类型 */
  role: "human" | "agent" | "system";
  /** 谁在说话（角色名，如 "开发者"、"审查者"、"项目负责人"） */
  speaker: string;
  /** 消息内容 */
  content: string;
}

// ═══════════════════════════════════════════════════════════
// Response — 响应协议
// ═══════════════════════════════════════════════════════════

/**
 * 调用结果：agent 调用完成后的返回值。
 */
export interface InvokeResult {
  /** session ID（stateful 模型返回，供后续 ResumeRequest 使用） */
  sessionId?: string | null;
  /** 等待 agent 子进程完全停止（shutdown 时确保所有子进程退出） */
  waitForStop?: () => Promise<void>;
}

/**
 * 流式事件：agent 在执行过程中产出的事件。
 * 通过 onEvent 回调实时传递给编排层。
 */
export interface AgentEvent {
  type: "message_event";
  event: MessageEvent;
}

/**
 * 消息事件：agent 产出的核心事件类型。
 *
 * 每个 runtime 的原生输出格式不同，adapter 按规则映射：
 *  - Claude Code: assistant.content[].type="text" → text, "tool_use" → tool_call
 *  - Codex: turn.completed.message.content[] → text
 *  - OpenCode: part.type="text" → text, "tool_use" → tool_call
 */
export type MessageEvent =
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

export interface EventSource {
  runtime_event_type: string;
  runtime_message_id: string | null;
  runtime_call_id?: string | null;
}

/**
 * 生命周期信号：runtime 在会话各阶段产出的信号。
 */
export type LifecycleSignal =
  | "start"
  | "step_start"
  | "step_finish"
  | "turn_started"
  | "turn_completed"
  | "runtime_usage"
  | "message_completed"
  | "message_failed"
  | "message_interrupted"
  | "message_cancelled"
  | "message_pending_approval";

// ═══════════════════════════════════════════════════════════
// InvokeOptions — 调用选项
// ═══════════════════════════════════════════════════════════

/**
 * 调用选项：编排层传给 agent runtime 的调用参数。
 * 不是 agent 能力声明，而是编排层对 runtime 的调用控制。
 */
export interface InvokeOptions {
  /** 中断信号 */
  signal?: AbortSignal;
  /** 模型标识（由 Snail指定） */
  model?: string;
  /** 上下文窗口大小（用于 runtime 未返回时的兜底） */
  contextWindow?: number;
  /** 调用超时（毫秒，默认 30 分钟） */
  invocationTimeoutMs?: number;
  /** 运行时上下文环境变量（issue_id, conversation_id, stage_id），spawn 时注入子进程 */
  contextEnv?: Record<string, string>;
}
