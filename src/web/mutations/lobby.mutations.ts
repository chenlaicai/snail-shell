import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "../queries/keys";

export function useResetLobbySession(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("POST /api/lobby/sessions/:sessionId/reset", { params: { sessionId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.lobby.sessions });
      qc.invalidateQueries({ queryKey: queryKeys.lobby.session(sessionId) });
    },
  });
}

export function useDeleteLobbySession(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("DELETE /api/lobby/sessions/:sessionId", { params: { sessionId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.lobby.sessions });
    },
  });
}
