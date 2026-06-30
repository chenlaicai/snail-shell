/**
 * useMention - @mention 自动补全 hook（v2）
 *
 * 适配自 v1 useMention，关键差异：
 * - 不直接操作 DOM（避免 React 受控组件兼容性问题）
 * - 返回 { newValue, cursorPos } 由 ChatInput 调用 setValue 更新
 * - 使用 role_instances（string[]）作为数据源
 */

import { useState, useCallback } from "react";

interface MentionState {
  active: boolean;
  start: number;
  end: number;
  query: string;
  suggestions: string[];
  selectedIndex: number;
}

const INITIAL_STATE: MentionState = {
  active: false, start: -1, end: -1, query: "", suggestions: [], selectedIndex: 0,
};

/** 从输入值中提取光标前最近的 @mention 查询 */
export function extractMentionQuery(value: string, caret: number): { start: number; query: string } | null {
  const mentionStart = value.lastIndexOf("@", caret - 1);
  if (mentionStart === -1) return null;
  /** @ 前必须是行首或空白字符，避免匹配 email 等场景 */
  const prefix = value.slice(0, mentionStart);
  if (prefix && !/[\s\n]$/.test(prefix)) return null;
  const tail = value.slice(mentionStart + 1, caret);
  /** @ 后紧跟空白字符时，视为 mention 已结束（用户已完成输入） */
  if (/^\s/.test(tail)) return null;
  const queryMatch = tail.match(/^[\p{L}\p{N}_][\p{L}\p{N}_-]*/u);
  if (!queryMatch) return null;
  const query = queryMatch[0];
  /** query 后面的字符决定 mention 是否活跃：
   *  - 单词字符（字母/数字/_）→ 光标在单词中间，不属于活跃查询
   *  - 空白 → mention 已完成（如 @alice 后跟空格），不属于活跃查询
   *  - 标点/行尾 → 用户仍在输入，属于活跃查询 */
  const afterQuery = value.charAt(mentionStart + 1 + query.length);
  if (/[\p{L}\p{N}_]/u.test(afterQuery)) return null;
  if (/\s/.test(afterQuery)) return null;
  return { start: mentionStart, query };
}

interface UseMentionOptions {
  roleInstances: string[];
}

interface TextTransform {
  newValue: string;
  cursorPos: number;
  selectedRole: string;
}

/** 计算选择 mention 后的文本变换（纯函数） */
function computeTextTransform(value: string, state: MentionState, index?: number): TextTransform | null {
  const idx = index ?? state.selectedIndex;
  const role = state.suggestions[idx];
  if (!role) return null;
  const before = value.slice(0, state.start);
  /** 移除 @query 后面的空白，避免选择后残留空格 */
  const after = value.slice(state.end).replace(/^\s*/, "");
  const newValue = `${before}@${role} ${after}`;
  const cursorPos = state.start + role.length + 2; // @name + space
  return { newValue, cursorPos, selectedRole: role };
}

/** 根据查询过滤角色并构建新状态（纯函数） */
function filterMentionState(
  query: { start: number; query: string },
  roleInstances: string[],
): MentionState | null {
  const filtered = roleInstances.filter((name) =>
    name.toLowerCase().includes(query.query.toLowerCase())
  );
  if (filtered.length === 0) return null;
  return {
    active: true,
    start: query.start,
    end: query.start + 1 + query.query.length,
    query: query.query,
    suggestions: filtered,
    selectedIndex: 0,
  };
}

export function useMention({ roleInstances }: UseMentionOptions) {
  const [mentionState, setMentionState] = useState<MentionState>(INITIAL_STATE);

  const hideSuggestions = useCallback(() => {
    setMentionState(INITIAL_STATE);
  }, []);

  const moveSelection = useCallback((delta: number) => {
    setMentionState((prev) => ({
      ...prev,
      selectedIndex: (prev.selectedIndex + delta + prev.suggestions.length) % prev.suggestions.length,
    }));
  }, []);

  const computeSelection = useCallback(
    (value: string, index?: number) => computeTextTransform(value, mentionState, index),
    [mentionState],
  );

  /** 检测输入变化，更新 mention 状态 */
  const updateMention = useCallback((value: string, caret: number) => {
    const mention = extractMentionQuery(value, caret);
    if (!mention) { hideSuggestions(); return; }
    const next = filterMentionState(mention, roleInstances);
    if (!next) { hideSuggestions(); return; }
    setMentionState(next);
  }, [roleInstances, hideSuggestions]);

  /**
   * 处理键盘事件
   * 返回 true 表示事件已被消费（调用方应阻止默认行为）
   */
  const handleKeyDown = useCallback((e: React.KeyboardEvent): boolean => {
    if (!mentionState.active || mentionState.suggestions.length === 0) return false;
    if (e.key === "ArrowDown") { e.preventDefault(); moveSelection(1); return true; }
    if (e.key === "ArrowUp") { e.preventDefault(); moveSelection(-1); return true; }
    /** Enter/Tab 确认选择（B4）：调用方需调用 computeSelection 并 setValue */
    /** Shift+Enter 不消费，由 ChatInput 处理发送逻辑（B7） */
    if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") { e.preventDefault(); return true; }
    /** Escape 关闭补全列表（B5） */
    if (e.key === "Escape") { e.preventDefault(); hideSuggestions(); return true; }
    return false;
  }, [mentionState, moveSelection, hideSuggestions]);

  return {
    mentionState, updateMention, hideSuggestions, moveSelection,
    computeSelection, handleKeyDown,
    isMentionActive: mentionState.active && mentionState.suggestions.length > 0,
  };
}
