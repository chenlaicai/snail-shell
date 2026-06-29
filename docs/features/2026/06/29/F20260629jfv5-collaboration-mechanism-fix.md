---
id: F20260629jfv5
title: collaboration-mechanism-fix
tags: [bugfix, collaboration, mcp, environment-variables]
modules: [collaboration, mcp, acs]
doc_kind: spec
---

# F20260629jfv5 [collaboration] 协作机制全链路修复

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

当前协作机制存在多个相互关联的问题，需要全链路修复：

### 问题 1：环境变量注入链路断裂（两套key）

**现状**：
- CONTEXT_KEYS 定义了 `SNAIL_CTX_*` 格式的环境变量（如 `SNAIL_CTX_ISSUE_ID`）
- db-bridge 脚本期望读取的是 `SNAIL_CTX_*` 格式的环境变量
- 但 buildContextEnv 函数直接展开 context 中的 key，不添加前缀
- 所以 context 中的 `message_id` 被展开为环境变量 `message_id`（不是 `SNAIL_CTX_MESSAGE_ID`）

**结果**：
- db-bridge 脚本无法读取到 `message_id` 环境变量（因为它期望的是 `SNAIL_CTX_MESSAGE_ID`）
- agent 无法获取自己的 message_id

**代码证据**：
- `src/infra/acs/context-keys.ts:7-16`：CONTEXT_KEYS 定义了 `SNAIL_CTX_*` 格式
- `src/infra/acs/_internal/utils/context-env.ts:16-22`：buildContextEnv 直接展开 context key，不添加前缀
- `src/app/issue-collaboration/collaboration.ts:358`：context 中包含 `message_id`（无前缀）

### 问题 2：set_final_body MCP message_id 可靠性

**现状**：
- `set_final_body` 要求 `message_id` 为必选参数
- agent 需要从环境变量读取 message_id，但环境变量名不一致
- agent 有时传入错误的 message_id（未读取环境变量、或在复杂多轮对话中混淆）

**代码证据**：
- `src/domain/snail-mcp-server/_internal/servers/snail-final-response.ts:27`：`message_id` 是 required 参数
- `src/domain/snail-mcp-server/_internal/servers/snail-final-response.ts:31-33`：handler 中直接使用 `params.message_id`（required）

### 问题 3：mention 路由无优先级

**现状**：
- `resolveReplies` 从 message events 中收集所有 mentions，无优先级区分
- message-payload 的 `--mentions` 生成的 JSON payload 无法被 `extractMentions` 识别
- MCP `set_final_body` 声明的路由意图也无法传递到 collaboration 层

**代码证据**：
- `src/app/issue-collaboration/collaboration.ts:403-412`：resolveReplies 从 message events 中收集所有 mentions，无优先级区分
- `src/app/issue-collaboration/collaboration.ts:521-529`：extractMentions 只识别 `@` 模式，无法从 JSON 结构中提取 structured mentions

### 问题 4：JSON payload 原文泄露

**现状**：
- 当 agent 使用 message-payload 生成 JSON payload 但未调用 set_final_body 时，JSON 原文会被渲染到前端

**代码证据**：
- `src/app/issue-collaboration/collaboration.ts:534-553`：extractTerminalContext 取最后一个 text event 作为 final_text，但 JSON payload 也是 text event

### 问题 5：最终答复来源优先级不明确

**现状**：
- agent 不知道必须优先使用 MCP 设置最终答复
- system-reminder 中没有说明最终答复的来源优先级

**代码证据**：
- `src/app/issue-collaboration/collaboration.ts:590-627`：buildContextBlock 生成的 system-reminder 中没有包含最终答复来源优先级说明

## 目标

1. 统一环境变量 key，消除两套 key 的混乱
2. `set_final_body` 的 `message_id` 和 `stage_id` 由 agent 从环境变量读取后显式传入
3. mention 路由严格优先级：MCP `to_speakers` > 现有 event mentions
4. extractTerminalContext 识别 JSON payload 并提取 fallback_text
5. system-reminder 中明确最终答复来源优先级

