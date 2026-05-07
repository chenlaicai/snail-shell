# F2026050607 飞书接入

## 背景

Snail Shell 当前已有 Web 对话入口，用户可以通过 HTTP API 与 WebSocket 进入 Conversation，消息随后由 `ProjectManager.sendStructuredMessage`、ConversationQueue、MessageBus、mention 和结构化消息模型处理。

本 feature 的目标是把飞书接入成“当前已有 Web 对话”的同级入口：用户可以在已绑定的飞书会话里和 Snail 对话，Snail 的可见回复回到飞书。飞书不能成为绕过 Snail Shell 核心协作模型的旁路，也不能在架构上被做成一次性单点功能。

## 目标

1. 引入统一 Conversation 接入通道，让 Web HTTP、WebSocket 和飞书共享同一套入站规范化、消息发送、事件订阅和历史回填边界。
2. 支持企业自建飞书应用通过长连接接收文本消息，并把消息投递到配置绑定的 Snail Shell Conversation。
3. 支持 Snail Shell Conversation 的 assistant 可见文本或结构化文本输出推送回绑定的飞书 chat。
4. 支持本地配置飞书 app 凭据环境变量、chat 到 conversation 的绑定关系和出站文本长度限制。
5. 保持飞书入口复用 `ProjectManager.sendStructuredMessage`，不绕过现有 Conversation、MessageBus、mention、协作轮次和阶段/产物约束。
6. 提供面向操作者的飞书接入步骤，覆盖飞书开放平台、本地配置、Snail Shell 绑定、手机飞书验证和排障。
7. 覆盖统一接入通道与飞书通道的自动化测试，并通过完整检查。

## 非目标

1. 不实现飞书云文档、审批、通讯录同步、文件下载、语音、图片内容解析和多维表格能力。
2. 不实现卡片按钮、问题卡片交互和飞书侧阶段/PR 操作入口；本次只打通文本对话链路。
3. 不实现飞书 chat 自动创建 Project、Feature、Stage 或 Conversation；绑定关系必须由本地配置显式提供。
4. 不支持多租户/多应用管理后台；当前以单个企业自建应用的本地配置为边界。
5. 不把飞书用户身份映射为 Snail Shell 内部权限主体；飞书入站消息统一作为 `Boss Snail` 输入。

## 设计

### 外部能力事实

1. 飞书企业自建应用支持通过 Node SDK `@larksuiteoapi/node-sdk` 的 `WSClient` 订阅 `im.message.receive_v1` 事件。
2. 长连接模式不要求本地服务暴露公网回调地址，适合 Snail Shell 当前本地和私有环境的开发使用。
3. 飞书事件处理需要快速返回，否则会触发重试；因此飞书 transport 只做事件解析并调度后台处理，实际对话处理交给统一 Conversation 接入通道和现有队列。
4. 机器人发送消息使用飞书消息发送 API，当前实现只发送 `text` 消息，避免把卡片交互、模板权限和按钮回调纳入本轮范围。
5. 飞书消息存在长度与频率限制；当前实现提供出站文本最大长度配置和截断，复杂限流留待需要时在 transport 层扩展。

### 统一 Conversation 接入通道

新增 `ConversationGateway` 作为 Web 与 Feishu 的共同接入边界。

职责：

1. 将外部入口的 `content` 或 `events` 统一规范化为 Snail Shell `MessageInputEvent[]`。
2. 统一校验外部入口只允许 `text` 与 `content_block` 这类内容事件，避免 transport 直接写入工具、命令或信号事件。
3. 统一调用 `ProjectManager.sendStructuredMessage`，并传递 `fromSnail`、`quotedMessageId`、`askerSnail` 和 `clientId`。
4. 订阅 `ProjectManager` 的 `agent-event`，向 WebSocket 和 Feishu 这类接入方发布统一 `ConversationOutboundEvent`。
5. 提供 conversation 事件回填能力，WebSocket 不再直接读 ProjectManager 形成独立事件流逻辑。

这个边界使 Web 和 Feishu 都是 Conversation 的接入通道，而不是各自实现一套消息发送和事件订阅逻辑。

### Web 接入调整

`src/api/server.ts` 保留 HTTP API 和 WebSocket 协议，但不再直接承担所有入站规范化与出站事件订阅职责：

