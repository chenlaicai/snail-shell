---
id: F2026062201
title: stop-button
from_ids: []
tags:
  - web
  - feature
  - agent
modules:
  - web
  - issue-collaboration
doc_kind: spec
---

# F2026062201 [web] 对话界面添加 Snail 中断按钮

## 背景

在 issue 对话界面中，当 AI agent 正在生成回复（streaming 状态）时，用户无法中断当前操作。如果 agent 陷入循环或生成不需要的内容，用户只能等待其完成或刷新页面。

## 目标

1. 在 streaming 状态的 AI 消息旁新增 Stop 中断按钮
2. 点击 Stop 后通过 AbortSignal 优雅终止 agent 子进程（SIGINT → SIGTERM → SIGKILL）
3. 中断后消息状态标记为 `interrupted`，WebSocket 实时推送状态变更

## 非目标

1. 不支持部分撤销已生成的内容
2. 不支持中断后恢复生成

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当用户发送消息触发 AI 回复时 | 系统应该在 streaming 消息旁显示 Stop 按钮 | - |
| B2 | 当用户点击 Stop 按钮时 | 系统应该终止 agent 进程，消息状态变为 interrupted | - |
| B3 | 当 agent 被中断时 | 系统应该通过 WebSocket 推送 `message_interrupted` 事件 | - |
| B4 | 当消息非 streaming 状态时 | 系统不应该显示 Stop 按钮 | - |

## 设计

### 接口层

- `port.ts`：`CollaborationInput` 新增 `interruptMessage` 字段

### 核心层

- `collaboration.ts`：AbortController 生命周期管理，信号注入 invokeOptions

### 路由层

- `issue.route.ts`：新增 `POST /api/stages/:stageId/messages/:messageId/interrupt` 端点

### 契约层

- `endpoints.ts`：interrupt 端点类型定义

### 前端

- `ChatMessage.tsx`：streaming 消息旁渲染 Stop 按钮
- `IssueConversation.tsx`：串联 interrupt API 调用

## 生效路径

- `src/api-contracts/endpoints.ts`
- `src/app/issue-collaboration/collaboration.ts`
- `src/app/issue-collaboration/port.ts`
- `src/infra/http/routes/issue.route.ts`
- `src/web/components/ChatMessage.tsx`
- `src/web/pages/IssueConversation.tsx`

## 改动范围

- `src/api-contracts/endpoints.ts`
- `src/app/issue-collaboration/collaboration.ts`
- `src/app/issue-collaboration/port.ts`
- `src/infra/http/routes/issue.route.ts`
- `src/web/components/ChatMessage.tsx`
- `src/web/pages/IssueConversation.tsx`
