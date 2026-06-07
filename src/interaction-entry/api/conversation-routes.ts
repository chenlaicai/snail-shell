import type express from "express";
import { HUMAN_ROLE_NAME } from "../../shared/domain-types";
import type { WorkspaceManager } from "../../workspace-workflow/manager";
import type { ConversationGateway } from "../gateway";
import type { ConversationStore } from "../../persistence/store";
import { isRoleName } from "./validation";
import { permissionStore } from "../../agent/permission-store";
import { logger } from "../../logger";

export function registerConversationRoutes(router: express.Router, workspaceManager: WorkspaceManager, conversationGateway: ConversationGateway, store: ConversationStore): void {
  router.get("/conversations/:conversationId", (req, res) => {
    const conversation = workspaceManager.getConversation(req.params.conversationId);
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    res.json(conversation);
  });

  registerConversationMessageReadRoutes(router, workspaceManager);
  registerConversationMessageWriteRoutes(router, workspaceManager, conversationGateway, store);

  // Role routes
  router.get("/roles", (_req, res) => {
    res.json(workspaceManager.listRoles());
  });
}

function registerConversationMessageReadRoutes(router: express.Router, workspaceManager: WorkspaceManager): void {
  router.get("/conversations/:conversationId/messages", (req, res) => {
    const limit = Number(req.query.limit) || 100;
    const offset = Number(req.query.offset) || 0;
    res.json(workspaceManager.getConversationMessages(req.params.conversationId, limit, offset));
  });

  router.get("/conversations/:conversationId/messages/page", (req, res) => {
    const limit = Number(req.query.limit) || 10;
    const offset = Number(req.query.offset) || 0;
    const before = req.query.before ? Number(req.query.before) : undefined;
    res.json(workspaceManager.getConversationMessagesPage(req.params.conversationId, { limit, offset, before }));
  });

  router.get("/conversations/:conversationId/messages/recent", (req, res) => {
    const limit = Number(req.query.limit) || 5;
    res.json(workspaceManager.getRecentConversationMessages(req.params.conversationId, limit));
  });

  router.get("/conversations/:conversationId/events", (req, res) => {
    const afterEventId = Number(req.query.after_event_id) || 0;
    res.json({ items: workspaceManager.getConversationEventsAfter(req.params.conversationId, afterEventId) });
  });

  router.post("/conversations/:conversationId/messages/by-ids", (req, res) => {
    const messageIds = Array.isArray(req.body?.message_ids)
      ? req.body.message_ids.map((value: unknown) => Number(value)).filter((value: number) => Number.isInteger(value))
      : [];
    if (messageIds.length === 0) {
      res.status(400).json({ error: "message_ids is required" });
      return;
    }
    res.json(workspaceManager.getConversationMessagesByIds(req.params.conversationId, messageIds));
  });

  router.get("/conversations/:conversationId/messages/window", (req, res) => {
    const anchorMessageId = Number(req.query.anchor_message_id);
    if (!Number.isInteger(anchorMessageId)) {
      res.status(400).json({ error: "anchor_message_id is required" });
      return;
    }
    const before = Number(req.query.before) || 2;
    const after = Number(req.query.after) || 2;
    res.json(workspaceManager.getConversationMessageWindow(req.params.conversationId, anchorMessageId, before, after));
  });

  router.get("/conversations/:conversationId/dispatch-state", (req, res) => {
    try {
      res.json(workspaceManager.getConversationDispatchState(req.params.conversationId));
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.get("/conversations/:conversationId/boss-mentions", (req, res) => {
    try {
      res.json(workspaceManager.getBossMentions(req.params.conversationId));
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.post("/conversations/:conversationId/boss-mentions/ack", (req, res) => {
    try {
      res.json(workspaceManager.acknowledgeBossMentions(req.params.conversationId));
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.get("/conversations/:conversationId/history/search", (req, res) => {
    const query = typeof req.query.query === "string" ? req.query.query : "";
    if (!query.trim()) {
      res.status(400).json({ error: "query is required" });
      return;
    }
    const limit = Number(req.query.limit) || 5;
    const offset = Number(req.query.offset) || 0;
    res.json(workspaceManager.searchConversationHistory(req.params.conversationId, query, limit, offset));
  });
}

function registerConversationMessageWriteRoutes(router: express.Router, workspaceManager: WorkspaceManager, conversationGateway: ConversationGateway, store: ConversationStore): void {
  router.post("/conversations/:conversationId/messages/:messageId/interrupt", (req, res) => {
    try {
      const messageId = Number(req.params.messageId);
      if (!Number.isInteger(messageId)) {
        res.status(400).json({ error: "message_id must be an integer" });
        return;
      }
      res.json(workspaceManager.interruptMessage(req.params.conversationId, messageId));
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  router.post("/conversations/:conversationId/messages/:messageId/approve-tool", createApproveToolHandler(workspaceManager, store));

  router.post("/conversations/:conversationId/messages", async (req, res) => {
    const { content, events, from_role, producer_role, quoted_message_id, asker_role, client_id } = req.body ?? {};
    const fromRole = from_role ?? producer_role ?? HUMAN_ROLE_NAME;
    const askerRole = typeof asker_role === "string" && isRoleName(asker_role)
      ? asker_role
      : null;
    try {
      logger.debug("Conversation message request", { conversationId: req.params.conversationId });
      const result = await conversationGateway.sendMessage(req.params.conversationId, {
        content,
        events,
        fromRole,
        quotedMessageId: quoted_message_id,
        askerRole,
        clientId: client_id,
      });
      if ("error" in result) {
        res.status(400).json({ error: result.error.message, hint: result.error.hint });
        return;
      }
      res.json(result);
    } catch (err: any) {
      logger.error("Conversation message failed", { conversationId: req.params.conversationId, error: err.message, stack: err.stack });
      res.status(500).json({ error: err.message });
    }
  });
}

function createApproveToolHandler(workspaceManager: WorkspaceManager, store: ConversationStore): express.RequestHandler {
  return async (req, res) => {
    try {
      const conversationId = req.params.conversationId as string;
      const messageId = Number(req.params.messageId as string);
      if (!Number.isInteger(messageId)) {
        res.status(400).json({ error: "message_id must be an integer" });
        return;
      }
      const { approved } = req.body ?? {};
      if (typeof approved !== "boolean") {
        res.status(400).json({ error: "approved must be a boolean" });
        return;
      }

      const pending = permissionStore.get(conversationId, messageId);
      if (!pending) {
        res.status(404).json({ error: "Permission request not found or expired" });
        return;
      }

      if (!approved) {
        store.updateMessageStatus(messageId, "failed");
        permissionStore.delete(conversationId, messageId);
        res.json({ approved: false, status: "denied" });
        return;
      }

      // 批准：重新发送原用户消息触发 agent retry
      // bypassPermissions + disallowedTools 模式下，deny list 通过 CLI 静态传入，
      // 不在 deny list 中的命令自动放行，无需 extraAllow 机制

      // 查找原用户消息事件，重新发送以触发 agent retry
      const originalMsg = store.getMessage(pending.originalUserMessageId, conversationId);
      if (originalMsg) {
        const originalEvents = store.getMessageEvents(pending.originalUserMessageId);
        const textEvents = originalEvents
          .filter((evt) => evt.kind === "text" || evt.kind === "content_block")
          .map((evt) => ({ kind: evt.kind, payload: evt.payload, source: evt.source } as any));
        if (textEvents.length > 0) {
          await workspaceManager.sendStructuredMessage(
            conversationId,
            textEvents,
            { fromRole: pending.originalFromRole || pending.originalRoleName || HUMAN_ROLE_NAME }
          );
        }
      }

      permissionStore.delete(conversationId, messageId);
      res.json({ approved: true, status: "retrying" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
}
