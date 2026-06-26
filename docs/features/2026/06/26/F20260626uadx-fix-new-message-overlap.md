---
id: F20260626uadx
title: fix-new-message-overlap
tags: [web, bugfix, virtualizer, scroll]
modules: [web]
doc_kind: spec
---

# F20260626uadx [web] 修复发送新消息时与上一条消息视觉重叠

## 背景

### 问题现象

用户发送新消息后，新消息与前一条底部消息在视觉上重叠。需要手动滚动或等待虚拟器重新测量后才能看到正确的消息排列。

### 影响范围

所有使用虚拟滚动的消息列表：发送消息、WebSocket 实时消息到达时的自动滚动。

### 历史溯源

| 时间 | 提交 | 变更 |
|------|------|------|
| 2026-06-25 | `7a36076e` (PR #473) | 引入 @tanstack/react-virtual 虚拟滚动，estimateSize=120 |
| 2026-06-26 | 当前 | 修复虚拟器测量时序导致的消息重叠 |

## 根因分析

### 问题链路

```
用户发消息 → 乐观插入到缓存 → sorted 变化
  → useEffect([sorted]) 触发
    → requestAnimationFrame(() => el.scrollTop = el.scrollHeight)
      → 此时虚拟器用 estimateSize:120 定位新消息（估算高度）
      → scrollHeight 基于估算值
  → 浏览器绘制 → 用户看到新消息在估算位置（可能与上一条重叠）
  → 虚拟器 ref 回调测量实际 DOM 高度
    → 触发 re-render → translateY 位置修正
    → 但 scrollHeight 已变，scrollTop 未更新
  → 用户看到重叠：新消息的 translateY 已修正，但滚动位置未跟随
```

### 根因

**auto-scroll 的时序早于虚拟器测量完成**

`@tanstack/react-virtual` 的工作流程：
1. **渲染阶段**：用 `estimateSize` 估算高度，计算 `translateY` 定位
2. **提交阶段**：ref 回调 `measureElement` 测量实际 DOM 高度
3. **重渲染**：用实际高度重新计算 `translateY` 和 `getTotalSize()`

原来的 `useEffect` + `requestAnimationFrame` 在步骤 1 之后、步骤 2 之前执行滚动。此时 `scrollHeight` 基于估算值，而非实际值。步骤 3 修正了位置但没有再次滚动。

### 为什么 estimateSize=120 导致明显重叠

- 短消息（如"好的"）：实际高度 ~60px，估算 120px → 下一条消息的 translateY 偏大，不重叠
- 长消息（多行文本）：实际高度 200px+，估算 120px → 下一条消息的 translateY 偏小，**重叠**
- 用户发送的消息通常是中等长度，加上 header、padding 等，实际高度经常超过 120px

## 设计方案

### 修复策略

单一 `useLayoutEffect` + 双依赖（`sorted` + `totalSize`）：

- `sorted` 变化（新消息到达）→ 触发滚动（此时用估算高度，但浏览器尚未绘制）
- `totalSize` 变化（虚拟器测量完成后）→ 再次触发滚动（此时用实际高度）
- `useLayoutEffect` 保证两次滚动都在浏览器绘制前执行，用户不会看到中间态

```diff
- import { useCallback, useEffect, useMemo, useRef, useState } from "react";
+ import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

+ const totalSize = virtualizer.getTotalSize();
- useEffect(() => {
+ useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (wasAtBottomRef.current) {
-     requestAnimationFrame(() => el.scrollTop = el.scrollHeight);
+     el.scrollTop = el.scrollHeight;
    }
- }, [sorted]);
+ }, [sorted, totalSize]);
```

### 设计决策

#### D1：useLayoutEffect 替代 useEffect + requestAnimationFrame

**决策**：用 `useLayoutEffect` 替换原来的 `useEffect` + `requestAnimationFrame`。

**正方**：
- `useLayoutEffect` 在 DOM 变更后、浏览器绘制前同步执行，避免用户看到中间态
- 去掉 `requestAnimationFrame` 简化逻辑，`useLayoutEffect` 本身已保证时序

**反方**：
- `useLayoutEffect` 是同步执行，如果回调耗时可能阻塞绘制

**结论**：回调只做 `scrollTop = scrollHeight` 赋值，耗时可忽略。

#### D2：totalSize 作为 useLayoutEffect 的第二依赖

**决策**：将 `virtualizer.getTotalSize()` 的返回值作为 `useLayoutEffect` 的依赖之一。

**正方**：
- 虚拟器测量完成后 `totalSize` 变化，触发 re-render，`useLayoutEffect` 用实际高度再次滚动
- 两次滚动都在 `useLayoutEffect` 内完成（绘制前），用户只看到最终正确位置
- 比分离成 `useLayoutEffect` + `useEffect` 两个 hook 更简洁，避免双阶段滚动导致的视觉跳动

**反方**：
- 理论上 totalSize 变化可能由非测量原因触发（如窗口 resize），但此时如果用户在底部，滚动到底部是正确行为

**结论**：单一 `useLayoutEffect` + 双依赖是最简方案，且完全在绘制前完成。

## 核心业务行为

### B1：发送消息后无重叠

**当** 用户发送新消息时，**应该** 新消息出现在列表底部且不与上一条消息重叠。

### B2：长消息场景无重叠

**当** 新消息内容较长（实际高度远超 120px 估算值）时，**应该** 自动滚动正确补偿高度差。

### B3：历史消息阅读不被打断

**当** 用户正在阅读历史消息（未在底部）时，新消息到达 **不应该** 强制滚动到底部。

### B4：WebSocket 实时消息同样适用

**当** WebSocket 推送新消息到达时，自动滚动逻辑 **应该** 同样生效且不产生重叠。

## 验证清单

- [ ] V1：发送短消息（< 1 行），新消息出现在底部且无重叠
- [ ] V2：发送长消息（多行文本），新消息出现在底部且无重叠
- [ ] V3：滚动到历史位置后发送消息，页面不自动滚动
- [ ] V4：WebSocket 推送 agent 回复时，自动滚动到底部且无重叠
- [ ] V5：快速连续发送多条消息，无闪烁或重叠

## 改动范围

- `src/web/pages/IssueConversation.tsx` — auto-scroll 逻辑：useLayoutEffect + totalSize 依赖
