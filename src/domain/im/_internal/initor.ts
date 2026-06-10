import { InMemoryIMRepository } from "./repository";
import { IMAdapter } from "./adapter";

/** 初始化 IM 模块 */
export function init() {
  const repo = new InMemoryIMRepository();
  const adapter = new IMAdapter(repo);
  return { repo, adapter };
}
