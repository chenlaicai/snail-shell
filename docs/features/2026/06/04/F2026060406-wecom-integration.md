---
id: F2026060406
title: wecom-integration
from_ids: [F2026050607]
tags: [integration, wecom]
modules: [interaction-entry, persistence]
doc_kind: spec
---

# F2026060406 [interaction-entry] 企业微信接入

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

Snail Shell 已有飞书接入（F2026050607），通过 `LobbyAwareChannel` + `FeishuTransport` 实现了飞书群聊与 Agent 的双向对话。IM 抽象层设计为平台无关：`LobbyAwareChannel` 只依赖 `FeishuTransport` 接口（`start/stop/sendText`），上层 Lobby 路由、会话管理、出站订阅全部复用。

企业微信是国内企业协作的另一大主流平台，且可通过「客户联系」能力触达微信用户生态。本次接入企业微信，使其成为与飞书同级的 IM 入口。同时将 `FeishuTransport` 提取为通用 `IMTransport` 接口，采用 `prepare()` + `onMessage()` 两步生命周期，统一 WebSocket 和 HTTP 回调两种通信模型。

## 目标

### P1 — 企业微信 IM 通道接入

1. 实现 `WecomSdkTransport`，通过企业微信「自建应用 + 智能机器人」接收群聊文本消息并发送回复。
2. 复用 `LobbyAwareChannel`，`channelType` 为 `"wecom"`，无需新建通道类。
3. 企业微信会话复用现有 Lobby 导航系统（`/workspaces`、`/issues`、`/enter`、`/back` 等命令）。
4. 出站消息推送复用 `PlainTextLobbyRenderer`，与飞书保持一致的纯文本体验。

### P2 — 回调接入基础设施

1. 企业微信使用 HTTP Webhook 回调（非 WebSocket 长连接）。`WecomSdkTransport` 在 `prepare()` 中挂载回调路由到 Express app，`onMessage()` 中注册消息回调。
2. 实现企业微信回调 URL 验证（GET 请求返回解密后的 `echostr`）。
3. 实现回调消息体 AES-CBC 解密（`EncodingAESKey` → `AESKey`，IV 取前 16 字节）。
4. 实现 `access_token` 缓存与自动刷新（2 小时有效期）。

### P3 — IM 抽象层泛化

1. 将 `FeishuTransport` / `FeishuInboundMessage` 重构为通用 `IMTransport` / `IMInboundMessage` 接口，放到 `im-channel/types.ts`。`IMTransport` 采用 `prepare()` + `onMessage()` 两步生命周期，统一 WebSocket 和 HTTP 回调两种通信模型。
2. 飞书和企业微信各自实现通用接口。`LobbyAwareChannel` 的 `start()` 改为调用 `transport.onMessage()`（不再调用 `transport.start()`），`prepare()` 由 `main.ts` 编排调用。

## 非目标

1. 不实现企业微信客服、朋友圈、审批、日程、文档等办公 API 集成。
2. 不实现模板卡片消息（按钮交互、投票选择等）；首版只发文本消息。
3. 不实现企业微信用户身份到 Snail Shell 内部权限的映射；入站消息统一作为 `Boss Snail` 输入。
4. 不实现自动创建企业微信群聊或自动邀请成员。
5. 不支持多企业（跨 corp_id）管理；以单个企业自建应用的本地配置为边界。
6. 不实现企业微信「数据与智能专区」或「会话内容存档」集成。

## 设计

### 外部能力事实

1. 企业微信自建应用通过 HTTP 回调接收消息：需在管理后台配置回调 URL、Token 和 EncodingAESKey。
2. 回调消息体为 XML 格式，使用 AES-CBC 加密；解密后提取 `Content`（文本内容）、`ChatId`（群聊 ID）、`MsgId`（消息 ID）、`FromUserName`（发送者）。
3. 企业微信会重试未确认的消息（类似飞书），需用 `MsgId` 去重。
4. 发送群聊消息使用 `POST /cgi-bin/appchat/send?access_token=ACCESS_TOKEN`（接收方为 `chatid`），不是 `/cgi-bin/message/send`（接收方为 `touser`/`toparty`/`totag`，用于应用消息推送）。`appchat/send` 支持文本、Markdown、模板卡片等类型。`ChatId` 到 `chatid` 的映射需联调验证。
5. `access_token` 通过 `POST /cgi-bin/gettoken?corpid=ID&corpsecret=SECRET` 获取，有效期 7200 秒，需缓存并定时刷新。
6. 消息频率限制：每应用不超过 账号上限数×200 人次/天；对同一成员不超过 30 次/分钟、1000 次/小时。
7. 企业微信可信 IP 白名单：2022 年 6 月后新创建的自建应用必须在管理端配置可信 IP。

