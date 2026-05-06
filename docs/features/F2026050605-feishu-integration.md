# F2026050605 飞书接入设计

## 背景

OpenClaw 等 AI agent 产品近期常见的一类接入方式，是把 agent 能力放到团队即时通讯工具中，让用户在现有协作空间内发起任务、接收进展、回答问题和查看结果。Snail Shell 当前已经具备 Project、Feature、Stage、Conversation、Message、MessageBus、结构化消息块和正式产物模型，但主要交互入口仍是本系统自己的 HTTP API 与 WebSocket。

接入飞书的真实问题不是“增加一个聊天机器人回复文本”，而是让飞书成为 Snail Shell 的外部协作入口之一，同时保持阶段驱动、角色协作、产物沉淀和可追溯记录这些核心不变量不被绕过。

## 目标

1. 支持企业自建飞书应用以机器人身份接入 Snail Shell。
2. 支持从飞书单聊或群聊消息进入 Snail Shell Conversation，并复用现有 MessageBus、mention、结构化消息和协作轮次控制。
3. 支持把 Snail Shell 的关键输出推送回飞书，包括 agent 回复、需要用户决策的问题卡片、阶段/PR 状态和错误提示。
4. 支持把飞书会话与 Snail Shell Project、Feature、Stage、Conversation 建立可追溯绑定。
5. 支持飞书事件幂等处理、消息限流、敏感配置隔离和基础可观测性。
6. 为后续实现拆分出可落地的分期边界，避免一次性把所有飞书能力、权限和交互形态纳入首版。

## 非目标

1. 首版不接入飞书应用商店应用，只面向企业自建应用。
2. 首版不实现飞书云文档、审批、通讯录全量同步、文件上传下载和多维表格能力。
3. 首版不让飞书替代 Snail Shell 内部权限、阶段推进和正式产物校验。
4. 首版不把飞书群聊自动映射为 Project 或 Feature 的唯一来源；创建和绑定规则必须显式、可审计。
5. 首版不要求所有 Snail Shell 结构化消息块都一比一渲染成飞书卡片组件；先定义降级策略。
6. 首版不实现跨租户、多企业、多飞书应用统一管理；按单租户单应用设计配置边界。

## 设计

### 外部能力事实

飞书开放平台对本 feature 有直接影响的能力和约束如下：

1. 飞书企业自建应用支持长连接事件订阅。Node.js SDK 可通过 `@larksuiteoapi/node-sdk` 的 `WSClient` 接收 `im.message.receive_v1` 等事件。长连接模式只要求 Snail Shell 进程能访问公网，不要求本地开发环境暴露公网回调地址。
2. 飞书长连接事件处理需要快速返回，文档要求消息处理在约 3 秒内完成，否则会触发超时重试。因此事件入口不能同步等待 agent 完整执行，必须先持久化入站事件并异步投递到 Conversation 队列。
3. 同一应用最多约 50 个长连接。多实例部署时，事件是集群分发而不是广播，同一事件只会随机到达一个客户端。因此幂等和实例级并发控制必须由 Snail Shell 自己负责。
4. 发送飞书消息需要启用机器人能力，并使用 `tenant_access_token` 或用户 token 调用 `im/v1/messages`。首版只采用应用机器人身份发送，避免引入用户授权流。
5. `tenant_access_token` 有效期最长约 2 小时，应由本系统缓存和刷新，不应写入数据库明文长期保存。
6. 发消息接口对同一用户或群聊有约 5 QPS 限制，消息体存在大小限制，卡片消息约 30 KB，文本消息约 150 KB。Snail Shell 输出到飞书必须具备截断、摘要和队列限速策略。
7. 飞书卡片可以表达结构化内容和按钮交互，适合承载 `message-out question`、产物卡片和状态卡片。但卡片交互回调仍是外部输入事件，必须回写为 Snail Shell 消息或操作记录，而不能直接修改内部状态。

### 系统边界

飞书接入层应定位为 Snail Shell 的外部 adapter，不能成为第二套协作引擎。

边界划分：

