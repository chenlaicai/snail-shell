import type { Workspace, Scope } from "@domain/workspace/model";

/**
 * Guard Profile — 安全策略配置。
 *
 * 控制 agent 的工具使用权限。
 * 平台级和 workspace 级配置合并，workspace 优先。
 */
export interface GuardProfile {
  /** 工具/命令白名单，匹配的工具绕过审批 */
  allow: string[];
  /** 工具/命令黑名单，匹配的工具被拒绝，优先于 allow */
  deny: string[];
  /** 作用域 */
  scope: Scope;
  /** 关联的工作区（workspace 来源时有值） */
  workspace?: Workspace;
}