### IM 抽象层泛化：两种通信模型的统一

当前 `IMTransport` 接口（原 `FeishuTransport`）围绕飞书的 WebSocket 模型设计：`start({ onMessage })` 把「建立通道」和「注册回调」合并为一步。这对 WebSocket 天然成立（建立连接后立即可收消息），但企业微信的 HTTP 回调模型需要拆分——「挂载路由」和「设置回调」是两个独立步骤，且挂载路由需要 Express app 实例。

本次重构 `IMTransport` 接口为两步生命周期：

**新增 `src/interaction-entry/im-channel/types.ts`**：

```typescript
import type { Express } from "express";

export interface IMInboundMessage {
  tenantKey: string | null;
  chatId: string;
  messageId: string;
  text: string;
}

/** 传递给 prepare() 的平台上下文；各 transport 按需取用 */
export interface IMTransportContext {
  /** HTTP 回调型 transport 挂载路由用；WebSocket 型忽略 */
  app?: Express;
}

export interface IMTransport {
  /** 第一步：准备通道。WebSocket 型建立连接，HTTP 回调型挂载路由。 */
  prepare(context: IMTransportContext): Promise<void>;
  /** 第二步：设置消息回调并开始接收。prepare() 之后调用。 */
  onMessage(handler: (message: IMInboundMessage) => void | Promise<void>): void;
  /** 停止通道 */
  stop?(): void;
  /** 发送文本消息 */
  sendText(input: { chatId: string; text: string; uuid?: string }): Promise<void>;
}
```

**飞书实现**（`FeishuSdkTransport`）：

```typescript
class FeishuSdkTransport implements IMTransport {
  async prepare(_ctx: IMTransportContext): Promise<void> {
    // WebSocket 不需要 Express app，初始化 Client 即可
    this.client = new sdk.Client({ appId, appSecret });
  }
  onMessage(handler): void {
    // 建立 WSClient，注册 EventDispatcher，handler 直接传入
    this.wsClient = new sdk.WSClient({ appId, appSecret });
    const dispatcher = new sdk.EventDispatcher({}).register({
      "im.message.receive_v1": (data) => {
        const msg = parseReceiveMessageEvent(data);
        if (msg) handler(msg);
      },
    });
    this.wsClient.start({ eventDispatcher: dispatcher });
  }
}
```

**企业微信实现**（`WecomSdkTransport`）：

```typescript
class WecomSdkTransport implements IMTransport {
  private messageHandler: ((msg: IMInboundMessage) => void) | null = null;
  /** prepare() 到 onMessage() 之间的消息缓冲；onMessage() 注册后排空 */
  private pendingMessages: IMInboundMessage[] = [];

  async prepare(ctx: IMTransportContext): Promise<void> {
    if (!ctx.app) throw new Error("WecomSdkTransport requires Express app");
    ctx.app.get("/webhook/wecom", this.handleVerification.bind(this));
    ctx.app.post("/webhook/wecom", this.handleMessage.bind(this));
    await this.refreshAccessToken();
  }

  onMessage(handler): void {
    this.messageHandler = handler;
    // 排空 prepare() 期间缓冲的消息
    for (const msg of this.pendingMessages) handler(msg);
    this.pendingMessages = [];
  }

  private handleMessage(req, res): void {
    const msg = this.parseAndDecrypt(req);
    if (this.messageHandler) {
      this.messageHandler(msg);
    } else {
      // onMessage() 尚未调用，缓冲消息；排空后不再缓冲
      this.pendingMessages.push(msg);
    }
    res.end('{"errcode":0,"errmsg":"ok"}');
  }
}
```

`prepare()` 到 `onMessage()` 之间存在一个窗口：路由已挂载但回调未注册。`pendingMessages` 队列保证此窗口期内到达的消息不丢失——`onMessage()` 注册时排空队列，排空后不再缓冲（避免内存泄漏）。

飞书不存在此窗口问题——WebSocket 连接在 `onMessage()` 内部建立，`onMessage()` 调用后才开始接收消息。

