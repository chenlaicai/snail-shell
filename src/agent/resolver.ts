import type { AgentRuntime, SnailRuntime } from "./interface";
import type { SnailDefinition } from "../snails";

export interface SnailAgentResolver {
  resolve(snail: SnailDefinition): SnailRuntime;
  list(): SnailRuntime[];
}

export class RuntimeSnailAgentResolver implements SnailAgentResolver {
  private agents = new Map<AgentRuntime, SnailRuntime>();

  constructor(agents: SnailRuntime[]) {
    for (const agent of agents) {
      this.agents.set(agent.runtime, agent);
    }
  }

  resolve(snail: SnailDefinition): SnailRuntime {
    // Runtime resolution happens per snail message, but the snail->runtime binding is
    // still stable. This preserves multi-snail handoff while keeping runtime choice
    // as a Snail Shell concern rather than something inferred by lower layers.
    const agent = this.agents.get(snail.runtime);
    if (!agent) {
      throw new Error(`No agent configured for runtime: ${snail.runtime}`);
    }
    return agent;
  }

  list(): SnailRuntime[] {
    return Array.from(this.agents.values());
  }
}
