---
id: F20260626q9bp
title: 修复实时消息排序错乱
from_ids: [F20260625u3kv]
tags: [web, bugfix, realtime, ordering]
---

# F20260626q9bp — 修复实时消息排序错乱

## 背景

### 问题现象

PR #473（F20260625u3kv）修复消息分页截断后，用户报告消息列表出现逆序排列。具体表现为：新到达的实时消息出现在列表顶部而非底部。

### 影响范围

所有通过 WebSocket 接收实时消息的 stage 对话页面。用户发送消息时的乐观更新同样受影响（消息短暂闪到顶部）。

### 历史溯源

| 时间 | 提交 | 变更 |
|------|------|------|
| 2026-06-25 | `7a36076e` (PR #473) | 引入 DESC 排序 + cursor-based 分页，后端返回 id DESC，前端 `.reverse()` 转 ASC 显示 |
| 2026-06-26 | 当前 | 修复 WebSocket 乐观更新 append 破坏 DESC 不变量的问题 |

## 根因分析

### 问题链路

```
后端 listByStage: ORDER BY id DESC LIMIT 50
  → messages 缓存: [{id:50}, {id:49}, ..., {id:1}]  (DESC)

前端 sorted = [...messages].reverse()
  → [{id:1}, {id:2}, ..., {id:50}]  (ASC 显示)

WebSocket applyBatch: result = [...result, newMessage]  ← append!
  → [{id:50}, ..., {id:1}, {id:51}]  ← DESC 顺序被破坏

sorted 再次 reverse:
  → [{id:51}, {id:1}, {id:2}, ..., {id:50}]  ← 新消息跑到顶部！
```

### 根因

**两处 `setQueryData` 使用 append 而非 prepend，破坏了 DESC 不变量**

PR #473 建立了一个隐式约定：messages 缓存必须保持 `id DESC` 顺序，前端 `sorted` memo 依赖此约定做 `.reverse()` 转 ASC。但两处写入缓存的代码都使用了 append：

1. `useWebSocket.ts` `applyBatch`：`result = [...result, createPlaceholderMessage(...)]`
2. `conversation.mutations.ts` `onMutate`：`[...(old ?? []), createPlaceholderMessage(...)]`

append 将新消息（更大 id）放到数组末尾，破坏了 DESC 顺序。当前端 `.reverse()` 时，这些消息被翻到 ASC 数组的头部（列表顶部）。

### 为什么 PR #473 没有发现此问题

PR #473 的测试场景聚焦于：
- 初始加载顺序（HTTP 查询，不受影响）
- 上拉加载历史（cursor-based 翻页，不受影响）
- 页面刷新后消息可见性（重新 fetch，不受影响）

未覆盖的场景：
- WebSocket 实时消息到达（不触发 refetch 的窗口期）
- 用户发送消息的乐观更新（`onMutate` 阶段）

## 设计方案

### 修复策略

将两处 `setQueryData` 从 append 改为 prepend，保持 DESC 不变量：

```diff
// useWebSocket.ts applyBatch
- result = [...result, createPlaceholderMessage(stageId, {...})];
+ result = [createPlaceholderMessage(stageId, {...}), ...result];

// conversation.mutations.ts onMutate
- qc.setQueryData(..., (old) => [...(old ?? []), createPlaceholderMessage(...)]);
+ qc.setQueryData(..., (old) => [createPlaceholderMessage(...), ...(old ?? [])]);
```

### 不变量声明

messages 缓存（`queryKeys.stages.messages(stageId)`）始终维护 `id DESC` 顺序。所有写入此缓存的代码必须遵守：

- 新消息（id 更大）必须 **prepend** 到数组头部
- 不得 append 到数组末尾

## 核心业务行为

### B1：实时消息出现在底部

**当** WebSocket 推送新消息到达时，**应该** 出现在消息列表底部（最新位置），而非顶部。

### B2：乐观更新不闪烁

**当** 用户发送消息时，乐观更新的消息 **应该** 直接出现在底部，不应先闪到顶部再被 refetch 纠正。

### B3：历史加载与实时消息共存

**当** 用户上拉加载了历史消息后，新到达的实时消息 **应该** 仍然出现在底部，且不破坏已加载的历史消息顺序。

## 验证清单

- [ ] V1：WebSocket 实时消息到达后，出现在消息列表底部
- [ ] V2：用户发送消息后，乐观更新消息出现在底部
- [ ] V3：上拉加载历史后，实时消息仍然正确追加到底部
- [ ] V4：Stage 切换后，新 stage 的消息顺序正确
- [ ] V5：WebSocket 重连后，消息顺序正确（refetch 覆盖）

## 改动范围

- `src/web/hooks/useWebSocket.ts` — `applyBatch` 方法：新消息 prepend 而非 append
- `src/web/mutations/conversation.mutations.ts` — `onMutate` 回调：乐观消息 prepend 而非 append

## 设计决策

### D1：修复缓存写入而非改变排序策略

**决策**：保持后端 DESC + 前端 reverse 的架构，只修复写入端。

**正方**：
- 改动最小，只涉及两处 append → prepend
- 不影响后端 API 契约
- 不影响 cursor-based 翻页逻辑

**反方**：
- DESC + reverse 是隐式约定，容易再次被违反

**结论**：最小修复优先。后续可考虑在缓存层加排序保护或类型约束。
