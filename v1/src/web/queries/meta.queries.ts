import { queryOptions } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "./keys";

export const metaQueries = {
  prompts: () =>
    queryOptions({
      queryKey: queryKeys.meta.prompts,
      queryFn: () => api("GET /api/meta/prompts"),
    }),

  skills: () =>
    queryOptions({
      queryKey: queryKeys.meta.skills,
      queryFn: () => api("GET /api/meta/skills"),
    }),

  mcps: (workspaceRoot?: string) =>
    queryOptions({
      queryKey: queryKeys.meta.mcps(workspaceRoot),
      queryFn: () => api("GET /api/meta/mcps", { query: workspaceRoot ? { workspace_root: workspaceRoot } : undefined }),
    }),

  snailDen: () =>
    queryOptions({
      queryKey: queryKeys.meta.snailDen,
      queryFn: () => api("GET /api/snail-den"),
    }),
};
