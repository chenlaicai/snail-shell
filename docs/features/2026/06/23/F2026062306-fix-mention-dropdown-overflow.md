---
id: F2026062306
title: fix-mention-dropdown-overflow
from_ids: []
tags: [bugfix, web, mention]
modules: [web]
doc_kind: spec
---

# F2026062306 [web] 修复 @mention 下拉列表被 overflow-hidden 裁剪

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

用户反馈输入 @ 后没有弹出可选的 role instance 列表，且 Enter/Shift+Enter 会跳到 @名称之后而不是执行预期行为（换行/发送）。

经过排查，根因是 `ChatInput.tsx` 父容器的 `overflow-hidden` 裁剪了 `MentionDropdown` 的下拉列表。虽然 UI 不可见，但逻辑上 `mentionState.active` 仍为 true，导致键盘事件被错误消费。

相关历史修复：
- F2026061805: 输入框 @mention 自动补全功能
- F2026062205: 修复 Shift+Enter 在补全列表激活时未发送消息

## 目标

修复 @mention 下拉列表不可见的问题，确保：
1. 输入 @ 时下拉列表正确显示
2. Enter 确认选择 mention
3. Shift+Enter 发送消息（不受 mention 状态影响）

## 非目标

- 不改变 @mention 的触发逻辑和过滤策略
- 不改变键盘快捷键的语义定义
- 不重构 ChatInput 组件结构

## 核心业务行为

| # | 场景 | 预期行为 |
|---|------|----------|
| B1 | 当用户输入 @ 且 roleInstances 不为空时 | 下拉列表应显示在输入框附近，列出所有匹配的角色实例 |
| B2 | 当下拉列表激活时用户按 Enter | 应确认当前选中的 mention，将 @query 替换为 @selectedRole |
| B3 | 当下拉列表激活时用户按 Shift+Enter | 应发送消息，不触发 mention 选择 |
| B4 | 当下拉列表激活时用户按 Escape | 应关闭下拉列表 |
| B5 | 当下拉列表激活时用户按 ArrowUp/Down | 应切换选中的 mention 项 |

## 设计

### 问题分析

**根因**：CSS overflow 裁剪

`ChatInput.tsx` 第 113 行的父容器：
```tsx
<div className="bg-surface-2 rounded-2xl border border-white/6 overflow-hidden ...">
```

`MentionDropdown` 使用 `absolute bottom-full` 定位在 textarea 上方：
```tsx
className="absolute bottom-full left-0 right-0 mb-1 ..."
```

由于父元素的 `overflow-hidden`，下拉列表被裁剪不可见。

**影响链**：
1. 用户输入 @ → `mentionState` 被设置为 active（逻辑上）
2. UI 下拉列表被裁剪 → 用户看不到
3. 用户按 Enter → `handleMentionKeyDown` 返回 true → 触发 `applyMentionSelection()`
4. 光标跳到 @name 之后（用户期望是换行或发送）

### 修复方案

将 `MentionDropdown` 从向上展开改为**向下展开**：

1. `MentionDropdown.tsx`：`bottom-full` → `top-full`，`mb-1` → `mt-1`
2. `ChatInput.tsx`：移除父容器的 `overflow-hidden`，改为 `overflow-visible`

**方案优势**：
- 最小改动，只涉及 2 个文件的 CSS 类名
- 不改变组件结构和逻辑
- 向下展开更符合用户预期（输入框通常在页面底部，向上展开可能被截断）

**方案风险**：
- 移除 `overflow-hidden` 可能影响圆角裁剪效果
- 需要验证下拉列表向下展开时不会被页面其他元素遮挡

## 生效路径

本修复通过以下路径生效：
- `src/web/components/MentionDropdown.tsx`：下拉列表定位方式
- `src/web/components/ChatInput.tsx`：父容器 overflow 属性

## 设计约束摘要

- **边界**：只修改 CSS 定位和 overflow 属性，不改变组件逻辑
- **关键决策**：向下展开优于向上展开，因为避免与父容器 overflow-hidden 冲突
- **非目标约束**：不重构 ChatInput 组件结构
- **语义不变量**：键盘快捷键语义不变（Enter 确认、Shift+Enter 发送、Escape 关闭）

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| src/web/components/MentionDropdown.tsx | 修改 | `bottom-full` → `top-full`，`mb-1` → `mt-1` |
| src/web/components/ChatInput.tsx | 修改 | 移除 `overflow-hidden`，改为 `overflow-visible` |

## 验证

### P1

- [ ] 输入 @ 后下拉列表正确显示在 textarea 下方
- [ ] 下拉列表可以鼠标点击选择
- [ ] 下拉列表可以键盘 ArrowUp/Down 切换选中项
- [ ] Enter 确认选择 mention，文本正确替换
- [ ] Shift+Enter 发送消息（不触发 mention 选择）
- [ ] Escape 关闭下拉列表
- [ ] 点击输入框外部关闭下拉列表

### 通用

- [ ] 输入框圆角样式不受影响
- [ ] 输入框 focus 样式不受影响
- [ ] 下拉列表 z-index 正确，不被其他元素遮挡

## 关联

- **前置**: F2026061805（@mention 自动补全功能，定义了键盘行为契约）
- **相关**: F2026062205（修复 Shift+Enter 在补全列表激活时未发送消息，PR #412）
- **问题链**: F2026061805 → F2026062205 → F2026062306（本次修复）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | 下拉列表展开方向 | 向下展开避免与 overflow-hidden 冲突，实现简单 | 向上展开更符合常见 UI 模式（如 GitHub、Slack） | 向下展开 | 向上展开会被父容器裁剪，需要 portal 或移除 overflow-hidden，改动更大 | 架构师-1 | 2026-06-23 |
| D2 | 是否移除 overflow-hidden | 移除 overflow-hidden 可以保持向上展开 | overflow-hidden 用于圆角裁剪，移除可能影响视觉效果 | 移除 overflow-hidden，改为 overflow-visible | 圆角裁剪可以通过其他方式实现（如 border-radius），而 overflow-hidden 会裁剪下拉列表 | 架构师-1 | 2026-06-23 |

## PR

- **PR #428**: https://github.com/chenlaicai/snail-shell/pull/428
- **分支**: fix/mention-dropdown-overflow
- **Worktree**: /Users/orca/ai/snail-shell/.snail/worktrees/fix-mention-dropdown-overflow

## 范围变更记录

无
