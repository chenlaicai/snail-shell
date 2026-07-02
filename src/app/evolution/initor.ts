import type { EvolutionPort } from "@domain/evolution/port";
import type { IssuePort } from "@domain/issue/port";
import type { SnailPort } from "@domain/snail/port";
import type { CollaborationInput } from "@app/issue-collaboration/port";
import { EvolutionAppAdapter } from "@app/evolution/_internal/adapter";

/** Evolution App 模块依赖 */
export interface EvolutionAppDeps {
  evolutionPort: EvolutionPort;
  collaboration: CollaborationInput;
  issuePort: IssuePort;
  snailPort: SnailPort;
}

/** 初始化 Evolution App 模块（编排层） */
export function init(deps: EvolutionAppDeps) {
  const adapter = new EvolutionAppAdapter(
    deps.evolutionPort,
    deps.collaboration,
    deps.issuePort,
    deps.snailPort,
  );
  return { adapter };
}