注意：飞书 `prepare()` / `onMessage()` 拆分需要验证 `client.im.v1.message.create`（发送）是否独立于 `WSClient`（接收）连接状态。如不独立，`prepare()` 需同时初始化两者。

**分离的关键收益**：
- **职责清晰**：`main.ts` 负责编排 `prepare()`，`LobbyAwareChannel` 只调 `onMessage()`
- **不暴露 Express 类型**：路由挂载在 transport 内部完成
- **可测试**：测试时不传 `app`，直接调用 `onMessage()` 后手动触发内部 handler
- **消息不丢失**：`pendingMessages` 队列消除 `prepare()` 到 `onMessage()` 之间的窗口期

### `LobbyAwareChannel` 与 transport 的协作

`LobbyAwareChannel` 不调用 `prepare()`——它不知道 Express app 的存在。职责分离：

- `main.ts`：调用 `transport.prepare(context)` 准备通道
- `LobbyAwareChannel.start()`：调用 `transport.onMessage(handler)` 设置回调 + `rehydrateSubscriptions()`

```typescript
// main.ts
const wecomTransport = new WecomSdkTransport(wecomConfig);
await wecomTransport.prepare({ app });  // 挂载路由

const channel = new LobbyAwareChannel(config, { transport: wecomTransport, ... });
await channel.start();  // 内部调 onMessage + rehydrate
```

### 与飞书接入的架构对齐

```
飞书:   WSClient(长连接) → FeishuSdkTransport → LobbyAwareChannel → LobbyRouter → Agent
企微:   HTTP回调(Express) → WecomSdkTransport  → LobbyAwareChannel → LobbyRouter → Agent
                                         ↑ 只有这里不同
```

`LobbyAwareChannel` 不需要新建子类。唯一的改动是 `clientId` 去重前缀从硬编码 `"feishu:"` 改为使用 `this.config.channelType`，使其对所有 IM 平台通用。

### 企业微信入站处理

`WecomSdkTransport` 在 `prepare()` 中挂载两个路由，统一使用 `/webhook/wecom` 路径（所有 IM 回调路由统一 `/webhook/{platform}` 前缀）：

**`GET /webhook/wecom` — 回调 URL 验证**：
- 企业微信首次配置回调 URL 时发 GET 请求，带 `msg_signature`、`timestamp`、`nonce`、`echostr` 参数
- 验证签名后解密 `echostr` 并返回明文，完成 URL 验证

**`POST /webhook/wecom` — 接收消息回调**：
1. 从请求体 XML 提取 `Encrypt` 字段
2. 用 `AESKey` + `IV` 做 AES-CBC 解密
3. 解析明文 XML，提取 `MsgType`、`Content`、`ChatId`、`MsgId`、`FromUserName`
4. 只处理 `MsgType=text` 的消息，忽略其他类型
5. 将 `CorpId` 映射为 `tenantKey`，构造 `IMInboundMessage` 调用 `this.messageHandler`
6. 返回 HTTP 200 响应（`{"errcode":0,"errmsg":"ok"}`）避免企业微信重试

### 企业微信出站处理

`sendText` 流程：
1. 检查 `access_token` 是否过期，过期则刷新
2. `POST /cgi-bin/appchat/send?access_token=ACCESS_TOKEN` 发送群聊消息
3. 请求体：`{ chatid: chatId, msgtype: "text", text: { content: text } }`
4. 使用 `appchat/send`（群聊消息 API），不是 `message/send`（应用消息 API）

`ChatId` 到 `appchat/send` 的 `chatid` 映射需在联调时验证；不一致时增加 ID 转换步骤。

### access_token 管理

- 缓存在内存中，记录过期时间
- 请求前检查，过期时自动刷新
- 并发请求时共享同一个刷新 Promise，避免重复请求

### 消息渲染

复用 `PlainTextLobbyRenderer`，无需 WeCom 专用渲染器。企业微信群聊中显示格式与飞书一致：

```
[角色名] 消息内容
```

### 配置

新增 `config/wecom.json.example`：

