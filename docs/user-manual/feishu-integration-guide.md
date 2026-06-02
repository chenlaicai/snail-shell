# 飞书接入操作指南

本文档面向实际接入操作者。飞书 IM 以大厅模式接入 Snail Shell：一个飞书群 = 一个独立的大厅会话，通过斜杠命令导航项目、Issue 和 Conversation。

## 0. 准备条件

1. 本地已经能正常启动 Snail Shell，并且 `config/llm.json` 已配置可用的 LLM。
2. 当前仓库依赖已经安装；如未安装，先在仓库根目录执行 `npm install`。
3. 已有一个飞书企业或团队，并且当前账号有创建企业自建应用、配置事件订阅和发布应用的权限。
4. 手机上已安装飞书，并登录同一个企业或团队账号。

## 1. 在飞书开放平台创建企业自建应用

1. 打开飞书开放平台，进入"开发者后台"。
2. 创建"企业自建应用"，记录应用的 `App ID` 和 `App Secret`。
3. 进入应用的"凭证与基础信息"页面，确认这两个值可见；不要把 `App Secret` 写入仓库或提交到 git。
4. 进入"事件订阅"或"事件与回调"页面，启用事件订阅。
5. 选择"长连接"作为事件订阅方式。当前 Snail Shell 使用飞书 Node SDK 的 `WSClient` 接收事件，不需要配置公网 HTTP 回调地址。
6. 添加事件 `im.message.receive_v1`，用于接收用户发给机器人或机器人所在群聊的文本消息。
7. 进入"权限管理"，开通接收消息事件所需权限，并至少开通一个发送消息权限：`im:message:send_as_bot`、`im:message:send` 或 `im:message`。推荐优先申请 `im:message:send_as_bot`，因为当前 Snail Shell 使用机器人身份把 assistant 文本回复发回同一个飞书会话。
8. 保存配置，并按飞书后台要求发布或安装应用到当前企业。未发布或未安装时，手机端通常无法真正和机器人对话。

## 2. 在飞书侧准备聊天会话

1. 创建或选择一个飞书群，把应用机器人添加进群。
2. 在手机飞书中打开会话设置，找到"会话 ID"，记录该值作为后续 `allowed_chats[].chat_id`。飞书的会话 ID 就是当前配置需要的 `chat_id`，通常形如 `oc_xxx`。
3. 在手机飞书中向机器人所在群发送一条普通文本消息，例如 `ping`。这一步用于后续验证事件投递是否正确。

## 3. 获取飞书 `chat_id` 和可选 `tenant_key`

首选路径是在手机飞书中直接查看会话设置里的"会话 ID"。这个会话 ID 就是 Snail Shell 配置需要的 `chat_id`，应填入 `config/feishu.json` 的 `allowed_chats[].chat_id`。

1. 打开手机飞书，进入要绑定的机器人所在群聊。
2. 打开该会话的设置页。
3. 找到"会话 ID"，复制或记录该值。
4. 将该值填入 `config/feishu.json` 的 `allowed_chats[].chat_id`。
5. 如果你只在单个企业内本地使用，可以先不填 `tenant_key`。如果需要租户隔离，再填飞书事件日志中展示的 `tenantKey`。

飞书开发者后台事件日志中的 `eventId` 不是 `chat_id`，不能填到 `allowed_chats[].chat_id`。如果事件日志只显示 `eventId`、`tenantKey` 和 `errorInfo: "app not online"`，说明应用长连接当前没有在线；这类日志本身也不会提供 `chat_id`。

如果手机飞书无法查看会话 ID，可以使用备用路径：先准备一个临时配置，让 Snail Shell 能启动飞书长连接，再通过未匹配白名单日志反查真实 `chatId`。

```json
{
  "enabled": true,
  "app_id_env": "FEISHU_APP_ID",
  "app_secret_env": "FEISHU_APP_SECRET",
  "allowed_chats": [
    {
      "tenant_key": "",
      "chat_id": "temporary-chat-id"
    }
  ],
  "message_push": {
    "max_text_length": 4000
  }
}
```

备用路径步骤：

