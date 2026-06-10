# IM 模块分析（v1 遗留）

> 本文档基于 `v1/` 目录下的遗留代码分析，用于指导 v2 重写。

---

## 一、业务场景

### 1.1 IM 是什么

IM（Instant Messaging）是 Snail Shell 的**消息与对话系统**。核心职责：管理 Conversation 和 Message 的生命周期，实现人与 AI Agent 之间的多角色协作对话。

核心架构：**事件溯源 + 分发路由**。Message 本身是薄信封，所有内容存于 append-only 的 message_event 流中；消息不直接调用接收方，而是创建 message_dispatch 记录，由 drainMessageBus 循环批量处理。

### 1.2 核心业务场景

| 场景 | 说明 |
|------|------|
| **Stage 默认 Conversation** | Issue 创建 / Stage 转换时自动创建一个 Conversation，包含该 Stage 的所有 Role |
| **用户发送消息** | 用户通过 Web/IM 渠道发送消息，系统解析 mention、确定目标角色、创建 dispatch、触发 Agent 协作循环 |
| **Agent 协作循环** | drainMessageBus 按 dispatch 分组调用 Agent 运行时，Agent 回复产生新 dispatch，循环直到无 pending dispatch |
| **消息中断** | 用户可中断正在 streaming 的 Agent 消息，通过 AbortController 实现 |
| **工具审批** | Agent 运行时请求权限时，消息状态变为 pending_approval，用户 approve/deny |
| **历史搜索** | FTS5 全文搜索跨 Conversation 的历史消息 |
| **Lobby（外部 IM 渠道）** | 飞书/企微等外部渠道通过 Lobby 导航层接入，支持 /workspaces、/issues、/enter 等命令 |
| **WebSocket 实时推送** | 前端通过 WebSocket 接收消息事件的实时流式更新 |

### 1.3 IM 与其他模块的关系

- **Issue → Stage → Conversation → Message**：层级关系，Stage 转换自动创建新 Conversation
- **SOP**：Conversation 的 default_role 和 participating_roles 来自 SOP snapshot 的 Stage 定义
- **Role**：消息路由基于 Role，dispatch 系统按目标角色分发
- **Agent Runtime**：drainMessageBus 调用各 Agent 适配器（Claude Code、Codex、OpenCode）
- **Skill**：message-payload Skill 格式化结构化消息内容；conversation-history Skill 查询历史
- **Evolution**：Evolution 治理对话的 owner_type="evolution"，走特殊 system prompt 构建路径
- **Prompt Center**：system prompt 注入 Conversation 的上下文（stage、role、handbook 等）
- **Gateway**：ConversationGateway 是所有消息发送的统一入口，处理输入规范化和 WebSocket 订阅

---

## 二、数据模型

### 2.1 数据库表（7 核心 + 2 Lobby + 1 FTS）

**conversation 表**：
```sql
CREATE TABLE conversation (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  issue_id TEXT REFERENCES issue(id) ON DELETE CASCADE,
  stage_id TEXT REFERENCES stage(id) ON DELETE SET NULL,
  owner_type TEXT NOT NULL DEFAULT 'workspace_stage',  -- workspace_stage | evolution
  owner_id TEXT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,          -- discussion/planning/design/implementation/review/bugfix
  status TEXT NOT NULL DEFAULT 'active',  -- active/paused/completed/archived
  default_role TEXT NOT NULL,
  participating_roles TEXT NOT NULL DEFAULT '[]',  -- JSON array
  summary TEXT,
  from_conversation_ids TEXT NOT NULL DEFAULT '[]',  -- JSON array, 跨 Conversation 血缘
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- UNIQUE(stage_id) WHERE stage_id IS NOT NULL — 每个 Stage 最多一个默认 Conversation
```