```json
{
  "_help": "复制本文件为 config/wecom.json 后再填写。config/wecom.json 会被 git 忽略，不要提交真实密钥。",
  "enabled": false,
  "_corp_id_help": "企业微信 CorpID，在「我的企业」-「企业信息」中查看。",
  "corp_id": "",
  "_corp_secret_help": "自建应用的 Secret，在应用详情页查看。",
  "corp_secret": "",
  "_token_help": "回调 Token，在应用的「接收消息」-「设置接收消息」中配置。",
  "token": "",
  "_encoding_aes_key_help": "回调 EncodingAESKey，在应用的「接收消息」-「设置接收消息」中配置。",
  "encoding_aes_key": "",
  "_allowed_chats_help": "允许接入大厅的企业微信群白名单。只有白名单中的群消息会进入 Lobby。单企业使用时只需配 chat_id；多企业场景可选配 tenant_key（值为 CorpID）用于隔离。",
  "allowed_chats": [
    {
      "_chat_id_help": "企业微信群聊的 ChatId。值来自智能机器人收到的回调消息 XML 中的 <ChatId> 字段，形如 wrXXXXXXXX。可在企业微信群聊中 @机器人 发送消息后从回调日志中获取。",
      "chat_id": "",
      "_tenant_key_help": "可选。多企业场景下填 CorpID，用于区分不同企业的同名群。单企业留空即可，留空时只按 chat_id 匹配。",
      "tenant_key": ""
    }
  ],
  "_message_push_help": "Snail Shell 回复推回企业微信的控制项。",
  "message_push": {
    "_max_text_length_help": "单条推送到企业微信的最大文本长度，超过会截断。默认 4000。",
    "max_text_length": 4000
  }
}
```

### `allowed_chats` 白名单匹配

`LobbyAwareChannel.isAllowedBinding` 当前逻辑：

```typescript
private isAllowedBinding(source: { chatId: string; tenantKey: string | null }): boolean {
  return this.config.allowedChats.some((binding) => {
    if (binding.chat_id !== source.chatId) return false;
    return binding.tenant_key ? binding.tenant_key === source.tenantKey : true;
  });
}
```

企业微信的 `allowed_chats` 只配 `chat_id`，不配 `tenant_key`。代码已支持此模式（`binding.tenant_key` 为空时只按 `chat_id` 匹配）。`WecomSdkTransport` 将 `CorpId` 映射到 `tenantKey` 字段，保持类型兼容。

## 生效路径

### 新建文件

| 文件 | 职责 |
|---|---|
| `src/interaction-entry/im-channel/types.ts` | 通用 `IMInboundMessage`、`IMTransport`、`IMTransportContext` 接口 |
| `src/interaction-entry/wecom/sdk-transport.ts` | `WecomSdkTransport` — 回调验证 + AES 解密 + 消息收发 + access_token 管理 + 消息缓冲 |
| `src/interaction-entry/wecom/config.ts` | `loadWecomConfig()` — 从 `config/wecom.json` 加载配置 |
| `src/interaction-entry/wecom/index.ts` | Barrel export |
| `src/persistence/wecom-config-store.ts` | `WecomConfigStore` — 持久化层配置缓存，导出 `WecomConfig` 类型 |
| `config/wecom.json.example` | 示例配置文件 |
| `tests/interaction-entry/wecom-transport-test.ts` | WecomSdkTransport 单元测试 |

### 修改文件

| 文件 | 改动 |
|---|---|
| `src/interaction-entry/im-channel/lobby-aware-channel.ts` | `clientId` 前缀通用化；import 从 `feishu/types` 改为 `im-channel/types`；`start()` 改为调用 `transport.onMessage()` + `rehydrateSubscriptions()`（不再调用 `transport.start()`） |
| `src/interaction-entry/feishu/types.ts` | 删除 `FeishuInboundMessage` 和 `FeishuTransport` 接口定义（已提取到 `im-channel/types.ts`）。文件可保留为 re-export 或直接删除 |
| `src/interaction-entry/feishu/sdk-transport.ts` | `FeishuSdkTransport` 改为实现 `IMTransport`（`prepare()` + `onMessage()` 两步生命周期）；import 路径更新 |
| `src/interaction-entry/index.ts` | 新增 wecom 模块导出 |
| `src/main.ts` | 新增 `startWecomChannel()`；启动时序调整（先 `createServer()` 获取 app，再 `prepare()` 所有通道，再 `start()` 所有通道）；合并多通道 cleanup 回调 |

### 不需要改动

- `LobbyRouter`、`LobbyCommandExecutor`、`LobbySessionStore`
- `ConversationGateway`
- `PlainTextLobbyRenderer`
- 数据库 schema（`lobby_session.channel_type` 天然支持多平台）

