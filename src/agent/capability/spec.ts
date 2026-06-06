/**
 * Agent Capability Spec (ACS)
 *
 * ACS 是 Snail Shell 面向底层 agent 运行时的通用能力声明规范。
 * 它声明 agent 在本次调用中应具备的全部能力维度。
 *
 * 设计原则：
 *  - 规范面向 agent，不面向 Snail Shell 内部
 *  - agent 只需关心"我能做什么"，不需知道能力从哪来
 *  - 每个 capability 维度独立，agent adapter 自行决定消费策略
 *  - 所有 agent 都支持的维度标记为已实现(TODO)，不支持的维度
 *    标记为 @planned 并附带各 agent 的支持计划
 *
 * 注意：本规范简称 ACS，与业界 ACP (Agent Client Protocol) 无关。
 * 业界 ACP 是编辑器↔Agent 的通信协议；ACS 是编排系统↔Agent Runtime
 * 的能力声明规范，两者在不同层，不冲突。
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
 * 注入策略（已实现）：
 *  - Claude Code → 通过符号链接暴露为 .claude/skills/，CLI 原生扫描 + Skill tool 调用
 *  - Codex → 通过符号链接暴露为 .agents/skills/，CLI 原生扫描 + $SkillName 引用
 *  - OpenCode → 同时扫描 .claude/skills/ 和 .agents/skills/，原生 skill tool 调用
 *
 * 符号链接由各 agent adapter 在 invokeMessage() 中通过 ensureSkillSymlinks() 创建。
 * skill 内脚本路径（node .meta/skills/...）不受符号链接影响，指向实际文件位置。
 */
export interface SkillCapability {
  name: string;
  description: string;
  filePath: string;
  directory: string;
  content: string;
  /** skill 来源：platform 为平台级（.meta/skills/），workspace 为工作区级（<projectRoot>/.snail/skills/） */
  source: "platform" | "workspace";
}

// ═══════════════════════════════════════════════════════════
// MCP 服务器
// ═══════════════════════════════════════════════════════════

/**
 * MCP 服务器声明。
 *
 * 支持两种 transport：
 * - stdio: command + args + env（独立进程，JSON-RPC over stdin/stdout）
 * - HTTP: url（挂载到现有 HTTP server，JSON-RPC over HTTP POST）
 *
 * 注入策略（工作区本地化）：
 *  - Claude Code → <wsRoot>/.claude/mcp.json（通过 --mcp-config 显式指定）
 *  - OpenCode → <wsRoot>/opencode.json（CWD auto-discovery，原生 mcp schema）
 *  - Codex → <wsRoot>/.codex/config.toml（通过 CODEX_HOME 环境变量加载）
 */
export interface MCPServerCapability {
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
 * Agent Capability 是对底层 agent 运行时能力的完整结构化声明（ACS 顶层接口）。
 *
 * 消费方式：
 *   // systemPrompt 直接使用
 *   const prompt = capability.systemPrompt;
 *
 *   // 其他维度 agent adapter 自行决定如何消费
 *   // if (capability.skills.length) { ... }
 */
export interface AgentCapability {
  /** 系统提示词——纯静态规则（constitution、角色手册、skill 引用），整场对话不变，可被 LLM 缓存 */
  systemPrompt: string;

  /** 系统提示词——动态运行时上下文（工作区/阶段状态、日期、剩余轮次等），仅在变化时注入当前消息 */
  systemReminder: string;

  /** 当前可用的 skill 列表 */
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

/** GuardProfile 类型定义已迁移至 shared/domain-types.ts。 */
import type { GuardProfile } from "../../shared/types";