1. HTTP `POST /api/conversations/:conversationId/messages` 通过 `ConversationGateway.sendMessage` 发送消息。
2. WebSocket `send_message` 通过 `ConversationGateway.sendMessageAsync` 异步发送消息并回传错误。
3. WebSocket 通过 `ConversationGateway.subscribe` 接收统一 conversation 事件。
4. WebSocket 初始连接通过 `ConversationGateway.getBackfill` 回填历史事件。

### 飞书接入

新增 `src/integrations/feishu/`：

1. `config.ts` 读取 `config/feishu.json`，缺省为关闭。真实 `config/feishu.json` 被 `.gitignore` 忽略，仓库只提交 `config/feishu.json.example`。
2. `sdk-transport.ts` 封装飞书 Node SDK，负责启动长连接、解析 `im.message.receive_v1` 文本消息和发送飞书文本消息。
3. `channel.ts` 实现 `FeishuConversationChannel`，把飞书 transport 和 `ConversationGateway` 连接起来。
4. `message-renderer.ts` 将 Snail Shell message events 渲染成飞书文本，并按配置截断。

入站路径：

1. `main.ts` 启动时读取 `config/feishu.json`。
2. `enabled=false` 时不加载飞书通道，不影响 Web 使用。
3. `enabled=true` 时从配置指定的环境变量读取 app id 和 app secret，启动 `FeishuSdkTransport`。
4. 飞书文本消息按配置绑定匹配 `conversation_id`；绑定配置了 `tenant_key` 时必须要求事件租户一致，绑定未配置 `tenant_key` 时才退化为只按 `chat_id` 匹配。
5. 匹配成功后，构造 `clientId=feishu:<tenant>:<chat>:<message>`，由 channel 后台调用 `ConversationGateway.sendMessage` 进入现有 Conversation，transport handler 不等待完整 Snail 协作链路完成。
6. 未匹配绑定的飞书消息只记录日志，不自动创建内部工作对象。
7. 入站去重只在 Snail Shell 成功接收消息后确认；处理失败保留飞书重试能力，并通过 TTL 与容量上限约束进程内去重状态生命周期。

出站路径：

1. `FeishuConversationChannel` 订阅绑定 Conversation 的统一出站事件。
2. 只推送 `message_event_appended` 中 `text` 与 `content_block` 事件。
3. 默认不回显 `Boss Snail` 输入，避免用户在飞书发送消息后收到自己的消息副本。
4. assistant 输出渲染为 `SnailName:\n内容` 并发送到绑定的飞书 chat。

### 配置

新增 `config/feishu.json.example`：

```json
{
  "_help": "复制本文件为 config/feishu.json 后再填写。config/feishu.json 会被 git 忽略，不要提交真实 app secret、chat 绑定或内部 conversation id。",
  "_enabled_help": "是否启用飞书接入。false 表示完全不启动飞书长连接；配置好飞书应用凭据和 bindings 后改为 true。",
  "enabled": false,
  "_app_id_env_help": "保存飞书企业自建应用 App ID 的环境变量名，不是 App ID 本身。例如保持 FEISHU_APP_ID，然后在启动前设置环境变量 FEISHU_APP_ID=cli_xxx。",
  "app_id_env": "FEISHU_APP_ID",
  "_app_secret_env_help": "保存飞书企业自建应用 App Secret 的环境变量名，不是 App Secret 本身。例如保持 FEISHU_APP_SECRET，然后在启动前设置环境变量 FEISHU_APP_SECRET=xxx。",
  "app_secret_env": "FEISHU_APP_SECRET",
  "_bindings_help": "飞书会话到 Snail Shell Conversation 的显式绑定列表。每个绑定只把一个飞书 chat 投递到一个已存在的 conversation_id；不会自动创建 Project、Feature 或 Conversation。",
  "bindings": [
    {
      "_tenant_key_help": "飞书租户标识。多租户或需要租户隔离时填写事件里的 tenant_key；单租户本地使用可以留空，留空时只按 chat_id 匹配。",
      "tenant_key": "",
      "_chat_id_help": "飞书群聊或单聊的 chat_id，来自飞书 im.message.receive_v1 事件 message.chat_id。只有这个 chat 的文本消息会进入下方 conversation_id。",
      "chat_id": "",
      "_conversation_id_help": "Snail Shell 已存在的 Conversation ID。飞书消息会作为 Boss Snail 输入发送到这个 Conversation。",
      "conversation_id": ""
    }
  ],
  "_message_push_help": "Snail Shell 回复推回飞书的控制项。当前只推送可见文本和 content_block，不推送工具日志、密钥或本地配置。",
  "message_push": {
    "_max_text_length_help": "单条推送到飞书的最大文本长度，超过会截断。建议不要超过飞书文本消息限制；默认 4000。",
    "max_text_length": 4000,
    "_include_user_messages_help": "是否把 Boss Snail 的输入也推回飞书。通常保持 false，避免用户在飞书发出的消息又被机器人回显一遍。",
    "include_user_messages": false
  }
}
```

