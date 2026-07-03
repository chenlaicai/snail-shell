---
id: F20260703k7mr
title: enter-issue-scroll-regression-2
from_ids: [F20260702n8vx, F20260702rzzu]
tags: [bugfix, frontend, scroll, virtualization, regression]
modules: [web]
doc_kind: spec
---

# F20260703k7mr [web] 进入 Issue 仍然停在顶部 — PR #558 文件拆分丢失 PR #555 修复

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

**特性类型**: bugfix（回归修复）
**创建日期**: 2026-07-03
**状态**: 设计锁定

## 背景 [required]

用户反馈：进入 issue 后页面仍然停在顶部，不会自动滚动到对话底部。

经溯源，PR #555（commit `35090a87`，2026-07-02 17:16）已修复此问题，但 PR #558（commit `d5253f41`，2026-07-02 18:56）在执行"超大文件拆分"时，将滚动逻辑从 `IssueConversation.tsx` 提取到 `useChatScroll.ts`，**丢失了 PR #555 的两项关键修复**。

### 回归链条

| 时间 | PR | 操作 | `wasAtBottomRef` 初始值 | `paddingEnd` | 进入 issue 行为 |
|------|-----|------|------------------------|--------------|----------------|
| 7/2 17:16 | #555 | 修复回归 | `true`（恢复） | ✅ 有 | 滚动到底部 ✓ |
| 7/2 18:56 | #558 | 文件拆分 | `false`（丢失） | ❌ 丢失 | 停在顶部 ✗ |

### PR #558 丢失的具体内容

**丢失 1：`wasAtBottomRef.current = true`**

PR #555 的 stage-switch effect：
```typescript
// PR #555 — IssueConversation.tsx
useEffect(() => {
  if (prevStageIdRef.current !== stageId) {
    if (prevStageIdRef.current) clearPendingMessages(prevStageIdRef.current);
    prevStageIdRef.current = stageId;
    setOlderHistory([]);
    allHistoryLoadedRef.current = false;
    wasAtBottomRef.current = true;  // ← PR #555 恢复
  }
}, [stageId]);
```

PR #558 拆分后的 `useChatScroll.ts`：
```typescript
// PR #558 — useChatScroll.ts
useEffect(() => {
  if (prevStageIdForScrollRef.current !== stageId) {
    prevStageIdForScrollRef.current = stageId;
    wasAtBottomRef.current = false;  // ← 回退到 PR #550 的错误值
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;       // ← PR #550 的"滚动到顶部"逻辑
  }
}, [stageId]);
```

**丢失 2：`paddingEnd` 逻辑**

PR #555 添加的完整 `paddingEnd` 机制（ResizeObserver + paddingEnd 计算 + useVirtualizer 配置）在拆分时完全未迁移到 `useChatScroll.ts`。

### 因果链

1. 用户点击 issue → `useChatScroll` 挂载
2. Stage-switch `useEffect` 触发（`prevStageIdForScrollRef.current (null) !== stageId`）
3. `wasAtBottomRef.current` 被设为 `false`，`scrollTop` 被设为 `0`
4. 消息加载完成后，auto-scroll `useLayoutEffect` 检查 `atBottom || wasAtBottomRef.current` → 均为 `false`
5. `scrollToIndex` 永远不会被调用 → 页面停在顶部

## 目标 [required]

恢复 PR #555 的修复，使进入 issue 时自动滚动到对话底部，同时保持"消息少时无大面积空白"的行为。

## 非目标 [required]

- 不重构 `useChatScroll` 的整体架构
- 不改变 `useMessages` 的职责
- 不改变消息加载、历史翻页、实时更新的行为
- 不涉及后端 API 变更

## 核心业务行为 [required]

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当用户点击 issue 进入对话页面时 | 页面应自动滚动到对话最底部，显示最新消息 | |
| B2 | 当用户在 stage A 中手动切换到 stage B 时 | 页面应滚动到 stage B 的底部，显示最新消息 | |
| B3 | 当用户通过推进 stage 从 stage A 进入 stage B 时 | 页面应滚动到 stage B 的底部，显示最新消息 | |
| B4 | 当 stage 消息数量较少（1-3 条）时 | 页面不应出现大面积空白区域，消息应从底部开始显示 | |
| B5 | 当新消息到达时，如果用户在底部 | 自动跟随滚动到新消息 | |

## 设计 [required]

### 修改点 1：恢复 `wasAtBottomRef.current = true`

**文件**：`src/web/hooks/useChatScroll.ts` Lines 26-33

将 stage-switch effect 中的 `wasAtBottomRef.current = false` 改为 `true`，移除 `el.scrollTop = 0`。

修改前：
```typescript
useEffect(() => {
  if (prevStageIdForScrollRef.current !== stageId) {
    prevStageIdForScrollRef.current = stageId;
    wasAtBottomRef.current = false;
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
  }
}, [stageId]);
```

修改后：
```typescript
useEffect(() => {
  if (prevStageIdForScrollRef.current !== stageId) {
    prevStageIdForScrollRef.current = stageId;
    wasAtBottomRef.current = true;
  }
}, [stageId]);
```

> **[D1]** 恢复 `wasAtBottomRef.current = true`，移除 `scrollTop = 0`。正方：这是 PR #555 确认的正确行为，进入 issue 和 stage 切换都应滚动到底部；`scrollTop = 0` 是 PR #550 引入的错误修复，其根因（空白区域）应由 `paddingEnd` 解决。反方：无。依据：用户明确要求"进入 issue 时滚动到底部"。

