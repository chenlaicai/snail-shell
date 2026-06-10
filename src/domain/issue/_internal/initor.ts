import type { SopRepository } from "@domain/sop/_internal/repository";
import type { IMRepository } from "@domain/im/_internal/repository";
import { InMemoryIssueRepository, InMemoryStageRepository } from "./repository";
import { IssueAdapter } from "./adapter";

/** Issue 模块依赖 */
export interface IssueDeps {
  sopRepo: SopRepository;
  imRepo: IMRepository;
}

/** 初始化 Issue 模块 */
export function init(deps: IssueDeps) {
  const issueRepo = new InMemoryIssueRepository();
  const stageRepo = new InMemoryStageRepository();
  const adapter = new IssueAdapter(issueRepo, stageRepo, deps.sopRepo, deps.imRepo);
  return { issueRepo, stageRepo, adapter };
}
