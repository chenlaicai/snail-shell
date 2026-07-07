import { queryOptions } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "./keys";

export const issueTemplateQueries = {
  list: () =>
    queryOptions({
      queryKey: queryKeys.issueTemplates.all,
      queryFn: () => api("GET /api/issue-templates"),
    }),

  executions: (templateId: string) =>
    queryOptions({
      queryKey: queryKeys.issueTemplates.executions(templateId),
      queryFn: () => api("GET /api/issue-templates/:id/executions", { params: { id: templateId } }),
    }),

  children: (templateId: string) =>
    queryOptions({
      queryKey: queryKeys.issueTemplates.children(templateId),
      queryFn: () => api("GET /api/issue-templates/:id/children", { params: { id: templateId } }),
    }),
};