1. 飞书连接层只负责接收事件、调用飞书 API、维护 token、处理 SDK 生命周期和基础重试。
2. 飞书映射层负责把飞书 `tenant_key`、`chat_id`、`open_id`、`message_id` 映射到 Snail Shell 的 Project、Feature、Stage、Conversation、Message 和用户身份上下文。
3. Snail Shell 核心层继续由 `ProjectManager.sendStructuredMessage`、ConversationQueue、MessageBus、mention 解析和正式产物机制处理协作。
4. 飞书渲染层负责把 Snail Shell 的 message events 转换为飞书文本、富文本或卡片，并处理长度限制与降级。
5. 飞书交互层负责把卡片按钮、问题回答和命令消息转换为 Snail Shell 的结构化输入或 API 调用。

### 推荐首版形态

首版采用“飞书长连接入口 + 机器人消息出口 + 显式会话绑定”的方案。

入站路径：

1. Snail Shell 启动时根据配置初始化飞书 `WSClient`。
2. 飞书收到用户私聊、群聊提及机器人或卡片交互事件后，SDK 回调进入 `FeishuEventReceiver`。
3. `FeishuEventReceiver` 校验事件类型、提取事件唯一键、写入幂等记录，然后立即返回 SDK。
4. 后台 worker 根据绑定关系找到目标 Conversation。
5. 如果没有绑定关系，则按命令进入绑定/创建流程，而不是直接创建不明来源的 Feature。
6. 已绑定消息被转换为 Snail Shell `MessageInputEvent`，调用 `ProjectManager.sendStructuredMessage`，`from_snail` 固定为 `Boss Snail`，并在 `client_id` 中保存飞书事件唯一键。
7. 后续 agent 协作沿用现有 ConversationQueue 和 MessageBus。

出站路径：

1. `ProjectManager` 已经通过 `agent-event` 事件暴露 Conversation 消息事件，现有 WebSocket 会消费同一事件流。
2. 新增 `FeishuConversationBridge` 订阅指定 Conversation 的 `agent-event`。
3. bridge 只向已绑定的飞书 chat 推送可见输出，避免把内部调试事件、prompt 或敏感配置发送到飞书。
4. `message-out` 结构化块优先渲染为飞书卡片；无法表达或超出限制时降级为摘要文本，并提供 Snail Shell 本地链接或引用 ID。
5. 对需要用户决策的问题块，渲染为飞书卡片按钮。用户点击后回调进入入站路径，转成 `question_response` 类型消息，继续由当前 Conversation 处理。

### 绑定模型

需要新增一组外部绑定模型，用于保证飞书消息与 Snail Shell 内部状态可追溯。

建议数据表：

1. `external_integration`：记录集成实例，例如 `provider=feishu`、启用状态、配置引用、创建时间和更新时间。敏感字段只保存环境变量名或本地配置键，不保存 secret 明文。
2. `external_conversation_binding`：记录 `provider`、`tenant_key`、`chat_id`、可选 `thread_id`、`project_id`、`feature_id`、`stage_id`、`conversation_id`、绑定状态和创建人。
3. `external_message_link`：记录飞书 `message_id`、Snail Shell `message_id`、事件唯一键、方向 `inbound/outbound`、发送状态、错误码和重试次数。
4. `external_event_dedup`：记录飞书事件唯一键、事件类型、处理状态和最后错误，用于长连接重试和多实例场景幂等。

绑定规则：

1. 群聊默认不自动创建 Feature，必须由用户使用显式命令或系统卡片确认绑定目标。
2. 单聊可以进入“个人控制台”模式，但仍需用户选择 Project/Feature 或创建 Feature 后再进入研发对话。
3. 一个飞书 chat 可以绑定多个 Conversation，但首版只允许“当前活动绑定”接收普通自然语言输入，避免用户在同一群里一句话同时触发多个 Feature。
4. 命令类消息使用显式前缀，例如 `/snail`，降低误触发概率。群聊中只有提及机器人或命令前缀才进入 Snail Shell。

### 消息转换

飞书入站到 Snail Shell：

1. 飞书文本消息转换为 `text` event。
2. 飞书富文本消息首版降级为 Markdown 近似文本，并保留原始飞书 message id。
3. 飞书 @ 机器人本身不转换为 Snail mention；飞书 @ 用户可先保留为普通文本。Snail mention 仍使用 Snail Shell 的 `message-out` mention 协议或文本中的 Snail 名称解析。
4. 飞书图片、文件、语音首版不下载内容，只生成引用卡片或提示“附件暂未接入”，避免引入文件权限、存储和安全扫描范围。
5. 飞书卡片按钮回调转换为 `content_block.question_response` 或命令事件。

