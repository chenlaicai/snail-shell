import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "../queries/keys";
import type { CreateScheduledTaskBody, UpdateScheduledTaskBody } from "@/types";

export function useCreateScheduledTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateScheduledTaskBody) => api("POST /api/scheduled-tasks", { body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.scheduledTasks.all }); },
  });
}

export function useUpdateScheduledTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & UpdateScheduledTaskBody) =>
      api("PUT /api/scheduled-tasks/:id", { params: { id }, body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.scheduledTasks.all }); },
  });
}

export function useDeleteScheduledTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api("DELETE /api/scheduled-tasks/:id", { params: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.scheduledTasks.all }); },
  });
}
