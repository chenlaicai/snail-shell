/**
 * 输入框草稿 localStorage 持久化工具
 *
 * 用于在页面刷新后恢复用户未发送的输入内容。
 * 存储 key: snail:input_drafts
 * 数据结构: Record<string, DraftData>，key 为 issueId
 */

const STORAGE_KEY = "snail:input_drafts";

interface DraftData {
  content: string;
  updatedAt: string; // ISO timestamp
}

function readAll(): Record<string, DraftData> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, DraftData>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage 满或不可用时静默失败，不阻塞用户输入
  }
}

/** 保存草稿到 localStorage */
export function saveDraft(issueId: string, content: string): void {
  const all = readAll();
  all[issueId] = { content, updatedAt: new Date().toISOString() };
  writeAll(all);
}

/** 获取指定 Issue 的草稿内容 */
export function getDraft(issueId: string): string | null {
  const all = readAll();
  return all[issueId]?.content ?? null;
}

/** 删除指定 Issue 的草稿 */
export function removeDraft(issueId: string): void {
  const all = readAll();
  delete all[issueId];
  writeAll(all);
}
