---
id: F20260625u3kv
title: 消息分页截断修复
from_ids: []
tags: [web, bugfix, pagination]
---

# F20260625u3kv — 消息分页截断修复

## 背景

### 问题现象

用户在"协作优化" issue (5a243d25) 中发送消息后，刷新页面消息消失。不只是新消息，最近几条消息也一并丢失，用户看到的是 2 小时前的旧对话开头。

### 影响范围

所有消息数超过 50 的 stage 都会受到影响。目前"协作优化" issue 的 design stage 有 53 条消息，已触发此问题。

### 历史溯源

| 时间 | 提交 | 变更 |
|------|------|------|
| 2026-06-10 | `61e737b3` | 引入消息分页，前端默认 `limit=50` |
| 2026-06-24 | `c4ab610a` → `681f1977` (PR #446) | 修复后端内部协作逻辑的 limit 50 问题 |
| 2026-06-25 | 当前 | 前端 API 端点仍然 limit=50，消息截断 |

## 根因分析

### 问题链路

```
前端 IssueConversation.tsx:56
  → api("GET /api/stages/:stageId/messages", ...)  // 不传 limit/offset
  → 后端 listMessages 路由处理器
  → deps.messagePort.listMessages(stageId, limit, offset)
  → listByStage(stageId, limit = 50, offset = 0)   // 默认 limit=50
  → SELECT * FROM message WHERE stage_id = ? ORDER BY id ASC LIMIT 50
  → 返回最早的 50 条消息，最新消息被截断
```

### 根因

**排序方向错误 + 分页逻辑缺失**

- 当前：`ORDER BY id ASC LIMIT 50` → 返回最早的 50 条，最新消息被截断
- 期望：`ORDER BY id DESC LIMIT 50` → 返回最新的 50 条，上拉加载更早的

### PR #446 修复了什么

PR #446 标题："修复对话丢失：cursor 时序 + SQL 层优化 + 路由恢复"

修复了**后端内部**三个方法的 limit 50 问题：
- `getUnreadMessages` → 改用 `listByStageAfterId` SQL 直查（`WHERE id > cursor`）
- `findLatestRespondingSpeaker` → 改用 SQL `ORDER BY id DESC LIMIT 1`
- `findLatestMessage` → 改用 SQL `LIMIT 1`

### PR #446 遗漏了什么

**前端 API 端点没有修复！**

- `IssueConversation.tsx:56` 直接调用 `api("GET /api/stages/:stageId/messages", ...)`，**不传 limit/offset**
- 后端 `listMessages` 路由处理器调用 `deps.messagePort.listMessages(stageId, limit, offset)`
- `listMessages` 默认 `limit=50`，返回**最早的 50 条**消息（按 id ASC）
- 当消息数超过 50 时，**最新消息被截断**

### 典型的"修复不完整"模式

```
后端 agent 协作逻辑 ✅ 已修复（PR #446）
前端用户界面层     ❌ 未修复（仍然 limit=50，且排序方向错误）
```

## 设计方案

### 核心需求

1. **默认展示最新 50 条消息**（不是最早的 50 条）
2. **上拉加载更早的历史消息**（向上滚动触发加载更早的消息）
3. **保留分页机制**，排序方向改为 `id DESC`

### 方案设计

#### 后端 API 变更

**`GET /api/stages/:stageId/messages` 端点**：

- 默认 `limit=50`，`sort=desc`（按 id 降序，返回最新 50 条）
- 新增 `before_id` 参数：用于 cursor-based 翻页，加载更早的消息
- 响应格式：返回消息数组，按 id 降序排列

**SQL 查询逻辑**：

```sql
-- 默认查询（最新 50 条）
SELECT * FROM message WHERE stage_id = ? ORDER BY id DESC LIMIT 50

-- 上拉加载更早的消息
SELECT * FROM message WHERE stage_id = ? AND id < ? ORDER BY id DESC LIMIT 50
```

#### 前端变更

**消息列表展示**：

- 初始加载：调用 `GET /api/stages/:stageId/messages`，获取最新 50 条
- 展示顺序：前端将结果反转（`reverse()`），按时间正序显示
- 上拉加载：监听滚动事件，当滚动到顶部时触发加载更早的消息

**上拉加载逻辑**：

```
1. 用户滚动到顶部
2. 记录当前最早消息的 id（before_id）
3. 调用 GET /api/stages/:stageId/messages?before_id={before_id}
4. 将新加载的消息插入到列表前面
5. 保持滚动位置不变（避免跳动）
```

**乐观更新**：

- 用户发送消息后，立即添加到列表末尾（乐观更新）
- `onSettled` 触发 refetch，获取最新 50 条
- 由于默认是最新 50 条，新消息一定在返回结果中

**边界情况：已加载历史消息的处理**

当 stage 消息数 > 50 时，用户上拉加载了部分历史消息（比如已加载 100 条），此时发送新消息，`onSettled` refetch 只返回最新 50 条。已加载的 50 条历史消息（id 51-100）会丢失。

**选择策略 A：refetch 只更新最新 50 条，已加载的历史消息需要用户重新上拉加载**

理由：
1. 简单，修复范围最小
2. 用户发送新消息后，通常会滚动到底部查看新消息，此时已加载的历史消息在视口之外
3. 如果用户需要查看历史消息，可以重新上拉加载
4. 避免复杂的合并逻辑，减少 bug 风险

### 实现要点

1. **后端 `listByStage` 方法**：支持 `before_id` 参数，实现 cursor-based 翻页
2. **后端排序方向**：默认改为 `ORDER BY id DESC`，返回最新消息
3. **前端消息展示**：将降序结果反转为正序显示
4. **前端上拉加载**：监听滚动事件，触发加载更早消息
5. **前端滚动位置保持**：加载历史消息后保持滚动位置不变

## 核心业务行为

### B1：默认展示最新消息

**当** 用户打开 stage 的消息列表时，**应该** 默认看到最新的 50 条消息，而非最早的 50 条。

### B2：上拉加载历史消息

**当** 用户滚动到消息列表顶部时，**应该** 自动加载更早的历史消息，插入到列表前面。

### B3：新消息可见性

**当** 用户发送新消息后刷新页面，**应该** 能看到刚发送的消息，因为它在最新的 50 条中。

### B4：滚动位置保持

**当** 用户上拉加载历史消息时，**应该** 保持当前滚动位置不变，避免消息列表跳动。

### B5：首次加载体验

**当** stage 消息数 <= 50 时，**应该** 显示所有消息，无需上拉加载。

## 验证清单

- [ ] V1：stage 消息数 <= 50 时，所有消息正常显示（按时间正序）
- [ ] V2：stage 消息数 > 50 时，默认显示最新 50 条
- [ ] V3：上拉加载更早的历史消息，插入到列表前面
- [ ] V4：上拉加载后滚动位置保持不变
- [ ] V5：发送新消息后刷新，新消息仍然可见
- [ ] V6：前端虚拟滚动在大量消息时性能正常
- [ ] V7：后端 `listByStage` 支持 `before_id` 参数
- [ ] V8：已加载历史消息后发送新消息，refetch 只更新最新 50 条，已加载历史消息需重新上拉加载

## 改动范围

完整改动链路：

**后端**：
- `src/domain/message/_internal/repository.ts` — `listByStage` 方法：支持 `before_id` 参数，默认 `ORDER BY id DESC`
- `src/domain/message/_internal/adapter.ts` — `listMessages` 方法：传递 `before_id` 参数
- `src/domain/message/port.ts` — `listMessages` 接口签名：新增 `beforeId` 参数
- `src/infra/http/routes/issue.route.ts` — `listMessages` 路由：解析 `before_id` 查询参数

**前端**：
- `src/web/queries/conversation.queries.ts` — `messages` 查询：支持 `before_id` 参数
- `src/web/pages/IssueConversation.tsx` — 消息列表：反转显示顺序，实现上拉加载逻辑
- `src/web/hooks/useScrollToTop.ts` — 新增 hook：监听滚动到顶部事件，触发加载历史消息

**测试**：
- 更新相关测试用例

## 设计决策

### D1：选择 cursor-based 翻页而非 offset-based

**决策**：使用 `before_id`（cursor-based）而非 `offset`（offset-based）实现分页。

**正方**：
- Cursor-based 分页在数据变化时更稳定（新消息插入不影响翻页）
- 实现简单，只需 `WHERE id < before_id`
- 性能更好，无需 `OFFSET` 跳过行

**反方**：
- 不支持跳页（只能向前翻，不能跳到指定页）
- 需要记录 cursor（最早消息的 id）

**结论**：聊天场景只需要向前翻页，cursor-based 更合适。

### D2：默认排序方向改为 DESC

**决策**：默认 `ORDER BY id DESC`，返回最新消息。

**正方**：
- 用户最关心最新消息，应默认展示
- 与用户需求一致："展示最新的 50 条"

**反方**：
- 前端需要反转显示顺序
- 与之前的 `ORDER BY id ASC` 不一致

**结论**：用户体验优先，默认展示最新消息。

### D3：上拉加载而非下拉加载

**决策**：上拉加载更早的消息（插入到列表前面）。

**正方**：
- 符合聊天应用的常见交互模式
- 用户向上滚动查看历史，向下滚动查看最新
- 新消息始终在底部，不需要特殊处理

**反方**：
- 需要保持滚动位置，实现稍复杂

**结论**：遵循聊天应用的交互惯例。
