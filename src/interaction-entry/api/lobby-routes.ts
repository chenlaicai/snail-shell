import type express from "express";
import type { LobbySessionStore } from "../../lobby/session-store";

export function registerLobbyRoutes(router: express.Router, sessionStore: LobbySessionStore): void {
  /** 列出所有大厅会话 */
  router.get("/lobby/sessions", (_req, res) => {
    res.json(sessionStore.listAll());
  });

  /** 获取会话详情 + 最近消息 */
  router.get("/lobby/sessions/:sessionId", (req, res) => {
    const session = sessionStore.get(req.params.sessionId);
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }
    const messages = sessionStore.getMessages(session.id, 50);
    res.json({ session, messages });
  });

  /** 分页获取大厅消息 */
  router.get("/lobby/sessions/:sessionId/messages", (req, res) => {
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    res.json(sessionStore.getMessages(req.params.sessionId, limit, offset));
  });

  /** 重置会话到大厅根 */
  router.post("/lobby/sessions/:sessionId/reset", (req, res) => {
    try {
      const session = sessionStore.updateNavigation(req.params.sessionId, {
        navigation_level: "lobby",
        current_project_id: null,
        current_feature_id: null,
        current_stage_id: null,
        current_conversation_id: null,
      });
      res.json(session);
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** 删除会话 */
  router.delete("/lobby/sessions/:sessionId", (req, res) => {
    sessionStore.delete(req.params.sessionId);
    res.status(204).send();
  });
}
