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

export function useMention(availableRoles: Role[]) {
  const [mentionState, setMentionState] = useState<MentionState>({
    active: false,
    start: -1,
    end: -1,
    query: "",
    suggestions: [],
    selectedIndex: 0,
  });
  const [mentionStatus, setMentionStatus] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 检测 @mention 并更新建议
  const updateMention = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;

    const value = input.value;
    const caret = input.selectionStart ?? value.length;
    const mentionStart = value.lastIndexOf("@", caret - 1);

    if (mentionStart === -1) {
      hideSuggestions();
      setMentionStatus(availableRoles.length ? `可 @ ${availableRoles.map((r) => r.name).join(" / ")}` : "");
      return;
    }

    // @ 前面必须是空白或行首
    const prefix = value.slice(0, mentionStart);
    if (prefix && !/[\s\n]$/.test(prefix)) {
      hideSuggestions();
      setMentionStatus(availableRoles.length ? `可 @ ${availableRoles.map((r) => r.name).join(" / ")}` : "");
      return;
    }

    const tail = value.slice(mentionStart + 1);
    const queryMatch = tail.match(/^(\S*)/);
    const query = queryMatch ? queryMatch[1] : "";
    const queryEnd = mentionStart + 1 + query.length;

    const filtered = availableRoles.filter((r) =>
      r.name.toLowerCase().includes(query.toLowerCase())
    );

    if (filtered.length === 0) {
      hideSuggestions();
      setMentionStatus("无匹配角色");
      return;
    }

    setMentionState({
      active: true,
      start: mentionStart,
      end: queryEnd,
      query,
      suggestions: filtered,
      selectedIndex: 0,
    });
    setMentionStatus(`@${query || "..."}`);
  }, [availableRoles]);

  // 隐藏建议
  const hideSuggestions = useCallback(() => {
    setMentionState((prev) => ({
      ...prev,
      active: false,
      suggestions: [],
      selectedIndex: 0,
    }));
  }, []);

  // 键盘导航
  const moveSelection = useCallback((delta: number) => {
    setMentionState((prev) => ({
      ...prev,
      selectedIndex: (prev.selectedIndex + delta + prev.suggestions.length) % prev.suggestions.length,
    }));
  }, []);

  // 应用选中的 mention
  const applySelection = useCallback((index?: number) => {
    const input = inputRef.current;
    if (!input) return;

    const idx = index ?? mentionState.selectedIndex;
    const role = mentionState.suggestions[idx];
    if (!role) return;

    const value = input.value;
    const before = value.slice(0, mentionState.start);
    const after = value.slice(mentionState.end).replace(/^\s*/, "");
    const newValue = `${before}@${role.name}${after ? ` ${after}` : " "}`;

    // 使用 nativeInputValueSetter 确保 React 受控组件更新
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype, "value"
    )?.set;
    nativeSetter?.call(input, newValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // 移动光标到 mention 之后
    const cursorPos = mentionState.start + role.name.length + 2;
    input.setSelectionRange(cursorPos, cursorPos);

    hideSuggestions();
    setMentionStatus(`当前将发给 ${role.name}`);
  }, [mentionState, hideSuggestions]);

  // 键盘事件处理
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!mentionState.active || mentionState.suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelection(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(-1);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      applySelection();
    } else if (e.key === "Escape") {
      e.preventDefault();
      hideSuggestions();
    }
  }, [mentionState, moveSelection, applySelection, hideSuggestions]);

  return {
    mentionState,
    mentionStatus,
    inputRef,
    updateMention,
    hideSuggestions,
    moveSelection,
    applySelection,
    handleKeyDown,
    isMentionActive: mentionState.active && mentionState.suggestions.length > 0,
  };
}