Snail Shell 出站到飞书：

1. 普通文本输出发送为飞书 text 或 post。
2. `markdown`、`reference_card`、`artifact_card`、`tool_call_card`、`question` 优先渲染为 interactive card。
3. `question` 卡片必须包含问题标题、原因、选项和可选自定义文本入口；按钮值中保存 `conversation_id`、内部问题标识、选项 key 和必要的事件防重放 token。
4. 大输出先摘要后发送，完整内容留在 Snail Shell Conversation 或 artifact 中，通过引用 ID 定位。
5. 错误输出必须面向用户可行动，隐藏 stack、secret、完整 prompt 和内部 token。

### 配置与密钥

建议新增 `config/feishu.json`，并提供 `config/feishu.example.json`。实际 secret 仍通过本地忽略配置或环境变量注入。

配置项建议：

1. `enabled`：是否启用飞书接入。
2. `app_id_env`、`app_secret_env`：读取飞书应用凭据的环境变量名。
3. `event_mode`：首版固定为 `websocket`，保留后续 webhook 模式扩展位。
4. `allowed_tenant_keys`：允许接入的 tenant 列表，空值表示仅使用当前应用返回 tenant。
5. `default_project_id`：可选，仅用于单聊控制台或测试环境，生产不应默认吞掉未绑定消息。
6. `message_push`：出站限速、最大卡片大小、最大文本长度、是否推送 agent 流式中间态。
7. `commands`：命令前缀和允许的创建/绑定命令。

### 权限与安全

首版需要的飞书侧能力：

1. 机器人能力。
2. 接收消息事件 `im.message.receive_v1`。
3. 发送消息权限，例如 `im:message:send_as_bot` 或飞书当前推荐的发送消息权限。
4. 如后续需要读取用户信息，再单独申请通讯录权限；首版不主动申请。

安全约束：

1. 不把飞书 `app_secret`、access token 或事件原文中的敏感字段写入普通日志。
2. 出站消息白名单化，只推送用户可见的 message content，不推送 prompt、系统注入、tool 原始日志和本地路径中的敏感信息。
3. 对卡片交互值做签名或短期 nonce 校验，防止用户伪造按钮 payload 直接驱动内部操作。
4. 飞书用户身份首版只作为外部 actor 记录，不直接等价于 Snail Shell 内部管理员权限。
5. 任何阶段推进、Feature 完成、PR 合入类操作仍必须走 Snail Shell 既有校验，飞书按钮只能触发同等 API，不可绕过正式产物要求。

### 错误与重试

1. 入站事件幂等键建议使用飞书事件 id；如事件结构不稳定，则组合 `tenant_key:event_type:message_id:create_time`。
2. SDK 回调只完成轻量校验和入队，后台 worker 失败时记录 `external_event_dedup.status=failed`，并提供重放脚本。
3. 出站发送按 chat 维度限速，收到飞书 230020 等限频错误时指数退避。
4. 收到机器人不在群、无权限、用户不在可用范围等不可自动恢复错误时，写入 `external_message_link` 并在 Snail Shell 内部 Conversation 记录可见错误。
5. 飞书卡片超过大小限制时降级为文本摘要和内部引用。

### 可观测性

需要至少记录以下指标或日志字段：

1. 飞书长连接状态、重连次数和最后连接错误。
2. 入站事件数量、去重数量、处理失败数量和平均入队延迟。
3. 出站消息数量、飞书错误码、重试次数和限流等待时间。
4. 绑定创建、切换、解绑记录。
5. Conversation 与飞书 chat 的映射查询结果，但不记录 secret 和完整 token。

### 分期实现

第一期：设计与基础框架。

1. 新增飞书接入设计文档。
2. 引入配置结构和 provider 抽象，但默认关闭。
3. 定义绑定、消息链接和事件去重数据模型。

第二期：最小可用消息闭环。

1. 引入飞书 Node SDK。
2. 实现长连接接收文本消息。
3. 实现显式绑定命令。
4. 文本消息进入现有 Conversation，并把 agent 最终回复推回飞书。
5. 覆盖幂等、未绑定、权限错误和发送限流的测试。

第三期：结构化协作体验。

