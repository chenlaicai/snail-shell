/**
 * Agent Capability Spec
 *
 * Snail Shell 作为多 agent 编排系统，需要统一的"能力注入协议"来描述
 * 一个 agent 在运行时应该具备的全部能力。这个协议层位于 orchestration
 * 和 runtime adaptation 之间，解决当前所有能力（prompt、skill、MCP 等）
 * 都通过 system prompt 文本拼接注入的问题。
 *
 * 核心理念：
 * - 能力声明和能力注入是两个独立环节
 * - Capability Spec 是对能力的结构化声明（类型安全、可组合、可测试）
 * - 每个 runtime adapter 负责将 Spec 翻译为该 runtime 的原生注入机制
 * - 未来新增 capability 类型只需加字段，不影响现有 adapter
 *
 * 当前字段（v1）：
 *   systemPrompt, prompts, skills
 *
 * 计划后续字段：
 *   mcpServers, hooks, permissions, tools, subAgents
 */

// ──── Prompt 能力 ────

/** 提示词的注入模式 */
export type PromptMode = "base" | "scenario";

/**
 * Prompt 能力声明。
 * 描述一个被注入到 agent 系统提示词中的提示词模块。
 * 这用于能力追溯和评估，不替代系统提示词文本本身。
 */
export interface PromptCapability {
  /** Prompt ID，例如 "B-01"、"S-03" */
  id: string;
  /** Prompt 标题 */
  title: string;
  /** 注入模式：base（始终注入）或 scenario（条件注入） */
  mode: PromptMode;
}

// ──── Skill 能力 ────

/** Skill 的激活模式 */
export type SkillMode = "required" | "conditional";

/**
 * Skill 能力声明。
 *
 * 这是 skill 在 Agent Capability 中的一等公民表示。
 * 与当前做法（在 system prompt 中用文本"必须使用 skill: X"引用）不同，
 * Capability 保留 skill 的完整结构化信息，让 runtime adapter 可以：
 * - 选择合适的注入方式（native skills 目录 vs 嵌入 prompt）
 * - 做权限控制和条件激活
 * - 跟踪 skill 使用情况
 */
export interface SkillCapability {
  /** Skill 名称，与 SKILL.md frontmatter 的 name 字段一致 */
  name: string;
  /** Skill 描述，来自 SKILL.md frontmatter */
  description: string;
  /** SKILL.md 的相对路径（相对于项目根） */
  filePath: string;
  /** Skill 目录的相对路径（runtime 如 Claude Code 需要整目录） */
  directory: string;
  /** 激活模式 */
  mode: SkillMode;
  /** 使用此 skill 的理由（人类可读） */
  reason: string;
  /** SKILL.md 完整内容（用于需要嵌入 prompt 的 runtime） */
  content: string;
  /** SKILL.md 一级标题 */
  title: string;
}

// ──── Agent Capability ────

/**
 * Agent Capability 是 Snail Shell 对底层 agent 运行时能力的完整结构化声明。
 *
 * 它是 SnailRuntimeMessageInput 的一部分，每个 agent 调用都会携带一份
 * 匹配当前上下文（project、feature、stage、conversation、role）的 Capability。
 *
 * 设计原则：
 * 1. systemPrompt 保留为纯文本，确保任何 runtime 的最低可用性
 * 2. prompts/skills 提供结构化元数据，不重复 systemPrompt 的内容
 * 3. 每个 capability 项可被独立选择、裁剪或降级
 * 4. 未来新增 capability 类型只需加字段，不影响现有 adapter
 */
export interface AgentCapability {
  /**
   * 组装的系统提示词文本。
   * 这是向后兼容字段，所有 runtime 都能消费。
   * 对于 stateless runtime（如 Claude Code --bare），这是唯一的指令入口。
   */
  systemPrompt: string;

  /**
   * 参与组装 systemPrompt 的 prompt 模块列表。
   * B-01 ~ B-99 为 base 模块（始终注入），S-01 ~ S-99 为 scenario 模块（条件注入）。
   * 用于能力追溯到具体 prompt id，帮助评估和调试。
   */
  prompts: PromptCapability[];

  /**
   * 当前上下文激活的 skill 能力列表。
   * 这些 skill 在 systemPrompt 中被引用，但通过结构化声明保留了完整元数据。
   * Runtime adapter 可选择最合适的注入方式。
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
