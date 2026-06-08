/**
 * Snail Repo — 文件实现（Snail 模板池）+ DB 实现（AgentSession）。
 *
 * 模板数据来源：config/snail-den.json
 * 会话数据来源：DB agent_session 表
 */

import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { SnailTemplate, AgentSession } from '@/snail/types.js';
import type { AgentRuntime } from '@/snail/acs/types.js';

export class SnailRepo {
  private templates: SnailTemplate[] | null = null;

  constructor(
    private configDir: string,
    private db: Database.Database,
  ) {}

  // ─── 模板（文件实现） ───

  /** 列出所有 Snail 模板 */
  listTemplates(): SnailTemplate[] {
    if (!this.templates) {
      const filePath = path.join(this.configDir, 'snail-den.json');
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      this.templates = (data.templates ?? []) as SnailTemplate[];
    }
    return this.templates;
  }

  /** 按 ID 获取模板 */
  getTemplate(id: string): SnailTemplate | undefined {
    return this.listTemplates().find(t => t.id === id);
  }

  // ─── 会话（DB 实现） ───

  /** 获取会话 */
  getSessionById(id: string): AgentSession | undefined {
    const row = this.db.prepare('SELECT * FROM agent_session WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.parseSession(row) : undefined;
  }

  /** 获取指定对话+角色的最新会话 */
  getLatestSession(conversationId: string, roleKey: string): AgentSession | undefined {
    const row = this.db.prepare(
      'SELECT * FROM agent_session WHERE conversation_id = ? AND role_key = ? ORDER BY created_at DESC LIMIT 1'
    ).get(conversationId, roleKey) as Record<string, unknown> | undefined;
    return row ? this.parseSession(row) : undefined;
  }

  /** 创建会话 */
  createSession(session: AgentSession): void {
    this.db.prepare(`
      INSERT INTO agent_session (id, conversation_id, role_key, runtime, external_session_id, handoff_from_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id,
      session.conversation_id,
      session.role_key,
      session.runtime,
      session.external_session_id ?? null,
      session.handoff_from_id ?? null,
      session.created_at,
    );
  }

  private parseSession(row: Record<string, unknown>): AgentSession {
    return {
      id: row.id as string,
      conversation_id: row.conversation_id as string,
      role_key: row.role_key as string,
      runtime: row.runtime as AgentRuntime,
      external_session_id: row.external_session_id as string | undefined,
      handoff_from_id: row.handoff_from_id as string | undefined,
      created_at: row.created_at as string,
    };
  }
}
