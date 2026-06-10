import fs from "fs";
import path from "path";
import type {
  SnailTemplate,
  SnailAgentSession,
  CreateSnailAgentSessionInput,
} from "@domain/snail/model";
import type { FileSystem } from "@infra/file-system";

/** Snail 持久层接口 */
export interface SnailRepository {
  listTemplates(): SnailTemplate[];
  findTemplateById(id: string): SnailTemplate | undefined;
  findCurrentSession(conversationId: string, roleName: string): SnailAgentSession | undefined;
  createSession(input: CreateSnailAgentSessionInput): SnailAgentSession;
  updateSessionExternalId(sessionId: string, externalSessionId: string): void;
}

/** Snail 文件存储实现 */
export class FileSnailRepository implements SnailRepository {
  private templates = new Map<string, SnailTemplate>();
  private sessions = new Map<string, SnailAgentSession>();
  private nextSessionId = 1;

  constructor(private fileSystem: FileSystem, repoRoot: string) {
    this.loadTemplates(repoRoot);
  }

  listTemplates(): SnailTemplate[] {
    return [...this.templates.values()];
  }

  findTemplateById(id: string): SnailTemplate | undefined {
    return this.templates.get(id);
  }

  findCurrentSession(conversationId: string, roleName: string): SnailAgentSession | undefined {
    // 查找最新的 session
    const sessions = [...this.sessions.values()]
      .filter(s => s.conversation_id === conversationId && s.role_name === roleName)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    return sessions[0];
  }

  createSession(input: CreateSnailAgentSessionInput): SnailAgentSession {
    const id = `session-${this.nextSessionId++}`;
    const now = new Date().toISOString();

    const session: SnailAgentSession = {
      id,
      conversation_id: input.conversation_id,
      role_name: input.role_name,
      runtime: input.runtime,
      model: input.model,
      context_provider: input.context_provider,
      external_session_id: input.external_session_id ?? null,
      handoff_from_id: input.handoff_from_id ?? null,
      created_at: now,
    };

    this.sessions.set(session.id, session);
    return session;
  }

  updateSessionExternalId(sessionId: string, externalSessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    session.external_session_id = externalSessionId;
  }

  private loadTemplates(repoRoot: string): void {
    const configPath = path.join(repoRoot, "config", "snail-den.json");
    const raw = this.fileSystem.readJson<{ snails: SnailTemplate[] }>(configPath);

    if (!raw?.snails) return;

    for (const template of raw.snails) {
      this.templates.set(template.id, template);
    }
  }
}