**message 表**：
```sql
CREATE TABLE message (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  client_id TEXT,              -- 前端乐观 ID
  from_role TEXT NOT NULL,
  to_roles TEXT NOT NULL DEFAULT '[]',  -- JSON array
  role TEXT NOT NULL,          -- user/assistant/system
  quoted_message_id INTEGER REFERENCES message(id),
  context_cutoff_at INTEGER,   -- 上下文边界（message ID，非时间戳）
  runtime TEXT,                -- claude/opencode/codex/system/unknown
  status TEXT NOT NULL DEFAULT 'completed',  -- streaming/completed/failed/interrupted/cancelled/pending_approval
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**message_event 表**（事件溯源核心）：
```sql
CREATE TABLE message_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES message(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,        -- 消息内排序
  category TEXT NOT NULL,      -- content/signal
  kind TEXT NOT NULL,          -- start/text/content_block/tool_call/tool_result/command/command_result/signal/error
  payload TEXT NOT NULL,       -- JSON
  source TEXT,                 -- JSON, 运行时元数据
  UNIQUE(message_id, seq)
);
```

**message_context 表**（终端上下文）：
```sql
CREATE TABLE message_context (
  message_id INTEGER PRIMARY KEY REFERENCES message(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,          -- final_text/message_out/event_summary/llm_summary/mcp_final_body
  context TEXT NOT NULL        -- prompt 可注入的文本表示
);
```

**message_dispatch 表**（分发路由）：
```sql
CREATE TABLE message_dispatch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL REFERENCES message(id) ON DELETE CASCADE,
  to_role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending/seen/consumed/skipped
  consumed_by_message_id INTEGER REFERENCES message(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**snail_agent_session 表**：
```sql
CREATE TABLE snail_agent_session (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  role_name TEXT NOT NULL,
  runtime TEXT NOT NULL,
  model TEXT,
  context_provider TEXT,       -- shell/agent
  external_session_id TEXT,
  handoff_from_id TEXT REFERENCES snail_agent_session(id)
);
```

**lobby_session / lobby_message 表**（外部 IM 渠道）：
```sql
CREATE TABLE lobby_session (
  channel_type TEXT NOT NULL,   -- feishu/wecom
  channel_chat_id TEXT NOT NULL,
  navigation_level TEXT NOT NULL DEFAULT 'lobby',  -- lobby/workspace_list/issue_list/in_conversation
  current_conversation_id TEXT,
  PRIMARY KEY (channel_type, channel_chat_id)
);

CREATE TABLE lobby_message (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_type TEXT NOT NULL,
  channel_chat_id TEXT NOT NULL,
  direction TEXT NOT NULL,      -- inbound/outbound
  command TEXT,
  content TEXT,
  response_content TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**message_search 表**（FTS5）：
```sql
CREATE VIRTUAL TABLE message_search USING fts5(
  conversation_id UNINDEXED,
  message_id UNINDEXED,
  role UNINDEXED,
  from_role UNINDEXED,
  content
);
```

### 2.2 类型系统

**Conversation 枚举**：
- `ConversationKind`: `"discussion" | "planning" | "design" | "implementation" | "review" | "bugfix"`
- `ConversationOwnerType`: `"workspace_stage" | "evolution"`
- `ConversationStatus`: `"active" | "paused" | "completed" | "archived"`

**Message 枚举**：
- `MessageRole`: `"user" | "assistant" | "system"`
- `MessageRuntime`: `"claude" | "opencode" | "codex" | "system" | "unknown"`
- `MessageStatus`: `"streaming" | "completed" | "failed" | "interrupted" | "cancelled" | "pending_approval"`
- `MessageEventKind`: `"start" | "text" | "content_block" | "tool_call" | "tool_result" | "command" | "command_result" | "signal" | "error"`
- `MessageContextKind`: `"final_text" | "message_out" | "event_summary" | "llm_summary" | "mcp_final_body"`
- `MessageDispatchStatus`: `"pending" | "seen" | "consumed" | "skipped"`

**内容块类型**（12 种 MessageContentBlock）：
- 文本：`MessageTextBlock`、`MessageRichTextBlock`、`MessageMarkdownBlock`
- 视觉：`MessageImageBlock`、`MessageIconBlock`
- 数据：`MessageChartBlock`（bar/line/pie/table）、`MessageTableBlock`
- 交互：`MessageQuestionBlock`、`MessageQuestionResponseBlock`
- 引用：`MessageToolCallCardBlock`、`MessageArtifactCardBlock`、`MessageReferenceCardBlock`

**事件 payload 类型**：
- `StartEventPayload` — 消息流开始标记
- `TextEventPayload` — 纯文本 + mention 提取
- `ContentBlockEventPayload` — 结构化块数组 + fallback_text
- `ToolCallEventPayload` / `ToolResultEventPayload` — 工具调用记录
- `CommandEventPayload` / `CommandResultEventPayload` — Shell 命令记录
- `SignalEventPayload` — 生命周期信号（message_completed、message_failed、runtime_usage、permission_blocked 等）
- `ErrorEventPayload` — 错误记录

---

## 三、核心流程

### 3.1 用户发送消息流程

```
用户输入 → ConversationGateway.normalizeInput() → 校验事件类型
  → resolveMentions() → 提取结构化 mention（或 LLM 兜底提取）
  → resolveMessageToRoles() → 目标角色：显式 mention > latestRespondingRole > default_role
  → store.addMessage() → 创建 message 行 + message_dispatch 行（每个目标角色一个）
  → appendEvents() → start event + content events + terminal signal event
  → buildTerminalMessageContext() → 生成 prompt 可注入的终端上下文
  → drainMessageBus() → 处理所有 pending dispatch
```

### 3.2 Agent 协作循环

```
drainMessageBus()
  → 按目标角色分组 pending dispatch
  → 人类角色（项目负责人）：跳过，发出 boss mention 通知
  → Agent 角色：invokeRoleBatch()
    → 解析运行时上下文（conversation, role, capability, session）
    → 构建 SnailRuntimeMessageInput（workspace, conversation, role, system prompt, history, events）
    → 注入 MCP context block（conversation_id, message_id, set_final_body 指令）
    → createStreamingContext() → 创建 assistant message + start event
    → 注册 interrupt controller
    → invokeRuntimeMessage() → 调用 Agent 运行时
    → handleStreamingEvent() → 流式事件处理
    → finalizeMessageLifecycle() → 终端信号事件、终端上下文持久化
    → 扫描 stage_transition 提议 → 解析 mention 路由
  → 循环直到无 pending dispatch（受 maxCollaborationRounds 限制）
```

### 3.3 消息中断流程

```
用户点击中断 → POST /api/conversations/:id/messages/:id/interrupt
  → MessageInterruptRegistry.interrupt(conversationId, messageId)
  → AbortController.abort()
  → 运行时收到中断信号 → 消息状态变为 interrupted
```

### 3.4 Stage Conversation 自动创建

```
createDefaultStageConversation()
  → title: "${issue.title} . ${stage.type} #${stage.sequence}"
  → kind: "discussion"
  → defaultRole: SOP stage 定义的 primary role
  → participatingRoles: [HUMAN_ROLE_NAME, ...all stage roles]
  → fromConversationIds: [previous stage conversation id]
```

---

## 四、关键设计决策（v1）

1. **事件溯源** — Message 是薄信封，所有内容存于 append-only 的 message_event 流
2. **终端上下文提取** — 消息完成后提取 prompt 可注入的摘要（优先 mcp_final_body，其次 deterministic，超长走 LLM 摘要）
3. **Dispatch 路由** — 消息不直接调用接收方，创建 dispatch 记录，drainMessageBus 批量处理
4. **Context cutoff 边界** — 每条消息记录 context_cutoff_at（message ID），防止并发写入污染上下文窗口
5. **每 Stage 一个默认 Conversation** — UNIQUE(stage_id) 约束，但 UI 可创建额外 Conversation
6. **ConversationQueue 串行化** — 每个 Conversation 独立的 promise chain，防止并发消息处理
7. **Lobby 导航层** — 外部 IM 渠道通过 lobby_session 跟踪导航状态，支持多级导航命令
8. **WebSocket 实时推送** — 前端通过 WebSocket 接收 message_started、message_event_appended、message_status_changed 事件

---

## 五、外部 IM 渠道集成（飞书/企微）

### 5.1 IMChannel 抽象层

`interaction-entry/im-channel/` 定义了平台无关的 IM 渠道抽象：

**IMChannelAdapter 接口**：
```typescript
interface IMChannelAdapter {
  readonly channelType: string;  // "feishu" | "wecom"
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

**IMTransport 接口**（传输层抽象）：
```typescript
interface IMTransport {
  prepare(context: IMTransportContext): Promise<void>;
  onMessage(handler: (msg: IMInboundMessage) => void): void;
  stop(): Promise<void>;
  sendText(params: { chatId: string; text: string; uuid?: string }): Promise<string>;  // 返回 message_id
  patchText?(params: { messageId: string; text: string }): Promise<void>;  // 可选，用于流式更新
}
```

**IMInboundMessage**（规范化入站消息）：
```typescript
interface IMInboundMessage {
  tenantKey?: string;
  chatId: string;
  messageId: string;
  text: string;
}
```

### 5.2 LobbyAwareChannel（核心适配器实现）

飞书和企微共享同一个 `LobbyAwareChannel` 实现（约 470 行），通过注入不同的 `IMTransport` 适配不同平台。

**入站消息流程**：
```
IM 消息到达 → IMTransport.onMessage()
  → LobbyAwareChannel.handleInbound()
    → allowedChats 白名单校验
    → 去重（pendingInbound Set + processedInbound Map with 24h TTL）
    → lobbyRouter.processInbound()
      → 斜杠命令（/workspaces, /issues, /enter, /back, /lobby, /status, /help）
        → LobbyCommandExecutor 执行 → 返回 LobbyResponse
      → 在 conversation 中 → gateway.sendMessage() → 转发到 Agent
      → 在 lobby 中非命令 → 提示使用斜杠命令
    → 命令响应 → transport.sendText() 回复
    → 转发成功 → gateway.subscribe() 订阅出站事件
```

**出站消息流程（Agent → IM 聊天）**：

Legacy 路径（streamingEnabled=false）：
```
message_event_appended → 提取文本 → renderOutboundMessage() → transport.sendText()
```

Streaming 路径（streamingEnabled=true，仅飞书）：
```
message_started → 创建 FeishuStreamingSession → sendText("[roleName] thinking...")
message_event_appended → onTextDelta(delta) → 追加到 buffer → debounce flush
message_status_changed → onEnd(finalText) → patchText() 最终替换
```

**回声防止**：
- `recentForwardedMessages` map 跟踪已转发的 messageId
- `pendingForwardChatId` 处理时序问题（gateway 同步 emit 早于 processInbound 返回）

**订阅管理**：
- `conversationSubscriptions`（conversationId → { chatIds, unsubscribe }）
- 导航切换时（/back, /lobby）自动取消旧 conversation 订阅
- `rehydrateSubscriptions()` 重启后重新订阅活跃 conversation

### 5.3 飞书集成（FeishuSdkTransport）

| 特性 | 值 |
|------|-----|
| 传输模型 | WebSocket（WSClient） |
| SDK | @larksuiteoapi/node-sdk（可选依赖，懒加载） |
| Express 依赖 | 否 |
| 消息加密 | SDK 处理 |
| 入站格式 | SDK event → JSON content 字段 |
| 出站 API | client.im.v1.message.create |
| 返回 message_id | 是 |
| patchText | 支持（SDK message.patch） |
| 流式更新 | 支持（placeholder + debounce PATCH） |

**配置**（`config/feishu.json`）：
```json
{
  "enabled": true,
  "app_id": "...",
  "app_secret": "...",
  "allowed_chats": [{ "chat_id": "...", "tenant_key": "..." }],
  "message_push": {
    "max_text_length": 4000,
    "streaming": { "enabled": true, "flush_interval_ms": 300 }
  }
}
```

**FeishuStreamingSession 状态机**：
```
idle → started（发送 placeholder）→ streaming（buffer + debounce flush）→ finalized（最终 PATCH）
```

### 5.4 企微集成（WecomSdkTransport）

| 特性 | 值 |
|------|-----|
| 传输模型 | HTTP callback（/webhook/wecom） |
| SDK | 无（raw HTTP fetch） |
| Express 依赖 | 是（mount GET/POST routes） |
| 消息加密 | AES-256-CBC（encoding_aes_key） |
| 入站格式 | 加密 XML → regex 解析 |
| 出站 API | POST /cgi-bin/appchat/send |
| 返回 message_id | 否（返回空字符串） |
| patchText | 不支持 |
| 流式更新 | 不支持（降级为 legacy sendText） |

**配置**（`config/wecom.json`）：
```json
{
  "enabled": true,
  "corp_id": "...",
  "corp_secret": "...",
  "token": "...",
  "encoding_aes_key": "...",
  "allowed_chats": [{ "chat_id": "..." }],
  "message_push": { "max_text_length": 4000 }
}
```

**Webhook 验证**：
```
GET /webhook/wecom → 解密 echostr（AES-256-CBC）→ 验证 SHA-1 签名 → 返回解密字符串
POST /webhook/wecom → 读取 raw body → 提取加密 XML → 解密 → 解析 MsgType=text
```

**Access Token 管理**：
```
GET /cgi-bin/gettoken?corpid=...&corpsecret=...
→ 缓存 token + expires_at
→ 5 分钟安全余量过期刷新
→ refreshPromise 单例防并发刷新
```

### 5.5 飞书 vs 企微对比

| 维度 | 飞书 | 企微 |
|------|------|------|
| 传输 | WebSocket | HTTP callback |
| Express | 不需要 | 需要（mount webhook routes） |
| SDK | @larksuiteoapi/node-sdk | 无（raw HTTP） |
| 加密 | SDK 处理 | AES-256-CBC 手动解密 |
| message_id | 返回 | 不返回 |
| patchText | 支持 | 不支持 |
| 流式更新 | 支持（debounce PATCH） | 不支持 |
| 启动顺序 | 先于 Express | 后于 Express（需要 app） |

### 5.6 启动时序（main.ts）

```
setupImChannels()
  → startFeishuChannel()（WebSocket，不依赖 Express）
    → FeishuSdkTransport.prepare()
    → 创建 LobbySessionStore, PlainTextLobbyRenderer, LobbyCommandExecutor, LobbyRouter
    → new LobbyAwareChannel({ channelType: "feishu", streamingEnabled: true })

createServer() → Express app 创建

  → startWecomChannel()（需要 Express mount routes）
    → WecomSdkTransport.prepare({ app })
    → 创建同上组件
    → new LobbyAwareChannel({ channelType: "wecom", streamingEnabled: false })

两个 channel 共享同一个 ConversationGateway 实例
onSessionCleanup 回调确保 Web UI 重置 session 时清理 channel 订阅
```

---

## 六、v2 重写待决问题

1. **事件溯源是否保留？** 当前 message_event 表是 append-only，是否需要保留还是简化为单 body 字段？
2. **Dispatch 路由是否简化？** 当前 dispatch 表 + drainMessageBus 循环是否过于复杂？
3. **飞书/企微是否保留？** 外部 IM 渠道集成是否在 v2 范围内？
4. **Agent 协作循环的 round 限制？** maxCollaborationRounds 是否需要更灵活的策略？
5. **终端上下文提取策略？** LLM 摘要是否保留，还是简化为 deterministic 提取？
6. **WebSocket 协议是否演进？** 当前的事件类型和 backfill 机制是否需要调整？
7. **Conversation owner_type 扩展？** 除 workspace_stage 和 evolution 外是否需要新的 owner 类型？
8. **消息内容块类型是否精简？** 12 种内容块是否都需要保留？
9. **IMChannel 抽象是否保留？** 当前 IMTransport/LobbyAwareChannel 分层是否需要简化？
10. **企微流式更新？** 企微不支持 patchText，是否需要其他方案（如卡片消息）？
11. **Lobby 导航是否简化？** 当前多级导航（lobby → workspace → issue → conversation）是否过于复杂？
12. **消息渲染是否增强？** 当前全部输出为纯文本，是否需要富文本/卡片消息？
