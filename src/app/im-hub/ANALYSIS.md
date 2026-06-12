# im-hub 业务分析

## 定位

im-hub 是 IM 场景的**薄网关层**。只做两件事：
1. 承载 webhook HTTP 路由
2. 把 `forwardMessage` 回调注入 IM domain 的 LobbyRouter

实际的消息处理、agent 调用、事件持久化、出站推送 — 全部由 `issue-collaboration` 负责。

```
外部 IM 平台 (Feishu/WeCom)
  ↓ webhook
im-hub (HTTP 路由，挂载 Hono app)
  ↓ channel.handleWebhook
IM domain (传输层 + lobby 导航 + 去重)
  ↓ processInbound
  ├── slash 命令 → 本地执行 → sendText 回复
  └── 普通消息 → forwardMessage 回调
        ↓
issue-collaboration (跨域编排)
  ├── CollaborationInput.sendMessage — 接收消息
  ├── MessagePort — 持久化
  ├── SnailPort — agent 调用
  ├── CollaborationConsumer — 推送给所有订阅者
  │     ├── IMConsumer → Feishu/WeCom sendText/patchText
  │     └── WebConsumer → WebSocket push
  └── MessagePort.completeMessage — 标记完成
```

## im-hub 的业务能力

### 能力 1：HTTP 路由承载

将 IM domain 的 Hono app 挂载到主 HTTP server。

```typescript
// main.ts
app.route("/im", im.app);
```

### 能力 2：注入 forwardMessage 回调

im-hub 构造 `forwardMessage` 回调，注入 IM domain 的 `LobbyRouter`。

```typescript
// im-hub 内部
const forwardMessage = (stageId: string, text: string, chatId: string) => {
  return collaboration.sendMessage(stageId, text, chatId);
};

// 注入到 IM domain
const im = initIM({
  workspacePort, issuePort, stagePort,
  forwardMessage,
}, imConfig);
```

### 能力 3：注册 IMConsumer

im-hub 在 `forwardMessage` 内部，确保当前 chatId 已注册为 CollaborationConsumer。

### 能力 4：启动时 re-register consumers

系统重启后，im-hub 主动恢复所有 in_stage 会话的 consumer 注册：

```typescript
// im-hub 启动逻辑
const activeSessions = lobbyRepo.getInStageSessions(channelType);
for (const session of activeSessions) {
  collaboration.registerConsumer(session.current_stage_id, new IMConsumer(session.channel_chat_id));
}
```

---

## issue-collaboration 端口定义

### 输入端口 — 外部 → issue-collaboration

```typescript
interface CollaborationInput {
  /**
   * 用户向 stage 发送消息。
   * 异步执行：创建消息 → 调 agent → 通过 output port 推结果。
   * 调用方不等待 agent 完成。
   */
  sendMessage(stageId: string, text: string, fromSpeaker: string): Promise<void>;

  /** 注册消费者（stage 维度） */
  registerConsumer(stageId: string, consumer: CollaborationConsumer): void;

  /** 注销消费者 */
  unregisterConsumer(stageId: string, consumer: CollaborationConsumer): void;
}
```

### 输出端口 — issue-collaboration → 外部

```typescript
interface CollaborationConsumer {
  /** agent 产生流式事件 */
  onEvent(stageId: string, event: MessageEvent): void;

  /** 消息完成（含最终文本） */
  onMessageCompleted(stageId: string, message: Message, context: MessageContext): void;
}
```

### 调用关系

```
IM  ──sendMessage──→ issue-collaboration ──onEvent/onCompleted──→ IMConsumer
Web ──sendMessage──→ issue-collaboration ──onEvent/onCompleted──→ WebConsumer
```

IM 和 Web 同时是输入方（调 sendMessage）和输出方（实现 CollaborationConsumer）。

---

## 5 个业务场景覆盖验证

### 场景 1：消息转发（IM → Agent）

```
用户在 Stage A 发 "帮我看看代码"
→ IM domain: LobbyRouter 判断 in_stage → forwardMessage
→ CollaborationInput.sendMessage(stageId, "帮我看看代码", "user")
→ issue-collaboration: 创建消息 + 调 snail
```

**覆盖。** forwardMessage 回调桥接到 CollaborationInput.sendMessage。

### 场景 2：Agent 调用

```
issue-collaboration 内部：
→ createMessage(stage_id, from_speaker: "user", status: "completed")  // 用户消息
→ createMessage(stage_id, from_speaker: roleInstance, status: "streaming")  // agent 消息
→ appendEvent(start)
→ snailPort.invokeFirstCall(snailId, request, onEvent)
→ onEvent 内部：appendEvent + notifyConsumers
→ completeMessage + setContext
```

