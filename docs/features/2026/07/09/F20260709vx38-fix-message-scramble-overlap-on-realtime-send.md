---
id: F20260709vx38
title: fix-message-scramble-overlap-on-realtime-send
from_ids: [F20260626uadx, F20260626q9bp, F20260706v2mn, F20260707q3kz]
tags: [web, bugfix, realtime, virtualizer, cache]
modules: [web]
doc_kind: spec
---

# F20260709vx38 [web] 修复实时消息发送时偶现错乱重叠

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

**特性类型**: bugfix（缓存竞态 + 虚拟列表测量竞态修复）
**创建日期**: 2026-07-09
**状态**: 已实现

## 背景 [required]

### 问题现象

用户报告：issue 对话界面的实时消息发送时会偶现错乱重叠在一起了。"偶现"表明这是一个时序相关的竞态问题。

### 历史修复

本问题区域已有多次修复：

| 时间 | Feature | 修复内容 | 与本次问题的关系 |
|------|---------|----------|------------------|
| 2026-06-26 | F20260626uadx | useLayoutEffect + totalSize 双依赖修复 auto-scroll 时序 | 修复了滚动时序，但未解决缓存竞态 |
| 2026-06-26 | F20260626q9bp | append 改 prepend 保持 DESC 不变量 | 修复了消息排序，但未解决 refetch 覆盖 |
| 2026-07-06 | F20260706v2mn | 非消息内容移出滚动容器 + 移除 paddingEnd | 修复了空白问题，但未解决测量竞态 |
| 2026-07-07 | F20260707q3kz | StageSuggestionCard 移出滚动容器 | 完结 MP1 不变量 |

前序修复聚焦于滚动位置和消息排序，但 **缓存层的竞态条件** 和 **多 agent 并发流式时的虚拟列表测量竞态** 尚未被识别和修复。

## 溯源与根因分析 [required]

### RC-1（主要）：`onSettled` invalidation 覆盖 WebSocket 更新

**文件**：`src/web/mutations/conversation.mutations.ts:70-72`

`useSendMessage` mutation 的 `onSettled` 调用 `invalidateQueries`，触发 `GET /api/stages/:stageId/messages` 后台 refetch。refetch 响应到达时**整体替换** React Query 缓存，覆盖此期间通过 WebSocket `setQueryData` 写入的所有更新。

**竞态时序**：

```
t0: 用户发送消息 "Hello"
    -> onMutate: 乐观消息 [-123(sending)] 写入缓存
t1: POST 请求发出
t2: 服务端创建消息 100，开始 dispatch
t3: WebSocket user_called(message_id=100) -> EventBatcher 批处理
t4: POST 响应返回 -> onSuccess: 删 localStorage -> onSettled: invalidateQueries
    -> 后台 refetch 请求发出
t5: EventBatcher flush: user_called 替换 -123 为 100
    -> 缓存: [100(completed), ...oldMsgs]
t6: WebSocket message_started(message_id=101) -> EventBatcher
t7: EventBatcher flush: 追加 101 placeholder
    -> 缓存: [101(streaming), 100(completed), ...oldMsgs]
t8: WebSocket message_event_appended(message_id=101, events=[e1,e2]) -> EventBatcher
t9: EventBatcher flush: 追加 events 到 101
    -> 缓存: [101(streaming, events=[e1,e2]), 100(completed), ...oldMsgs]
t10: **refetch 响应到达 -> 替换整个缓存**
    -> 缓存: [101(streaming, events=[]), 100(completed), ...oldMsgs]
    -> t5-t9 的 WebSocket 更新全部丢失！
```

**影响**：
- 消息 events 丢失 -> EventStream 空白 -> 内容闪烁
- `_lastEventAt` 丢失（前端专有字段）-> stuck-streaming 检测失效
- 消息 status 回退（如果 refetch 查询早于服务端状态更新）-> 消息从 completed 回退到 streaming
- `sorted` 数组引用变化 -> 虚拟列表全部重渲染 -> 测量重置 -> 瞬时重叠

**为什么是"偶现"**：竞态仅在 refetch 响应到达晚于 WebSocket 事件时发生。如果 refetch 在 WebSocket 事件之前完成，不会覆盖。时序取决于网络延迟和服务端处理速度。

### RC-2（次要）：多 agent 并发流式时虚拟列表测量竞态

