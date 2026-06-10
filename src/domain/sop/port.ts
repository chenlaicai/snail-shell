import type { Sop } from "./model";

/** SOP 端口定义 */
export interface SopPort {
  /** 列出所有已加载的 SOP */
  list(): Sop[];

  /** 按 key 查找 */
  findByKey(key: string): Sop | undefined;
}
