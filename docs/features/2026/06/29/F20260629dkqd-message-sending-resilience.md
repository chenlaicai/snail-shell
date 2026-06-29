---
id: F20260629dkqd
title: 消息发送韧性：发送状态 + 持久化 + 重试
status: implemented
created_at: 2026-06-29
---

# F20260629dkqd — 消息发送韧性：发送状态 + 持久化 + 重试

## 问题背景

### 用户场景复现

1. 用户在 Issue 对话页面输入消息，按 Shift+Enter 发送
2. 消息立即显示在界面上（乐观更新，status="completed"）
3. 用户退出 Issue 页面（SPA 导航或页面刷新）
4. 用户再次进入 Issue → 消息消失了

### 根因链路分析

```
用户按 Enter
  ↓
onMutate: 创建乐观消息 (status="completed") → 插入 TanStack Query 缓存 → UI 显示
  ↓
fetch POST /api/stages/:stageId/messages (异步，可能耗时数百毫秒)
  ↓
用户此时退出页面 / 刷新浏览器
  ↓
浏览器取消 in-flight fetch 请求（页面刷新时）或 SPA 导航导致组件卸载
  ↓
POST 请求从未完成 → 消息从未持久化到数据库
  ↓
再次进入页面 → 从服务器 fetch 消息列表 → 该消息不存在 → "丢失"
```

**核心缺陷**：乐观更新使用 `status: "completed"` 欺骗用户认为消息已发送成功。实际上，在 POST 请求返回之前，消息处于"薛定谔状态"——用户无法区分"已发送"和"正在发送"。

**次级缺陷**：
- 即使 POST 失败（网络错误、服务器 500），`onError` 直接回滚缓存 → 消息无声消失
- 无重试机制，用户必须重新输入
- 无 localStorage 持久化，页面刷新即丢失所有 pending 消息

## 设计方案

### 核心业务行为

1. **当用户发送消息时**，消息应立即显示在界面上，但带有"发送中"视觉标记（旋转加载圈）
2. **当 POST 请求成功时**，"发送中"标记消失，消息变为正常状态
3. **当 POST 请求失败时**，消息保留显示，但变为"发送失败"状态（红色感叹号 + 重试按钮）
4. **当用户在消息发送中离开页面时**，pending 消息应持久化到 localStorage
5. **当用户再次进入页面时**，pending 消息应从 localStorage 恢复并显示
6. **当恢复的 pending 消息与服务器数据冲突时**（POST 实际成功了但用户不知道），应去重合并

### 前端 MessageStatus 扩展

**变更类型**：类型扩展（不兼容）

`MessageStatus` 新增 `"sending"` 值：

```typescript
// 原
type MessageStatus = "streaming" | "completed" | "failed" | "interrupted" | "cancelled";
// 新
type MessageStatus = "sending" | "streaming" | "completed" | "failed" | "interrupted" | "cancelled";
```

- `"sending"` 是纯前端状态，后端永远不会产生
- 后端 `MessageStatus` 不变，无需迁移
- 前端 switch/条件需要增加 `"sending"` 分支

**决策记录**：
- 正方：将 "sending" 纳入 MessageStatus 类型是最小改动方案，复用现有 `status` 字段，不需要新增 `isPending` 等额外标记
- 反方：混入前端专有状态到共享类型可能造成混淆
- 结论：采用正方方案。"sending" 语义清晰，且后端 DTO 层面不受影响（API 返回的 JSON 中 status 永远不会是 "sending"）。在类型注释中标明 "frontend-only"。

### localStorage 持久化

**存储 key**：`snail:pending_messages`

**数据结构**：

```typescript
interface PendingMessage {
  id: number;            // 乐观 ID（Date.now() * 1000 + random）
  stageId: string;
  content: string;
  toSpeakers?: string[];
  createdAt: string;     // ISO timestamp
  status: "sending" | "failed";
}

// localStorage 值: Record<string, PendingMessage>
// key 格式: `${stageId}:${id}`
```

**生命周期**：
1. `onMutate` → 写入 localStorage（status: "sending"）
2. `onSuccess` → 删除 localStorage 条目（服务器已持久化）
3. `onError` → 更新 localStorage 条目（status: "failed"）
4. 页面加载 → 从 localStorage 读取 pending 消息 → 注入缓存

### useSendMessage 重设计