**文件**：`src/web/hooks/useChatScroll.ts:69`, `src/web/pages/IssueConversation.tsx:192-213`

虚拟列表使用 `estimateSize: () => 120` + `measureElement` 动态测量。items 使用 `position: absolute` + `translateY(${virtualRow.start}px)` 定位。

在 Snail Shell 中，同一 stage 内多个 agent（如架构师-1 和架构师-2）可以并发响应。当两个 agent 同时流式输出时：

```
消息 101（agent A）开始 streaming
消息 102（agent B）开始 streaming

每 16ms EventBatcher flush:
  -> 消息 101 追加 event -> DOM 高度增长
  -> 消息 102 的 virtualRow.start 依赖 101 的测量高度
  -> ResizeObserver 异步触发（在 paint 前，但非同步）
  -> 在 ResizeObserver 回调前，102 的 translateY 基于旧的 101 高度
  -> 102 与 101 视觉重叠
```

**关键约束**：`ResizeObserver` 在事件循环的 "deliver resize loop notifications" 阶段触发（paint 前），但不是在 DOM 变更后同步触发。在单次 paint 周期内，如果 101 的内容增长导致 102 的位置错误，用户会看到一帧的重叠。

F20260626uadx 的 `useLayoutEffect + totalSize` 修复了**滚动位置**，但不修复**item 间相对定位**——`translateY` 由 virtualizer 内部测量数据决定，`useLayoutEffect` 只控制 `scrollTop`。

### RC-3（三级）：乐观消息替换时 React key 不稳定

**文件**：`src/web/pages/IssueConversation.tsx:197`

虚拟列表使用 `key={msg.id}`。当 `user_called` WebSocket 事件替换乐观消息（负 ID）为服务端消息（正 ID）时，key 变化导致 React unmount/mount。virtualizer 丢失该位置的测量数据，回退到 estimateSize=120px，引发后续 items 的位置重计算和瞬时跳动。

## 目标 [required]

1. 消除 `onSettled` invalidation 对 WebSocket 更新的覆盖
2. 消除多 agent 并发流式时的虚拟列表测量竞态
3. 消除乐观消息替换时的 React key 不稳定
4. 保持已有修复（F20260626uadx 的 useLayoutEffect、F20260626q9bp 的 DESC 不变量、F20260706v2mn 的 MP1/MP2/MP3）不被破坏

## 非目标 [required]

- 不改变后端 API 或 WebSocket 协议
- 不改变消息排序逻辑（DESC 缓存 + reverse 显示）
- 不改变 EventBatcher 的 16ms 批处理策略
- 不改变虚拟列表的基本架构（@tanstack/react-virtual）
- 不改变乐观更新的基本策略（onMutate 插入 sending 消息）

## 用户意图锚 [required]

| # | 用户原话 | 来源 | 关键修饰语 | 架构师解读 |
|---|----------|------|------------|------------|
| UA-1 | "issue对话界面的实时消息发送时会偶现错乱重叠在一起了" | 消息 #1 | 时序：实时消息发送时；频率：偶现；状态：错乱重叠 | 实时消息发送过程中，消息偶发性地出现顺序错乱和视觉重叠 |
| UA-2 | "issue对话界面的消息错乱重叠在一起了" | Issue 标题 | 空间：issue 对话界面；状态：错乱重叠 | 问题发生在 issue 对话界面，表现为消息之间视觉重叠和顺序错乱 |

> 注：用户表达较简短，关键修饰语覆盖时序（"实时消息发送时"）、频率（"偶现"）、空间（"issue 对话界面"）、视觉属性（"错乱重叠"）。无数量、条件类修饰语。"错乱"解读为消息顺序或状态异常，"重叠"解读为消息在视觉上互相覆盖。

## 核心业务行为 [required]

| # | 场景 | 预期行为 | 追溯 | 测试覆盖 |
|---|------|----------|------|----------|
| B1 | 当用户发送消息且 WebSocket 连接正常时 | 乐观消息保持 "sending" 状态直到 `user_called` 事件替换，不被 refetch 覆盖 | ← UA-1 | T1 |
| B2 | 当 WebSocket 事件正在更新缓存时，POST 响应到达 | WebSocket 更新不被 refetch 覆盖；refetch 不触发或其结果与 WebSocket 更新合并 | ← UA-1 | T2 |
| B3 | 当两个 agent 并发流式输出时 | 两条流式消息不发生视觉重叠；后一条消息的正确定位不依赖前一条消息的实时测量 | ← UA-2 | T3 |
| B4 | 当乐观消息被服务端消息替换时 | React key 不变化，组件不 unmount/mount，虚拟列表测量数据保持 | ← UA-1 | T4 |
| B5 | 当 WebSocket 断连时发送消息 | refetch 作为 fallback 确保消息最终一致 | ← UA-1 | T5 |
| B6 | 所有已有行为保持不变 | 滚动到底部、历史加载、stage 切换等行为不受影响 | | T6 |

