---
id: F20260702n8vx
title: enter-issue-scroll-to-bottom
from_ids: [F20260702k4tp]
tags: [bugfix, frontend, scroll, virtualization, regression]
modules: [web]
doc_kind: spec
---

# F20260702n8vx [web] 进入 Issue 时不再滚动到底部 — 回归溯源与修复

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

**特性类型**: bugfix（回归修复）
**创建日期**: 2026-07-02
**状态**: 设计锁定

## 背景 [required]

用户反馈：点击进入 issue 后，页面不再自动跳转到对话最底部（最新消息位置），而是停在顶部（issue header 位置）。用户期望进入 issue 时直接看到最新对话内容。

经溯源，此行为变化由 commit `71c820e3`（PR #550，`F20260702k4tp`）于 2026-07-02 引入。该 PR 原本解决的是"stage 切换后出现空白区域"的问题，但其修改同时影响了"初始进入 issue"的滚动行为，造成回归。

### 连锁问题的完整链条

**第一环：PR #550 的错误诊断**
- PR #550 认为根因是 `wasAtBottomRef.current = true` 导致 `scrollToIndex(last, { align: 'end' })` 把页面滚到很下方，导致空白
- 方案：把 `wasAtBottomRef.current` 改为 `false`，`scrollTop = 0`（滚动到顶部）

**第二环：用户指正**
- "显示到最底部是预期行为"——用户想看最新消息
- "空白部分多才是问题"——这才是真正需要解决的
- PR #550 没有解决空白问题，反而把正确行为（滚动到底部）给改掉了

**第三环：我的错误分析**
- 我设计的"区分初始加载与 stage 切换"仍然在讨论"时机"，没有解决核心问题
- 即使初始加载时滚动到底部，当消息少时仍然会有大面积空白

**第四环：架构师-2 的致命审查**
- `offsetY` 方案存在致命缺陷：scrollHeight 没有变化，消息会被渲染到可视区域之外
- 正确方案是使用 `paddingEnd`

### 真正的根因分析

当 stage 只有 1-3 条消息时：
- 虚拟列表总高度 = `estimateSize` × 消息数量 ≈ 120px × 3 = 360px
- 可视区域高度 = 800px
- `scrollToIndex(last, { align: 'end' })` 会把最后一条消息放在可视区域底部
- **但因为虚拟列表总高度 < 可视区域高度，结果是消息在容器顶部，下面有大量空白**

**关键发现**：这不是"滚动位置"的问题，而是"虚拟列表高度不足时的对齐"问题。

### 溯源链路

| 时间线 | Commit | PR | Stage 切换行为 | 初始加载行为 |
|--------|--------|----|--------------|-------------|
| 6/25 | `7a36076e` | #473 | 滚动到底部 (`wasAtBottomRef=true`) | 滚动到底部 |
| 6/26 | `92f6da61` | #471 | 滚动到底部（修复虚拟滚动机制） | 滚动到底部 |
| **7/2** | **`71c820e3`** | **#550** | **滚动到顶部** (`wasAtBottomRef=false, scrollTop=0`) | **滚动到顶部**（回归） |

### 根因分析

**代码位置**：`src/web/pages/IssueConversation.tsx` Lines 106-117

```typescript
// commit 71c820e3 引入的变更
useEffect(() => {
  if (prevStageIdRef.current !== stageId) {
    // ...
    wasAtBottomRef.current = false;  // 原为 true
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;        // 原无此行
  }
}, [stageId]);
```

**因果链**：
1. 用户点击 issue → 组件挂载 → `stageId` 从 `null` 变为实际值
2. Stage-switch `useEffect` 触发（`prevStageIdRef.current (null) !== stageId`）
3. `wasAtBottomRef.current` 被设为 `false`，`scrollTop` 被设为 `0`
4. 自动滚动 `useLayoutEffect` 检查 `atBottom || wasAtBottomRef.current` → 均为 `false` → 不滚动
5. 结果：页面停在顶部

