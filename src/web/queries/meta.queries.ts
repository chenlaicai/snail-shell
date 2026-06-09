import { api } from "../services/api-client";
import { queryKeys } from "./keys";

export const metaQueries = {
  prompts: () => ({
    queryKey: queryKeys.meta.prompts,
    queryFn: () => api("GET /api/meta/prompts"),
  }),
  skills: () => ({
    queryKey: queryKeys.meta.skills,
    queryFn: () => api("GET /api/meta/skills"),
  }),
  snailDen: () => ({
    queryKey: queryKeys.meta.snailDen,
    queryFn: () => api("GET /api/snail-den"),
  }),
  mcps: (workspaceRoot?: string) => ({
    queryKey: queryKeys.meta.mcps(workspaceRoot),
    queryFn: () => api("GET /api/meta/mcps", { query: workspaceRoot ? { workspace_root: workspaceRoot } : undefined }),
  }),
  roles: () => ({
    queryKey: queryKeys.meta.roles,
    queryFn: () => api("GET /api/roles"),
  }),
};
