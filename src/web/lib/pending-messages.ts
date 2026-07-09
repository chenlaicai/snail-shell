/**
 * Pending 消息 localStorage 持久化工具
 *
 * 用于在页面刷新或 SPA 导航时保留正在发送或发送失败的消息。
 * 存储 key: snail:pending_messages
 * 数据结构: Record<string, PendingMessage>，key 格式: ${stageId}:${id}
 */

const STORAGE_KEY = "snail:pending_messages";

export interface PendingMessage {
  /** 乐观 ID（负数，避免与服务端正整数 ID 冲突） */
  id: number;
  stageId: string;
  content: string;
  toSpeakers?: string[];
  createdAt: string; // ISO timestamp
  status: "sending" | "failed";
  /** 前端生成的稳定标识，用于虚拟列表 key（乐观消息和服务端消息保持一致） */
  clientId?: string;
}

function readAll(): Record<string, PendingMessage> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, PendingMessage>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * 生成乐观 ID：负数，确保不与服务端自增正整数 ID 冲突。
 * 取值范围 ≈ -2^53 ~ -1，在 JS 安全整数范围内。
 */
export function generateOptimisticId(): number {
  return -(Date.now() * 1000 + Math.floor(Math.random() * 1000));
}

/** 保存 pending 消息到 localStorage */
export function savePendingMessage(msg: PendingMessage): void {
  const all = readAll();
  all[`${msg.stageId}:${msg.id}`] = msg;
  writeAll(all);
}

/** 删除 pending 消息（发送成功后调用） */
export function removePendingMessage(stageId: string, id: number): void {
  const all = readAll();
  delete all[`${stageId}:${id}`];
  writeAll(all);
}

/** 标记 pending 消息为失败 */
export function markPendingMessageFailed(stageId: string, id: number): void {
  const all = readAll();
  const key = `${stageId}:${id}`;
  if (all[key]) {
    all[key].status = "failed";
    writeAll(all);
  }
}

/** 获取指定 stageId 的所有 pending 消息 */
export function getPendingMessages(stageId: string): PendingMessage[] {
  const all = readAll();
  return Object.values(all).filter((msg) => msg.stageId === stageId);
}

/** 清除指定 stageId 的所有 pending 消息 */
export function clearPendingMessages(stageId: string): void {
  const all = readAll();
  for (const key of Object.keys(all)) {
    if (all[key].stageId === stageId) {
      delete all[key];
    }
  }
  writeAll(all);
}
