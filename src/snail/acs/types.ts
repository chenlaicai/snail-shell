/**
 * ACS 能力声明类型 — Agent 启动所需的静态配置。
 *
 * 运行时契约（SnailRuntime 等）在 runtime.ts。
 * 事件模型（AgentEvent 等）在 agent-event.ts。
 */

/** 当前系统已实现支持的 agent 运行时类型 */
export type AgentRuntime = 'claude-stateful' | 'opencode-stateful';

// ═══════════════════════════════════════════════════════════
// Agent 启动规格
// ═══════════════════════════════════════════════════════════

/**
 * ACS 顶层接口 — Agent 的完整启动规格。
 *
 * 包含启动一个 agent 所需的全部信息：运行时、模型、能力、执行参数。
 * 不包含运行态（workspace_root、conversation_id、history 等）。
 */
export interface AgentCapabilitySpec {
  // ─── 运行时与模型 ───

  /** 运行时类型 */
  runtime: AgentRuntime;
  /** 模型标识符 */
  model: string;

  // ─── 能力声明 ───

  /** 系统提示词——静态规则（constitution等），整场对话不变 */
  systemPrompt: string;
  /** 系统提示词——动态运行时上下文（工作区/阶段状态、日期等），每次调用传入 */
  systemReminder: string;
  /** 当前可用的 skill 列表 */
  skills: SkillCapability[];
  /** 当前可用的 MCP 服务器列表 */
  mcpServers: McpServerCapability[];
  /** 安全守护策略 */
  guardProfile: GuardProfile;

  // ─── 执行参数 ───

  /** 上下文窗口大小（token 数） */
  context_window?: number;
  /** 单次调用超时时间（毫秒） */
  invocation_timeout_ms?: number;
}

// ═══════════════════════════════════════════════════════════
// 能力子类型
// ═══════════════════════════════════════════════════════════

/** 安全守护策略：控制 Agent 可使用的工具和操作边界 */
export interface GuardProfile {
  /** 允许使用的工具列表 */
  allow: string[];
  /** 禁止使用的工具列表 */
  deny: string[];
}

/** Skill 能力声明 */
export interface SkillCapability {
  /** skill 名称 */
  name: string;
  /** skill 功能描述 */
  description: string;
  /** skill 文件绝对路径 */
  filePath: string;
  /** skill 所在目录绝对路径 */
  directory: string;
  /** skill 内容（SKILL.md 正文） */
  content: string;
  /** skill 来源：platform 为平台级，workspace 为工作区级 */
  source: 'platform' | 'workspace';
}

/** MCP 服务器声明 */
export interface McpServerCapability {
  /** MCP 服务器名称 */
  name: string;
  /** stdio transport: 启动命令 */
  command?: string;
  /** stdio transport: 命令参数 */
  args?: string[];
  /** stdio transport: 环境变量 */
  env?: Record<string, string>;
  /** HTTP transport: MCP endpoint URL */
  url?: string;
}

// ═══════════════════════════════════════════════════════════
// 共享子类型（被多处引用）
// ═══════════════════════════════════════════════════════════

/** 事件来源（运行时溯源） */
export interface EventSource {
  /** 产生事件的运行时类型 */
  runtime: AgentRuntime;
  /** 运行时会话 ID */
  session_id?: string;
}
