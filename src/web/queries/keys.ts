export const queryKeys = {
  workspaces: {
    all: ["workspaces"] as const,
    detail: (id: string) => ["workspaces", id] as const,
    issues: (id: string) => ["workspaces", id, "issues"] as const,
    stages: (id: string) => ["workspaces", id, "stages"] as const,
    conversations: (id: string) => ["workspaces", id, "conversations"] as const,
    evolution: (id: string) => ["workspaces", id, "evolution"] as const,
  },
  issues: {
    detail: (id: string) => ["issues", id] as const,
    stages: (id: string) => ["issues", id, "stages"] as const,
    conversations: (id: string) => ["issues", id, "conversations"] as const,
    stageSuggestion: (id: string) => ["issues", id, "stage-suggestion"] as const,
  },
  stages: {
    detail: (id: string) => ["stages", id] as const,
    conversations: (id: string) => ["stages", id, "conversations"] as const,
  },
  sops: {
    all: ["sops"] as const,
    detail: (id: string) => ["sops", id] as const,
  },
  conversations: {
    detail: (id: string) => ["conversations", id] as const,
    messages: (id: string) => ["conversations", id, "messages"] as const,
    messagesPage: (id: string, offset: number) => ["conversations", id, "messages", "page", offset] as const,
    recentMessages: (id: string) => ["conversations", id, "messages", "recent"] as const,
    events: (id: string) => ["conversations", id, "events"] as const,
    dispatchState: (id: string) => ["conversations", id, "dispatch-state"] as const,
    bossMentions: (id: string) => ["conversations", id, "boss-mentions"] as const,
    historySearch: (id: string, query: string) => ["conversations", id, "history", "search", query] as const,
  },
  evolution: {
    items: (filters?: Record<string, unknown>) => ["evolution", "items", filters] as const,
    detail: (id: string) => ["evolution", "items", id] as const,
  },
  knowledge: {
    summary: ["knowledge", "summary"] as const,
    items: (filters?: Record<string, unknown>) => ["knowledge", "items", filters] as const,
    detail: (id: string) => ["knowledge", "items", id] as const,
    search: (q: string) => ["knowledge", "search", q] as const,
  },
  lobby: {
    sessions: ["lobby", "sessions"] as const,
    session: (id: string) => ["lobby", "sessions", id] as const,
    messages: (id: string) => ["lobby", "sessions", id, "messages"] as const,
  },
  meta: {
    prompts: ["meta", "prompts"] as const,
    skills: ["meta", "skills"] as const,
    snailDen: ["snail-den"] as const,
    mcps: (root?: string) => ["meta", "mcps", root] as const,
    roles: ["roles"] as const,
  },
} as const;
