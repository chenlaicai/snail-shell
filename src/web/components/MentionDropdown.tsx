/**
 * MentionDropdown - @mention 补全列表 UI
 *
 * 绝对定位在 textarea 下方，显示可选的角色实例列表。
 * 支持键盘导航（ArrowUp/Down）和鼠标点击选择。
 * 视口自适应：空间不足时向上展开（flip upward），上下都不够时限制高度并滚动。
 */

import { useLayoutEffect, useRef, useState } from "react";

interface MentionDropdownProps {
  suggestions: string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

export function MentionDropdown({ suggestions, selectedIndex, onSelect }: MentionDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  /** true = 向上展开（空间不足时 flip） */
  const [flip, setFlip] = useState(false);
  /** true = 视口上下空间都不够，限制 max-h */
  const [constrained, setConstrained] = useState(false);

  /** 基于触发器位置决定 flip 和 constrained，不依赖下拉框自身位置 */
  useLayoutEffect(() => {
    if (!dropdownRef.current) return;
    const parent = dropdownRef.current.parentElement;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - parentRect.bottom;
    const spaceAbove = parentRect.top;
    setFlip(spaceBelow < 200 && spaceAbove > spaceBelow);
    setConstrained(Math.max(spaceBelow, spaceAbove) < 300);
  }, [suggestions]);

  if (suggestions.length === 0) return null;

  return (
    <div
      ref={dropdownRef}
      role="listbox"
      aria-label="Mention suggestions"
      className={`absolute left-0 right-0 overflow-y-auto rounded-lg border border-white/10 bg-surface-3 shadow-lg z-50 ${
        flip ? "bottom-full mb-1" : "top-full mt-1"
      } ${constrained ? "max-h-[50vh]" : "max-h-48"}`}
    >
      {suggestions.map((name, index) => (
        <div
          key={`${name}-${index}`}
          role="option"
          aria-selected={index === selectedIndex}
          onMouseDown={(e) => {
            /** 使用 mousedown 而非 click，确保在 textarea 失焦前触发（B12） */
            e.preventDefault();
            onSelect(index);
          }}
          className={`px-3 py-2 text-[13px] cursor-pointer transition-colors ${
            index === selectedIndex
              ? "bg-shell-600/30 text-text-primary"
              : "text-text-secondary hover:bg-white/5"
          }`}
        >
          @{name}
        </div>
      ))}
    </div>
  );
}
