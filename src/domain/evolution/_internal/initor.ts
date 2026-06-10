import type { SopRepository } from "@domain/sop/_internal/repository";
import type { IMRepository } from "@domain/im/_internal/repository";
import type { IssueRepository, StageRepository } from "@domain/issue/_internal/repository";
import { InMemoryEvolutionRepository } from "./repository";
import { EvolutionAdapter } from "./adapter";

/** Evolution 模块依赖 */
export interface EvolutionDeps {
  sopRepo: SopRepository;
  imRepo: IMRepository;
  issueRepo: IssueRepository;
  stageRepo: StageRepository;
}

/** 初始化 Evolution 模块 */
export function init(deps: EvolutionDeps) {
  const repo = new InMemoryEvolutionRepository();
  const adapter = new EvolutionAdapter(repo, deps.issueRepo, deps.stageRepo, deps.imRepo, deps.sopRepo);
  return { repo, adapter };
}
