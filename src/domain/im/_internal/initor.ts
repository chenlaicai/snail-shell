import { InMemoryIMRepository } from "@domain/im/_internal/repository";
import { IMAdapter } from "@domain/im/_internal/adapter";

/** 初始化 IM 模块 */
export function init() {
  const repo = new InMemoryIMRepository();
  const adapter = new IMAdapter(repo);
  return { repo, adapter };
}
