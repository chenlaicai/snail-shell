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
**状态**: 实现中

## 背景 [required]

用户反馈：点击进入 issue 后，页面不再自动跳转到对话最底部（最新消息位置），而是停在顶部（issue header 位置）。用户期望进入 issue 时直接看到最新对话内容。

经溯源，此行为变化由 commit `71c820e3`（PR #550，`F20260702k4tp`）于 2026-07-02 引入。该 PR 原本解决的是"stage 切换后出现空白区域"的问题，但其修改同时影响了"初始进入 issue"的滚动行为，造成回归。

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

恢复"进入 issue 时自动滚动到对话底部"的行为，同时保留 #550 修复的"stage 切换消除空白区域"效果。

### P1 — 区分初始加载与 stage 切换

将初始进入 issue（`prevStageIdRef` 从 `null` 变为实际值）与 stage 切换（两个不同的实际 stage ID 之间的切换）区分开，分别应用不同的滚动策略。

## 非目标 [required]

- 不改变"新消息到达时的自动跟随滚动"行为（已由 `wasAtBottomRef` + `useLayoutEffect` 正确处理）
- 不改变"手动滚动到顶/底按钮"的行为
- 不改变"上拉加载历史消息"的行为
- 不涉及后端 API 变更

## 核心业务行为 [required]

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当用户点击 issue 进入对话页面时 | 页面应自动滚动到对话最底部，显示最新消息 | |
| B2 | 当用户在 stage A 中手动切换到 stage B 时 | 页面应滚动到 stage B 的顶部，避免空白区域 | |
| B3 | 当用户通过推进 stage 从 stage A 进入 stage B 时 | 页面应滚动到 stage B 的顶部，避免空白区域 | |
| B4 | 当 stage B 消息数量较少（1-3 条）时 | 页面不应出现大面积空白区域 | |

## 设计 [required]

### P1 详设

#### 方案：基于 `prevStageIdRef` 初始值区分

**核心思路**：利用 `prevStageIdRef` 的初始值（`null`）来区分"首次加载"和"stage 切换"。

**修改点 1**：Stage-switch `useEffect` 中区分初始加载与切换

当 `prevStageIdRef.current === null`（首次加载）时，设置 `wasAtBottomRef.current = true` 并滚动到底部；当 `prevStageIdRef.current !== null`（stage 切换）时，保持 #550 的行为（`wasAtBottomRef.current = false` + `scrollTop = 0`）。

```typescript
useEffect(() => {
  if (prevStageIdRef.current !== stageId) {
    if (prevStageIdRef.current) clearPendingMessages(prevStageIdRef.current);
    const isInitialLoad = prevStageIdRef.current === null;
    prevStageIdRef.current = stageId;
    setOlderHistory([]);
    allHistoryLoadedRef.current = false;
    if (isInitialLoad) {
      // 初始加载：滚动到底部（对话最新位置）
      wasAtBottomRef.current = true;
    } else {
      // Stage 切换：滚动到顶部，避免空白区域
      wasAtBottomRef.current = false;
      const el = scrollRef.current;
      if (el) el.scrollTop = 0;
    }
  }
}, [stageId]);
```

> **[D1]** 初始加载时滚动到底部，stage 切换时滚动到顶部。正方：满足用户"进入 issue 看最新消息"的预期，同时保留 #550 修复的空白区域问题。反方：初始加载和 stage 切换的行为不一致，可能造成认知负担。依据：用户反馈明确要求"进入 issue 时滚动到底部"，而 #550 已验证"stage 切换滚动到顶部"解决了空白区域问题。

**修改点 2**：无需修改自动滚动 `useLayoutEffect`

自动滚动逻辑（Lines 147-154）不需要修改。初始加载时 `wasAtBottomRef.current = true` 会正确触发 `virtualizer.scrollToIndex(last, { align: 'end' })`。

## 生效路径 [required]

- 代码：`src/web/pages/IssueConversation.tsx` 的 stage-switch `useEffect`
- 无配置变更、无 API 变更、无提示词变更

## 设计约束摘要 [required]

### 硬约束（违反即 bug）
- 进入 issue 时（`prevStageIdRef` 从 `null` 变为实际值）必须滚动到底部
- Stage 切换时（两个不同实际 stage ID 之间）必须滚动到顶部

### 设计取舍（不得自行推翻）
- 使用 `prevStageIdRef.current === null` 作为初始加载的判断条件，而非引入新的 `isInitialLoad` state

### 语义不变量（实现中必须保持为真）
- `wasAtBottomRef.current === true` 当且仅当需要自动滚动到底部
- `wasAtBottomRef.current === false` 当且仅当不需要自动滚动

### 非目标（不得扩展）
- 不重构滚动逻辑的整体架构
- 不引入新的滚动状态管理

<!-- [design-time] 章节结束 -->

## 改动范围 [required]

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/web/pages/IssueConversation.tsx` | 修改 | Stage-switch `useEffect` 中区分初始加载与 stage 切换 |

## 验证 [required]

### P1
- [ ] 进入 issue 时，页面自动滚动到对话底部
- [ ] 在 stage A 手动切换到 stage B 时，页面滚动到 stage B 顶部
- [ ] 通过推进 stage 进入新 stage 时，页面滚动到新 stage 顶部
- [ ] 新 stage 消息少（1-3 条）时无大面积空白
- [ ] 新消息到达时，如果用户在底部，自动跟随滚动

### 通用
- [ ] `npm run check` 通过

## 关联 [required]

- **相关**: F20260702k4tp（Stage 切换后滚动位置异常 — 引入回归的 PR）

## 关键决策记录 [required]

| # | 决策点 | 最终决策 | 状态 |
|---|--------|----------|------|
| D1 | 初始加载与 stage 切换的滚动策略 | 初始加载滚动到底部，stage 切换滚动到顶部 | 设计阶段确认 |

## 风险与缓解 [required]

| # | 风险 | 严重程度 | 影响 | 缓解策略 | 负责方 |
|---|------|----------|------|----------|--------|
| R1 | `prevStageIdRef.current === null` 判断可能被其他逻辑重置 | 低 | 初始加载误判为 stage 切换 | 仅在 `stageId` 变化时检查，且 `prevStageIdRef` 只在此处赋值 | 架构师-1 |
