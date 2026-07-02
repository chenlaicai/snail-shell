import { queryOptions } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "./keys";

export const scheduledTaskQueries = {
  list: () =>
    queryOptions({
      queryKey: queryKeys.scheduledTasks.list,
      queryFn: () => api("GET /api/scheduled-tasks"),
    }),

  executions: (taskId: string) =>
    queryOptions({
      queryKey: queryKeys.scheduledTasks.executions(taskId),
      queryFn: () => api("GET /api/scheduled-tasks/:id/executions", { params: { id: taskId } }),
      enabled: !!taskId,
    }),
};
