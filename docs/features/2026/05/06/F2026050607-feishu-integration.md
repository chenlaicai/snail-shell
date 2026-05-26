---
id: F2026050607
title: 飞书接入
from_ids: []
tags: [integration, feishu]
modules: [project_management]
---
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
6. 覆盖统一接入通道与飞书通道的自动化测试，并通过完整检查。

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

## 生效路径

1. `src/conversation/gateway.ts` 成为 Web 与 Feishu 的统一 Conversation 接入通道。
2. `src/api/server.ts` 的 HTTP/WebSocket 对话入口改为使用 `ConversationGateway`。
3. `src/integrations/feishu/` 提供飞书配置、SDK transport、通道和文本渲染。
4. `src/main.ts` 在服务启动时按配置启用飞书通道，并在 shutdown 时停止。
5. `config/feishu.json.example` 提供飞书本地配置模板，`.gitignore` 忽略真实 `config/feishu.json`。
6. `tests/conversation/gateway-test.ts` 与 `tests/integrations/feishu-channel-test.ts` 覆盖统一接入、飞书链路、快速 ack、租户匹配和入站去重边界。

## 改动范围

1. 新增 `ConversationGateway`。
2. 调整 Web HTTP/WebSocket 对话入口使用统一 gateway。
3. 新增飞书集成模块和配置示例。
4. 新增飞书 Node SDK 依赖。
5. 新增自动化测试。
6. 更新本 feature 文档以匹配用户收敛后的目标和实际实现范围。

## 验证

1. `npm run build` 通过。
2. `npm run check` 通过，30 个编译后测试文件全部通过。
3. `tests/conversation/gateway-test.ts` 覆盖普通输入规范化和统一出站事件订阅。
4. `tests/integrations/feishu-channel-test.ts` 覆盖飞书入站到 Conversation、入站快速 ack、tenant_key 绑定拒绝缺失或不一致租户、重复消息成功后去重、失败后可重试、去重容量边界、assistant 出站到飞书、默认不回显 Boss 输入。

## 风险与决策记录

当前没有未经确认的问题。

决策记录：按用户要求，本 feature 不再按“后续分期”停留在设计文档，而是直接打通“飞书与 Snail 对话”的链路。复杂卡片、文件和阶段操作不属于当前目标，避免扩大到与 Web 对话同级链路无关的飞书生态能力。

决策记录：采用 `ConversationGateway` 抽象统一 Web 与 Feishu 接入。原因是 Web 和 Feishu 都是 Conversation 的接入途径；如果飞书直接调用 ProjectManager 并自行订阅事件，会复制 WebSocket 逻辑并形成长期架构分叉。

决策记录：飞书绑定关系使用本地配置而不是新增数据库表。原因是当前目标是打通指定飞书 chat 与已有 Conversation 的对话链路，尚未引入绑定管理 UI 或多租户管理；本地配置能满足当前目标，同时不阻碍后续把绑定迁移到持久化模型。

决策记录：首版只发送文本消息，不做飞书卡片。原因是当前用户目标是“通过飞书来和 snail 对话”，文本链路是与现有 Web 对话同级的最小完整闭环；卡片按钮会引入新的交互语义和权限边界，已明确为非目标。

## 范围变更记录

1. 用户明确要求不要分期，目标收敛为“通过飞书和 Snail 对话”，并要求把 Web 与 Feishu 作为同级接入途径进行整体架构调整。因此本 feature 从原设计文档 PR 扩展为包含架构抽象、飞书运行时代码、配置示例和测试的实现 PR。
2. PR 检视指出飞书入站处理不能阻塞事件 ack、tenant_key 绑定不能在事件缺失租户时放行、去重状态不能在失败前确认且不能无界增长；实现范围随之补充为快速 ack 调度、严格租户匹配、成功后确认去重和去重生命周期边界。