## 非目标

- 不改变 MessageContext 模型
- 不改变 WebSocket 协议
- 不改变前端渲染逻辑
- 不改变 message-payload skill 的命令格式或输出结构

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | agent 从环境变量读取 message_id 后显式传入 | set_final_body 写入成功 | 未实现 |
| B2 | agent 传入错误 message_id | set_final_body 报错（message 不存在） | 未实现 |
| B3 | agent 传入正确 message_id | 行为不变，写入成功 | 未实现 |
| B4 | set_final_body 传入 to_speakers | to_speakers 存入 MCP store，resolveReplies 返回该值 | 未实现 |
| B5 | set_final_body 未传 to_speakers | MCP store 无数据，resolveReplies 回退到现有逻辑 | 未实现 |
| B6 | message-payload 生成 JSON payload，未调用 set_final_body | extractTerminalContext 提取 fallback_text | 未实现 |
| B7 | 纯文本输出 | 行为不变 | 未实现 |
| B8 | set_final_body 传入 to_speakers=[] | 空数组 = "未指定"，不写入 store，resolveReplies 回退现有逻辑 | 未实现 |
| B9 | agent 失败/中断，已调用 set_final_body 写入 to_speakers | invokeAgent catch 块清理 MCP store entry，不泄漏 | 未实现 |
| B10 | agent 读取 message_id 环境变量 | 从 process.env.SNAIL_CTX_MESSAGE_ID 获取 | 未实现 |
| B11 | system-reminder 中包含最终答复来源优先级 | agent 知道必须优先使用 MCP | 人工验证 |

## 设计

### 变更 1：统一环境变量 key

**1a. 修正 buildContextEnv 函数**

将 context 中的 key 统一添加 `SNAIL_CTX_` 前缀（已带前缀的 key 不重复添加）：

```
// 修正前
env[key] = String(value);

// 修正后
const envKey = key.startsWith("SNAIL_CTX_") ? key : `SNAIL_CTX_${key}`;
env[envKey] = String(value);
```

**1b. 修正 CONTEXT_KEYS**

添加 `MESSAGE_ID` 的定义：

```
export const CONTEXT_KEYS = {
  WORKSPACE_PATH: "SNAIL_CTX_WORKSPACE_PATH",
  ISSUE_ID: "SNAIL_CTX_ISSUE_ID",
  CONVERSATION_ID: "SNAIL_CTX_CONVERSATION_ID",
  STAGE_ID: "SNAIL_CTX_STAGE_ID",
  MESSAGE_ID: "SNAIL_CTX_MESSAGE_ID",  // 新增
} as const;
```

**1c. 修正所有读取环境变量的地方**

统一使用 `SNAIL_CTX_*` 格式读取环境变量。

### 变更 2：set_final_body 参数说明

`message_id` 和 `stage_id` 保持 required。MCP Server 运行在主进程，无法访问 agent 子进程的 `process.env`，因此不存在环境变量 fallback。

Agent 从自己的环境变量 `SNAIL_CTX_MESSAGE_ID` 和 `SNAIL_CTX_STAGE_ID` 读取后显式传入。

```
inputSchema.required: ["text", "message_id", "stage_id"]

handler:
  // message_id 和 stage_id 由 agent 从环境变量读取后显式传入
  // 归属校验：message_id 必须属于 stage_id，防止串台写入
```

### 变更 3：MCP to_speakers + 严格优先级路由

**3a. MCP store**

新增共享 in-memory store，MCP 层写入、collaboration 层读取：

```typescript
export interface McpMessageStore {
  getMcpRoutingTargets(messageId: number): string[] | undefined;
  setMcpRoutingTargets(messageId: number, targets: string[]): void;
  deleteMcpRoutingTargets(messageId: number): void;
}
```

