---
id: F20260702qeyb
title: dispatch idle 后 workspace 通知缺失修复
from_ids: [F20260701b3qx]
tags: [bugfix, websocket, board, realtime]
modules: [issue-collaboration]
---
# F20260702qeyb — dispatch idle 后 workspace 通知缺失修复

## 问题

IssueBoard 实时刷新间歇性失效：agent 完成后（ai_running → needs_human），board 页面不更新。

## 根因

`dispatch()` 方法有 4 条 idle 退出路径（无未读消息、agent 异常、正常完成、max rounds），全部缺少 workspace consumer 通知。

`notifyConsumers("onMessageCompleted")` 在 `invokeAgent()` 内部调用时，`dispatchStates` 仍为 "invoking"，导致 `getActivityStatus()` 返回 "ai_running" 而非 "needs_human"，`prev !== newStatus` 检查无变化，不触发 workspace 通知。

`invokeAgent()` 返回后 `dispatchStates` 被清空为 idle，但无任何代码通知 workspace consumers。

## 修复方案

1. 提取 `notifyWorkspaceIfStatusChanged(stageId)` 方法：检查 `getActivityStatus()` 并在状态变化时通知 workspace consumers
2. `notifyConsumers()` 内联逻辑替换为调用新方法
3. `dispatch()` 的 try-finally 结构确保所有退出路径（正常 break、异常、max rounds）均触发通知

## 改动文件

- `src/app/issue-collaboration/collaboration.ts` — 核心修复
- `tests/dispatch-idle-notification.test.ts` — 新增测试

## 验证

- `npm run check` 通过（lint + tsc + build）
- 185 tests passed（183 existing + 2 new）
