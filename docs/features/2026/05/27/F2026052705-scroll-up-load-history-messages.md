---
id: F2026052705
title: scroll-up-load-history-messages
from_ids: []
tags: [ui, message-list, conversation-history]
modules: [project_management]
doc_kind: spec
---

# F2026052704 [project_management] 会话历史消息上拉加载

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

用户在 Snail Shell 会话对话框中上拉想查看更早的对话历史时，发现只能看到最近约 20 条消息，更早的消息在界面上完全不可见。

排查确认：数据在 SQLite 数据库中完好无损（"初始研发迭代" conversation 有 30 条消息，"不在黑白名单中的操作审批" conversation 有 74 条消息），但前端存在两个根因导致历史消息无法查看：

1. **前端只拉最近 N 条**：`message-sync-controller.js` 始终调用 `/messages/recent?limit=20`，只取最新 20 条。不存在上拉加载更早消息的 scroll 事件监听或分页逻辑。
2. **replaceHistory() 全量替换**：每次 `loadMessages()` 调用 `replaceHistory()` 用最新 20 条替换整个内存 store。流式响应完成后 `reconcileMessagesAfterStreaming()` 再次调用 `loadMessages()`，把可能已存在的更多消息再次截断到最近 20 条。

后端已有分页 API（`/messages/page?limit=N&offset=N`）但前端从未使用。

## 目标

- 用户在会话对话框中上拉到顶部时，自动加载并展示更早的历史消息
- 加载更早消息时保持当前滚动位置不变（不跳屏）
- 流式响应完成或 WebSocket 重连后不丢失已加载的历史消息
- 消息已在数据库中 → 不涉及数据迁移或存储变更

## 非目标

- 不改变数据库消息存储格式或表结构
- 不新增后端 API（复用已有的 `/messages/page`）
- 不增加"加载更多"按钮或视觉指示器（纯 scroll 触发，最小改动）
- 不改变消息搜索或全文检索逻辑

## 设计

### 数据流

```
用户上拉到顶 (scrollTop ≤ 50)
  → MessageList._loadMore()
    → app.loadMoreMessages()
      → messageSync.loadOlderMessages()
        → GET /messages/page?limit=20&offset={N}
        → store.prependHistory()  // 向前追加，自动去重
        → 返回新增条数
      ← store.onChange → render()
    ← MessageList 调整 scrollTop 保持视口内容不变
```

### 新增方法

- **message-store.js `prependHistory()`**：将消息追加到 records 数组**前面**，自动按 ID 去重，返回新增条数
- **message-store.js `setHasMore()`**：标记是否还有更多可加载
- **message-sync-controller.js `loadOlderMessages()`**：调用分页 API，管理 offset，驱动 prependHistory

### 修改行为

- **message-list.js `render()`**：仅当用户在底部时才自动滚到底（不再强制滚底），避免打断阅读历史
- **reconcileMessagesAfterStreaming()**：不再调用 `loadMessages()` 全量替换，改为只更新 `hasMore` 状态
- **onSocketOpen**：不再调用 `loadMessages()` 全量替换，实时事件已足够同步状态

### 滚动位置保持

`_loadMore()` 在调用 `onLoadMore` 前记录 `scrollHeight` 和 `scrollTop`，加载完成后用差值调整 `scrollTop`：`newScrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight)`。

`render()` 中增加 `_isLoadingMore` 保护：加载更早消息期间的 render 不触发自动滚底。

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 改动 |
|---|---|
| `src/web/message-store.js` | 新增 `prependHistory()`、`setHasMore()`；`hasMore` 加入 state |
| `src/web/message-sync-controller.js` | 新增 `loadOlderMessages()`；`loadMessages()` 初始化 hasMore；使用 cursor-based（`before` 消息 ID）分页替代 offset-based |
| `src/web/components/message-list.js` | 新增 scroll 事件监听、`_loadMore()`、`hasMore` 状态检查；`render()` 智能滚底 |
| `src/web/app.js` | 注册 `onLoadMore`；新增 `loadMoreMessages()`；修复 `reconcileMessagesAfterStreaming` 和 `onSocketOpen` 不丢历史 |
| `src/persistence/store.ts` | 新增 `getMessagesBefore()` 方法，支持按消息 ID 游标查询前 N 条 |
| `src/project-workflow/manager-queries.ts` | `getConversationMessagesPage()` 增加 `before` 游标参数 |
| `src/project-workflow/manager.ts` | 透传 `before` 参数 |
| `src/interaction-entry/api/server.ts` | `/messages/page` 路由透传 `before` 查询参数 |

## 验证

### 通用

- [ ] ESLint 零告警
- [ ] TypeScript 编译通过
- [ ] 全部 42 个测试通过
- [ ] `message-store` 单元测试通过

### 功能验证

- [ ] 切换到一个有 30+ 条历史消息的 conversation，上拉到顶部后出现更早消息
- [ ] 加载更早消息时滚动位置不跳动
- [ ] assistant 流式回复完成后，已加载的历史消息仍在
- [ ] WebSocket 断开重连后，已加载的历史消息仍在
- [ ] 切换 conversation 后状态正确刷新

## 关联

- **相关**: F2026052701（SOP 采用机制优化）— 同 project_management 模块
- **相关**: F2026052702（Feature Doc 生命周期阶段分离）— 同 project_management 模块

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | `reconcileMessagesAfterStreaming` 和 `onSocketOpen` 中原有的 `loadMessages()` 调用会丢弃已加载的历史消息 | 移除这两个场景的 `loadMessages()` 调用；实时事件已足够同步状态 | 2026-05-27 |
| 2 | 分页 API `/messages/page` 返回的消息已包含 events，但不含 context | 可接受；历史消息展示不需要 context（context 仅用于 AI prompt 构建） | 2026-05-27 |
| 3 | 原始 offset-based 分页（`offset=0` 从最早消息开始）导致上拉历史出现断层——初始显示最新 20 条（如 55-74），首次上拉加载最早 20 条（1-20），中间缺失 21-54 | 改用 cursor-based 分页：API 新增 `before` 参数（基于最早可见消息 ID），直接定位到当前窗口之前的一页。后端新增 `getMessagesBefore()` 方法，前端 `loadOlderMessages()` 移除 `loadMoreOffsets` Map，改为追踪最早消息 ID 作为游标 | 2026-05-27 |
| 4 | `hasMore` 状态被写入 store，但 scroll 触发逻辑未读取，导致到达历史尽头后仍反复请求 | `MessageList` 在 `render()` 时捕获 `hasMore` 状态，`_bindScroll` 在 `_hasMore === false` 时跳过请求 | 2026-05-27 |
