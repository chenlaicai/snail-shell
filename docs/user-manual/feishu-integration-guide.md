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
3. 在手机飞书中向机器人或机器人所在群发送一条普通文本消息，例如 `ping`。
4. 保持 Snail Shell 暂时不要求已经收到该消息；这一步的作用是让飞书产生一条 `im.message.receive_v1` 事件，后面用来确认 `chat_id` 和可选的 `tenant_key`。

## 3. 获取 `conversation_id`

1. 启动 Snail Shell Web 服务。
2. 打开 Snail Shell Web 页面，选择目标 Project、Feature、Stage 和 Conversation。
3. 从当前页面 URL、浏览器开发者工具的 API 响应，或 `/api/conversations/:conversationId` 相关请求中取得目标 Conversation 的 `id`。
4. 如果通过 API 确认，可以请求 `GET /api/projects/:projectId/conversations`，在返回列表中找到要绑定的 Conversation，并复制其 `id`。
5. 记录该值，后续填入 `config/feishu.json` 的 `bindings[].conversation_id`。

## 4. 获取飞书 `chat_id` 和可选 `tenant_key`

飞书开发者后台的事件列表通常优先展示 `eventId`。`eventId` 只是这条事件记录的 ID，不能填到 `bindings[].chat_id`；`chat_id` 在事件详情的原始 payload 里，字段路径是 `event.message.chat_id`。

1. 先在飞书开发者后台打开事件调试、事件日志或事件订阅日志。
2. 找到刚才发送文本消息产生的 `im.message.receive_v1` 事件。如果列表里只看到 `eventId`，点击该事件进入详情。
3. 在事件详情中查看原始 JSON、请求体、payload 或 event 内容，找到 `event.message.chat_id`。它通常形如 `oc_xxx`，群聊和单聊都使用这个字段。
4. 如果详情中有 `tenant_key`，也一并记录。单租户本地使用可以不配置 `tenant_key`，只填 `chat_id`。如果同一个应用可能跨租户使用，或需要更严格隔离，应同时填写 `tenant_key`。
5. 如果后台页面无法展开原始 payload，可以用本地日志法：先启用飞书接入但暂不配置有效绑定，向机器人发送文本消息，让 Snail Shell 打印“未匹配绑定”的日志；日志中会包含 `chatId`，可能也包含 `tenantKey`。
6. 记录 `chat_id`，后续填入 `config/feishu.json` 的 `bindings[].chat_id`。

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
5. 如果长连接没有收到消息，优先检查飞书应用是否已发布或安装、事件 `im.message.receive_v1` 是否启用、机器人是否在对应单聊或群聊中。

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
4. 后台只看到 `eventId`，找不到 `chat_id`：打开该事件详情，查看原始 payload 中的 `event.message.chat_id`；不要把 `eventId` 填入 `bindings[].chat_id`。
5. 日志提示未匹配绑定：复制日志或飞书事件详情中的真实 `chat_id`，更新 `bindings[].chat_id`；如配置了 `tenant_key`，同时确认租户值。
6. 飞书能进消息但没有回复：确认绑定的 `conversation_id` 是当前可工作的 Conversation，Snail Shell Web 中能看到 assistant 输出；再检查飞书发送消息权限和发送 API 日志。
7. 收到自己的消息回显：确认 `message_push.include_user_messages` 为 `false`。
