---
id: F20260706jm2g
title: issue-last-updated-time
from_ids: []
tags: [feature, issue, message, frontend]
modules: [issue-collaboration, web]
---

# F20260706jm2g Issue 增加最新更新时间

## 状态

- [x] design
- [x] development
- [ ] review
- [ ] merge

## 问题描述

Issue 当前只有 `created_at` 和 `closed_at` 两个时间字段，Issue Board 卡片和 Issue List 行显示的是 `created_at`（创建时间），无法反映 Issue 的最新活动时间。用户需要在 Issue Board 卡片上看到 Issue 的最新更新时间，以便快速识别哪些 Issue 最近有活动。

## 用户意图锚

> 「issue增加一个最新更新时间，这个时间按照 最新的消息的结束时间来看；并且要显示在issue board的issue卡片上」

| 修饰语 | 原文 | 含义 | 架构师解读 |
|--------|------|------|-----------|
| 空间 | 「issue board的issue卡片上」 | 显示位置限于 Issue Board 卡片 | 显示在 `IssueCard` 组件中；`IssueRow` 同属 Board/List 视图，一并更新以保持一致 |
| 时序 | 「最新的消息的结束时间」 | 时间来源 = 最新消息的 `ended_at` | 跨 issue 所有 stage 取 id 最大的 message，用其 `ended_at`；若 `ended_at` 为 null（streaming 中），回退到 `created_at` |
| 数量 | 「一个最新更新时间」 | 单一字段 | 在 IssueDetailDto 上增加 `updated_at: string` 字段 |
| 条件 | 「按照最新的消息的结束时间来看」 | 时间值由消息计算得出，非存储字段 | 动态计算，不在 issue 表新增列（系统禁止 ALTER TABLE） |
| 视觉属性 | 未指定 | 无特殊视觉要求 | 复用现有 `formatRelativeTime` 显示格式 |

**来源**：Issue kickoff 消息（design stage 第一条用户消息）

## [design-time] 设计方案

### 现状分析

| 层 | 现状 | 文件 |
|----|------|------|
| 数据库 | `issue` 表无 `updated_at` 列；`message` 表有 `ended_at` 列（nullable，到达终态时设置） | `src/domain/issue/_internal/repository.ts`, `src/domain/message/_internal/repository.ts` |
| 领域模型 | `Issue` 接口无 `updated_at`；`Message` 接口有 `ended_at: string \| null` | `src/domain/issue/model.ts`, `src/domain/message/model.ts` |
| MessagePort | 有 `findLatestMessage(stageId)` 但无跨 stage 查询方法 | `src/domain/message/port.ts` |
| API DTO | `IssueDetailDto` 无 `updated_at` 字段 | `src/api-contracts/dto.ts` |
| API 路由 | `toIssueDetail` 不依赖 `messagePort`，不查询消息 | `src/adapter/http/routes/issue.route.ts` |
| 前端 IssueCard | 显示 `formatRelativeTime(issue.created_at)` | `src/web/components/IssueCard.tsx:28` |
| 前端 IssueRow | 显示 `formatRelativeTime(issue.created_at)` | `src/web/components/IssueRow.tsx:25` |

### 核心业务行为

1. **当 API 返回 Issue 详情时**，`updated_at` 字段应反映该 Issue 所有 Stage 中最新消息的结束时间（`ended_at`），若最新消息仍在 streaming（`ended_at` 为 null），则使用该消息的 `created_at` ← UA-1（时序修饰语）
2. **当 Issue 尚无任何消息时**，`updated_at` 应回退为 `issue.created_at` ← UA-1（时序修饰语，边界场景）
3. **当用户查看 Issue Board 卡片时**，应看到 `updated_at` 的相对时间显示，而非 `created_at` ← UA-1（空间修饰语）
4. **当用户查看 Issue List 行时**，同样显示 `updated_at` 的相对时间 ← UA-1（空间修饰语，IssueRow 同属 Board/List 视图，保持一致）

### 方案：动态计算 `updated_at`，跨 Stage 查询最新消息

#### 1. MessagePort 新增方法

在 `MessagePort` 接口新增 `findLatestMessageByIssueId`：

```typescript
/** 查询 issue 所有 stage 中最新一条消息（按 id DESC LIMIT 1） */
findLatestMessageByIssueId(issueId: string): Message | undefined;
```

SQL 实现（跨 `message` + `stage` 表 JOIN）：

```sql
SELECT m.* FROM message m
JOIN stage s ON s.id = m.stage_id
WHERE s.issue_id = ?
ORDER BY m.id DESC LIMIT 1
```

#### 2. API 层：`toIssueDetail` 注入 `messagePort`

`toIssueDetail` 的 deps 从 `Pick<IssueRoutesDeps, "stagePort" | "collaboration">` 扩展为 `Pick<IssueRoutesDeps, "stagePort" | "collaboration" | "messagePort">`。

计算逻辑：

```typescript
const latestMessage = deps.messagePort.findLatestMessageByIssueId(issue.id);
const updated_at = latestMessage ? (latestMessage.ended_at ?? latestMessage.created_at) : issue.created_at;
```

返回对象中增加 `updated_at`。

#### 3. DTO 类型

`IssueDetailDto` 增加 `updated_at: string` 字段。

