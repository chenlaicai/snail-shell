import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { Agent, AgentMessage, AgentEvent, ToolPermissionRequest, PermissionDecision } from "../agent/interface";
import { ConversationStore, Message } from "../persistence/store";

export interface SessionInfo {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export class SessionManager extends EventEmitter {
  private pendingPermissions = new Map<string, {
    sessionId: string;
    request: ToolPermissionRequest;
    resolve: (decision: PermissionDecision) => void;
  }>();

  constructor(
    private store: ConversationStore,
    private agent: Agent
  ) {
    super();
  }

  createSession(title?: string): { id: string } {
    const id = randomUUID();
    this.store.createSession(id, title);
    return { id };
  }

  getSession(id: string): SessionInfo | null {
    const session = this.store.getSession(id);
    if (!session) return null;
    const messages = this.store.getMessages(id);
    return { ...session, message_count: messages.length };
  }

  listSessions(limit = 50, offset = 0): SessionInfo[] {
    return this.store.listSessions(limit, offset).map((s) => {
      const messages = this.store.getMessages(s.id);
      return { ...s, message_count: messages.length };
    });
  }

  async sendMessage(sessionId: string, userContent: string): Promise<{ reply: string }> {
    const session = this.store.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.store.addMessage(sessionId, "user", userContent);

    const history = this.store.getMessages(sessionId);
    const agentMessages: AgentMessage[] = history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    if (this.agent.chatStream) {
      let fullReply = "";

      const reply = await this.agent.chatStream(
        agentMessages,
        (event: AgentEvent) => {
          this.emit("agent-event", sessionId, event);
          if (event.type === "text") {
            fullReply += event.content;
          } else if (event.type === "result") {
            fullReply = event.content;
          }
        },
        async (request: ToolPermissionRequest): Promise<PermissionDecision> => {
          return new Promise<PermissionDecision>((resolve) => {
            this.pendingPermissions.set(request.tool_use_id, {
              sessionId,
              request,
              resolve,
            });
            this.emit("permission-required", sessionId, request);
          });
        }
      );

      this.store.addMessage(sessionId, "assistant", reply.content);
      return { reply: reply.content };
    }

    // Fallback to simple chat
    const reply = await this.agent.chat(agentMessages);
    this.store.addMessage(sessionId, "assistant", reply.content);
    return { reply: reply.content };
  }

  respondToPermission(toolUseId: string, decision: PermissionDecision): boolean {
    const pending = this.pendingPermissions.get(toolUseId);
    if (!pending) return false;
    this.pendingPermissions.delete(toolUseId);
    pending.resolve(decision);
    return true;
  }

  deleteSession(id: string): void {
    this.store.deleteSession(id);
  }

  getHistory(sessionId: string, limit = 100, offset = 0): Message[] {
    return this.store.getMessages(sessionId, limit, offset);
  }
}
