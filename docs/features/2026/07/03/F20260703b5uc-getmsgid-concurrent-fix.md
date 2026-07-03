---
id: F20260703b5uc
title: get_current_message_id 并发串台修复
from_ids: []
tags: [messaging, mcp, concurrency]
modules: [snail-mcp-server, message]
---
# get_current_message_id 并发串台修复

**特性编号**：F20260703b5uc
**创建日期**：2026-07-03
**状态**：implemented

## 问题背景

在多 agent 并发发言场景下，`get_current_message_id` 返回了错误的消息 ID，导致架构师-1 的最终发言被写入到架构师-2 的消息上。

**事故现象**：
- 消息 3637 的 `from_speaker` 是 `"架构师-2"`，但内容签名是 "by 架构师-1"
- 架构师-1 确实先调用了 `get_current_message_id`，但获取到了错误的 message_id

## 根因分析

### 核心问题

`findLatestMessage` 的 SQL 查询不带 `from_speaker` 过滤：

```sql
SELECT * FROM message WHERE stage_id = ? ORDER BY id DESC LIMIT 1
```

当两个 agent 在同一 stage 并发发言时：
1. `invokeAgent` 为架构师-1 创建消息 3636（`from_speaker: "架构师-1"`）
2. `invokeAgent` 为架构师-2 创建消息 3637（`from_speaker: "架构师-2"`）
3. 架构师-1 调用 `get_current_message_id` → 返回 3637（因为 ID 更大）
4. 架构师-1 调用 `set_final_body(message_id=3637)` → 写入架构师-2 的消息

### 现有防护失效

| 防护机制 | 失效原因 |
|---------|---------|
| `verifyStageOwnership` | 只检查 `message.stage_id === stageId`，不检查 `from_speaker` |
| `verifyMessageFreshness` | 也调用 `findLatestMessage(stageId)`，同样不带 speaker 过滤 |
| `submittedMessages` Set | 只防同一 message_id 重复调用，不防跨 speaker 写入 |

## 用户意图锚

| UA | 用户原话 | 来源 | 关键修饰语 | 架构师解读 |
|----|---------|------|-----------|-----------|
| UA-1 | "我看到了架构师-1的最终发言 适配到了 架构师-2 上！！！！" | Issue 消息 | 强调符号"！！！！"表示严重性 | 用户发现消息串台，这是核心问题 |
| UA-2 | "架构师-1 是有先调用get msg id的" | Issue 消息 | "先调用"表示时序 | 用户认为架构师-1 的操作顺序正确，问题不在调用时机 |
| UA-3 | "当时架构师-1和架构师-2是同时都在说话的" | Issue 消息 | "同时"表示并发 | 用户提供了关键的并发上下文 |

## 核心业务行为

| ID | 触发条件 | 预期行为 | 追溯 |
|----|---------|---------|------|
| B-1 | 当 agent 调用 `get_current_message_id` 时 | 应返回该 agent 自己正在 streaming 的消息 ID，而非 stage 中全局最新的消息 | ← UA-1, UA-3 |
| B-2 | 当多个 agent 在同一 stage 并发发言时 | 每个 agent 应获取到各自的消息 ID，互不干扰 | ← UA-3 |
| B-3 | 当 agent 调用 `set_final_body` 时 | 应校验 message 的 `from_speaker` 与当前 agent 一致，拒绝跨 speaker 写入 | ← UA-1 |

## 设计方案

### 变更范围

| 文件 | 变更类型 | 变更内容 |
|------|---------|---------|
| `port.ts` | 接口新增 | `MessagePort` 新增 `findLatestMessageBySpeaker(stageId, fromSpeaker)` |
| `repository.ts` | 方法新增 | 实现 `findLatestMessageBySpeaker`，SQL 增加 `AND from_speaker = ?` |
| `adapter.ts` | 方法新增 | `MessageAdapter` 实现新接口方法 |
| `snail-final-response.ts` | 参数新增 + 校验新增 | 两个工具增加 `from_speaker` 参数，新增 `verifySpeakerOwnership` |

### 接口变更

```typescript
// port.ts - 新增方法
interface MessagePort {
  findLatestMessageBySpeaker(stageId: string, fromSpeaker: string): Message | undefined;
}
```