**覆盖。** 完全在 issue-collaboration 内部，不涉及 IM。

### 场景 3：出站推送（Agent → IM）

```
onEvent → notifyConsumers(stageId, event)
→ 遍历 stageId 下所有 registered consumers
→ IMConsumer.onEvent(stageId, event)
  → event.kind === "text" → sendText/patchText
→ IMConsumer.onMessageCompleted(stageId, message, context)
  → 最终文本推送
```

**覆盖。** Echo 防护在 IMConsumer 内部处理。

### 场景 4：多聊天室订阅

```
Chat A 发消息 → sendMessage → 自动 registerConsumer(stageA, consumerA)
Chat B 也订阅了 stageA → registerConsumer(stageA, consumerB)

agent 事件 → notifyConsumers → fanout：
→ consumerA.onEvent → push 到 Chat A
→ consumerB.onEvent → push 到 Chat B
```

**覆盖。** issue-collaboration 维护 stage→consumers 映射，按 stage 维度 fanout。

Echo 防护在 IMConsumer 内部：
- 用户消息从 Chat A 发出 → consumerA 的 onEvent 跳过回显
- 但 consumerB 正常推送

### 场景 5：启动恢复

```
重启前：Chat A 的 LobbySession → navigation_level: "in_stage", current_stage_id: "stage-123"
重启后：
  1. LobbySession 从 SQLite 恢复 → 位置不变
  2. IM 主动 re-register consumers：
     lobbyRepo.getInStageSessions("feishu")
     → 每个 session：registerConsumer(session.current_stage_id, new IMConsumer(session.channel_chat_id))
  3. agent 产出消息 → consumer 已就绪 → 正常推送到 IM
```

**覆盖。** 两步：LobbySession 持久化（位置恢复）+ 启动时主动注册 consumer（消息不丢）。

---

## 对 IM domain 的改动需求

### forwardMessage 签名扩展

当前：
```typescript
forwardMessage?: (stageId: string, text: string) => Promise<{ messageIds: number[] } | null>;
```

改为：
```typescript
forwardMessage?: (stageId: string, text: string, chatId: string) => Promise<void>;
```

### LobbyRouter.processInbound 携带 chatId

`forwarded` 结果需要携带 chatId：
```typescript
{ forwarded: true; session: LobbySession; chatId: string }
```

### IMHonoDeps 接受 forwardMessage

```typescript
interface IMHonoDeps {
  workspacePort: WorkspacePort;
  issuePort: IssuePort;
  stagePort: StagePort;
  forwardMessage?: (stageId: string, text: string, chatId: string) => Promise<void>;
}
```

### LobbySession 持久化

当前 InMemory，需要改为 SQLite（启动恢复依赖）。SQLiteDatabase infra 已就绪。

---

## Domain 依赖关系

### im-hub 的依赖

```
im-hub
  ├── IM domain — Hono app 用于挂载
  └── issue-collaboration — forwardMessage 回调
```

### issue-collaboration 的依赖

```
issue-collaboration
  ├── MessagePort     — 消息 CRUD、事件流、上下文
  ├── SnailPort       — agent 调用
  ├── StagePort       — 角色-snail 映射、handbook
  └── (无 IM 依赖)    — 通过 CollaborationConsumer 输出
```

issue-collaboration 不依赖 IM domain。它只认识 CollaborationConsumer 接口，不关心背后是 Feishu、WeCom 还是 WebSocket。

---

## 实现顺序

| 阶段 | 内容 | 模块 |
|------|------|------|
| P0 | CollaborationInput / CollaborationConsumer 端口定义 | app/issue-collaboration |
| P0 | issue-collaboration 核心实现（sendMessage + onEvent + notifyConsumers） | app/issue-collaboration |
| P0 | IMConsumer 实现 | app/im-hub |
| P0 | IM domain forwardMessage 签名扩展 | IM domain |
| P0 | Message domain 接入 main.ts | main.ts |
| P0 | im-hub 薄网关 + 回调注入 + consumer 注册 | app/im-hub |
| P1 | 流式推送（Feishu PATCH） | IMConsumer |
| P0 | LobbySession SQLite 持久化 | IM domain |
| P0 | 启动时 re-register consumers | im-hub |
| P1 | WebConsumer 实现 | app/web-hub 或类似 |
| P2 | 多聊天室订阅 echo 防护 | IMConsumer |
