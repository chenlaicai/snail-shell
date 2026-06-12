import type { IssuePort } from "@domain/issue/port";
import { InMemoryEvolutionRepository } from "./repository";
import { EvolutionAdapter } from "./adapter";

/** 初始化 Evolution 模块 */
export function init(issuePort: IssuePort) {
  const repo = new InMemoryEvolutionRepository();
  const adapter = new EvolutionAdapter(repo, issuePort);
  return { repo, adapter };
}
