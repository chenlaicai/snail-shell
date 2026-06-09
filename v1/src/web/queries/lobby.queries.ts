import { queryOptions } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "./keys";

export const lobbyQueries = {
  sessions: () =>
    queryOptions({
      queryKey: queryKeys.lobby.sessions,
      queryFn: () => api("GET /api/lobby/sessions"),
    }),

  detail: (sessionId: string) =>
    queryOptions({
      queryKey: queryKeys.lobby.detail(sessionId),
      queryFn: () => api("GET /api/lobby/sessions/:sessionId", { params: { sessionId } }),
    }),
};
