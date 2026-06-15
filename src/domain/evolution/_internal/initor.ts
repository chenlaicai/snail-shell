import type { IssuePort } from "@domain/issue/port";
import { InMemoryEvolutionRepository } from "@domain/evolution/_internal/repository";
import { EvolutionAdapter } from "@domain/evolution/_internal/adapter";

/** 初始化 Evolution 模块 */
export function init(issuePort: IssuePort) {
  const repo = new InMemoryEvolutionRepository();
  const adapter = new EvolutionAdapter(repo, issuePort);
  return { repo, adapter };
}
