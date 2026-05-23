/**
 * Agent Capability Protocol (ACP) Spec
 *
 * ACP 是 Snail Shell 面向底层 agent 运行时的通用能力声明协议。
 * 它只定义 agent 需要的能力维度，不携带 Snail Shell 内部概念
 * (如 B-01/B-02 prompt ID、required/conditional skill mode 等)。
 *
 * 设计原则：
 *  - 协议面向 agent，不面向 Snail Shell 内部
 *  - agent 只需要知道"我能做什么"，不需要知道"这个能力从哪来的"
 *  - 每个 capability 维度独立声明，agent adapter 自行决定消费方式
 *
 * v1 字段：
 *   systemPrompt, skills
 *
 * 未来字段：
 *   mcpServers, hooks, permissions, tools, plugins, subAgents
 */

// ──── Skill 能力 ────

/**
 * Skill 能力声明。
 *
 * 描述一个可用的 skill，包含其完整内容和元数据。
 * agent adapter 可以选择：
 *  - 忽略（当前所有 agent 走 systemPrompt 文本通道）
 *  - 或利用原生机制注入（未来 Claude Code → native skills dir）
 */
export interface SkillCapability {
  /** Skill 名称，与 SKILL.md frontmatter 的 name 字段一致 */
  name: string;
  /** Skill 用途描述 */
  description: string;
  /** SKILL.md 的相对路径 */
  filePath: string;
  /** Skill 目录的相对路径（native skills dir 注入时需要整目录） */
  directory: string;
  /** SKILL.md 完整内容 */
  content: string;
}

// ──── Agent Capability ────

/**
 * Agent Capability 是对底层 agent 运行时能力的完整结构化声明。
 *
 * agent adapter 的消费方式：
 *   const prompt = capability.systemPrompt;  // 直接使用
 *   // 未来：if (capability.skills.length) createNativeSkillsDir(...)
 */
export interface AgentCapability {
  /**
   * 完整的系统提示词文本。
   * agent 直接使用，不做任何再组装。
   * 所有 runtime 都能消费的 fallback 注入通道。
   */
  systemPrompt: string;

  /**
   * 当前上下文可用的 skill 列表。
   * agent adapter 可以忽略（走 systemPrompt 文本通道），
   * 或利用原生 mechanism 注入。
   */
  skills: SkillCapability[];
}

// ──── Future capability types (planned, not yet implemented) ────

/**
 * MCP 服务器引用（planned）。
 * 注入方式：Claude Code → .mcp.json, OpenCode → opencode.json mcp 段
 * @planned
 */
// export interface MCPServerRef {
//   name: string;
//   command: string;
//   args: string[];
//   env?: Record<string, string>;
// }

/**
 * Hook 定义（planned）。
 * 注入方式：Claude Code → hooks 目录, OpenCode → custom instructions
 * @planned
 */
// export type HookEvent = "SessionStart" | "PreToolUse" | "PostToolUse" | "Stop";
// export interface HookDef {
//   event: HookEvent;
//   matcher?: string;
//   action: "inject_prompt" | "deny" | "ask";
//   prompt?: string;
// }

/**
 * 工具权限矩阵（planned）。
 * 注入方式：Claude Code → allowedTools/permissionMode, OpenCode → permissions
 * @planned
 */
// export interface PermissionMatrix {
//   [toolName: string]: "allow" | "deny" | "ask";
// }

/**
 * 子 Agent 定义（planned）。
 * 注入方式：Claude Code → plugin agents, OpenCode → agents 配置
 * @planned
 */
// export interface SubAgentDef {
//   name: string;
//   description: string;
//   systemPrompt: string;
//   tools: string[];
//   model?: string;
// }
