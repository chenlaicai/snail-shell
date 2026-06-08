import type { GuardProfile } from '@/snail/acs/types.js';

/** 系统级工作空间配置（来自 config/workspaces.yaml） */
export interface WorkspacesConfig {
  /** 系统当前识别的工作空间根目录绝对路径列表 */
  paths: string[];
}

/** 工作空间级配置（来自 <workspace>/.snail/init.json） */
export interface WorkspaceInitConfig {
  /** 工作空间名称 */
  name: string;
  /** 工作空间简要说明 */
  summary: string;
  /** 采用的 SOP ID 列表（可选，为空时使用平台默认） */
  adopted_sop_ids?: string[];
  /** 权限覆盖配置 */
  guard_profile?: GuardProfile;
  /** 允许扩展 */
  [key: string]: unknown;
}

/** 工作空间级 prompt 文档（来自 .snail/prompts/*.md） */
export interface WorkspacePromptDocument {
  /** 文档标识符（从文件名派生，不含扩展名） */
  key: string;
  /** 文件绝对路径 */
  file_path: string;
  /** frontmatter 元数据 */
  frontmatter: Record<string, unknown>;
  /** markdown 正文 */
  content: string;
}