## 改动范围

| # | 文件 | 改动类型 | 说明 |
|---|---|---|---|
| 1 | `src/interaction-entry/im-channel/types.ts` | 新增 | 通用 `IMInboundMessage`、`IMTransport`（`prepare` + `onMessage` 两步生命周期）、`IMTransportContext` |
| 2 | `src/interaction-entry/wecom/sdk-transport.ts` | 新增 | `WecomSdkTransport` — `prepare()` 挂载路由、`onMessage()` 注册回调 + 排空缓冲、AES 解密、消息收发、token 管理 |
| 3 | `src/interaction-entry/wecom/config.ts` | 新增 | 配置加载 |
| 4 | `src/interaction-entry/wecom/index.ts` | 新增 | Barrel export |
| 5 | `src/persistence/wecom-config-store.ts` | 新增 | 持久化层配置缓存，导出 `WecomConfig` 类型 |
| 6 | `config/wecom.json.example` | 新增 | 示例配置 |
| 7 | `tests/interaction-entry/wecom-transport-test.ts` | 新增 | WecomSdkTransport 单元测试（AES 解密、去重、token 并发刷新、消息缓冲） |
| 8 | `src/interaction-entry/im-channel/lobby-aware-channel.ts` | 修改 | import 改为 `im-channel/types`；`clientId` 前缀通用化；`start()` 改为 `transport.onMessage()` + `rehydrateSubscriptions()` |
| 9 | `src/interaction-entry/feishu/types.ts` | 修改 | 删除接口定义（已提取到 `im-channel/types.ts`），保留 re-export 或删除文件 |
| 10 | `src/interaction-entry/feishu/sdk-transport.ts` | 修改 | `FeishuSdkTransport` 改为实现 `IMTransport`（`prepare()` + `onMessage()`）；import 路径更新 |
| 11 | `src/interaction-entry/index.ts` | 修改 | 新增 wecom 模块导出 |
| 12 | `src/main.ts` | 修改 | 启动时序调整（`createServer` → `prepare` → `start`）；新增 `startWecomChannel()`；多通道 cleanup |

## 验证

### P1 — 基础接入

- [ ] `config/wecom.json` 配置 `enabled: true` 并填写企业微信凭据后，服务启动时成功挂载回调路由
- [ ] 企业微信管理后台配置回调 URL 验证通过
- [ ] 在白名单群中发送文本消息，Agent 成功接收并回复
- [ ] Agent 回复正确推送到企业微信群聊
- [ ] 非白名单群的消息被忽略

### P2 — 回调基础设施

- [ ] 回调 URL 验证（GET 请求）返回正确解密的 `echostr`
- [ ] 回调消息 AES 解密正确
- [ ] AES 解密失败或 XML 解析异常时返回 200 不阻塞回调（避免企业微信无限重试）
- [ ] 消息去重：相同 `MsgId` 的重试消息不重复处理
- [ ] `access_token` 过期后自动刷新
- [ ] 并发请求共享同一个 token 刷新

### P3 — IM 抽象层泛化（回归 + 新行为）

- [ ] 飞书通道在接口重构后行为不变：`prepare()` 初始化 Client，`onMessage()` 建立 WSClient，消息收发正常
- [ ] 企业微信 `prepare()` 到 `onMessage()` 之间的消息不丢失（`pendingMessages` 缓冲队列生效）
- [ ] `LobbyAwareChannel.start()` 不再调用 `transport.start()`，改为 `transport.onMessage()` + `rehydrateSubscriptions()`
- [ ] `clientId` 去重前缀使用 `this.config.channelType` 而非硬编码 `"feishu:"`

### P4 — Lobby 导航

- [ ] `/workspaces` 命令在企业微信群中正常工作
- [ ] `/issues`、`/enter`、`/back`、`/lobby`、`/status`、`/help` 命令正常工作
- [ ] 进入 conversation 后，Agent 回复正确推送到企业微信群
- [ ] `/back` 退出房间后不再收到旧 conversation 的推送
- [ ] 服务重启后，已进入 conversation 的会话自动恢复出站订阅

### 跨平台一致性

- [ ] 企业微信和飞书可以同时启用，互不干扰
- [ ] 同一个 conversation 可以同时被飞书群和企业微信群订阅
- [ ] `lobby_session` 表中 `channel_type` 正确区分 `"feishu"` 和 `"wecom"`
- [ ] Web UI 删除 session 时，飞书和企业微信通道的出站订阅都被清理