## 设计 [required]

### 修改点 1：移除 `onSettled` invalidation，改为条件性 refetch（RC-1 修复 - 核心修复）

**文件**：`src/web/mutations/conversation.mutations.ts`

**问题**：`onSettled` 无条件调用 `invalidateQueries`，触发后台 refetch。refetch 响应整体替换缓存，覆盖 WebSocket 更新。

**修复方案**：移除 `onSettled`，将 refetch 逻辑移到 `onSuccess` 中并添加 WebSocket 连接状态判断：

```typescript
// 修改前
onSuccess: (_data, _body, context) => {
  removePendingMessage(stageId, context.optimisticId);
},
onError: (_err, _body, context) => {
  markPendingMessageFailed(stageId, context.optimisticId);
  qc.setQueryData(queryKeys.stages.messages(stageId), (old) =>
    old?.map((m) => (m.id === context.optimisticId ? { ...m, status: "failed" } : m)),
  );
},
onSettled: () => {
  qc.invalidateQueries({ queryKey: queryKeys.stages.messages(stageId) });
},

// 修改后
onSuccess: (_data, _body, context) => {
  removePendingMessage(stageId, context.optimisticId);
  // WebSocket 连接正常时，user_called 事件会替换乐观消息，无需 refetch
  // WebSocket 断连时，refetch 作为 fallback 确保最终一致
  if (useConversationStore.getState().wsStatus !== "connected") {
    qc.invalidateQueries({ queryKey: queryKeys.stages.messages(stageId) });
  }
},
onError: (_err, _body, context) => {
  markPendingMessageFailed(stageId, context.optimisticId);
  qc.setQueryData(queryKeys.stages.messages(stageId), (old) =>
    old?.map((m) => (m.id === context.optimisticId ? { ...m, status: "failed" } : m)),
  );
  // 无条件 refetch：POST 失败但服务端可能已创建消息（网络错误场景）
  // replaceOptimisticMessage 只匹配 status="sending"，不匹配 "failed"
  // 如果不 refetch，user_called 事件会作为新消息追加，导致缓存中出现重复消息
  qc.invalidateQueries({ queryKey: queryKeys.stages.messages(stageId) });
},
// 移除 onSettled
```

**设计理由**：
- **POST 成功 + WS 连接**：`user_called` 事件通过 `replaceOptimisticMessage` 替换乐观消息，不需要 refetch
- **POST 成功 + WS 断连**：`onSuccess` 中条件 refetch 作为 fallback
- **POST 失败**：`onError` 无条件 refetch。因为 `replaceOptimisticMessage` 只匹配 `status="sending"`，不匹配 `"failed"`。如果不 refetch，`user_called` 事件会作为新消息追加，导致缓存中出现重复消息
- **WS 重连**：`refetchStaleQueries` 检查数据过期并 refetch，作为第三道防线

> **[D1]** 移除无条件 `onSettled` invalidation，改为 `onSuccess` 中条件性 refetch + `onError` 中无条件 refetch。正方：(1) 消除竞态根因--WebSocket 连接且 POST 成功时不再触发 refetch；(2) WebSocket 断连时保留 fallback；(3) POST 失败时无条件 refetch 防止重复消息（`replaceOptimisticMessage` 不匹配 "failed" 状态，`user_called` 会作为新消息追加导致重复）。反方：`onError` 的 refetch 在 WS 连接时仍可能覆盖 WebSocket 更新，但错误场景下服务端数据是唯一可信源，覆盖可接受。依据：交叉审视发现 `onError` 缺失 refetch 会导致 POST 失败但服务端已创建消息时出现重复消息。

### 修改点 2：使用 `client_id` 稳定虚拟列表 key（RC-3 修复 - 核心修复）

**文件**：`src/web/mutations/conversation.mutations.ts`、`src/web/hooks/useWebSocket.ts`、`src/web/pages/IssueConversation.tsx`

