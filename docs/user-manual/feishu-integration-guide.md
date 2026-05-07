# 飞书接入操作指南

本文档面向实际接入操作者，目标是完成“在手机飞书里给机器人发文本，文本进入一个已存在的 Snail Shell Conversation，Snail 的可见回复再回到同一个飞书会话”的闭环。

## 0. 准备条件

1. 本地已经能正常启动 Snail Shell，并且 `config/llm.json` 已配置可用的 LLM。
2. 当前仓库依赖已经安装；如未安装，先在仓库根目录执行 `npm install`。
3. 已有一个飞书企业或团队，并且当前账号有创建企业自建应用、配置事件订阅和发布应用的权限。
4. 手机上已安装飞书，并登录同一个企业或团队账号。
5. 已决定要绑定的 Snail Shell Conversation。飞书接入不会自动创建 Project、Feature、Stage 或 Conversation，只会把消息投递到显式配置的 `conversation_id`。

## 1. 在飞书开放平台创建企业自建应用

1. 打开飞书开放平台，进入“开发者后台”。
2. 创建“企业自建应用”，记录应用的 `App ID` 和 `App Secret`。
3. 进入应用的“凭证与基础信息”页面，确认这两个值可见；不要把 `App Secret` 写入仓库或提交到 git。
4. 进入“事件订阅”或“事件与回调”页面，启用事件订阅。
5. 选择“长连接”作为事件订阅方式。当前 Snail Shell 使用飞书 Node SDK 的 `WSClient` 接收事件，不需要配置公网 HTTP 回调地址。
6. 添加事件 `im.message.receive_v1`，用于接收用户发给机器人或机器人所在群聊的文本消息。
7. 进入“权限管理”，至少开通应用接收消息事件和发送文本消息所需权限。权限名称会随飞书后台调整，按后台提示选择和 `im.message.receive_v1` 事件、发送 `im` 消息相关的权限。
8. 保存配置，并按飞书后台要求发布或安装应用到当前企业。未发布或未安装时，手机端通常无法真正和机器人对话。

## 2. 在飞书侧准备聊天会话

1. 如果要单聊机器人：在飞书客户端找到该应用机器人，打开会话。
2. 如果要群聊机器人：创建或选择一个飞书群，把应用机器人添加进群。
3. 在手机飞书中打开会话设置，找到“会话 ID”，记录该值作为后续 `bindings[].chat_id`。飞书的会话 ID 就是当前配置需要的 `chat_id`，通常形如 `oc_xxx`。
4. 在手机飞书中向机器人或机器人所在群发送一条普通文本消息，例如 `ping`。这一步用于后续验证事件投递和 Snail Shell 绑定是否正确。

## 3. 获取 `conversation_id`

1. 启动 Snail Shell Web 服务。
2. 打开 Snail Shell Web 页面，选择目标 Project、Feature、Stage 和 Conversation。
3. 从当前页面 URL、浏览器开发者工具的 API 响应，或 `/api/conversations/:conversationId` 相关请求中取得目标 Conversation 的 `id`。
4. 如果通过 API 确认，可以请求 `GET /api/projects/:projectId/conversations`，在返回列表中找到要绑定的 Conversation，并复制其 `id`。
5. 记录该值，后续填入 `config/feishu.json` 的 `bindings[].conversation_id`。

## 4. 获取飞书 `chat_id` 和可选 `tenant_key`

首选路径是在手机飞书中直接查看会话设置里的“会话 ID”。这个会话 ID 就是 Snail Shell 配置需要的 `chat_id`，应填入 `config/feishu.json` 的 `bindings[].chat_id`。

1. 打开手机飞书，进入要绑定的机器人单聊或机器人所在群聊。
2. 打开该会话的设置页。
3. 找到“会话 ID”，复制或记录该值。
4. 将该值填入 `config/feishu.json` 的 `bindings[].chat_id`。
5. 如果你只在单个企业内本地使用，可以先不填 `tenant_key`。如果需要租户隔离，再填飞书事件日志中展示的 `tenantKey`。

