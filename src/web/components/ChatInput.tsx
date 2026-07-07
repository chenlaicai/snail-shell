import { useState, useRef, useCallback, useEffect } from "react";
import { useMention } from "@/hooks/useMention";
import { MentionDropdown } from "@/components/MentionDropdown";
import { saveDraft, getDraft, removeDraft } from "@/lib/input-drafts";

/**
 * 从文本中提取匹配 role_instances 的 @mention 目标
 *
 * 策略说明：使用全局正则匹配所有 @mention，与 extractMentionQuery（lastIndexOf）策略不同。
 * - extractMentionQuery: 用于 UI 交互，只处理光标前最近的 @（D4 决策：与 GitHub/Slack 一致）
 * - extractToSpeakers: 用于发送时提取所有 @mention，确保消息路由到所有被提及的角色
 */
function extractToSpeakers(text: string, roleInstances: string[]): string[] {
  const matcher = /@([\p{L}\p{N}_-]+)/gu;
  const result: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(text)) !== null) {
    const name = match[1];
    if (roleInstances.includes(name) && !result.includes(name)) {
      result.push(name);
    }
  }
  return result;
}

interface ChatInputProps {
  onSend: (content: string, toSpeakers: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  roleInstances?: string[];
  issueId?: string;
}

export function ChatInput({ onSend, disabled, placeholder = "Reply to this issue...", roleInstances = [], issueId }: ChatInputProps) {
  const [value, setValue] = useState(() => {
    if (issueId) return getDraft(issueId) ?? "";
    return "";
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    mentionState, updateMention, hideSuggestions, computeSelection, handleKeyDown: handleMentionKeyDown, isMentionActive,
  } = useMention({ roleInstances });

  /** 输入变化时同步检测 mention 状态 */
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
    updateMention(newValue, e.target.selectionStart ?? newValue.length);
  }, [updateMention]);

  /** 点击/光标移动时重新检测 mention（用户可能用鼠标重新定位光标） */
  const handleSelect = useCallback(() => {
    const el = textareaRef.current;
    if (el) updateMention(el.value, el.selectionStart ?? el.value.length);
  }, [updateMention]);

  /** 选择补全列表项（鼠标点击或 Enter/Tab 确认） */
  const applyMentionSelection = useCallback((index?: number) => {
    const transform = computeSelection(value, index);
    if (!transform) return;
    setValue(transform.newValue);
    hideSuggestions();
    /** 设置光标位置需要在 React 状态更新后执行 */
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) el.setSelectionRange(transform.cursorPos, transform.cursorPos);
    });
  }, [value, computeSelection, hideSuggestions]);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    const toSpeakers = extractToSpeakers(trimmed, roleInstances);
    onSend(trimmed, toSpeakers);
    setValue("");
    hideSuggestions();
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    if (issueId) removeDraft(issueId);
  }, [value, disabled, onSend, roleInstances, hideSuggestions, issueId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    /** 补全列表激活时，优先处理 mention 键盘事件 */
    if (isMentionActive) {
      const consumed = handleMentionKeyDown(e);
      if (consumed) {
        /** Enter/Tab 确认选择（B4） */
        if (e.key === "Enter" || e.key === "Tab") {
          applyMentionSelection();
        }
        return;
      }
      /** Shift+Enter 在补全列表激活时也发送（B7） */
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        handleSend();
        return;
      }
    } else {
      /** 补全列表未激活：恢复 F2026060401 设计：Enter 换行、Shift+Enter 发送 */
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    }
  };

  /** 补全列表激活时点击外部关闭 */
  useEffect(() => {
    if (!isMentionActive) return;
    const handleClickOutside = () => hideSuggestions();
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isMentionActive, hideSuggestions]);

  /** 草稿恢复后调整 textarea 高度（useState 初始化时 DOM 尚未就绪） */
  useEffect(() => {
    const el = textareaRef.current;
    if (el && value) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, []);

  /** Debounce 保存草稿到 localStorage；清空输入时立即删除旧草稿 */
  useEffect(() => {
    if (!issueId) return;
    if (!value) {
      removeDraft(issueId);
      return;
    }
    const timer = setTimeout(() => saveDraft(issueId, value), 300);
    return () => clearTimeout(timer);
  }, [issueId, value]);

  return (
    <div className="bg-surface-2 rounded-2xl border border-white/6 overflow-visible focus-within:border-shell-600/40 focus-within:ring-1 focus-within:ring-shell-600/15 transition-all relative">
      <MentionDropdown
        suggestions={mentionState.suggestions}
        selectedIndex={mentionState.selectedIndex}
        onSelect={applyMentionSelection}
      />
      <div className="px-4 py-3">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onSelect={handleSelect}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          aria-label="Message input"
          className="w-full bg-transparent border-none outline-none resize-none text-[13px] text-text-primary placeholder:text-text-muted leading-relaxed min-h-6"
        />
      </div>
      <div className="flex items-center justify-between px-3 py-2 border-t border-white/4">
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-text-grey ml-2">Markdown</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-[11px] text-text-muted">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/></svg>
            Ask Snail
          </div>
          <button
            onClick={handleSend}
            disabled={!value.trim() || disabled}
            aria-label="Send message"
            className="w-7 h-7 rounded-md bg-shell-600 hover:bg-shell-500 flex items-center justify-center text-white transition-colors disabled:opacity-50"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