`tenant_key` 可为空；为空时只按 `chat_id` 匹配，适合单租户本地配置。`include_user_messages=false` 是默认行为，防止把用户飞书输入再次推回飞书。

### 安全与边界

1. `config/feishu.json` 被忽略，不提交真实 chat 绑定和密钥配置。
2. 飞书 app secret 通过环境变量读取，不写入数据库和配置示例。
3. 飞书入站只能转换为 `text` 输入，不能从飞书直接注入 command、tool、signal 等内部事件。
4. 飞书未绑定 chat 不自动创建 Feature 或 Conversation，避免外部群聊误触发内部工作流。
5. 飞书出站只发送用户可见的文本/结构化文本，不发送 prompt、tool 原始日志、密钥和本地配置。

### 操作步骤

本节面向实际接入操作者，目标是完成“在手机飞书里给机器人发文本，文本进入一个已存在的 Snail Shell Conversation，Snail 的可见回复再回到同一个飞书会话”的闭环。

#### 0. 准备条件

1. 本地已经能正常启动 Snail Shell，并且 `config/llm.json` 已配置可用的 LLM。
2. 当前仓库依赖已经安装；如未安装，先在仓库根目录执行 `npm install`。
3. 已有一个飞书企业或团队，并且当前账号有创建企业自建应用、配置事件订阅和发布应用的权限。
4. 手机上已安装飞书，并登录同一个企业或团队账号。
5. 已决定要绑定的 Snail Shell Conversation。飞书接入不会自动创建 Project、Feature、Stage 或 Conversation，只会把消息投递到显式配置的 `conversation_id`。

#### 1. 在飞书开放平台创建企业自建应用

1. 打开飞书开放平台，进入“开发者后台”。
2. 创建“企业自建应用”，记录应用的 `App ID` 和 `App Secret`。
3. 进入应用的“凭证与基础信息”页面，确认这两个值可见；不要把 `App Secret` 写入仓库或提交到 git。
4. 进入“事件订阅”或“事件与回调”页面，启用事件订阅。
5. 选择“长连接”作为事件订阅方式。当前 Snail Shell 使用飞书 Node SDK 的 `WSClient` 接收事件，不需要配置公网 HTTP 回调地址。
6. 添加事件 `im.message.receive_v1`，用于接收用户发给机器人或机器人所在群聊的文本消息。
7. 进入“权限管理”，至少开通应用接收消息事件和发送文本消息所需权限。权限名称会随飞书后台调整，按后台提示选择和 `im.message.receive_v1` 事件、发送 `im` 消息相关的权限。
8. 保存配置，并按飞书后台要求发布或安装应用到当前企业。未发布或未安装时，手机端通常无法真正和机器人对话。

#### 2. 在飞书侧准备聊天会话

1. 如果要单聊机器人：在飞书客户端找到该应用机器人，打开会话。
2. 如果要群聊机器人：创建或选择一个飞书群，把应用机器人添加进群。
3. 在手机飞书中向机器人或机器人所在群发送一条普通文本消息，例如 `ping`。
4. 保持 Snail Shell 暂时不要求已经收到该消息；这一步的作用是让飞书产生一条 `im.message.receive_v1` 事件，后面用来确认 `chat_id` 和可选的 `tenant_key`。

#### 3. 获取 `conversation_id`

1. 启动 Snail Shell Web 服务。
2. 打开 Snail Shell Web 页面，选择目标 Project、Feature、Stage 和 Conversation。
3. 从当前页面 URL、浏览器开发者工具的 API 响应，或 `/api/conversations/:conversationId` 相关请求中取得目标 Conversation 的 `id`。
4. 如果通过 API 确认，可以请求 `GET /api/projects/:projectId/conversations`，在返回列表中找到要绑定的 Conversation，并复制其 `id`。
5. 记录该值，后续填入 `config/feishu.json` 的 `bindings[].conversation_id`。

