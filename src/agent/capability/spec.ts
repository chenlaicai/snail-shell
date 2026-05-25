/**
 * Agent Capability Protocol (ACP) Spec
 *
 * ACP 是 Snail Shell 面向底层 agent 运行时的通用能力声明协议。
 * 它声明 agent 在本次调用中应具备的全部能力维度。
 *
 * 设计原则：
 *  - 协议面向 agent，不面向 Snail Shell 内部
 *  - agent 只需关心"我能做什么"，不需知道能力从哪来
 *  - 每个 capability 维度独立，agent adapter 自行决定消费策略
 *  - 所有 agent 都支持的维度标记为已实现(TODO)，不支持的维度
 *    标记为 @planned 并附带各 agent 的支持计划
 */

// ═══════════════════════════════════════════════════════════
// 系统提示词
// ═══════════════════════════════════════════════════════════

// systemPrompt 是 AgentCapability 的直接字段，见下文

// ═══════════════════════════════════════════════════════════
// Skill
// ═══════════════════════════════════════════════════════════

/**
 * Skill 能力声明。
 *
 * 注入策略（TODO）：
 *  - Claude Code → 写入 native skills 临时目录，无需在 systemPrompt 中引用
 *  - 其他 agent → 当前走 systemPrompt 文本通道，未来各 adapter 自决
 */
export interface SkillCapability {
  name: string;
  description: string;
  filePath: string;
  directory: string;
  content: string;
}

// ═══════════════════════════════════════════════════════════
// MCP 服务器
// ═══════════════════════════════════════════════════════════

/**
 * MCP 服务器声明。
 *
 * 注入策略（TODO）：
 *  - Claude Code → 写入临时 .mcp.json 或 --mcp-config
 *  - OpenCode → 写入 opencode.json 的 mcp 段
 *  - Gemini → 写入 gemini.json 配置
 *  - Codex → 写入 codex.yaml 配置
 */
export interface MCPServerCapability {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

// ═══════════════════════════════════════════════════════════
// Hooks
// ═══════════════════════════════════════════════════════════

/** Hook 触发事件 */
export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "Notification"
  | "Stop"
  | "SubagentStop";

/**
 * Hook 定义。
 *
 * 注入策略（TODO）：
 *  - Claude Code → 写入 hooks 目录下的 hook 脚本
 *  - OpenCode → 写入 opencode.json 的 custom_instructions 段
 *  - 其他 agent → 当前忽略
 */
export interface HookCapability {
  event: HookEvent;
  /** 工具名称匹配（PreToolUse/PostToolUse 时） */
  matcher?: string;
  /** hook 执行的脚本命令 */
  command: string;
  /** 超时秒数 */
  timeout?: number;
}

// ═══════════════════════════════════════════════════════════
// 权限
// ═══════════════════════════════════════════════════════════

/** 工具权限级别 */
export type PermissionLevel = "allow" | "deny" | "ask";

/**
 * 权限矩阵。
 *
 * 注入策略（TODO）：
 *  - Claude Code → --allowedTools / --permission-mode
 *  - OpenCode → opencode.json 的 permissions 段
 *  - Codex → codex.yaml 权限配置
 *  - Gemini → gemini.json 权限配置
 */
export interface PermissionCapability {
  /** 默认权限模式 */
  defaultMode: PermissionLevel;
  /** 逐工具权限覆盖 */
  rules: Record<string, PermissionLevel>;
}

// ═══════════════════════════════════════════════════════════
// 工具
// ═══════════════════════════════════════════════════════════

/**
 * 自定义工具定义。
 *
 * 注入策略（TODO）：
 *  - Claude Code → 通过 MCP tool 或 custom slash command 注入
 *  - OpenCode → 通过 opencode.json agents.tools 注入
 *  - 其他 agent → 当前写入 systemPrompt 描述
 */
export interface ToolCapability {
  name: string;
  description: string;
  /** JSON Schema 参数定义 */
  parameters: Record<string, unknown>;
  /** 执行该工具的命令 */
  command: string;
}

// ═══════════════════════════════════════════════════════════
// 子 Agent
// ═══════════════════════════════════════════════════════════

/**
 * 子 Agent 定义。
 *
 * 注入策略（TODO）：
 *  - Claude Code → 写入 plugin 配置或 sub-agent 定义
 *  - OpenCode → 写入 opencode.json 的 agents 段
 *  - 其他 agent → 当前忽略
 */
export interface SubAgentCapability {
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  model?: string;
}

// ═══════════════════════════════════════════════════════════
// Agent Capability 顶层
// ═══════════════════════════════════════════════════════════

/**
 * Agent Capability 是对底层 agent 运行时能力的完整结构化声明。
 *
 * 消费方式：
 *   // systemPrompt 直接使用
 *   const prompt = capability.systemPrompt;
 *
 *   // 其他维度 agent adapter 自行决定如何消费
 *   // if (capability.skills.length) { ... }
 */
export interface AgentCapability {
  /** 完整的系统提示词文本（已实现） */
  systemPrompt: string;

  /** 当前可用的 skill 列表（TODO） */
  skills: SkillCapability[];

  /** MCP 服务器列表（TODO） */
  mcpServers: MCPServerCapability[];

  /** Hook 列表（TODO） */
  hooks: HookCapability[];

  /** 工具权限（TODO） */
  permissions: PermissionCapability;

  /** 自定义工具列表（TODO） */
  tools: ToolCapability[];

  /** 子 Agent 列表（TODO） */
  subAgents: SubAgentCapability[];

  /** 安全守护策略：按领域定义操作安全边界（已实现） */
  guardProfile: GuardProfile;
}

// ═══════════════════════════════════════════════════════════
// Guard Profile：安全守护策略
// ═══════════════════════════════════════════════════════════

/** 守护策略模式 */
export type GuardMode = "allow" | "deny" | "ask";

/** 单个安全领域的守护策略 */
export interface GuardDomain {
  /** 默认模式：allow（放行）、deny（拒绝）、ask（需审批） */
  mode: GuardMode;
  /** 即使在 deny/ask 模式下也放行的模式列表 */
  readOnlyPatterns?: string[];
  /** 即使在 allow 模式下也拒绝的模式列表 */
  denyPatterns?: string[];
  /** 允许的网络域名列表（仅 network 领域使用） */
  allowedDomains?: string[];
  /** 受保护的文件系统路径（仅 filesystem 领域使用） */
  protectedPaths?: string[];
}

/**
 * GuardProfile 按风险领域定义 agent 操作安全边界。
 *
 * 注入策略（已实现）：
 *  - Claude Code → 翻译为 settings.json 的 allow/deny 列表 + PreToolUse hooks
 *  - Codex → 翻译为 codex.yaml 权限配置（尽力而为）
 *  - OpenCode → 翻译为 opencode.json 权限配置（尽力而为）
 */
export interface GuardProfile {
  database: GuardDomain;
  filesystem: GuardDomain;
  network: GuardDomain;
  git: GuardDomain;
}
