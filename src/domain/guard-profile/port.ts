import type { Workspace } from "@domain/workspace/model";
import type { GuardProfile } from "./model";

/**
 * Guard Profile 端口定义。
 *
 * 读取平台级和 workspace 级的安全策略配置，合并后返回。
 * 合并策略：workspace 优先（workspace 的配置覆盖平台的配置）。
 */
export interface GuardProfilePort {
  /** 获取指定 ws 的安全策略（平台 + 该 ws 合并，ws 优先） */
  findByWorkspace(workspace: Workspace): GuardProfile;
}