#### 4. 获取飞书 `chat_id` 和可选 `tenant_key`

1. 最直接的方式是在本地先启用飞书接入但暂不配置有效绑定，让 Snail Shell 打印“未匹配绑定”的日志；日志中会包含 `chatId`，可能也包含 `tenantKey`。
2. 也可以在飞书开放平台的事件调试、事件日志或开发者工具中查看刚才发送的 `im.message.receive_v1` 事件，读取 `event.message.chat_id` 和事件中的 `tenant_key`。
3. 单租户本地使用可以不配置 `tenant_key`，只填 `chat_id`。如果同一个应用可能跨租户使用，或需要更严格隔离，应同时填写 `tenant_key`。
4. 记录 `chat_id`，后续填入 `config/feishu.json` 的 `bindings[].chat_id`。

#### 5. 配置本地 `config/feishu.json`

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

#### 6. 设置飞书应用凭据环境变量

1. 在启动 Snail Shell 的同一个终端中设置环境变量。
2. macOS 或 Linux 示例：

```bash
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="xxx"
```

3. 如果用进程管理器、launchd、systemd 或其他服务方式启动 Snail Shell，要把这两个环境变量配置到实际启动服务的环境里，而不是只配置到临时终端。
4. 不要把 `App Secret` 写入 `config/feishu.json.example`、文档、commit、PR 或截图。

#### 7. 启动并确认长连接接入

1. 在仓库根目录执行 `npm start`，或使用项目已有服务脚本启动。
2. 启动日志应出现 `Feishu conversation channel started`，并显示绑定数量。
3. 如果启动时报 `Feishu integration is enabled but FEISHU_APP_ID/FEISHU_APP_SECRET are not set`，说明环境变量没有进入当前进程。
4. 如果启动时报 `Feishu integration is enabled but @larksuiteoapi/node-sdk is not installed`，执行 `npm install` 后重新启动。
5. 如果长连接没有收到消息，优先检查飞书应用是否已发布或安装、事件 `im.message.receive_v1` 是否启用、机器人是否在对应单聊或群聊中。

#### 8. 用手机飞书验证闭环

1. 打开手机飞书，进入已绑定的机器人单聊或群聊。
2. 发送一条普通文本消息，例如 `你好，Implementation Snail，请回复一句收到`。
3. 在 Snail Shell Web 页面打开绑定的 Conversation，确认该消息以 `Boss Snail` 输入出现。
4. 等待 Snail 回复；可见文本回复应由机器人推回同一个飞书会话，格式类似 `Implementation Snail:\n...`。
5. 如果 Web 里有输入但飞书没有回复，检查应用发送消息权限、机器人是否仍在群里，以及日志中飞书发送 API 是否报错。
6. 如果飞书消息没有进入 Web，检查 `chat_id` 是否和事件里的 `message.chat_id` 完全一致；配置了 `tenant_key` 时还要确认事件里的 `tenant_key` 完全一致。

#### 9. 日常使用边界

1. 当前只支持文本消息。图片、文件、语音、卡片按钮和飞书云文档不会进入 Snail Shell 对话。
2. 飞书入站消息统一作为 `Boss Snail` 输入，当前不把飞书用户身份映射为 Snail Shell 内部权限主体。
3. 一个 `bindings` 条目只绑定一个飞书 `chat_id` 到一个已有 `conversation_id`。要绑定多个群或多个 Conversation，需要添加多个绑定条目并重启服务。
4. 更换绑定后需要重启 Snail Shell，因为飞书通道在服务启动时读取配置并订阅 Conversation 出站事件。
5. 飞书通道只推送 `text` 和 `content_block` 这类可见内容，不推送工具日志、内部 prompt、密钥或本地配置。

#### 10. 常见问题排查

1. 手机里找不到机器人：确认企业自建应用已经发布或安装到当前企业，并且当前账号在可用范围内。
2. 机器人收不到消息事件：确认事件订阅使用长连接，已添加 `im.message.receive_v1`，并且应用具备接收消息事件权限。
3. Snail Shell 启动失败：确认 `config/feishu.json` 是合法 JSON，`enabled=true` 时环境变量存在，依赖已安装。
4. 日志提示未匹配绑定：复制日志或飞书事件中的真实 `chat_id`，更新 `bindings[].chat_id`；如配置了 `tenant_key`，同时确认租户值。
5. 飞书能进消息但没有回复：确认绑定的 `conversation_id` 是当前可工作的 Conversation，Snail Shell Web 中能看到 assistant 输出；再检查飞书发送消息权限和发送 API 日志。
6. 收到自己的消息回显：确认 `message_push.include_user_messages` 为 `false`。