#### 4. 前端显示

- `IssueCard.tsx`：`formatRelativeTime(issue.created_at)` → `formatRelativeTime(issue.updated_at)`
- `IssueRow.tsx`：`formatRelativeTime(issue.created_at)` → `formatRelativeTime(issue.updated_at)`

### 为什么不存储 `updated_at` 而是动态计算

1. **系统约束**：禁止 ALTER TABLE，无法在 `issue` 表新增列
2. **数据一致性**：动态计算始终反映最新状态，无需维护同步逻辑
3. **性能可接受**：Issue Board 典型场景 < 20 个 Issue，每 Issue 一次 SQL 查询（有索引 `idx_message_stage_id`），无性能瓶颈

### 不兼容更新

`IssueDetailDto` 新增 `updated_at: string` 字段。前端使用 `.passthrough()` 的 Zod schema 验证，不破坏现有验证。但任何硬编码 Issue DTO 字段列表的消费者需感知新字段。

## 验收标准

- [ ] `IssueDetailDto` 包含 `updated_at: string` 字段
- [ ] `updated_at` = 最新消息的 `ended_at`；若 `ended_at` 为 null，则 = 最新消息的 `created_at`
- [ ] Issue 无消息时，`updated_at` = `issue.created_at`
- [ ] IssueCard 显示 `updated_at` 的相对时间
- [ ] IssueRow 显示 `updated_at` 的相对时间
- [ ] 现有 Issue 相关测试通过
- [ ] WebSocket 实时更新后，`updated_at` 随 refetch 正确刷新

## 实现指引

### MessageRepository SQL 跨表 JOIN 注意事项

`message` 表和 `stage` 表在同一个 SQLite 数据库中。`SQLiteMessageRepository` 的 `db.initSchema(MESSAGE_SCHEMA)` 只初始化 message 相关表，但 SQL 查询可以 JOIN 已存在的 `stage` 表（由 `SQLiteStageRepository` 初始化）。需确认 `stage` 表在 `message` 查询时已存在——由于 `stage` 表是 issue 领域的 schema，且两个 repository 共享同一个 `SQLiteDatabase` 实例，表创建顺序由依赖注入保证，查询时表一定存在。

### `toIssueDetail` 调用点影响面

`toIssueDetail` 被以下 5 个路由调用，均通过 `deps` 传参，新增 `messagePort` 到 deps pick 不影响调用方（`IssueRoutesDeps` 已包含 `messagePort`）：

1. `GET /api/workspaces/:workspaceId` — 列表
2. `GET /api/workspaces/:workspaceId/issues` — 列表
3. `GET /api/issues/:issueId` — 单个
4. `POST /api/workspaces/:workspaceId/issues` — 创建
5. `POST /api/issues/:issueId/close` — 关闭

### 列表 API N+1 查询

`GET /api/workspaces/:workspaceId/issues` 返回 `IssueDetailDto[]`，每个 issue 调用一次 `findLatestMessageByIssueId`。当前 < 20 Issue 场景性能可接受。若未来 Issue 数量增长，可改为批量查询 `SELECT s.issue_id, MAX(m.id) FROM message m JOIN stage s ... GROUP BY s.issue_id`，再按 issue_id 映射。

### WebSocket 实时刷新路径

前端收到 `message_status_changed` 事件后，`useWebSocket.ts` 的 EventBatcher 会更新 issue detail cache。但 `updated_at` 是服务端计算字段，前端无法从 WS 事件中直接推导。需要确保 `message_status_changed` 事件触发 issue 列表 refetch（通过 `invalidateQueries` 或 `refetchStaleQueries`），使 `updated_at` 从服务端重新获取。

## 架构师-2 对抗审视

### 审查结论：方案通过，无阻塞问题

架构师-2 逐项验证了关键假设：

| 验证项 | 结果 | 证据 |
|--------|------|------|
| SQL JOIN 可行 | ✅ | `stage` 表有 `issue_id` 列，`message` 表有 `stage_id` 列，同一 SQLite DB |
| `ORDER BY m.id DESC` 跨 stage 正确 | ✅ | `message.id` 是 `INTEGER PRIMARY KEY AUTOINCREMENT`，全局自增 |
| `toIssueDetail` 签名扩展 | ✅ | 当前 `Pick<IssueRoutesDeps, "stagePort" \| "collaboration">`，`IssueRoutesDeps` 已含 `messagePort` |
| DTO 层 | ✅ | `IssueDetailDto = IssueDto & { ... }`，`IssueDto` 无 `updated_at`，加在 `IssueDetailDto` 合理 |
| 前端修改范围 | ✅ | IssueCard.tsx:28、IssueRow.tsx:25 确认显示 `created_at`；IssueConversation.tsx 和 PropertiesPanel.tsx 是详情页，保留不变 |
| 边界场景 | ✅ | 无消息回退、streaming 中回退、关闭 issue 不取 `closed_at` — 均符合用户意图 |

### 实现建议（已纳入实现指引）

1. **列表 API N+1 查询**：当前可接受，已补充批量查询优化方向
2. **WebSocket 实时刷新路径**：已补充前端 refetch 机制说明

### 共识

双方达成共识，方案正确完整，推进到 development。