### 自动化测试（`tests/interaction-entry/wecom-transport-test.ts`）

- [ ] AES-CBC 解密：已知密文 + 密钥 → 预期明文
- [ ] 回调 URL 验证：正确签名返回解密 echostr，错误签名返回错误
- [ ] 消息去重：相同 MsgId 的重试消息不重复调用 onMessage
- [ ] access_token 刷新：过期后自动获取新 token
- [ ] access_token 并发安全：多个并发请求共享同一个刷新 Promise
- [ ] 非 text 类型消息被忽略
- [ ] 消息缓冲：`prepare()` 后、`onMessage()` 前到达的消息在 `onMessage()` 注册后被排空调用
- [ ] 消息缓冲：`onMessage()` 注册后到达的消息直接调用 handler，不经过缓冲
- [ ] 非白名单 chat 的消息被 LobbyAwareChannel 过滤（复用现有测试模式）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | WebSocket 与 HTTP 回调两种通信模型的统一 | `IMTransport` 拆为两步生命周期：`prepare(context)` 准备通道（WebSocket 建立连接，HTTP 挂载路由），`onMessage(handler)` 设置回调。解决了一步 `start()` 对 HTTP 回调模型的时序错位。路由在 transport 内部挂载，不暴露 handler 方法 | 2026-06-04 |
| 2 | `FeishuTransport` 接口命名与飞书强绑定 | 提取通用 `IMTransport` / `IMInboundMessage` / `IMTransportContext` 到 `im-channel/types.ts`；删除 `feishu/types.ts` 中的接口定义；`LobbyAwareChannel` 改为 import 通用类型 | 2026-06-04 |
| 3 | `LobbyAwareChannel` 不应知道 Express app | `main.ts` 调用 `transport.prepare({ app })`，`LobbyAwareChannel.start()` 只调用 `transport.onMessage()` + `rehydrateSubscriptions()`。职责分离：编排层负责 prepare，业务层负责 onMessage | 2026-06-04 |
| 4 | 企业微信回调需要可信 IP 白名单 | 部署时需在企业微信管理后台配置服务器公网 IP；本地开发可用 ngrok 或内网穿透 | 2026-06-04 |
| 5 | `clientId` 去重前缀硬编码 `"feishu:"` | 改为使用 `this.config.channelType`，使其对所有 IM 平台通用 | 2026-06-04 |
| 6 | 企业微信消息频率限制（30 次/分钟/用户） | 首版不做限流；当前使用场景（Lobby 命令 + Agent 对话）远低于限制，需要时在 transport 层扩展 | 2026-06-04 |
| 7 | 企业微信 XML 消息解析 | 使用轻量 XML 解析（如 `fast-xml-parser`）或正则提取关键字段，避免引入重型依赖 | 2026-06-04 |
| 8 | 发送群聊消息的 API 选型 | 使用 `/cgi-bin/appchat/send`（群聊消息 API），不是 `/cgi-bin/message/send`（应用消息 API）。配置中移除 `agent_id` 字段（`appchat/send` 不需要）。`ChatId` 到 `chatid` 的映射需联调验证 | 2026-06-04 |
| 9 | `main.ts` 启动时序 | `createServer()` → `prepare()` 所有通道 → `start()` 所有通道。飞书的 `prepare()` 是 no-op（不需要 Express），可安全先调用 | 2026-06-04 |
| 10 | `prepare()` 到 `onMessage()` 之间的消息丢失窗口 | `WecomSdkTransport` 内部维护 `pendingMessages` 队列。`handleMessage` 在 `messageHandler` 为 null 时缓冲消息；`onMessage()` 注册时排空队列。排空后不再缓冲，避免内存泄漏。飞书不存在此问题（WebSocket 连接在 `onMessage()` 内部建立） | 2026-06-04 |
| 11 | `wecom/types.ts` 不独立创建 | `WecomConfig` 类型统一从 `wecom-config-store.ts` 导出，减少冗余文件 | 2026-06-04 |
| 12 | Web UI 删除 session 时多通道 cleanup | 合并飞书和企业微信的 `cleanupSessionSubscriptions` 回调，按 `chatId` 匹配（不同平台的 chatId 格式不同，不会冲突），未匹配的调用为 no-op | 2026-06-04 |

<!-- [design-time] 章节结束 -->
