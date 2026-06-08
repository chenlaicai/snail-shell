/**
 * Snail 域公开类型。
 *
 * 本文件只定义 snail 编排层的类型（模板配置、会话管理）。
 * Agent 启动规格和运行时契约在 acs/types.ts。
 */

import type { AgentRuntime } from '@/snail/acs/types.js';

// ═══════════════════════════════════════════════════════════
// Snail 模板（配置数据）
// ═══════════════════════════════════════════════════════════

/** Snail 模板（来自 snail-den.json，模板池中的配置元数据） */
export interface SnailTemplate {
  /** 模板唯一标识符 */
  id: string;
  /** 模板名称 */
  name: string;
  /** 运行时类型 */
  runtime: AgentRuntime;
  /** 模型标识符 */
  model: string;
  /** 上下文提供者类型 */
  context_provider?: string;
  /** 上下文窗口大小（token 数） */
  context_window?: number;
  /** 单次调用超时时间（毫秒） */
  invocation_timeout_ms?: number;
  /** 模板功能描述 */
  description?: string;
}

// ═══════════════════════════════════════════════════════════
// Agent 会话
// ═══════════════════════════════════════════════════════════

/** Agent 会话（绑定到 conversation + role 的运行时会话实例） */
export interface AgentSession {
  /** 会话 ID */
  id: string;
  /** 绑定的对话 ID */
  conversation_id: string;
  /** 绑定的角色 key */
  role_key: string;
  /** 运行时类型 */
  runtime: AgentRuntime;
  /** 外部运行时会话 ID（用于有状态会话恢复） */
  external_session_id?: string;
  /** 交接来源会话 ID（会话链） */
  handoff_from_id?: string;
  /** 创建时间 */
  created_at: string;
}