### 修改点 2：添加 `paddingEnd` 逻辑

**文件**：`src/web/hooks/useChatScroll.ts`

在 `useChatScroll` 中添加：
1. `paddingEnd` 和 `containerHeight` 状态
2. ResizeObserver 监听容器尺寸变化
3. `useLayoutEffect` 计算 `paddingEnd`
4. 将 `paddingEnd` 传入 `useVirtualizer` 配置

```typescript
const [paddingEnd, setPaddingEnd] = useState(0);
const [containerHeight, setContainerHeight] = useState(0);

/** 监听容器尺寸变化（窗口 resize、PropertiesPanel 展开/折叠等） */
useEffect(() => {
  const el = scrollRef.current;
  if (!el) return;
  setContainerHeight(el.clientHeight);
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      setContainerHeight(entry.contentRect.height);
    }
  });
  observer.observe(el);
  return () => observer.disconnect();
}, []);

/** 当消息数量或容器尺寸变化时，计算 paddingEnd */
useLayoutEffect(() => {
  const el = scrollRef.current;
  if (!el) return;
  const rawContentHeight = sorted.length * 120; // estimateSize
  const needed = Math.max(0, el.clientHeight - rawContentHeight);
  setPaddingEnd(needed);
}, [sorted.length, containerHeight]);
```

`useVirtualizer` 配置中添加 `paddingEnd`：
```typescript
const virtualizer = useVirtualizer({
  count: sorted.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 120,
  overscan: 10,
  paddingEnd,
});
```

> **[D2]** 使用 `paddingEnd` 解决虚拟列表高度不足时的空白问题。正方：这是 PR #555 确认的正确方案，`paddingEnd` 是 TanStack Virtual 的原生支持；使用 `el.clientHeight` 计算避免与 `getTotalSize()` 循环依赖。反方：增加复杂度。依据：PR #555 的架构师审查已确认此方案。

## 生效路径 [required]

- 代码：`src/web/hooks/useChatScroll.ts` 的 stage-switch `useEffect`、`useVirtualizer` 配置、新增 `paddingEnd` 逻辑
- 无配置变更、无 API 变更、无提示词变更

## 设计约束摘要 [required]

### 硬约束（违反即 bug）
- 进入 issue 时（组件首次挂载）必须滚动到底部
- stage 切换时必须滚动到底部
- 消息少时（虚拟列表总高度 < 可视区域高度）不得出现大面积空白
- `paddingEnd` 必须使用 `el.clientHeight`（DOM 实际值）计算，避免与 `getTotalSize()` 循环依赖

### 语义不变量（实现中必须保持为真）
- `wasAtBottomRef.current === true` 当且仅当需要自动滚动到底部
- `paddingEnd >= 0` 当且仅当虚拟列表总高度 < 可视区域高度
- `containerHeight` 通过 `ResizeObserver` 保持与滚动容器 `clientHeight` 同步

### 非目标（不得扩展）
- 不重构滚动逻辑的整体架构
- 不引入新的滚动状态管理
- 不改变 `useMessages` 的职责

<!-- [design-time] 章节结束 -->

## 改动范围 [required]

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/web/hooks/useChatScroll.ts` | 修改 | 恢复 `wasAtBottomRef.current = true`，移除 `scrollTop = 0`，添加 `paddingEnd` + ResizeObserver 逻辑，`useVirtualizer` 配置中添加 `paddingEnd` |

## 验证 [required]

### P1
- [ ] 进入 issue 时，页面自动滚动到对话底部，显示最新消息
- [ ] 在 stage A 手动切换到 stage B 时，页面滚动到 stage B 的底部，显示最新消息
- [ ] 通过推进 stage 进入新 stage 时，页面滚动到新 stage 的底部，显示最新消息
- [ ] 新 stage 消息少（1-3 条）时无大面积空白，消息从底部开始显示
- [ ] 新消息到达时，如果用户在底部，自动跟随滚动
- [ ] 点击"回到底部"按钮，页面滚动到最新消息

### 通用
- [ ] `npm run check` 通过

## 关联 [required]

- **回归来源**: F20260702rzzu（超大文件拆分 — 丢失 PR #555 修复的 PR）
- **原始修复**: F20260702n8vx（使用 paddingEnd 修复进入 Issue 滚动到底部）
- **回归引入**: F20260702k4tp（Stage 切换后滚动到顶部 — PR #550）

## 关键决策记录 [required]

| # | 决策点 | 最终决策 | 状态 |
|---|--------|----------|------|
| D1 | stage-switch effect 中的 wasAtBottomRef 值 | 恢复为 `true`，移除 `scrollTop = 0` | 设计阶段确认 |
| D2 | 虚拟列表高度不足时的对齐 | 使用 `paddingEnd` 增加 scrollHeight | 设计阶段确认（沿用 PR #555） |

## 风险与缓解 [required]

| # | 风险 | 严重程度 | 影响 | 缓解策略 | 负责方 |
|---|------|----------|------|----------|--------|
| R1 | `paddingEnd` 与 `getTotalSize()` 循环依赖 | 高 | 无限循环 | 使用 `el.clientHeight`（DOM 实际值）计算，不依赖 `getTotalSize()`；`containerHeight` 通过 `ResizeObserver` 作为触发依赖 | 架构师-1 |
| R2 | `paddingEnd` 计算使用 `estimateSize` 而非实际高度 | 低 | 消息高度不一致时 padding 不精确 | `estimateSize` 返回 120px 是经验值，实际消息高度差异不大；后续可通过 `measureElement` 回调修正 | 架构师-1 |
