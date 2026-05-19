import type { AgentRuntime, SnailRuntime } from "./interface";

export interface SnailAgentResolver {
  resolve(runtime: AgentRuntime): SnailRuntime;
  list(): SnailRuntime[];
}

export class RuntimeSnailAgentResolver implements SnailAgentResolver {
  private agents = new Map<AgentRuntime, SnailRuntime>();

  constructor(agents: SnailRuntime[]) {
    for (const agent of agents) {
      this.agents.set(agent.runtime, agent);
    }
  }

  resolve(runtime: AgentRuntime): SnailRuntime {
    const agent = this.agents.get(runtime);
    if (!agent) {
      throw new Error(`No agent configured for runtime: ${runtime}`);
    }
    return agent;
  }

  list(): SnailRuntime[] {
    return Array.from(this.agents.values());
  }
}
