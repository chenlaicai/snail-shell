import { api } from "../services/api-client";
import { queryKeys } from "./keys";

export const lobbyQueries = {
  sessions: () => ({
    queryKey: queryKeys.lobby.sessions,
    queryFn: () => api("GET /api/lobby/sessions"),
  }),
  session: (id: string) => ({
    queryKey: queryKeys.lobby.session(id),
    queryFn: () => api("GET /api/lobby/sessions/:sessionId", { params: { sessionId: id } }),
  }),
  messages: (id: string) => ({
    queryKey: queryKeys.lobby.messages(id),
    queryFn: () => api("GET /api/lobby/sessions/:sessionId/messages", { params: { sessionId: id } }),
  }),
};

export const roleQueries = {
  all: () => ({
    queryKey: queryKeys.meta.roles,
    queryFn: () => api("GET /api/roles"),
  }),
};