**问题**：`key={msg.id}` 在乐观消息（负 ID）被服务端消息（正 ID）替换时变化，导致 React unmount/mount，virtualizer 丢失测量数据。

**现状分析**：
- `MessageDto`（`src/api-contracts/dto.ts:136-154`）**不包含** `client_id` 字段。`createPlaceholderMessage` 设置的 `client_id` 是未声明的多余属性（既有类型不一致）
- WebSocket 事件类型中声明了 `client_id: string | null`，但 `unified-websocket.ts:189` 硬编码为 `null`
- 乐观消息创建时不设置 `client_id`

**修复方案**：在 `MessageDto` 中声明 `client_id` 字段，在前端生成 `client_id` 作为稳定标识，贯穿乐观消息和服务端消息：

0. **`src/api-contracts/dto.ts`**：在 `MessageDto` 中声明 `client_id` 字段
   ```typescript
   export type MessageDto = {
     ...
     client_id?: string | null;  // 前端生成的稳定标识，用于虚拟列表 key
     ...
   };
   ```

1. **`conversation.mutations.ts` onMutate**：生成 `client_id` 并设置到乐观消息
   ```typescript
   const clientId = `opt-${crypto.randomUUID()}`;
   // 传给 createPlaceholderMessage
   createPlaceholderMessage(stageId, {
     id: optimisticId, role: "user", status: "sending", content: body.text,
     client_id: clientId,
   })
   ```
   同时将 `clientId` 存入 context，供 `replaceOptimisticMessage` 使用。

2. **`useWebSocket.ts` `replaceOptimisticMessage`**：替换时保留乐观消息的 `client_id`
   ```typescript
   // 修改前：使用 event.client_id（始终为 null）
   createPlaceholderMessage(stageId, {
     id: event.message_id, ..., client_id: event.client_id, ...
   })
   // 修改后：保留原消息的 client_id
   createPlaceholderMessage(stageId, {
     id: event.message_id, ..., client_id: messages[optimisticIndex].client_id, ...
   })
   ```

3. **`IssueConversation.tsx`**：key 使用 `client_id` 优先
   ```typescript
   <div key={msg.client_id ?? msg.id} ref={virtualizer.measureElement} ...>
   ```

**效果**：
- 乐观消息：`client_id = "opt-uuid"`, `id = -123` → key = `"opt-uuid"`
- 服务端消息（替换后）：`client_id = "opt-uuid"`（保留）, `id = 100` → key = `"opt-uuid"`
- 非乐观消息（服务端历史消息）：`client_id = null` → key = `msg.id`
- **key 不变，React 复用组件，virtualizer 保留测量数据**

> **[D2]** 前端生成 `client_id` 作为虚拟列表稳定 key，并在 `MessageDto` 中声明该字段。正方：(1) 消除 key 变化导致的 unmount/mount；(2) virtualizer 保留测量数据，避免位置跳动；(3) `client_id` 字段已在 WebSocket 事件类型中声明但后端未使用，前端赋值语义无冲突；(4) 纯前端方案，不涉及后端变更。反方：需在 `dto.ts` 中补充 `client_id` 声明以修复既有类型不一致。依据：代码验证显示 `MessageDto` 未声明 `client_id`，但 `createPlaceholderMessage` 已设置该字段，属于既有类型不一致；`unified-websocket.ts:189` 硬编码 `client_id: null`，后端从未使用该字段。

### 修改点 3：为虚拟列表 items 添加 `contain: layout` 样式（RC-2 缓解）

**文件**：`src/web/pages/IssueConversation.tsx:192-213`

**问题**：多 agent 并发流式时，`ResizeObserver` 异步回调期间，后续 items 的 `translateY` 基于旧测量值，导致瞬时重叠。

**修复方案**（可选缓解）：为虚拟列表 item 容器添加 CSS `contain: layout` 属性：

```typescript
// 修改前
<div
  key={msg.id}
  ref={virtualizer.measureElement}
  data-index={virtualRow.index}
  style={{
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    transform: `translateY(${virtualRow.start}px)`,
  }}
  className="px-0 py-1"
>

// 修改后
<div
  key={msg.client_id ?? msg.id}
  ref={virtualizer.measureElement}
  data-index={virtualRow.index}
  style={{
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    transform: `translateY(${virtualRow.start}px)`,
    contain: "layout",  // 隔离布局影响，减少重排范围
  }}
  className="px-0 py-1"
>
```