```typescript
// snail-final-response.ts - get_current_message_id 参数变更
inputSchema: {
  properties: {
    stage_id: { type: "string" },
    from_speaker: { type: "string", description: "当前 agent 的 role instance name" }
  },
  required: ["stage_id", "from_speaker"]
}

// snail-final-response.ts - set_final_body 参数变更
inputSchema: {
  properties: {
    text: { type: "string" },
    message_id: { type: "string" },
    stage_id: { type: "string" },
    from_speaker: { type: "string", description: "当前 agent 的 role instance name" },
    to_speakers: { type: "array", items: { type: "string" } }
  },
  required: ["text", "message_id", "stage_id", "from_speaker"]
}
```

### 新增校验逻辑

```typescript
// verifySpeakerOwnership - 防止跨 speaker 写入
function verifySpeakerOwnership(
  message: Message | undefined,
  fromSpeaker: string
): void {
  if (!message) return;
  if (message.from_speaker !== fromSpeaker) {
    throw new Error(
      `message ${message.id} belongs to ${message.from_speaker}, not ${fromSpeaker}`
    );
  }
}

// verifyMessageFreshness - 改用 speaker 过滤
function verifyMessageFreshness(
  messagePort: MessagePort,
  messageId: number,
  stageId: string,
  fromSpeaker: string
): void {
  if (!stageId) return;
  const latest = messagePort.findLatestMessageBySpeaker(stageId, fromSpeaker);
  if (!latest) throw new Error(`no message found for stage ${stageId} and speaker ${fromSpeaker}`);
  if (latest.status !== "streaming") {
    throw new Error(`message ${latest.id} is not streaming (actual: ${latest.status}). Please call get_current_message_id again.`);
  }
  if (latest.id !== messageId) {
    throw new Error(`message ${messageId} is not the active streaming message for ${fromSpeaker} in stage ${stageId} (latest: ${latest.id})`);
  }
}
```

## `from_speaker` 参数获取方式

agent 从 system prompt 的身份信息中提取 role instance name：

```
## Snail
- **Key**：claude-code-stateful
- **名称**：claude-code-stateful
- **底层 Agent**：claude-code-stateful
- **模型**：opus[1m]

## 角色
# 你是架构师
**角色实例**：架构师-1  ← 从这里提取 "架构师-1"
```

信任模型与 `stage_id`（从环境变量 `SNAIL_CTX_STAGE_ID` 获取）一致。

## 双重防护机制

1. **查询时过滤**：`get_current_message_id` 使用 `findLatestMessageBySpeaker`，确保返回正确的 message_id
2. **写入时校验**：`set_final_body` 使用 `verifySpeakerOwnership`，拒绝跨 speaker 写入

## 不兼容更新

- `get_current_message_id` 新增 required 参数 `from_speaker`，旧 agent 不传时会报错
- `set_final_body` 新增 required 参数 `from_speaker`，旧 agent 不传时会报错

这是正确的设计：不传 `from_speaker` 就无法保证并发安全，报错是预期行为。

## 关键决策记录

| 决策点 | 正方论点 | 反方论点 | 最终决策 |
|--------|---------|---------|---------|
| 修复方案选择 | MCP 工具层增加 `from_speaker` 过滤，改动范围小（4 个文件） | 替代方案（在 `invokeAgent` 中注入 message_id）更彻底但改动大 | 采用 MCP 工具层方案 |
| `from_speaker` 获取方式 | agent 从 system prompt 身份信息提取，与 `stage_id` 信任模型一致 | 增加了 agent 的解析负担 | 采用 system prompt 方式 |
| `set_final_body` 校验方式 | 增加 `from_speaker` 参数 + `verifySpeakerOwnership`，形成双重防护 | 增加了调用复杂度 | 采用双重防护方案 |

## 替代方案（记录为未来重构方向）

**在 `invokeAgent` 中直接注入 message_id**

与其让 agent 通过 `get_current_message_id` 查询，不如在 `invokeAgent` 创建消息后，将 message_id 通过环境变量或 system prompt 注入给 agent。

**不采纳理由**：
1. 当前方案改动集中在 MCP 工具层（4 个文件），替代方案需要修改 `invokeAgent`、system prompt 构建、MCP 工具定义，范围更大
2. 当前方案已经解决问题，双重防护足够健壮