```typescript
// 伪代码
function useSendMessage(stageId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (body) => api("POST /api/stages/:stageId/messages", ...),

    onMutate: async (body) => {
      await qc.cancelQueries(...);
      const previous = qc.getQueryData(...);
      const optimisticId = generateId();

      // 1. 写入 localStorage
      savePendingMessage({ id: optimisticId, stageId, content: body.text, ... });

      // 2. 插入缓存，status = "sending"
      qc.setQueryData(..., (old) => [
        createPlaceholderMessage(stageId, { id: optimisticId, role: "user", status: "sending", content: body.text }),
        ...(old ?? []),
      ]);

      return { previous, optimisticId };
    },

    onSuccess: (_data, _body, context) => {
      // 删除 localStorage
      removePendingMessage(stageId, context.optimisticId);
      // 更新缓存：status "sending" → "completed"
      qc.setQueryData(..., (old) =>
        old?.map(m => m.id === context.optimisticId ? { ...m, status: "completed" } : m)
      );
    },

    onError: (_err, _body, context) => {
      // 标记 localStorage 为 "failed"
      markPendingMessageFailed(stageId, context.optimisticId);
      // 更新缓存：status "sending" → "failed"
      qc.setQueryData(..., (old) =>
        old?.map(m => m.id === context.optimisticId ? { ...m, status: "failed" } : m)
      );
      // 不回滚缓存！保留消息在界面上
    },

    onSettled: () => {
      qc.invalidateQueries(...);
    },
  });
}
```

**关键变化**：
- `onError` 不再回滚缓存（删除 `qc.setQueryData(..., context.previous)`），而是将消息标记为 "failed"
- `onSuccess` 新增，将 "sending" 更新为 "completed"
- 所有操作同步更新 localStorage

### 页面加载恢复

**IssueConversation 的 messages query**：

```typescript
// 在 useQuery 的 select 或 initialData 中注入 pending 消息
const { data: serverMessages = [] } = useQuery({
  queryKey: queryKeys.stages.messages(stageId),
  queryFn: () => api(...),
  enabled: !!stageId,
  select: (serverData) => {
    const pending = getPendingMessages(stageId);
    if (pending.length === 0) return serverData;

    // 去重：如果 pending 消息的 content 和时间窗口与 server 消息匹配，说明 POST 实际成功了
    const serverContents = new Set(serverData.map(m => m.content?.trim()));
    const uniquePending = pending
      .filter(p => !serverContents.has(p.content.trim()))
      .map(p => createPlaceholderMessage(stageId, {
        id: p.id,
        role: "user",
        status: p.status, // "sending" or "failed"
        content: p.content,
      }));

    return [...uniquePending, ...serverData];
  },
});
```

**去重逻辑**：用 content 匹配。如果服务器已有一条相同内容的 user 消息（trim 后比较），则认为 POST 实际成功，从 localStorage 清除。

### ChatMessage UI 适配

在 `ChatMessage.tsx` 中为用户消息增加发送状态指示：

```
[用户消息气泡]  ← 正常显示
  ↳ 发送中时：消息气泡右侧显示旋转加载圈 (Spinner)
  ↳ 发送失败时：消息气泡右侧显示红色感叹号 + "重试" 按钮
```

**UI 位置**：在消息气泡的右下方（与时间戳同一行），添加状态指示器：

- `status === "sending"`: 小型旋转动画（类似微信发送中的圈）
- `status === "failed"`: 红色感叹号图标 + "重试" 文字按钮

**重试逻辑**：
- 点击"重试"时，调用 `sendMutation.mutate()` 重新发送相同内容
- 状态从 "failed" → "sending"
- 同时更新 localStorage

### WebSocket 实时去重增强

**问题**：当前 `applyBatch` 中 `user_called` 事件的去重逻辑仅按 `message_id` 匹配（`useWebSocket.ts` line 138）。但乐观消息的 ID 是客户端生成的（`Date.now() * 1000 + random`），与服务端分配的真实 ID 不同 → 去重失败 → 短暂出现两条消息。

这是**已有 bug**，但本设计因 `onError` 不回滚，需要更精确处理。

**方案**：在 `applyBatch` 的 `user_called`/`message_started` 处理中，增加**内容匹配替换**逻辑：

```
处理 user_called(message_id=serverId, role="user") 时：
1. 先检查 ID 去重（现有逻辑，保留）
2. 如果 ID 不匹配，检查缓存中是否已有 role="user" + status="sending" + content 相同的消息
3. 如果匹配 → 用服务端消息替换乐观消息（更新 id、status、from_role 等字段）
4. 如果不匹配 → 插入新消息（现有逻辑）
```