**设计理由**：
- `contain: layout` 告诉浏览器该元素的布局变化不影响外部布局，浏览器可以优化重排
- **效果存疑**：items 已使用 `position: absolute`，布局已独立。`contain: layout` 对 absolute 元素可能是冗余的
- 加速 `ResizeObserver` 回调是浏览器实现细节，无规范保证
- 作为可选缓解，MP1+MP2 已覆盖 RC-1 和 RC-3，RC-2 作为次要根因可接受瞬时一帧重叠

> **[D3]** `contain: layout` 作为可选缓解，效果依赖浏览器实现。正方：(1) 零风险 CSS 属性，不影响功能；(2) 对 absolute 定位元素的效果存疑但无负面影响。反方：(1) absolute 定位已隔离布局，`contain: layout` 可能是冗余的；(2) 加速 `ResizeObserver` 回调是浏览器实现细节，无规范保证。依据：交叉审视质疑对 absolute 元素的效果。如果不添加 MP3，MP1+MP2 已覆盖 RC-1 和 RC-3，RC-2 作为次要根因可接受瞬时一帧重叠。

## 生效路径 [required]

- 代码：`src/web/mutations/conversation.mutations.ts`（移除 onSettled + onError refetch + client_id）、`src/api-contracts/dto.ts`（声明 client_id）、`src/web/hooks/useWebSocket.ts`（保留 client_id）、`src/web/lib/pending-messages.ts`（持久化 client_id）、`src/web/pages/IssueConversation.tsx`（key + contain）
- 无配置变更、无 API 变更、无提示词变更
- 新增依赖：`useConversationStore` 在 `conversation.mutations.ts` 中的引用（已存在于项目中）

## 设计约束摘要 [required]

### 硬约束（违反即 bug）
- WebSocket 连接正常时不得触发 messages refetch ← UA-1
- 乐观消息替换时 React key 不得变化 ← UA-1
- WebSocket 断连时必须触发 refetch 作为 fallback ← UA-1
- POST 失败时必须无条件 refetch 防止重复消息 ← UA-1

### 语义不变量（实现中必须保持为真）
- messages 缓存（`queryKeys.stages.messages(stageId)`）始终维护 `id DESC` 顺序（F20260626q9bp 不变量）
- 滚动容器内只包含虚拟化内容（F20260707q3kz 不变量）
- `onSettled` 不再被定义——refetch 逻辑移至 `onSuccess` 中条件触发

### 非目标（不得扩展）
- 不更换虚拟列表库
- 不改变 EventBatcher 的批处理策略
- 不改变消息发送的 HTTP API
- 不引入新的状态管理机制

<!-- [design-time] 章节结束 -->