## 生效路径

1. `src/conversation/gateway.ts` 成为 Web 与 Feishu 的统一 Conversation 接入通道。
2. `src/api/server.ts` 的 HTTP/WebSocket 对话入口改为使用 `ConversationGateway`。
3. `src/integrations/feishu/` 提供飞书配置、SDK transport、通道和文本渲染。
4. `src/main.ts` 在服务启动时按配置启用飞书通道，并在 shutdown 时停止。
5. `config/feishu.json.example` 提供飞书本地配置模板，`.gitignore` 忽略真实 `config/feishu.json`。
6. 本文档的“操作步骤”作为飞书接入的长期用户操作入口，覆盖飞书开放平台、本地配置、绑定、手机验证和排障。
7. `tests/conversation/gateway-test.ts` 与 `tests/integrations/feishu-channel-test.ts` 覆盖统一接入、飞书链路、快速 ack、租户匹配和入站去重边界。

## 改动范围

1. 新增 `ConversationGateway`。
2. 调整 Web HTTP/WebSocket 对话入口使用统一 gateway。
3. 新增飞书集成模块和配置示例。
4. 新增飞书 Node SDK 依赖。
5. 新增自动化测试。
6. 更新本 feature 文档以匹配用户收敛后的目标、实际实现范围和飞书接入操作步骤。

## 验证

1. `npm run build` 通过。
2. `npm run check` 通过，30 个编译后测试文件全部通过。
3. `tests/conversation/gateway-test.ts` 覆盖普通输入规范化和统一出站事件订阅。
4. `tests/integrations/feishu-channel-test.ts` 覆盖飞书入站到 Conversation、入站快速 ack、tenant_key 绑定拒绝缺失或不一致租户、重复消息成功后去重、失败后可重试、去重容量边界、assistant 出站到飞书、默认不回显 Boss 输入。
5. 本轮文档补充后执行 `npm run lint`，确认 Markdown/JSON 以外未引入代码检查问题。

## 风险与决策记录

当前没有未经确认的问题。

决策记录：按用户要求，本 feature 不再按“后续分期”停留在设计文档，而是直接打通“飞书与 Snail 对话”的链路。复杂卡片、文件和阶段操作不属于当前目标，避免扩大到与 Web 对话同级链路无关的飞书生态能力。

决策记录：采用 `ConversationGateway` 抽象统一 Web 与 Feishu 接入。原因是 Web 和 Feishu 都是 Conversation 的接入途径；如果飞书直接调用 ProjectManager 并自行订阅事件，会复制 WebSocket 逻辑并形成长期架构分叉。

决策记录：飞书绑定关系使用本地配置而不是新增数据库表。原因是当前目标是打通指定飞书 chat 与已有 Conversation 的对话链路，尚未引入绑定管理 UI 或多租户管理；本地配置能满足当前目标，同时不阻碍后续把绑定迁移到持久化模型。

决策记录：首版只发送文本消息，不做飞书卡片。原因是当前用户目标是“通过飞书来和 snail 对话”，文本链路是与现有 Web 对话同级的最小完整闭环；卡片按钮会引入新的交互语义和权限边界，已明确为非目标。

## 范围变更记录

1. 用户明确要求不要分期，目标收敛为“通过飞书和 Snail 对话”，并要求把 Web 与 Feishu 作为同级接入途径进行整体架构调整。因此本 feature 从原设计文档 PR 扩展为包含架构抽象、飞书运行时代码、配置示例和测试的实现 PR。
2. PR 检视指出飞书入站处理不能阻塞事件 ack、tenant_key 绑定不能在事件缺失租户时放行、去重状态不能在失败前确认且不能无界增长；实现范围随之补充为快速 ack 调度、严格租户匹配、成功后确认去重和去重生命周期边界。
3. 用户表示已有飞书实现但不清楚具体操作，要求提供从飞书侧到本系统侧、最终通过手机飞书完成 Snail 对话的步骤。因此本 feature 追加面向操作者的接入文档，不改变运行时代码。