1. 按上例创建 `config/feishu.json`，先把 `allowed_chats[].chat_id` 填成一个明显不会匹配的临时值，例如 `temporary-chat-id`。
2. 按第 4 步设置 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`，值来自同一个飞书企业自建应用。
3. 启动 Snail Shell，确认日志出现 `Lobby-aware IM channel started`。如果飞书事件日志仍显示 `app not online`，说明 Snail Shell 没有成功连上飞书长连接，需要先排查 App ID、App Secret、应用发布/安装状态或长连接事件订阅配置。
4. 保持 Snail Shell 运行，再从手机飞书向机器人所在群发送一条普通文本消息。
5. 因为当前 `chat_id` 是临时值，Snail Shell 应记录"chat not in allowed_chats"相关日志，日志中会包含真实 `chatId`，可能也包含 `tenantKey`。
6. 复制日志里的真实 `chatId`，填回 `config/feishu.json` 的 `allowed_chats[].chat_id`。如果需要租户隔离，再把日志或事件里的 `tenantKey` 填入 `allowed_chats[].tenant_key`。
7. 重启 Snail Shell，让新的配置生效。

## 4. 配置本地 `config/feishu.json`

1. 在仓库根目录创建 `config/feishu.json`。
2. 将 `enabled` 设为 `true`。
3. 保持 `app_id_env` 为 `FEISHU_APP_ID`，保持 `app_secret_env` 为 `FEISHU_APP_SECRET`，除非你明确要换环境变量名。
4. 在 `allowed_chats` 中填写允许使用大厅的飞书群 `chat_id`。

示例：

```json
{
  "enabled": true,
  "app_id_env": "FEISHU_APP_ID",
  "app_secret_env": "FEISHU_APP_SECRET",
  "allowed_chats": [
    {
      "tenant_key": "",
      "chat_id": "oc_xxx"
    }
  ],
  "message_push": {
    "max_text_length": 4000
  }
}
```

真实 `config/feishu.json` 已被 `.gitignore` 忽略，不要提交该文件。

## 5. 大厅命令

| 命令 | 作用 |
|------|------|
| `/workspaces` | 列出所有工作区 |
| `/issues <workspace_id>` | 列出工作区下的 Issue |
| `/enter <issue_id>` | 进入 Issue 当前 Stage 的 Conversation |
| `/back` | 返回上一级 |
| `/lobby` | 直接回到大厅根 |
| `/status` | 查看当前位置 |
| `/help` | 显示帮助 |

## 6. 使用流程

1. 在飞书群中发送 `/workspaces`，查看可用工作区列表
2. 发送 `/issues <工作区ID>`，查看该工作区下的 Issue
3. 发送 `/enter <Issue ID>`，进入该 Issue 的 Conversation（房间）
4. 进入房间后，直接发文本消息即可与 Agent 对话，Agent 回复会推送到飞书群
5. 发送 `/back` 或 `/lobby` 退出房间，回到大厅导航

## 7. 注意事项

- 整个群共享一个导航状态（非 per-user）
- 进入房间后，群内所有消息（除 `/back`、`/lobby`、`/status`、`/help`）都会转发到 Conversation
- 大厅模式只接受 `allowed_chats` 中配置的群消息，未配置的群会被忽略
- 本群用户发的消息不会回显到本群；其他入口（Web UI、其他飞书群）的消息会正常同步推送
- Web 端"IM 大厅"页面可查看所有会话状态、重置会话、删除会话和查看消息审计

## 8. 设置飞书应用凭据环境变量

1. 在启动 Snail Shell 的同一个终端中设置环境变量。
2. macOS 或 Linux 示例：

```bash
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="xxx"
```

3. 如果用进程管理器、launchd、systemd 或其他服务方式启动 Snail Shell，要把这两个环境变量配置到实际启动服务的环境里，而不是只配置到临时终端。
4. 不要把 `App Secret` 写入 `config/feishu.json`、文档、commit、PR 或截图。

## 9. 启动并确认长连接接入

1. 在仓库根目录执行 `npm start`，或使用项目已有服务脚本启动。
2. 启动日志应出现 `Lobby-aware IM channel started`。
3. 如果启动时报 `Feishu integration is enabled but FEISHU_APP_ID/FEISHU_APP_SECRET are not set`，说明环境变量没有进入当前进程。
4. 如果启动时报 `Feishu integration is enabled but @larksuiteoapi/node-sdk is not installed`，执行 `npm install` 后重新启动。
5. 如果飞书后台事件日志显示 `errorInfo: "app not online"`，说明飞书没有检测到当前应用的长连接在线；优先检查 Snail Shell 是否正在运行、App ID/App Secret 是否正确、应用是否已发布或安装、事件订阅是否选择长连接且启用了 `im.message.receive_v1`。
6. 如果长连接已在线但没有收到消息，检查机器人是否在对应群聊中。

## 10. 用手机飞书验证闭环

1. 打开手机飞书，进入已配置的机器人所在群聊。
2. 发送 `/help`，应收到大厅帮助信息。
3. 发送 `/workspaces`，应收到工作区列表。
4. 发送 `/enter <Issue ID>`，进入房间后发送一条文本消息。
5. 在 Snail Shell Web 页面打开对应 Conversation，确认该消息以 `Boss Role` 输入出现。
6. 等待 Agent 回复；可见文本回复应由机器人推回飞书群。
7. 发送 `/back` 或 `/lobby` 退出房间。

## 11. 常见问题排查

1. 手机里找不到机器人：确认企业自建应用已经发布或安装到当前企业，并且当前账号在可用范围内。
2. 机器人收不到消息事件：确认事件订阅使用长连接，已添加 `im.message.receive_v1`，并且应用具备接收消息事件权限。
3. Snail Shell 启动失败：确认 `config/feishu.json` 是合法 JSON，`enabled=true` 时环境变量存在，依赖已安装。
4. 不知道 `chat_id` 填什么：优先打开手机飞书会话设置，复制"会话 ID"，该值就是 `allowed_chats[].chat_id`。
5. 后台只看到 `eventId` 且 `errorInfo` 是 `app not online`：先让 Snail Shell 用正确的 App ID/App Secret 启动飞书长连接；应用不在线时，本地拿不到这条消息的 `chatId`。
6. 日志提示 chat not in allowed_chats：确认 `allowed_chats[].chat_id` 是否等于手机飞书会话设置中的会话 ID；如配置了 `tenant_key`，同时确认租户值。
7. 飞书能进消息但没有回复：确认机器人已正确启动，检查飞书发送消息权限和发送 API 日志。如飞书返回缺少 `[im:message:send, im:message, im:message:send_as_bot]`，到应用权限管理中开通 `im:message:send_as_bot` 或任一提示的发送权限，完成审批、发布或安装后重试。