实例在 main.ts 创建，同时传入 MCP server 和 collaboration 层。

**3b. set_final_body 增加 to_speakers 参数**

```typescript
inputSchema.properties: {
  // 现有字段不变
  to_speakers: { type: "array", items: { type: "string" }, description: "路由目标（严格优先级最高）" }
}
// required 不变，to_speakers 为可选
```

handler 中：若 to_speakers 非空数组，写入 MCP store。空数组（`[]`）视为"未指定"，不写入。

多次调用 `set_final_body` 时，后调覆盖前调（Map 语义），与 `setContext` 覆盖行为一致。

**3c. resolveReplies 优先级（两层）**

```
resolveReplies(stage, roleInstance, messageId):
  // 优先级 1: MCP to_speakers（agent 通过 set_final_body 显式声明）
  mcpTargets = mcpMessageStore.getMcpRoutingTargets(messageId)
  if (mcpTargets?.length > 0):
    mcpMessageStore.deleteMcpRoutingTargets(messageId)  // 消费后清理
    return mcpTargets.filter(isValidReplyMention)

  // 优先级 2: 现有逻辑（signal mentions + text @mentions）
  // 代码不变
```

优先级语义：MCP to_speakers 存在时直接返回，不与低优先级来源合并。

**3d. error path 清理**

在 `invokeAgent` 的 catch 块中，增加 MCP store 清理：

```
catch (error):
  mcpMessageStore.deleteMcpRoutingTargets(agentMessage.id)  // 新增：丢弃未消费的路由目标
  // 后续 error handling 不变
```

agent 失败/中断时，`resolveReplies` 不执行，MCP store 中的 entry 成为孤儿。catch 块中清理消除泄漏根因。

### 变更 4：JSON payload fallback_text 提取

在 `extractTerminalContext` 中，找到 text event 后增加 JSON 检测：

```
if (event.payload.type === "text" && event.payload.text.trim()):
  // 新增：检测 format=blocks JSON payload
  parsed = tryParseJsonPayload(event.payload.text)
  if (parsed?.format === "blocks" && typeof parsed.fallback_text === "string" && parsed.fallback_text.trim()):
    return { kind: "final_text", context: parsed.fallback_text }
  return { kind: "final_text", context: event.payload.text }
```

`tryParseJsonPayload` 返回 null 表示非 JSON 或非 blocks 格式，回退到原始文本。

### 变更 5：system-reminder 完善

在 `buildContextBlock` 中添加最终答复来源优先级说明：

```
## 最终答复规则

**必须使用 `set_final_body` MCP 设置最终答复**。每次发言结束前必须调用此工具，传入你希望展示给用户的完整 Markdown 内容。

**路由目标声明**：如果需要其他角色继续处理，必须在 `set_final_body` 的 `to_speakers` 参数中声明目标角色。

**必选参数**：调用 `set_final_body` 时必须传入 `message_id` 和 `stage_id`，从环境变量 `SNAIL_CTX_MESSAGE_ID` 和 `SNAIL_CTX_STAGE_ID` 获取。
```

### 变更 6：完整链路说明

**6a. 时序说明**

消息是在 invoke agent 之前创建的，所以 `agentMessage.id` 在 invoke 时就已经存在了：

```
1. 创建消息（获得 message_id）
   ↓
   const agentMessage = this.deps.messagePort.createMessage(...)
   agentMessage.id = 123  // 此时已经知道了

2. 构建 context（包含 message_id）
   ↓
   context: { ..., message_id: String(agentMessage.id), ... }

3. 构建环境变量
   ↓
   contextEnv = this.buildContextEnv(request)

4. 注入到 agent 进程
   ↓
   env: { ...process.env, ...options.contextEnv }

5. 调用 agent
   ↓
   await agent.invokeFirstCall(...)
```

