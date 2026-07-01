---
id: F20260701b7q2
title: board-scroll-fix
from_ids: [F20260630xy7k]
tags: [web, bugfix, board, layout, scroll, responsive]
modules: [web]
doc_kind: spec
change_type: bugfix
---

# F20260701b7q2 [web][BugFix] Issue Board 无法滚动

## 背景

用户报告：Issue Board 界面 issue 较多时，屏幕无法下拉。

### 当前布局架构

Board 页面（`IssueBoard.tsx`）的 flex/grid 布局链：

```
AppShell (flex h-screen overflow-hidden)
  └─ Main (flex-1 flex-col min-w-0)
       ├─ TopBar (shrink-0)
       ├─ Toolbar (shrink-0)
       └─ Board (flex-1 overflow-y-hidden px-6 py-4)     ← 问题层 1
            └─ Grid (grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 h-full)  ← 问题层 2
                 ├─ Column "AI Running" (flex flex-col)
                 │    └─ Inner (flex-1 overflow-y-auto)   ← 应该滚动但不生效
                 ├─ Column "Needs You" (flex flex-col)
                 │    └─ Inner (flex-1 overflow-y-auto)
                 └─ Column "Completed" (flex flex-col)
                      └─ Inner (flex-1 overflow-y-auto)
```

此架构来自 F20260630xy7k（Board 全宽布局改造），设计意图是每列独立滚动。

## 问题分析

### 根因：flex 子元素缺少 `min-h-0`

CSS Flexbox 默认 `min-height: auto`，即 flex 子元素的最小高度等于其内容高度。当内容超出容器时，子元素会撑开而非裁剪。

**布局链中的 height 传递失败**：

| 层级 | 当前 CSS | 问题 |
|------|---------|------|
| Board 容器 | `flex-1 overflow-y-hidden` | `flex-1` 在列方向 flex 中 height 由 flex 算法决定，但默认 `min-height: auto` 阻止了高度收缩。`overflow-y-hidden` 应该裁剪内容，但前提是容器有确定的高度约束 |
| Grid | `h-full` | 在父容器高度未确定时，`h-full` 无法正确解析为具体像素值 |
| 每列 Inner | `flex-1 overflow-y-auto` | 父容器（Column）没有高度约束，`flex-1` 无法收缩，`overflow-y-auto` 无法触发滚动 |

**核心问题**：`overflow-y-hidden`（或 `overflow-y-auto`）触发裁剪/滚动的前提是容器有**确定的高度上限**。在 flex 布局中，如果子元素没有 `min-h-0`，即使父容器有 `overflow-hidden`，子元素仍可能撑开超过父容器高度。

### 行为表现

- **桌面端（≥1024px）**：三列并排，每列可能无法独立滚动（高度未被正确约束）
- **移动端（<768px）**：三列堆叠为单列，所有 status 分组在同一个容器内，整体无法滚动

## 目标

修复 Issue Board 页面的滚动能力，确保 issue 数量超出可视区域时用户可以正常滚动浏览。

## 非目标

- 不改变 Board 的响应式列数（1/2/3 列）
- 不改变每列独立滚动的设计意图（桌面端）
- 不改变 AppShell 的 `h-screen overflow-hidden` 全局约束

## 方案

### 修改 Board 容器：添加 `min-h-0`

```diff
- <div className="flex-1 overflow-y-hidden px-6 py-4">
+ <div className="flex-1 min-h-0 overflow-y-hidden px-6 py-4">
```

**效果**：Board 容器允许高度收缩到 0，从而被 AppShell 的 `h-screen` 正确约束。`overflow-y-hidden` 现在可以生效，裁剪超出部分。

### 修改 Grid：添加 `min-h-0`

```diff
- <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 h-full">
+ <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 h-full min-h-0">
```

**效果**：Grid 容器允许高度收缩，`h-full` 能正确解析为父容器高度。

### 修改每列容器：添加 `min-h-0`

```diff
- <div key={col.status} className="flex flex-col">
+ <div key={col.status} className="flex flex-col min-h-0">
```

**效果**：每列允许高度收缩，`flex-1 overflow-y-auto` 内层 div 可以正确触发独立滚动。

## 修改文件

| 文件 | 变更 |
|------|------|
| `src/web/pages/IssueBoard.tsx` | Board 容器 + Grid + 每列容器添加 `min-h-0` |

## 设计取舍

| 决策 | 正面 | 反面 | 结论 |
|------|------|------|------|
| `min-h-0` vs 移除 `overflow-y-hidden` | 最小改动，保持原有每列独立滚动设计 | 需要理解 flex min-height 语义 | 选 `min-h-0`：精准修复高度约束链 |
| 桌面端每列独立滚动 vs 整页滚动 | 每列独立，互不干扰 | 移动端单列体验可能不够直观 | 保持每列独立滚动（与 F20260630xy7k 设计一致） |

## 验证

| 检查项 | 验证方式 |
|--------|----------|
| 桌面端每列可独立滚动 | 三列各有 10+ issue 时，每列可独立滚动，不互相影响 |
| 移动端可滚动 | 窄屏（<768px）单列布局下，可滚动浏览所有 issue |
| 空状态正常 | 无 issue 时显示 "No issues in this workspace" 居中 |
| 响应式列数不变 | 宽屏三列、中屏两列、窄屏单列 |
| `npm run check` | lint + tsc + build 全通过 |