**设计冲突**：
- PR #550 的目标：stage 切换后滚动到顶部，消除新 stage 消息少时的空白区域
- 用户预期：进入 issue 时滚动到底部（对话最新位置）
- 两者共享同一条 `useEffect` 代码路径，无法在当前架构下分别控制

## 目标 [required]

恢复"进入 issue 时自动滚动到对话底部"的行为，同时解决"消息少时大面积空白"的问题。

### P1 — 虚拟列表高度不足时的对齐

当虚拟列表总高度 < 可视区域高度时，使用 `paddingEnd` 增加虚拟列表的 scrollHeight，使 `scrollToIndex(last, { align: 'end' })` 能正确工作，用户看到最后一条消息在底部，无空白。

## 非目标 [required]

- 不改变"新消息到达时的自动跟随滚动"行为（已由 `wasAtBottomRef` + `useLayoutEffect` 正确处理）
- 不改变"手动滚动到顶/底按钮"的行为
- 不改变"上拉加载历史消息"的行为
- 不涉及后端 API 变更

## 核心业务行为 [required]

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当用户点击 issue 进入对话页面时 | 页面应自动滚动到对话最底部，显示最新消息 | |
| B2 | 当用户在 stage A 中手动切换到 stage B 时 | 页面应滚动到 stage B 的底部，显示最新消息 | |
| B3 | 当用户通过推进 stage 从 stage A 进入 stage B 时 | 页面应滚动到 stage B 的底部，显示最新消息 | |
| B4 | 当 stage B 消息数量较少（1-3 条）时 | 页面不应出现大面积空白区域，消息应从底部开始显示 | |
| B5 | 当新消息到达时，如果用户在底部 | 自动跟随滚动到新消息 | |

## 设计 [required]

### P1 详设

#### 方案：使用 `paddingEnd` 增加虚拟列表高度

**核心思路**：当虚拟列表总高度 < 可视区域高度时，给虚拟列表添加 `paddingEnd`，增加 scrollHeight，使 `scrollToIndex(last, { align: 'end' })` 能正确滚动到底部。

**原理图示**：
```
scrollContainer (clientHeight = 800px)
  └── virtualizer inner div (height = 360 + 800 = 1160px)
        ├── item 0 (translateY(0px))   ← scrollTop=360 时在上方不可见
        ├── item 1 (translateY(120px)) ← scrollTop=360 时在上方不可见
        └── item 2 (translateY(240px)) ← scrollTop=360 时可见 ✓
        └── [paddingEnd: 800px]        ← scrollTop=360 时在下方不可见
```

`scrollToIndex(last, { align: 'end' })` → `scrollTop = 360` → 用户看到最后一条消息在底部，无空白。

**修改点 1**：使用 `ResizeObserver` 监听容器尺寸变化，动态计算 `paddingEnd`

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

> **[D1]** 当虚拟列表总高度 < 可视区域高度时，使用 `paddingEnd` 增加 scrollHeight。正方：解决"消息少时大面积空白"的问题，同时保持"滚动到底部"的正确行为；`paddingEnd` 是 TanStack Virtual 的原生支持，不会破坏虚拟滚动机制。反方：增加了复杂度，需要避免循环依赖。依据：`getTotalSize()` 返回值包含 `paddingEnd`（`end - scrollMargin + paddingEnd`），所以 `paddingEnd` 会影响 `totalSize`，不能用 `totalSize` 计算 `paddingEnd`。

**修改点 2**：在 `useVirtualizer` 配置中传入 `paddingEnd`

```typescript
const virtualizer = useVirtualizer({
  count: sorted.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 120,
  overscan: 10,
  paddingEnd,
});
```

**修改点 3**：恢复 `wasAtBottomRef.current = true`，移除 PR #550 的"滚动到顶部"逻辑