**边界 case：连续发送相同内容**：第二条 `user_called` 到达时，第一条已被替换为服务端消息（status 从 "sending" 变为 "completed" 或 "streaming"），不满足 `status === "sending"` 条件，不会误匹配。

**边界 case：localStorage 恢复 + WebSocket**：恢复的 pending 消息 status 为 "sending"。如果 POST 实际成功，WebSocket 推送的 `user_called` 会触发替换逻辑，将 "sending" 消息替换为服务端消息。如果 POST 未成功，消息保持 "sending" 状态等待重试或用户手动操作。

### API Client 变更

当前 `api-client.ts` 的 `api()` 函数不支持 `AbortSignal`。本次设计不要求添加 AbortSignal 支持，原因：

1. TanStack Query 的 `useMutation` 本身不自动取消请求
2. 主要问题是 localStorage 持久化，而非请求取消
3. AbortSignal 是优化项，不在本次范围内

## 影响面

### 前端变更文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/api-contracts/dto.ts` | 类型扩展 | MessageStatus 新增 "sending" |
| `src/web/mutations/conversation.mutations.ts` | 重写 | 发送逻辑重设计 |
| `src/web/components/ChatMessage.tsx` | 功能增加 | 发送状态 UI 指示 |
| `src/web/hooks/useWebSocket.ts` | 功能增强 | applyBatch 增加内容匹配替换逻辑，消除乐观消息与服务端消息的重复闪烁 |
| `src/web/pages/IssueConversation.tsx` | 功能增加 | 页面加载时恢复 pending 消息 |
| `src/web/lib/pending-messages.ts` | 新文件 | localStorage 操作工具函数 |

### 后端变更

无。后端不感知 "sending" 状态，不需要任何修改。

### 兼容性

- MessageStatus 类型扩展：前端内部使用，不破坏 API 契约
- localStorage 格式：新增存储，不影响已有数据
- 无数据库迁移

## 关键设计决策

### D1: onError 回滚 vs 保留

**决策**：onError 不再回滚缓存，而是将消息标记为 "failed"。

**正方**：用户能看到自己发了什么，有重试机会，不会"消息凭空消失"
**反方**：界面上会出现一条从未真正发送的消息，可能造成困惑
**结论**：采用正方。用户体验优先。"发送失败"的视觉标记足够清晰，且提供重试机制。

### D2: 去重策略

**决策**：用 content（trim 后）匹配去重。

**正方**：简单可靠，不需要额外字段
**反方**：如果用户连续发送两条相同内容的消息，可能误删
**结论**：采用正方。实际场景中连续发送相同内容的概率极低。如果需要更精确，可加入时间窗口约束（±5 秒内的同内容消息不去重）。

### D4: WebSocket 去重策略——ID 匹配 vs 内容匹配

**决策**：在 `applyBatch` 中增加 content + role + status 三重匹配的替换逻辑。

**正方**：消除乐观消息和服务端消息之间的重复闪烁；不改变 API 契约；仅影响 user role 消息，assistant 消息不受影响
**反方**：内容匹配增加 `applyBatch` 复杂度；极端 case 下可能误匹配（如用户手动触发 WebSocket 重放）
**结论**：采用正方。status="sending" 的额外约束将误匹配概率降至极低，且误匹配的后果仅为提前将 "sending" 消息替换为服务端消息（无数据丢失）。

### D3: localStorage vs IndexedDB

**决策**：使用 localStorage。

**正方**：API 简单，同步操作，足够存放 pending 消息（单条消息通常 < 10KB）
**反方**：localStorage 有 5MB 限制
**结论**：采用正方。pending 消息量极小（发送成功即清除），不会触及限制。

## 验证场景

1. **正常发送**：消息显示"发送中"加载圈 → POST 成功 → 加载圈消失
2. **发送失败**：断网 → 消息显示红色感叹号 + 重试 → 联网后重试成功
3. **页面刷新**：发送中刷新页面 → 消息恢复显示 → POST 完成后消失
4. **SPA 导航**：发送中离开页面 → 回来后消息仍在 → 最终同步
5. **重复去重**：发送成功但页面刷新 → 不会出现重复消息
6. **WebSocket 去重**：发送成功后 WebSocket 推送 user_called → 乐观消息被替换而非新增，无闪烁