1. 把 `message-out question` 渲染为飞书卡片。
2. 支持卡片按钮回写 `question_response`。
3. 支持 artifact、reference 和 tool_call 卡片的飞书降级渲染。
4. 支持阶段/PR 状态摘要推送。

第四期：运维与扩展。

1. 提供事件重放和绑定管理脚本。
2. 支持 webhook 模式作为部署选项。
3. 支持文件引用、云文档或更细权限映射。
4. 支持多租户或多应用配置。

## 生效路径

1. `docs/features/F2026050605-feishu-integration.md` 记录本 feature 的需求结论、设计取舍、分期边界和风险。
2. 后续实现应新增飞书 adapter 代码，并通过 `ProjectManager.sendStructuredMessage`、`agent-event` 和现有 message events 接入核心协作流。
3. 后续实现应新增持久化 schema、配置示例和测试，确保外部事件不绕过 Snail Shell 的 Feature、Stage、Conversation 与 formal artifact 约束。
4. 如果后续修改提示词或工作流规则，必须同步检查 `AGENTS.md` 与 `.meta/prompts/`，避免飞书入口形成不一致的人机协作规则。

## 改动范围

当前设计阶段改动范围：

1. 新增 `docs/features/F2026050605-feishu-integration.md`。

后续实现阶段预计改动范围：

1. `package.json`：新增飞书 Node SDK 依赖。
2. `config/`：新增飞书配置示例和本地配置加载规则。
3. `src/integrations/feishu/`：新增飞书连接、事件接收、消息发送、卡片渲染和命令处理模块。
4. `src/persistence/schema.ts` 与 store 类型：新增外部集成、绑定、消息链接和事件去重表。
5. `src/main.ts`：按配置启动飞书 adapter。
6. `src/project/manager.ts` 或邻近 bridge 模块：暴露安全的 conversation event 订阅与外部入站调用路径。
7. `tests/`：新增飞书事件转换、幂等、绑定、出站渲染和失败重试测试。
8. `.meta/prompts/` 或 `AGENTS.md`：仅当飞书入口需要新增长期协作规则时同步调整。

## 验证

当前设计阶段验证：

1. 检查本文件编号符合 `docs/README.md` 的 `FYYYYMMDDNN` 规则。
2. 对照现有 `src/api/server.ts`、`src/project/manager.ts`、`src/project/message-bus.ts`、`src/project/message-out.ts` 和 `src/persistence/schema.ts`，确认设计没有绕过现有 Conversation、MessageBus 和 formal artifact 约束。
3. 对照飞书开放平台文档，确认长连接、消息发送、卡片、tenant token、限流和大小限制已纳入设计约束。
4. 运行文档级自检，确认没有未收敛问题残留在“风险与决策记录”。

后续实现阶段验证：

1. `npm run check`。
2. 单元测试覆盖飞书事件到 `MessageInputEvent` 的转换。
3. 单元测试覆盖事件幂等、重复事件不重复触发 agent。
4. 单元测试覆盖未绑定 chat 的处理结果。
5. 单元测试覆盖出站渲染降级、卡片大小限制和文本截断。
6. 集成或手工验证覆盖飞书长连接收消息、绑定 Conversation、发送问题卡片、点击按钮回写回答。
7. 手工验证飞书权限错误、机器人不在群和限流错误时的用户可见提示。

## 风险与决策记录

当前没有未经确认的问题。

决策记录：首版选择企业自建应用的长连接模式，而不是 webhook。原因是 Snail Shell 当前常在本地或私有环境迭代，长连接模式不要求公网回调地址，能降低开发和部署门槛；后续生产部署如需要统一入口、审计网关或企业安全策略，再补充 webhook 模式。

决策记录：飞书接入层只作为 adapter，不直接驱动 Snail Shell 内部状态机。原因是 Snail Shell 的核心价值来自阶段驱动、角色协作、正式产物和可追溯记录；如果飞书按钮或消息绕过这些模型，会形成第二套不可审计的工作流。

决策记录：群聊首版采用显式绑定，不自动创建 Feature。原因是群聊语境噪声高，自动创建会导致 Feature 边界不可控，也会让用户误触发昂贵的 agent 协作。

决策记录：首版不主动接入文件、语音和云文档内容。原因是这些能力会引入文件权限、内容安全、存储生命周期和大对象处理范围，应该在文本与卡片闭环稳定后单独设计。

## 范围变更记录

当前没有范围变更。