```typescript
useEffect(() => {
  if (prevStageIdRef.current !== stageId) {
    if (prevStageIdRef.current) clearPendingMessages(prevStageIdRef.current);
    prevStageIdRef.current = stageId;
    setOlderHistory([]);
    allHistoryLoadedRef.current = false;
    wasAtBottomRef.current = true;  // 恢复为 true
    // 移除 el.scrollTop = 0
  }
}, [stageId]);
```

> **[D2]** 恢复 `wasAtBottomRef.current = true`，移除"滚动到顶部"逻辑。正方：这是正确的默认行为，用户进入 issue 时应该看到最新消息。反方：无。依据：用户明确要求"进入 issue 时滚动到底部"，PR #550 的"滚动到顶部"是错误的修复。

## 生效路径 [required]

- 代码：`src/web/pages/IssueConversation.tsx` 的 `useVirtualizer` 配置、stage-switch `useEffect`
- 无配置变更、无 API 变更、无提示词变更

## 设计约束摘要 [required]

### 硬约束（违反即 bug）
- 进入 issue 时（`prevStageIdRef` 从 `null` 变为实际值）必须滚动到底部
- 消息少时（虚拟列表总高度 < 可视区域高度）不得出现大面积空白
- `paddingEnd` 必须使用 `el.clientHeight`（DOM 实际值）计算，避免与 `getTotalSize()` 循环依赖

### 设计取舍（不得自行推翻）
- 使用 `paddingEnd` 而非 `offsetY` 偏移，因为 `offsetY` 会导致消息渲染在 scrollHeight 之外
- 使用 `el.clientHeight` 而非 `virtualizer.getTotalSize()`，避免循环依赖；通过 `ResizeObserver` 响应容器尺寸变化

### 语义不变量（实现中必须保持为真）
- `wasAtBottomRef.current === true` 当且仅当需要自动滚动到底部
- `paddingEnd >= 0` 当且仅当虚拟列表总高度 < 可视区域高度
- `containerHeight` 通过 `ResizeObserver` 保持与滚动容器 `clientHeight` 同步

### 非目标（不得扩展）
- 不重构滚动逻辑的整体架构
- 不引入新的滚动状态管理
- 不改变虚拟滚动的其他行为

<!-- [design-time] 章节结束 -->

## 改动范围 [required]

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/web/pages/IssueConversation.tsx` | 修改 | 添加 `paddingEnd` 计算逻辑，传入 `useVirtualizer` 配置，恢复 `wasAtBottomRef.current = true`，移除 PR #550 的"滚动到顶部"逻辑 |

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

- **相关**: F20260702k4tp（Stage 切换后滚动位置异常 — 引入回归的 PR）

## 关键决策记录 [required]

| # | 决策点 | 最终决策 | 状态 |
|---|--------|----------|------|
| D1 | 虚拟列表高度不足时的对齐 | 使用 `paddingEnd` 增加 scrollHeight，使 `scrollToIndex` 能正确工作 | 设计阶段确认 |
| D2 | stage 切换时的滚动策略 | 恢复 `wasAtBottomRef.current = true`，移除"滚动到顶部"逻辑 | 设计阶段确认 |

## 风险与缓解 [required]

| # | 风险 | 严重程度 | 影响 | 缓解策略 | 负责方 |
|---|------|----------|------|----------|--------|
| R1 | `paddingEnd` 与 `getTotalSize()` 循环依赖 | 高 | 无限循环 | 使用 `el.clientHeight`（DOM 实际值）计算，不依赖 `getTotalSize()`；`containerHeight` 通过 `ResizeObserver` 作为触发依赖 | 架构师-1 |
| R2 | `paddingEnd` 计算使用 `estimateSize` 而非实际高度 | 低 | 消息高度不一致时 padding 不精确 | `estimateSize` 返回 120px 是经验值，实际消息高度差异不大；后续可通过 `measureElement` 回调修正 | 架构师-1 |
