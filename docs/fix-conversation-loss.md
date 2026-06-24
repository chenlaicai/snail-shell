# 对话丢失修复方案

## 问题描述

drainStage 中 advanceCursor 在 invokeAgent 之前执行，失败后消息被标记为已读但未处理，下次 drain 无法重试，导致对话永久丢失。getUnreadMessages 和 findLatestRespondingSpeaker 全量加载消息再内存过滤，长对话中 listByStage 默认 limit=50 导致早期上下文被静默截断。resolveToSpeakers 中多余的广播分支改变了既有路由语义。

---

## 根因分析

### 主因：Cursor 时序缺陷（HIGH）

`drainStage` 中 `advanceCursor` 和 `deleteCallSignal` 在 `invokeAgent` 之前执行。如果 invokeAgent 失败，消息被标记为"已读"但从未处理，下次 drain 无法重试。

### 次要因素：SQL 层全量加载（MEDIUM）

`getUnreadMessages` 调用 `listByStage(stageId, Number.MAX_SAFE_INTEGER)` 全量加载再内存过滤。`findLatestRespondingSpeaker` 同样全量加载再反向遍历。

### 次要因素：listByStage 50条限制（MEDIUM）

`drainStage` 用户分支调用 `listMessages(stageId).at(-1)` 使用默认 limit=50，长对话中返回的是第 50 条消息而非最新消息。

---

## 锁定修复方案（两位架构师一致同意 + 用户确认）

### 变更 1: Cursor 时序 — 推迟到成功后（HIGH）

**文件**: `collaboration.ts` — `drainStage`

**设计**: 将 `advanceCursor` 和 `deleteCallSignal` 移到 `invokeAgent` 之后。失败时 cursor 不推进，call signal 保留，下次 drain 可重试。

### 变更 2: SQL 层优化（LOW）

**文件**: `repository.ts` + `adapter.ts` + `port.ts`

**设计**: 新增 3 个专用 SQL 方法：

- `listByStageAfterId(stageId, afterId)`：`WHERE id > ? ORDER BY id ASC`，getUnreadMessages 改用此方法
- `findLatestRespondingSpeaker(stageId)`：SQL 直接查询 `ORDER BY id DESC LIMIT 1`，adapter 改为委托 repository
- `findLatestMessage(stageId)`：`ORDER BY id DESC LIMIT 1`，drainStage 用户分支改用此方法

`listByStage` 保持现有签名和默认 limit=50 不变。

### 变更 3: 移除广播逻辑（HIGH）

**文件**: `collaboration.ts` — `resolveToSpeakers`

**设计**: 删除 `if (others.length > 1)` 广播分支，恢复纯 3 层路由：mention → last speaker → primary role。

---

## 优先级排序

| # | 变更 | 优先级 | 理由 |
|---|------|--------|------|
| 1 | Cursor 时序：推迟到成功后 | HIGH | 唯一真正导致对话丢失的 bug |
| 2 | SQL 层优化 | LOW | 消除全量加载，listByStage 保持不变 |
| 3 | 移除广播逻辑 | HIGH | 恢复既有路由语义 |

---

## 涉及文件

- `src/app/issue-collaboration/collaboration.ts` — drainStage 时序 + resolveToSpeakers 路由恢复
- `src/domain/message/_internal/adapter.ts` — getUnreadMessages/findLatestRespondingSpeaker/findLatestMessage 委托 repository
- `src/domain/message/_internal/repository.ts` — 新增 3 个 SQL 方法
- `src/domain/message/port.ts` — 新增 findLatestMessage 接口方法

---

## 验证计划

1. **Cursor 测试**: invokeAgent 失败时，cursor 不推进，call signal 保留，下次 drain 可重试
2. **路由测试**: 有 @mention 时精确路由；无 @mention 时路由到 last speaker 或 primary role
3. **长对话测试**: 超过 50 条消息时，getUnreadMessages 不截断
