---
id: F2026052801
title: conversation-switch-scroll-position
from_ids: [F2026052705]
tags: [ui, scroll, conversation-switch, bug-fix]
modules: [project_management]
doc_kind: spec
---

# F2026052801 [project_management] 切换对话时滚动位置异常

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

用户点击切换对话时，偶现新对话自动跳转到消息顶部而非底部。

排查确认根因：`MessageList.render()` 中 `wasAtBottom` 的判断基于容器的**当前滚动位置**，该位置属于**前一个对话**。当用户在前一个对话中正在查看历史消息（已上拉，`scrollTop` 远小于 `scrollHeight`）时，`wasAtBottom = false`，新对话的消息加载后不会自动滚底，导致用户看到新对话的顶部。

相关代码路径：
- `src/web/components/message-list.js` — `render()` 方法的 `wasAtBottom` 判断（第 76 行）
- `src/web/app.js` — `selectConversation()` 中 `renderActiveMessages()` 和 `loadMessages()` 的调用顺序（第 666、676 行）

## 目标

- 切换对话后，始终自动滚动到新对话的最新消息（底部）
- 不影响正常的消息自动滚底行为（流式回复、发送消息后）
- 不影响上拉加载历史消息时的滚动位置保持

## 非目标

- 不改变数据库消息存储格式或表结构
- 不新增后端 API
- 不改变上拉加载历史消息的逻辑

## 设计

### 修复方案

在 `MessageList` 中增加 `_forceScrollToBottom` 标志位：

1. **`scrollToBottom()`** 方法（已有，第 108 行）：增加设置 `_forceScrollToBottom = true` 的逻辑
2. **`render()`** 方法：自动滚底条件从 `wasAtBottom` 改为 `wasAtBottom || _forceScrollToBottom`；滚底后重置标志位
3. **`selectConversation()`**：在 `loadMessages()` 完成后调用 `messageList.scrollToBottom()`

### 滚动行为矩阵

| 场景 | 触发条件 | 滚底行为 |
|---|---|---|
| 切换对话 | `_forceScrollToBottom = true` | 始终滚底 |
| 流式回复进行中 | `wasAtBottom = true`（用户在底部） | 自动滚底 |
| 用户查看历史 | `wasAtBottom = false` | 不滚底 |
| 上拉加载历史 | `_isLoadingMore = true` | 不滚底（已有保护） |

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 改动 |
|---|---|
| `src/web/components/message-list.js` | `scrollToBottom()` 增加 `_forceScrollToBottom` 标志设置；`render()` 检查该标志 |
| `src/web/app.js` | `selectConversation()` 在 `loadMessages()` 完成后调用 `messageList.scrollToBottom()` |

## 验证

### 通用

- [ ] ESLint 零告警
- [ ] TypeScript 编译通过
- [ ] 全部测试通过

### 功能验证

- [ ] 在对话 A 中上拉查看历史消息，点击对话 B，确认自动滚到底部
- [ ] 在对话 A 中已在底部，点击对话 B，确认自动滚到底部
- [ ] 在对话中发送消息，流式回复完成后确认自动滚到底部
- [ ] 在对话中上拉查看历史，收到新消息时确认不自动滚底

## 关联

- **依赖**: F2026052705（会话历史消息上拉加载）— 引入了 `wasAtBottom` 智能滚底逻辑
- **回归**: F2026052705 的 `render()` 修改导致切换对话时 `wasAtBottom` 判断基于前一个对话的滚动位置

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | `selectConversation` 中 `loadMessages` 后调用 `scrollToBottom()` 与 `render()` 中的 `_forceScrollToBottom` 可能双重触发 | `render()` 中滚底后立即重置标志位；`scrollToBottom()` 设置标志位不直接操作 scrollTop，由下一次 render 统一处理 | 2026-05-28 |
