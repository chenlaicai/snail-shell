/**
 * useMention - @mention 系统
 *
 * 实现原 composer.js 的 mention 逻辑：
 * - 输入 @ 时显示角色建议
 * - 键盘/点击选择角色
 * - 替换 @query 为 @rolename
 */

import { useState, useCallback, useRef } from "react";

interface Role {
  name: string;
  description?: string;
}

interface MentionState {
  active: boolean;
  start: number;
  end: number;
  query: string;
  suggestions: Role[];
  selectedIndex: number;
}

const INITIAL_STATE: MentionState = {
  active: false, start: -1, end: -1, query: "", suggestions: [], selectedIndex: 0,
};

/** 从输入值中提取 @mention 查询 */
function extractMentionQuery(value: string, caret: number): { start: number; query: string } | null {
  const mentionStart = value.lastIndexOf("@", caret - 1);
  if (mentionStart === -1) return null;
  const prefix = value.slice(0, mentionStart);
  if (prefix && !/[\s\n]$/.test(prefix)) return null;
  const tail = value.slice(mentionStart + 1);
  const queryMatch = tail.match(/^(\S*)/);
  return { start: mentionStart, query: queryMatch ? queryMatch[1] : "" };
}

/** 应用 mention 选择到输入框 */
function applyMentionToInput(
  input: HTMLTextAreaElement,
  mentionState: MentionState,
  role: Role,
): void {
  const value = input.value;
  const before = value.slice(0, mentionState.start);
  const after = value.slice(mentionState.end).replace(/^\s*/, "");
  const newValue = `${before}@${role.name}${after ? ` ${after}` : " "}`;
  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype, "value"
  )?.set;
  nativeSetter?.call(input, newValue);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  const cursorPos = mentionState.start + role.name.length + 2;
  input.setSelectionRange(cursorPos, cursorPos);
}

interface FilterAndUpdateOptions {
  query: { start: number; query: string };
  availableRoles: Role[];
  setMentionState: (state: MentionState) => void;
  setMentionStatus: (status: string) => void;
  hideSuggestions: () => void;
}

/** 根据查询过滤角色并更新状态 */
function filterAndUpdate(options: FilterAndUpdateOptions): void {
  const { query, availableRoles, setMentionState, setMentionStatus, hideSuggestions } = options;
  const filtered = availableRoles.filter((r) =>
    r.name.toLowerCase().includes(query.query.toLowerCase())
  );
  if (filtered.length === 0) {
    hideSuggestions();
    setMentionStatus("无匹配角色");
    return;
  }
  setMentionState({
    active: true, start: query.start, end: query.start + 1 + query.query.length,
    query: query.query, suggestions: filtered, selectedIndex: 0,
  });
  setMentionStatus(`@${query.query || "..."}`);
}

export function useMention(availableRoles: Role[]) {
  const [mentionState, setMentionState] = useState<MentionState>(INITIAL_STATE);
  const [mentionStatus, setMentionStatus] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const hideSuggestions = useCallback(() => {
    setMentionState((prev) => ({ ...prev, active: false, suggestions: [], selectedIndex: 0 }));
  }, []);

  const moveSelection = useCallback((delta: number) => {
    setMentionState((prev) => ({
      ...prev,
      selectedIndex: (prev.selectedIndex + delta + prev.suggestions.length) % prev.suggestions.length,
    }));
  }, []);

  const applySelection = useCallback((index?: number) => {
    const input = inputRef.current;
    if (!input) return;
    const idx = index ?? mentionState.selectedIndex;
    const role = mentionState.suggestions[idx];
    if (!role) return;
    applyMentionToInput(input, mentionState, role);
    hideSuggestions();
    setMentionStatus(`当前将发给 ${role.name}`);
  }, [mentionState, hideSuggestions]);

  const updateMention = useCallback((nextValue?: string, nextCaret?: number) => {
    const input = inputRef.current;
    const value = nextValue ?? input?.value ?? "";
    const caret = nextCaret ?? input?.selectionStart ?? value.length;
    const mention = extractMentionQuery(value, caret);
    if (!mention) {
      hideSuggestions();
      setMentionStatus(availableRoles.length ? `可 @ ${availableRoles.map((r) => r.name).join(" / ")}` : "");
      return;
    }
    filterAndUpdate({ query: mention, availableRoles, setMentionState, setMentionStatus, hideSuggestions });
  }, [availableRoles, hideSuggestions]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!mentionState.active || mentionState.suggestions.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); moveSelection(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveSelection(-1); }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); applySelection(); }
    else if (e.key === "Escape") { e.preventDefault(); hideSuggestions(); }
  }, [mentionState, moveSelection, applySelection, hideSuggestions]);

  return {
    mentionState, mentionStatus, inputRef,
    updateMention, hideSuggestions, moveSelection, applySelection, handleKeyDown,
    isMentionActive: mentionState.active && mentionState.suggestions.length > 0,
  };
}