飞书开发者后台事件日志中的 `eventId` 不是 `chat_id`，不能填到 `bindings[].chat_id`。如果事件日志只显示 `eventId`、`tenantKey` 和 `errorInfo: "app not online"`，说明应用长连接当前没有在线；这类日志本身也不会提供 `chat_id`。

如果手机飞书无法查看会话 ID，可以使用备用路径：先准备一个临时绑定，让 Snail Shell 能启动飞书长连接，再通过未匹配绑定日志反查真实 `chatId`。

```json
{
  "enabled": true,
  "app_id_env": "FEISHU_APP_ID",
  "app_secret_env": "FEISHU_APP_SECRET",
  "bindings": [
    {
      "tenant_key": "",
      "chat_id": "temporary-chat-id",
      "conversation_id": "填入第 3 步获取到的真实 conversation_id"
    }
  ],
  "message_push": {
    "max_text_length": 4000,
    "include_user_messages": false
  }
}
```

备用路径步骤：

1. 按第 5 步创建 `config/feishu.json`，先把 `bindings[].chat_id` 填成一个明显不会匹配的临时值，例如 `temporary-chat-id`，但 `conversation_id` 必须填真实值。
2. 按第 6 步设置 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`，值来自同一个飞书企业自建应用。
3. 按第 7 步启动 Snail Shell，确认日志出现 `Feishu conversation channel started`。如果飞书事件日志仍显示 `app not online`，说明 Snail Shell 没有成功连上飞书长连接，需要先排查 App ID、App Secret、应用发布/安装状态或长连接事件订阅配置。
4. 保持 Snail Shell 运行，再从手机飞书向机器人或机器人所在群发送一条普通文本消息。
5. 因为当前 `chat_id` 是临时值，Snail Shell 应记录“未匹配绑定”相关日志，日志中会包含真实 `chatId`，可能也包含 `tenantKey`。
6. 复制日志里的真实 `chatId`，填回 `config/feishu.json` 的 `bindings[].chat_id`。如果需要租户隔离，再把日志或事件里的 `tenantKey` 填入 `bindings[].tenant_key`。
7. 重启 Snail Shell，让新的绑定生效。

如果飞书开发者后台能查看成功投递事件的完整原始 payload，也可以从事件详情中读取 `event.message.chat_id`。但在手机飞书已经能看到会话 ID 时，不需要走这条路径。

## 5. 配置本地 `config/feishu.json`

1. 在仓库根目录复制示例文件：`cp config/feishu.json.example config/feishu.json`。
2. 编辑 `config/feishu.json`。
3. 将 `enabled` 改为 `true`。
4. 保持 `app_id_env` 为 `FEISHU_APP_ID`，保持 `app_secret_env` 为 `FEISHU_APP_SECRET`，除非你明确要换环境变量名。
5. 在 `bindings` 中填写飞书会话和 Snail Shell Conversation 的绑定关系。
6. 建议保持 `message_push.include_user_messages=false`，避免你在飞书发出的消息又被机器人原样回显。

示例：

```json
{
  "enabled": true,
  "app_id_env": "FEISHU_APP_ID",
  "app_secret_env": "FEISHU_APP_SECRET",
  "bindings": [
    {
      "tenant_key": "",
      "chat_id": "oc_xxx",
      "conversation_id": "43befc97-d45d-4072-9dfa-c436a4233208"
    }
  ],
  "message_push": {
    "max_text_length": 4000,
    "include_user_messages": false
  }
}
```

真实 `config/feishu.json` 已被 `.gitignore` 忽略，不要提交该文件。

## 6. 设置飞书应用凭据环境变量

1. 在启动 Snail Shell 的同一个终端中设置环境变量。
2. macOS 或 Linux 示例：

```bash
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="xxx"
```

3. 如果用进程管理器、launchd、systemd 或其他服务方式启动 Snail Shell，要把这两个环境变量配置到实际启动服务的环境里，而不是只配置到临时终端。
4. 不要把 `App Secret` 写入 `config/feishu.json.example`、文档、commit、PR 或截图。

## 7. 启动并确认长连接接入

1. 在仓库根目录执行 `npm start`，或使用项目已有服务脚本启动。
2. 启动日志应出现 `Feishu conversation channel started`，并显示绑定数量。
3. 如果启动时报 `Feishu integration is enabled but FEISHU_APP_ID/FEISHU_APP_SECRET are not set`，说明环境变量没有进入当前进程。
4. 如果启动时报 `Feishu integration is enabled but @larksuiteoapi/node-sdk is not installed`，执行 `npm install` 后重新启动。
5. 如果飞书后台事件日志显示 `errorInfo: "app not online"`，说明飞书没有检测到当前应用的长连接在线；优先检查 Snail Shell 是否正在运行、App ID/App Secret 是否正确、应用是否已发布或安装、事件订阅是否选择长连接且启用了 `im.message.receive_v1`。
6. 如果长连接已在线但没有收到消息，检查机器人是否在对应单聊或群聊中。

## 8. 用手机飞书验证闭环

1. 打开手机飞书，进入已绑定的机器人单聊或群聊。
2. 发送一条普通文本消息，例如 `你好，Implementation Snail，请回复一句收到`。
3. 在 Snail Shell Web 页面打开绑定的 Conversation，确认该消息以 `Boss Snail` 输入出现。
4. 等待 Snail 回复；可见文本回复应由机器人推回同一个飞书会话，格式类似 `Implementation Snail:\n...`。
5. 如果 Web 里有输入但飞书没有回复，检查应用发送消息权限、机器人是否仍在群里，以及日志中飞书发送 API 是否报错。
6. 如果飞书消息没有进入 Web，检查 `chat_id` 是否和事件里的 `message.chat_id` 完全一致；配置了 `tenant_key` 时还要确认事件里的 `tenant_key` 完全一致。

## 9. 日常使用边界

1. 当前只支持文本消息。图片、文件、语音、卡片按钮和飞书云文档不会进入 Snail Shell 对话。
2. 飞书入站消息统一作为 `Boss Snail` 输入，当前不把飞书用户身份映射为 Snail Shell 内部权限主体。
3. 一个 `bindings` 条目只绑定一个飞书 `chat_id` 到一个已有 `conversation_id`。要绑定多个群或多个 Conversation，需要添加多个绑定条目并重启服务。
4. 更换绑定后需要重启 Snail Shell，因为飞书通道在服务启动时读取配置并订阅 Conversation 出站事件。
5. 飞书通道只推送 `text` 和 `content_block` 这类可见内容，不推送工具日志、内部 prompt、密钥或本地配置。

## 10. 常见问题排查

1. 手机里找不到机器人：确认企业自建应用已经发布或安装到当前企业，并且当前账号在可用范围内。
2. 机器人收不到消息事件：确认事件订阅使用长连接，已添加 `im.message.receive_v1`，并且应用具备接收消息事件权限。
3. Snail Shell 启动失败：确认 `config/feishu.json` 是合法 JSON，`enabled=true` 时环境变量存在，依赖已安装。
4. 不知道 `chat_id` 填什么：优先打开手机飞书会话设置，复制“会话 ID”，该值就是 `bindings[].chat_id`。
5. 后台只看到 `eventId` 且 `errorInfo` 是 `app not online`：先让 Snail Shell 用正确的 App ID/App Secret 启动飞书长连接；应用不在线时，本地拿不到这条消息的 `chatId`。
6. 后台能看到成功投递事件但找不到 `chat_id`：优先使用手机飞书会话设置中的会话 ID；也可以打开事件详情，查看原始 payload 中的 `event.message.chat_id`；不要把 `eventId` 填入 `bindings[].chat_id`。
7. 日志提示未匹配绑定：优先确认 `bindings[].chat_id` 是否等于手机飞书会话设置中的会话 ID；如配置了 `tenant_key`，同时确认租户值。
8. 飞书能进消息但没有回复：确认绑定的 `conversation_id` 是当前可工作的 Conversation，Snail Shell Web 中能看到 assistant 输出；再检查飞书发送消息权限和发送 API 日志。
9. 收到自己的消息回显：确认 `message_push.include_user_messages` 为 `false`。