## 改动范围 [required]

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/web/mutations/conversation.mutations.ts` | 修改 | 移除 `onSettled`；`onSuccess` 中条件 refetch（WS 断连时）；`onError` 中无条件 refetch；生成 `client_id` 并设置到乐观消息；import `useConversationStore` |
| `src/api-contracts/dto.ts` | 修改 | 在 `MessageDto` 中声明 `client_id?: string \| null` 字段 |
| `src/web/hooks/useWebSocket.ts` | 修改 | `replaceOptimisticMessage` 保留原消息的 `client_id` 而非使用 `event.client_id` |
| `src/web/lib/pending-messages.ts` | 修改 | `PendingMessage` 接口增加 `client_id` 字段，持久化到 localStorage |
| `src/web/pages/IssueConversation.tsx` | 修改 | 虚拟列表 key 从 `msg.id` 改为 `msg.client_id ?? msg.id`；item 容器添加 `contain: layout` |

## 验证 [required]

### P1 手动验证
- [ ] 发送消息后，乐观消息保持 "sending" 状态直到服务端确认，不闪烁
- [ ] 发送消息后，agent 开始流式回复时，消息不重叠
- [ ] 快速连续发送多条消息，不出现错乱或重叠
- [ ] 两个 agent 并发回复时，消息不重叠
- [ ] WebSocket 断连时发送消息，消息最终与服务端一致
- [ ] 滚动到底部、历史加载、stage 切换等已有行为不受影响

### 自动化测试（防回归）

| # | 测试 | 断言（行为级） |
|---|------|----------------|
| T1 | 发送消息后不触发 refetch（WS 连接时） | `queryClient.isFetching(messagesQueryKey)` === 0 |
| T2 | WebSocket 更新不被 refetch 覆盖 | 发送消息 -> WS user_called 替换乐观消息 -> 缓存中乐观消息被替换，其他消息的 events 不丢失 |
| T3 | 多 agent 并发流式时无重叠 | 两条 streaming 消息的 DOM 位置不重叠（`getBoundingClientRect` 检查） |
| T4 | 乐观消息替换时 key 不变 | 替换前后 React 节点 key 一致，组件不 unmount |
| T5 | WebSocket 断连时触发 refetch | WS 状态非 connected 时，`onSuccess` 调用 `invalidateQueries` |
| T6 | 已有行为回归 | 滚动到底部、历史加载、stage 切换行为不变 |

### 通用
- [ ] `npm run check` 通过

## 关联 [required]

- **前序修复**: F20260626uadx（auto-scroll 时序）、F20260626q9bp（DESC 不变量）、F20260706v2mn（MP1/MP2/MP3）、F20260707q3kz（StageSuggestionCard 移出）
- **本次新增**: RC-1（缓存竞态）、RC-2（测量竞态）、RC-3（key 不稳定）

## 关键决策记录 [required]

| # | 决策点 | 最终决策 | 正方 | 反方 | 状态 |
|---|--------|----------|------|------|------|
| D1 | onSettled invalidation 去留 | 移除无条件 invalidation，改为 onSuccess 条件性 + onError 无条件 refetch | 消除竞态根因；WS 断连时保留 fallback；POST 失败时防止重复消息 | onError refetch 在 WS 连接时仍可能覆盖更新，但错误场景下服务端数据是唯一可信源 | 设计锁定 |
| D2 | 虚拟列表 key 选择 | 前端生成 `client_id` 作为稳定 key，在 `MessageDto` 中声明字段 | 消除 key 变化导致的 unmount/mount；保留测量数据；纯前端方案 | 需修复 `MessageDto` 既有类型不一致 | 设计锁定 |
| D3 | 虚拟列表 contain 属性 | 可选缓解，效果依赖浏览器实现 | 零风险 CSS 属性，无负面影响 | absolute 定位已隔离布局，效果存疑；无规范保证 | 设计锁定 |

## 风险与缓解 [required]

| # | 风险 | 严重程度 | 影响 | 缓解策略 | 负责方 |
|---|------|----------|------|----------|--------|
| R1 | WS 连接但 user_called 事件未到达 | 低 | 乐观消息卡在 "sending" | stuck-streaming 检测（90s 超时）提示用户刷新 | 架构师 |
| R2 | client_id 语义变更 | 极低 | `client_id` 从"服务端分配"变为"前端生成"，但当前服务端始终返回 null | 语义无冲突；`client_id` 字段当前未被任何逻辑使用 | 架构师 |
| R3 | contain: layout 对 absolute 元素效果存疑 | 极低 | 可能是冗余属性 | 标注为可选缓解；无负面影响 | 架构师 |

## 交叉审视记录 [required]

### 第一轮

- **架构师-2 确认 RC-1 根因准确**：`conversation.mutations.ts:70-72` 的 `onSettled` 无条件 `invalidateQueries` 确实是缓存竞态根因
- **架构师-2 确认 RC-3 根因正确**：`key={msg.id}` 在乐观消息替换时确实变化
- **架构师-2 发现事实性错误**：`MessageDto` 不包含 `client_id` 字段，文档已修正并添加 `dto.ts` 到改动范围
- **架构师-2 发现 `onError` 缺失 refetch**：POST 失败但服务端已创建消息时，`replaceOptimisticMessage` 不匹配 "failed" 状态，`user_called` 会追加为新消息导致重复。已在 `onError` 中添加无条件 refetch
- **架构师-2 指出 `PendingMessage` 不持久化 `client_id`**：已将 `pending-messages.ts` 加入改动范围，扩展 `PendingMessage` 接口
- **架构师-2 质疑 `contain: layout` 对 absolute 元素效果**：已降级为可选缓解，修正 D3 描述

### 共识

所有 4 个问题已解决。MP1 增加 `onError` 无条件 refetch；MP2 增加 `dto.ts` 和 `pending-messages.ts` 到改动范围；MP3 降级为可选。方案状态升级为设计锁定。
