---
id: F20260630xy7k
title: board-full-width-layout
from_ids: []
tags: [web, ui, layout, board, responsive]
modules: [web]
doc_kind: spec
change_type: feature
---

# F20260630xy7k [web][Feature] Board 布局撑满页面 + 卡片信息丰富化

## 背景

两个布局问题：

1. **Issue Board 页面**：三列固定 280px（总计 ~920px），在宽屏上仅占页面一半，右侧大量空白。
2. **Issue Conversation 页面**：对话内容区域 `max-w-[920px] mx-auto`，宽屏上左右留白明显。

根因：Board 列使用 `w-[280px] shrink-0` 固定宽度，不随视口扩展；Conversation 内容区硬编码 920px 上限。

## 目标

1. Board 三列自适应撑满可用宽度，消除页面右侧空白
2. Board 卡片利用更宽的列空间展示更多信息（SOP）
3. Conversation 内容区适度加宽，减少宽屏留白
4. 窄屏（≤1280px）不退化，保持可用性

## 非目标

- 不改变 Board 的列数（默认 3 列：AI Running / Needs You / Completed）
- 不改变 Conversation 的两栏结构（内容区 + PropertiesPanel）

## 方案

### 1. Board 容器：固定宽度 → 响应式 Grid

**当前**：`div.flex.gap-4.min-w-max` + 每列 `w-[280px].shrink-0`

**改为**：`div.grid.grid-cols-1.md:grid-cols-2.lg:grid-cols-3.gap-4`（响应式断点）

```diff
- <div className="flex gap-4 h-full min-w-max">
+ <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 h-full">
    {activityStatusColumns.map((col) => (
-     <div key={col.status} className="w-[280px] flex flex-col shrink-0">
+     <div key={col.status} className="flex flex-col">
```

同时移除外层容器的 `overflow-x-auto`（Grid 已撑满，不需要横向滚动）：

```diff
- <div className="flex-1 overflow-x-auto overflow-y-hidden px-6 py-4">
+ <div className="flex-1 overflow-y-hidden px-6 py-4">
```

**效果**：
- 宽屏（≥1024px）：三列等分可用宽度，每列自动适应
- 中屏（≥768px）：两列布局
- 窄屏（<768px）：单列布局，内容不被压缩

### 2. Board 卡片：增加信息密度

当前卡片仅展示：ID + 标题 + 状态标签 + 创建时间。

**新增字段**（均已在 DTO 中可用）：

| 字段 | 来源 | 展示方式 |
|------|------|----------|
| `issue.sop_snapshot.name` | `IssueDto.sop_snapshot.name` | SOP 标签，与 StatusBadge 同行 |

> ~~阶段进度~~ 不纳入：阶段支持回退，"Stage 2/5" 暗示线性推进，语义不准确。

**新卡片布局**：

```
┌─────────────────────────────────────┐
│ F20260630  Title of the Issue       │  ← ID + 标题
│                                     │
│ [AI Running] SOP: code-delivery     │  ← status + SOP (新增)
│ 3 hours ago                         │  ← 时间
└─────────────────────────────────────┘
```

### 3. Conversation 内容区：适度加宽

```diff
- <div className="mx-auto flex w-full max-w-[920px] flex-col gap-5">
+ <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5">

- <div className="mx-auto max-w-[920px]">
+ <div className="mx-auto max-w-[1120px]">
```

从 920px → 1120px（+200px）。在 1920px 屏幕上：左侧留白 ~300px + 内容 1120px + 右侧 sidebar 280px + padding ≈ 1760px，布局更饱满。

### 4. Board 空状态居中

Grid 布局下空状态文字需要跨列居中：

```diff
  {issues.length === 0 ? (
-   <div className="text-center text-text-muted text-sm py-16">No issues in this workspace</div>
+   <div className="col-span-full text-center text-text-muted text-sm py-16">No issues in this workspace</div>
  ) : (
```

## 修改文件

| 文件 | 变更 |
|------|------|
| `src/web/pages/IssueBoard.tsx` | 容器 flex→响应式 grid，移除 overflow-x-auto，空状态 col-span-full |
| `src/web/components/IssueCard.tsx` | 新增 SOP 展示 |
| `src/web/pages/IssueConversation.tsx` | max-w-[920px] → max-w-[1120px]（两处） |

## 设计取舍

| 决策 | 正面 | 反面 | 结论 |
|------|------|------|------|
| 响应式 Grid vs 固定列数 | 撑满页面，窄屏自动降列 | 窄屏单列信息密度低 | 用 responsive breakpoints（1/2/3 列）自动适配 |
| Conversation 1120px vs 更宽 | 更宽体验更饱满 | 超长文本行影响可读性 | 1120px 是折中，ChatGPT/Claude 等产品用 ~1000-1200px |

## 验证

| 检查项 | 验证方式 |
|--------|----------|
| Board 三列撑满宽度 | 打开 Board 页面，确认无横向滚动、三列等宽 |
| 窄屏退化 | 缩小窗口至 <768px，确认单列布局、内容不溢出 |
| 卡片信息完整 | 确认 SOP 名称正确显示 |
| Conversation 加宽 | 确认对话内容区在宽屏上左右留白减少 |
| `npm run check` | lint + tsc + build 全通过 |
