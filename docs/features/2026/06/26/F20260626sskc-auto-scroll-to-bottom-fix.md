---
id: F20260626sskc
title: 修复 Issue 对话界面自动滚动到底部失效
from_ids: []
tags: [bugfix, web, virtual-scroll]
modules: [web]
---
# F20260626sskc - 修复 Issue 对话界面自动滚动到底部失效

## 元数据

- **编号**: F20260626sskc
- **创建日期**: 2026-06-26
- **模块**: web
- **变更类型**: bugfix
- **Issue**: 0a0ee496-d12e-42a4-8d4a-b3948f56f89d

---

## 1. 需求背景

### 问题

用户进入 Issue 对话界面时，不再自动滚动到底部查看最新消息。此功能在 commit `32169d02` 引入虚拟滚动（`@tanstack/react-virtual`）后失效。

### 场景

1. **初次进入**：用户点击 Issue 进入对话界面，期望直接看到最新消息
2. **切换 Stage**：用户在不同 Stage 之间切换时，期望自动定位到最新对话

### 约束

- 虚拟滚动环境下，`el.scrollTop = el.scrollHeight` 可能不可靠
- 容器高度由 `virtualizer.getTotalSize()` 计算，而非真实 DOM 高度
- 需要兼容现有的"只在用户已在底部时自动滚动"逻辑

---

## 2. 设计方案

### 2.1 根因分析

**引入虚拟滚动前**（commit `67679b01`）：
```javascript
useEffect(() => {
  const el = scrollRef.current;
  if (el) {
    requestAnimationFrame(() => el.scrollTop = el.scrollHeight);
  }
}, [sorted]);
```
每次 `sorted` 变化都自动滚动到底部，无条件检查。

**引入虚拟滚动后**（commit `32169d02`）：
```javascript
useEffect(() => {
  const el = scrollRef.current;
  if (!el) return;
  if (wasAtBottomRef.current) {
    requestAnimationFrame(() => el.scrollTop = el.scrollHeight);
  }
}, [sorted]);
```
增加了 `wasAtBottomRef.current` 检查，但 `el.scrollTop = el.scrollHeight` 在虚拟滚动环境下失效。

**失效原因（双因素模型）**：

| 因素 | 描述 | 严重度 |
|------|------|--------|
| **A. API 不兼容** | `el.scrollHeight` 在虚拟滚动容器中不反映虚拟总高度（由 `virtualizer.getTotalSize()` 控制），`el.scrollTop = el.scrollHeight` 设了一个不存在的值 | 主因 |
| **B. 时序竞争** | 容器高度变化可能触发 scroll 事件，在 effect 执行前将 `wasAtBottomRef.current` 置 `false` | 次因 |

### 2.2 修复方案

使用 `virtualizer.scrollToIndex()` 替代 `el.scrollTop = el.scrollHeight`，并在 effect 中直接检查实际滚动位置：

```javascript
useEffect(() => {
  const el = scrollRef.current;
  if (!el || sorted.length === 0) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD;
  if (atBottom || wasAtBottomRef.current) {
    virtualizer.scrollToIndex(sorted.length - 1, { align: 'end' });
  }
}, [sorted]);
```

**优势**：
- 解决主因A：使用 `scrollToIndex` 替代 `el.scrollTop = el.scrollHeight`
- 解决次因B：直接检查实际位置，不依赖可能被抢先修改的 ref
- 行为确定性高，跨浏览器一致

**Stage 切換行爲**：
在 `handleStageChanged` 回调中重置 `wasAtBottomRef.current = true`，因为用户主动切换 Stage 意味着想要查看新 Stage 的内容，应该自动滚动到底部。

---

## 2.3 设计约束摘要

<!-- design-time -->

| 约束 | 来源 | 说明 |
|------|------|------|
| 虚拟滚动兼容 | F20260625bc8d | 必须使用 `@tanstack/react-virtual` 的 API，不能直接操作 DOM scrollTop |
| 粘性底部逻辑保留 | 现有设计 | 只在用户已在底部时自动滚动，避免打断历史消息阅读 |
| 位置检测阈值 | 现有实现 | 80px 阈值与现有 `handleScroll` 逻辑一致 |
| Stage 切换重置 | 新增约束 | 用户主动切换 Stage 时重置 `wasAtBottomRef`，自动滚动到底部 |

---

## 3. 核心业务行为

| # | 条件 | 行为 |
|---|------|------|
| B1 | 用户进入 Issue 对话界面，且消息列表非空 | 自动滚动到最后一条消息。**前置条件**：`wasAtBottomRef.current` 为 `true`（默认值）。**副作用**：用户可手动滚动查看历史消息 |
| B2 | 新消息到达，且用户已在底部 | 自动滚动到最后一条消息。**前置条件**：`wasAtBottomRef.current` 为 `true`。**副作用**：用户阅读历史消息时不触发自动滚动 |
| B3 | 用户手动滚动离开底部 | 禁用自动滚动。**触发条件**：`handleScroll` 检测到 `scrollHeight - scrollTop - clientHeight >= threshold` |

**边界行为**：
- 消息列表为空：不触发任何滚动行为
- 快速连续加载：`scrollToIndex` 天然幂等，多次调用结果一致
- Stage 切换：重置 `wasAtBottomRef.current = true`，触发消息重新加载后自动滚动到底部

---

## 4. 技术约束与依赖

### 4.1 依赖

- `@tanstack/react-virtual` v3.14.3（已安装），支持 `scrollToIndex` API
- 无新增依赖

### 4.2 滚动行为规格

- **自动滚动**：`scrollToIndex(count - 1, { align: 'end' })`
- **位置检测阈值**：80px（与现有粘性底部逻辑一致）
- **状态管理**：`wasAtBottomRef.current` 控制是否启用自动滚动

### 4.3 与现有逻辑的交互

- `handleScroll` 继续负责更新 `wasAtBottomRef.current`
- 自动滚动只在 `wasAtBottomRef.current` 为 `true` 时触发
- 用户手动滚动后，自动滚动被禁用，直到用户手动滚动到底部

---

## 5. 影响范围

- **前端**：`src/web/pages/IssueConversation.tsx` 修改自动滚动逻辑
- **不影响**：后端 API、WebSocket、数据模型

---

## 6. 开放问题

### Q1: 是否需要保留 `requestAnimationFrame`？

当前方案直接调用 `scrollToIndex`，无需 `requestAnimationFrame`。`scrollToIndex` 内部已处理时序问题。

**决策**：移除 `requestAnimationFrame`，直接调用 `scrollToIndex`。

### Q2: 是否需要处理虚拟滚动容器高度为 0 的情况？

当 `sorted.length === 0` 时，不触发滚动行为。当 `sorted` 从空变为非空时，`scrollToIndex` 会自动处理。

**决策**：保持现有逻辑，`sorted.length === 0` 时直接返回。

---

## 7. 待确认事项

- [x] 架构师-2 确认修正后的设计方案
- [ ] 确认是否需要额外的边界场景测试

---

## 8. 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-06-25 | 初稿 | 架构师-1 |
| 2026-06-25 | 修正：根因分析改为双因素模型、修复方案增加实际位置检查、补充设计约束摘要 | 架构师-1（回应架构师-2 审视） |
| 2026-06-26 | 特性编号顺延至 F20260626sskc | 开发者 |
