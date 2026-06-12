# IM 模块待实现：Lobby 功能

## 现状

IM 模块当前只有传输层（feishu/wecom webhook + sendText/patchText）和类型定义。
`model.ts` 中的 `LobbySession`、`LobbyMessage`、`NavigationLevel` 已定义但未使用。
消息从 IM 到 agent 的链路完全断裂。

## 缺失组件

### P0 — 核心路由链路

| 组件 | 说明 | 依赖 |
|---|---|---|
| `LobbyCommandParser` | 解析 slash 命令（/workspaces, /issues, /enter, /back, /lobby, /status, /help） | 无 |
| `LobbyRouter` | 路由决策：slash 命令 vs 普通消息转发 | LobbyCommandParser |
| `LobbySessionStore` | 会话状态持久化（lobby_session + lobby_message 表） | SQLiteDatabase |
| `LobbyCommandExecutor` | 命令执行 | WorkspacePort, IssuePort, StagePort（跨域 port） |
| `PlainTextLobbyRenderer` | 响应渲染 | 无 |

### P1 — 会话生命周期

| 组件 | 说明 | 依赖 |
|---|---|---|
| 完整 `LobbyAwareChannel` | 订阅管理、echo 防护、流式会话、重启恢复 | LobbyRouter, ConversationGateway |
| `ConversationGateway` port | IM → agent 消息桥接 | MessagePort（跨域） |
| `FeishuStreamingSession` | 防抖 + PATCH 流式响应 | FeishuTransport |

### P2 — 管理界面

| 组件 | 说明 |
|---|---|
| Lobby REST API | Web UI 管理端点 |
| Web UI "IM Lobby" 模块 | 会话列表、导航状态、审计日志 |

## 数据库

需要新增表（参考 v1 schema）：
- `lobby_session` — 会话状态（channel_type, chat_id, navigation_level, current_workspace/issue/stage）
- `lobby_message` — 审计日志（direction, command, content, response_content）

## 参考

- v1 实现：`v1/src/lobby/`（types, session-store, command-parser, command-executor, response-renderer, router）
- v1 通道层：`v1/src/interaction-entry/im-channel/lobby-aware-channel.ts`
- 设计文档：`docs/features/2026/05/29/F2026052905-im-lobby.md`
