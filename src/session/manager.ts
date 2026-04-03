import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { Agent, AgentMessage, AgentEvent } from "../agent/interface";
import { ConversationStore, Message, Requirement } from "../persistence/store";
import { SkillRegistry, SkillContext, SkillResult } from "../skills";
import { log } from "../main";

export interface SessionInfo {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export class SessionManager extends EventEmitter {
  constructor(
    private store: ConversationStore,
    private agent: Agent,
    private skillRegistry: SkillRegistry
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
      let assistantMessageId: number | null = null;

      const reply = await this.agent.chatStream(
        agentMessages,
        (event: AgentEvent) => {
          this.emit("agent-event", sessionId, event);
          if (event.type === "text") {
            fullReply += event.content;
            // Save streaming text content to database
            // Create or update the assistant message
            if (assistantMessageId === null) {
              // Create initial assistant message
              const msg = this.store.addMessage(sessionId, "assistant", fullReply);
              assistantMessageId = msg.id;
            } else {
              // Update existing message
              this.store.updateMessage(assistantMessageId, fullReply);
            }
          } else if (event.type === "result") {
            fullReply = event.content;
            // Update the message with the final result
            if (assistantMessageId !== null) {
              this.store.updateMessage(assistantMessageId, fullReply);
            }
          } else if (event.type === "tool_use") {
            // With bypassPermissions mode, tools are automatically allowed
            // Still emit tool_use event for UI display
            // No permission request needed
          }
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


  deleteSession(id: string): void {
    this.store.deleteSession(id);
  }

  getHistory(sessionId: string, limit = 100, offset = 0): Message[] {
    return this.store.getMessages(sessionId, limit, offset);
  }

  // Requirement management methods
  createRequirement(sessionId: string, title: string, description?: string): Requirement {
    return this.store.createRequirement(sessionId, title, description);
  }

  getRequirement(id: number): Requirement | null {
    return this.store.getRequirement(id) || null;
  }

  listRequirements(sessionId: string, limit = 50, offset = 0): Requirement[] {
    return this.store.listRequirements(sessionId, limit, offset);
  }

  updateRequirementStatus(id: number, status: Requirement["status"]): void {
    this.store.updateRequirementStatus(id, status);
  }

  updateRequirementCommit(id: number, commitHash: string): void {
    this.store.updateRequirementCommit(id, commitHash);
  }

  deleteRequirement(id: number): void {
    this.store.deleteRequirement(id);
  }

  // Skill execution
  async executeSkill(sessionId: string, skillName: string, args: Record<string, any>): Promise<SkillResult> {
    const context: SkillContext = {
      sessionId,
      sessionManager: this,
    };
    return await this.skillRegistry.execute(skillName, context, args);
  }

  listSkills(): { name: string; description: string }[] {
    return this.skillRegistry.listSkills();
  }
}
