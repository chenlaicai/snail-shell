/**
 * MentionDropdown - @mention 补全列表 UI
 *
 * 绝对定位在 textarea 上方，显示可选的角色实例列表。
 * 支持键盘导航（ArrowUp/Down）和鼠标点击选择。
 */

interface MentionDropdownProps {
  suggestions: string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

export function MentionDropdown({ suggestions, selectedIndex, onSelect }: MentionDropdownProps) {
  if (suggestions.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="Mention suggestions"
      className="absolute bottom-full left-0 right-0 mb-1 max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-surface-3 shadow-lg z-50"
    >
      {suggestions.map((name, index) => (
        <div
          key={name}
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
