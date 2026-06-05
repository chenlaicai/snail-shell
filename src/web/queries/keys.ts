// query key 工厂——queries/mutations/WebSocket handler 统一引用

interface EvolutionFilters {
  workspace_id?: string;
  issue_id?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

interface KnowledgeFilters {
  scope?: "global" | "workspace";
  workspace_id?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

export const queryKeys = {
  workspaces: {
    all: ["workspaces"] as const,
    list: (query?: { limit?: number; offset?: number }) => ["workspaces", query] as const,
    detail: (id: string) => ["workspaces", id] as const,
    issues: (id: string) => ["workspaces", id, "issues"] as const,
    stages: (id: string) => ["workspaces", id, "stages"] as const,
    conversations: (id: string) => ["workspaces", id, "conversations"] as const,
    sops: (id: string) => ["workspaces", id, "sops"] as const,
    evolution: (id: string) => ["workspaces", id, "evolution"] as const,
  },
  issues: {
    detail: (id: string) => ["issues", id] as const,
    stages: (id: string) => ["issues", id, "stages"] as const,
    conversations: (id: string) => ["issues", id, "conversations"] as const,
  },
  conversations: {
    detail: (id: string) => ["conversations", id] as const,
    messages: (id: string) => ["conversations", id, "messages"] as const,
  },
  sops: {
    all: ["sops"] as const,
    list: (source?: string) => ["sops", { source }] as const,
    detail: (id: string) => ["sops", id] as const,
  },
  evolution: {
    list: (filters?: EvolutionFilters) => ["evolution", filters] as const,
    detail: (id: string) => ["evolution", id] as const,
  },
  knowledge: {
    list: (filters?: KnowledgeFilters) => ["knowledge", filters] as const,
    search: (q: string) => ["knowledge", "search", q] as const,
  },
  lobby: {
    sessions: ["lobby", "sessions"] as const,
    detail: (id: string) => ["lobby", id] as const,
  },
  meta: {
    prompts: ["meta", "prompts"] as const,
    skills: ["meta", "skills"] as const,
    mcps: (root?: string) => ["meta", "mcps", root] as const,
    snailDen: ["meta", "snail-den"] as const,
  },
  roles: ["roles"] as const,
};