**关键代码**：
- `src/app/issue-collaboration/collaboration.ts:294`：消息在invoke之前创建
- `src/app/issue-collaboration/collaboration.ts:358`：context中包含message_id
- `src/infra/acs/_internal/utils/context-env.ts:16-22`：环境变量注入

**6b. 环境变量注入链路**

```
collaboration.ts:358
  context: { ..., message_id: String(agentMessage.id), ... }
    ↓
adapter.ts:124
  contextEnv = this.buildContextEnv(request)
    ↓
context-env.ts:16-22
  env[`SNAIL_CTX_${key}`] = String(value)  // 修正后：统一添加前缀
    ↓
claude-code.ts:76
  env: { ...process.env, ...options.contextEnv }
    ↓
agent 进程
  process.env.SNAIL_CTX_MESSAGE_ID = "123"
```

**6c. agent 获取 message_id 的方式**

Agent 从环境变量 `SNAIL_CTX_MESSAGE_ID` 读取当前消息 ID，在调用 `set_final_body` 时显式传入 `message_id` 和 `stage_id` 参数。

## 生效路径

### 依赖注入链路

```
main.ts
  ├── const mcpMessageStore = createMcpMessageStore()     // 新增：创建 store 实例
  ├── initMCPServer({ message, mcpMessageStore })          // 传入 MCP server
  │     └── createFinalResponseServer(messagePort, mcpMessageStore)
  └── initIssueCollaboration({ ..., mcpMessageStore })     // 传入 collaboration
        └── IssueCollaboration({ ..., mcpMessageStore })
```

### 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/infra/acs/context-keys.ts` | 修改 | 添加 MESSAGE_ID 定义 |
| `src/infra/acs/_internal/utils/context-env.ts` | 修改 | 统一添加 SNAIL_CTX_ 前缀 |
| `src/domain/snail-mcp-server/_internal/mcp-message-store.ts` | 新增 | McpMessageStore 接口 + createMcpMessageStore 实现 |
| `src/domain/snail-mcp-server/_internal/servers/snail-final-response.ts` | 修改 | 变更 2（message_id 可选）+ 变更 3b（to_speakers 参数） |
| `src/domain/snail-mcp-server/_internal/initor.ts` | 修改 | init deps 增加 mcpMessageStore，传递给 createFinalResponseServer |
| `src/app/issue-collaboration/collaboration.ts` | 修改 | 变更 3c（resolveReplies 优先级）+ 变更 3d（error path 清理）+ 变更 4（JSON payload）+ 变更 5（system-reminder）+ CollaborationDeps 增加 mcpMessageStore 字段 |
| `src/main.ts` | 修改 | 创建 mcpMessageStore 实例，传入 initMCPServer 和 initIssueCollaboration |

## 设计约束摘要

