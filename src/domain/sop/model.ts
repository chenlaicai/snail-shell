import type { Workspace, Scope } from "@domain/workspace/model";

/** SOP (Standard Operating Procedure) 定义 */
export interface Sop {
  /** SOP 唯一标识，来自目录名 */
  key: string;
  /** 显示名称 */
  name: string;
  /** 描述 */
  description: string | null;
  /** SOP 级共享手册内容（@file 引用已解析） */
  shared_handbook: string | null;
  /** 阶段定义 */
  stage_definitions: StageDefinition[];
  /** 转移边 */
  transitions: Transition[];
  /** 作用域：platform 平台级，workspace 工作区级 */
  scope: Scope;
  /** 来源 workspace（workspace 来源时有值） */
  workspace?: Workspace;
}

/** 阶段定义 */
export interface StageDefinition {
  /** 阶段标识符 */
  key: string;
  /** 显示标题 */
  title: string;
  /** 阶段描述 */
  description: string;
  /** 角色定义 */
  roles: RoleDefinition[];
}

/** 角色定义 */
export interface RoleDefinition {
  /** 角色标识符 */
  key: string;
  /** 显示名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 是否主角色 */
  is_primary: boolean;
  /** 实例数 */
  count: number;
  /** 角色手册内容（@file 引用已解析） */
  handbook: string | null;
}

/** 转移边 */
export interface Transition {
  /** 源 stage key */
  from: string;
  /** 目标 stage key */
  to: string;
  /** 状态转移的判断标准描述 */
  guard: string | null;
}
