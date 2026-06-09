/**
 * Agent Capability 模块公开类型
 *
 * 定义 Agent 能力声明、权限管理的领域类型。
 *
 * 设计原则：
 * - 只定义本模块的领域类型
 * - 通过 Builder 接口构建能力
 */

/**
 * Skill 定义（本模块自包含）
 */
export interface SkillDefinition {
  /** Skill ID */
  id: string;
  /** Skill 名称 */
  name: string;
  /** Skill 描述 */
  description: string;
  /** Skill 路径 */
  path: string;
  /** Skill 内容 */
  content: string;
}

/**
 * MCP Server 配置（本模块自包含）
 */
export interface McpServerConfig {
  /** Server 名称 */
  name: string;
  /** 启动命令 */
  command: string;
  /** 命令参数 */
  args: string[];
  /** 环境变量 */
  env: Record<string, string>;
}

/**
 * Hook 配置
 */
export interface HookConfig {
  /** Hook 名称 */
  name: string;
  /** Hook 事件 */
  event: string;
  /** Hook 命令 */
  command: string;
}

/**
 * 权限配置
 */
export interface PermissionConfig {
  /** 允许的权限列表 */
  allowed: string[];
  /** 拒绝的权限列表 */
  denied: string[];
}

/**
 * 工具配置
 */
export interface ToolConfig {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 工具参数 Schema */
  parameters: Record<string, unknown>;
}

/**
 * 子 Agent 配置
 */
export interface SubAgentConfig {
  /** Agent 名称 */
  name: string;
  /** Agent 描述 */
  description: string;
  /** Agent 模型 */
  model: string;
}

/**
 * Guard Profile
 */
export interface GuardProfile {
  /** Profile 名称 */
  name: string;
  /** 禁用工具列表 */
  disallowedTools: string[];
}

/**
 * Agent Capability
 *
 * 定义 Agent 的完整能力声明。
 */
export interface AgentCapability {
  /** 系统提示词 */
  systemPrompt: string;
  /** 系统提醒 */
  systemReminder: string;
  /** Skill 列表 */
  skills: SkillDefinition[];
  /** MCP Server 列表 */
  mcpServers: McpServerConfig[];
  /** Hook 列表 */
  hooks: HookConfig[];
  /** 权限配置 */
  permissions: PermissionConfig;
  /** 工具列表 */
  tools: ToolConfig[];
  /** 子 Agent 列表 */
  subAgents: SubAgentConfig[];
  /** Guard Profile */
  guardProfile: GuardProfile | null;
}

/**
 * Capability 构建上下文
 */
export interface CapabilityBuildContext {
  /** 工作区根目录 */
  workspaceRoot: string;
  /** Issue ID */
  issueId: string;
  /** Stage ID */
  stageId: string;
  /** 会话 ID */
  conversationId: string;
  /** 角色信息 */
  role: {
    key: string;
    name: string;
    description: string;
    rules: string[];
    isPrimary: boolean;
  };
}