- **边界**：不修改 MessageContext 模型、不修改 WebSocket 协议、不修改前端
- **语义不变量**：cursor 是 agent 认知边界，to_speakers 是路由事实
- **优先级语义**：两层——MCP to_speakers > 现有 event mentions。高优先级存在时直接返回，不合并
- **内存生命周期**：正常路径——resolveReplies 消费后清理；异常路径——invokeAgent catch 块清理
- **多次调用**：set_final_body 多次调用时"最后一次调用生效"，与 setContext 覆盖语义一致
- **空数组语义**：to_speakers=[] 视为"未指定"，不写入 store，回退现有逻辑
- **环境变量统一**：所有 context key 统一添加 SNAIL_CTX_ 前缀，消除两套 key 混乱

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | 环境变量统一策略 | 统一使用 SNAIL_CTX_ 前缀，消除两套 key 混乱 | 需要修改多处代码 | 统一前缀 | 用户明确要求"不要有两套key" | 用户, 架构师-1 | 2026-06-27 |
| D2 | get_current_message_id 独立工具 vs agent 直接读 env var | 独立工具：agent 可预先验证 | 多一个工具增加认知负担 | env var 直读 | agent 从 process.env.SNAIL_CTX_MESSAGE_ID 读取后显式传入，MCP Server 无进程内 env var 访问能力 | 架构师-1 | 2026-06-27 |
| D3 | MCP store vs MessageContext 扩展 vs JSON 序列化 | store：零模型变更，层间解耦 | 共享状态在进程内存，重启丢失 | store | routing targets 是瞬态数据，无需持久化；层间解耦优先 | 架构师-1 | 2026-06-27 |
| D4 | JSON 检测范围 | `format=blocks` 精确匹配 message-payload 输出 | 极低概率误判（agent 恰好输出同结构 JSON） | 精确匹配 | set_final_body 已调用时走 mcp_final_body 分支，不进入此逻辑；误判场景不存在 | 架构师-1 | 2026-06-27 |
| D5 | error path MCP store 清理策略 | catch 块中 delete：一行代码消除泄漏根因 | 低频场景，entry 体积极小，重启即清空 | catch 块清理 | 零副作用，防御性编程 | 架构师-1 | 2026-06-27 |
| D6 | 两层 vs 三层优先级 | 两层：MCP to_speakers > 现有 event mentions，message-payload 通过 MCP 间接生效 | 三层：直接从 JSON payload 提取 structured mentions | 两层 | 避免 collaboration 层耦合 message-payload JSON 结构 | 架构师-1 | 2026-06-27 |

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/infra/acs/context-keys.ts` | 修改 | 添加 MESSAGE_ID 定义 |
| `src/infra/acs/_internal/utils/context-env.ts` | 修改 | 统一添加 SNAIL_CTX_ 前缀 |
| `src/domain/snail-mcp-server/_internal/mcp-message-store.ts` | 新增 | McpMessageStore 接口 + createMcpMessageStore 实现 |
| `src/domain/snail-mcp-server/_internal/servers/snail-final-response.ts` | 修改 | message_id 可选 + to_speakers 参数 |
| `src/domain/snail-mcp-server/_internal/initor.ts` | 修改 | init deps 增加 mcpMessageStore |
| `src/app/issue-collaboration/collaboration.ts` | 修改 | resolveReplies 优先级 + error path 清理 + JSON payload + system-reminder + CollaborationDeps 增加 mcpMessageStore 字段 |
| `src/main.ts` | 修改 | 创建 mcpMessageStore 实例 |

## 验证

- [ ] agent 能从 `process.env.SNAIL_CTX_MESSAGE_ID` 获取 message_id
- [ ] set_final_body 必须传入 message_id 和 stage_id（required）
- [ ] set_final_body 传入 to_speakers 时，resolveReplies 返回该值
- [ ] message-payload 生成 JSON payload 时，extractTerminalContext 提取 fallback_text
- [ ] system-reminder 中包含最终答复来源优先级说明
- [ ] agent 失败/中断时，MCP store entry 被清理

## 关联

- **前置**: 无
- **后续**: 无

## 关键设计取舍

### 取舍 1：统一前缀 vs 不统一

**正方**：统一使用 SNAIL_CTX_ 前缀，消除两套 key 混乱，与现有 db-bridge 脚本兼容
**反方**：需要修改多处代码，增加复杂度
**最终决策**：统一前缀
**决策依据**：用户明确要求"不要有两套key"

### 取舍 2：MCP store vs MessageContext 扩展

**正方**：MCP store 零模型变更，层间解耦
**反方**：共享状态在进程内存，重启丢失
**最终决策**：MCP store
**决策依据**：routing targets 是瞬态数据，无需持久化；层间解耦优先

### 取舍 3：两层 vs 三层优先级

**正方**：两层：MCP to_speakers > 现有 event mentions，message-payload 通过 MCP 间接生效
**反方**：三层：直接从 JSON payload 提取 structured mentions
**最终决策**：两层
**决策依据**：避免 collaboration 层耦合 message-payload JSON 结构
