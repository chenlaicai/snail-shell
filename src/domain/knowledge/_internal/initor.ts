import { InMemoryKnowledgeRepository } from "./repository";
import { KnowledgeAdapter } from "./adapter";

/** 初始化 Knowledge 模块 */
export function init() {
  const repo = new InMemoryKnowledgeRepository();
  const adapter = new KnowledgeAdapter(repo);
  return { repo, adapter };
}
