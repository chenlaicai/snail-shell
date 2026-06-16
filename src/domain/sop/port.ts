import type { Workspace } from "@domain/workspace/model";
import type { Sop } from "@domain/sop/model";

/** SOP 端口定义 */
export interface SopPort {
  /** 页面展示用，列出所有 SOPs */
  list(): Sop[];

  /** 按 key 查找 */
  findByKey(key: string): Sop | undefined;

  /** 获取指定 workspace 的 SOPs（平台 + 该 workspace） */
  findByWorkspace(workspace: Workspace): Sop[];
}
