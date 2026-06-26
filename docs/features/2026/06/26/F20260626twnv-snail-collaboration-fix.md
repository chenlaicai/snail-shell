---
id: F20260626twnv
title: snail-collaboration-fix
from_ids:
  - F2026052605
  - F2026060201
  - F2026062209
  - F2026052006
  - F20260625swf8
tags:
  - mcp
  - agent-protocol
  - collaboration
  - mention
  - reliability
modules:
  - mcp
  - collaboration
  - message
  - web
doc_kind: spec
---

# F20260626twnv [collaboration] Snail 协作机制修复：set_final_body 可靠性 + mention 路由 + JSON payload 降级

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

Snail Shell 的 snail 间协作机制存在三个核心缝隙，导致 Agent 的最终答复、mention 路由和结构化内容展示不可靠。

### 缝隙 1（P0）：`set_final_body` 调用失败率高

Agent 通过 MCP 工具 `set_final_body` 声明最终答复正文，这是系统的正途路径。但 `message_id` 参数依赖 Agent 手动传入，实际运行中 Agent 经常传错值（如传入字符串 `"analysis"` 而非数字 ID），导致校验失败、写入未生效，系统降级到最后一个 text event 作为 `final_text`。

**现场证据**（message 550）：
```json
{
  "tool_name": "mcp__snail-final-response__set_final_body",
  "tool_input": { "message_id": "analysis", "text": "..." }
}
```
`Number("analysis")` = NaN，校验失败，`mcp_final_body` 未写入。

**历史脉络**：
| Feature | 问题 | 修复 |
|---------|------|------|
| F2026052605 | 初始设计 | MCP HTTP transport + `.mcp.json` auto-discovery |
| F2026060201 | 工具不可用（名字不匹配） | 配置统一 |
| **F20260626twnv** | **工具可用但调用失败（参数错误）** | **本文档** |

### 缝隙 2（P1）：mention 与 `set_final_body` 割裂

当前 mention 提取只有两个来源：text event 中正则匹配 `@角色名`，或 signal event 的结构化 `mentions` 数组。`set_final_body` 没有 `to_speakers` 参数，无法在声明最终答复时同时声明路由目标。Agent 需要在文本中写 `@角色名` 来触发 mention，与 `set_final_body` 的内容声明割裂。

### 缝隙 3（P2）：message-payload JSON 被当纯文本展示

Agent 使用 `message-payload` skill 生成的 JSON payload 会被存为 text event 的文本内容。当 `set_final_body` 调用失败降级到 text event 时，`extractTerminalContext` 取最后一个 text event 作为 `final_text`，如果该 event 是 JSON payload，前端会把 JSON 原文渲染出来。

### 架构上下文：F20260625swf8 事件驱动路由重构

F20260625swf8 对 collaboration 层进行了重大重构：
- **删除 `call_signal` 表**：路由事实从 `call_signal` 表迁移到 `message.to_speakers` 字段
- **删除 `StageQueue` 和 `drainStage`**：改为事件驱动递归链 `route → dispatch → invokeAgent → route`
- **新 Router 状态机**：per-speaker dispatch 状态，cursor 驱动去重和排队

本 feature 的 P1 方案必须适配新架构：mention 路由不能依赖已删除的 `call_signal` 表，需通过 `message.to_speakers` + Router 的 `route()` 方法实现。

## 目标

1. **P0 — `set_final_body` 可靠化**：新增 `get_current_message_id` MCP 工具，Agent 显式获取 message_id 后传给 `set_final_body`，消除传错参数的可能性
2. **P1 — mention 路由合并**：`set_final_body` 增加必选 `to_speakers` 参数，与文本中 `@角色名` 合并去重，通过 in-memory store 传递给 collaboration 层
3. **P2 — JSON payload 降级**：`extractTerminalContext` 识别 JSON payload 并提取 `fallback_text`

## 非目标

- 不改变 `extractTerminalContext` 的优先级链（MCP > text event > event_summary）
- 不改变 agent adapter 层的 `mentions` 字段（仍硬编码为 `[]`，长期改进方向）
- 不改变 message-payload skill 的 JSON 格式定义
- 不引入新的 MCP transport 方案

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当 Agent 调用 `get_current_message_id(issue_id)` 且存在对应 streaming message 时 | 返回正确的 message_id（数字） | |
| B2 | 当 Agent 调用 `get_current_message_id` 但 DB 中无对应 streaming message 时 | 抛出明确错误信息 `"No active streaming message found"` | |
| B3 | 当 Agent 调用 `set_final_body(text, message_id, to_speakers)` 且 message_id 有效时 | `mcp_final_body` 写入成功，`to_speakers` 存入 in-memory store | |
| B4 | 当 Agent 调用 `set_final_body` 但 message_id 无效时 | 报错，提示调用 `get_current_message_id` 获取正确 ID | |
| B5 | 当 `set_final_body` 写入 `to_speakers` 后 invokeAgent 完成时 | MCP 声明的 `to_speakers` 与文本中 `@角色名` 合并去重，写入 `message.to_speakers`，Router 触发 dispatch | |
| B6 | 当 `set_final_body` 未被调用时 | 仅从文本中正则提取 mention（保持现有行为） | |
| B7 | 当 `set_final_body` 未被调用且最后一个 text event 是 JSON payload 含 `fallback_text` 时 | `extractTerminalContext` 提取 `fallback_text` 作为 `final_text` | |
| B8 | 当 `set_final_body` 未被调用且最后一个 text event 是纯文本时 | 保持现有行为：该文本作为 `final_text` | |
| B9 | 当 Agent 调用 `set_final_body` 但 `text` 为空时 | 报错（现有行为，保持不变） | |

## 设计

### P0 详设：`set_final_body` 可靠化

#### 核心变更：新增 `get_current_message_id` MCP 工具

新增 MCP 工具 `get_current_message_id`，Agent 在调用 `set_final_body` 前先获取正确的 message_id：

```
工具名: get_current_message_id
输入: issue_id (string, required) — 从 SNAIL_CTX_issue_id 环境变量获取
输出: message_id (number) — 当前 streaming message 的 ID
```

handler 逻辑：
```
get_current_message_id_handler(params) {
  if (!params.issue_id) throw new Error("issue_id is required")

  message = SELECT m.* FROM message m
            JOIN stage s ON m.stage_id = s.id
            WHERE s.issue_id = params.issue_id AND m.status = 'streaming'
            ORDER BY m.id DESC LIMIT 1

  if (!message) throw new Error("No active streaming message found")
  return { message_id: message.id }
}
```

#### `set_final_body` 保留 `message_id` 参数

`set_final_body` 的 `inputSchema` 不变：
- `text`（string, required）
- `message_id`（string, required）— Agent 从 `get_current_message_id` 获取
- `to_speakers`（string[], required）— Agent 声明的路由目标

handler 逻辑：
```
set_final_body_handler(params) {
  // message_id 校验
  messageId = Number(params.message_id)
  if (!Number.isInteger(messageId) || messageId <= 0)
    throw new Error("message_id must be a positive integer (call get_current_message_id first)")

  // text 校验
  if (!params.text) throw new Error("text is required")

  // to_speakers 校验
  if (!Array.isArray(params.to_speakers) || params.to_speakers.length === 0)
    throw new Error("to_speakers is required")

  // 写入最终答复
  messagePort.setContext(messageId, "mcp_final_body", params.text)

  // 存入 to_speakers 到 in-memory store（供 collaboration 层读取）
  mcpToSpeakersStore.set(messageId, params.to_speakers)
}
```

#### Agent 侧流程

```
// Step 1: 获取当前 message_id
message_id = get_current_message_id(process.env.SNAIL_CTX_issue_id)

// Step 2: 声明最终答复和路由目标
set_final_body("最终答复内容", message_id, ["开发者"])
```

Agent 从 `get_current_message_id` 获得明确的数字 ID，不会传错。

#### 为什么用两步调用而非一步查询

| 方案 | 优点 | 缺点 |
|------|------|------|
| 一步：`set_final_body(text, issue_id)` 内部查询 | 一次调用 | 查询链路长（message → stage → issue），对 Agent 不透明 |
| **两步：`get_current_message_id` + `set_final_body`** | **链路透明，Agent 明确知道 message_id，可复用** | **两次调用** |

选择两步方案：链路透明 > 调用次数。Agent 获取 message_id 后可在多次 MCP 调用中复用。

#### 并发安全性论证

- 同一 stage 内：新 Router 的 `dispatch` per-speaker 状态机保证同一 speaker 不会并发 invoke
- 不同 stage 之间：`issue_id` 精确隔离，不同 issue 的 streaming message 互不干扰
- 边界：同一 issue 的不同 stage 不会同时 active（stage transition 是串行的）
- 时效性：`get_current_message_id` 和 `set_final_body` 都在 `invokeAgent` 期间调用，message 状态始终是 `streaming`

### P1 详设：mention 路由合并

#### 数据流（适配 F20260625swf8 新架构）

```
Agent 调用 get_current_message_id(issue_id) → message_id
Agent 调用 set_final_body(text, message_id, to_speakers)
  → handler 写入 mcp_final_body context
  → handler 存入 mcpToSpeakersStore[message_id] = to_speakers

invokeAgent 完成后（collaboration.ts）：
  → extractTerminalContext(messageId)  // 返回 mcp_final_body
  → resolveReplies(stage, roleInstance, messageId)  // 从文本提取 @mentions
  → 从 mcpToSpeakersStore 读取 MCP 声明的 to_speakers
  → 合并去重：[...new Set([...mcpToSpeakers, ...textMentions])]
  → updateMessageTargets(messageId, mergedTargets)  // 写入 message.to_speakers
  → route(stageId, completedMessage)  // Router 触发 dispatch
```

#### in-memory store 设计

```typescript
// MCP handler 层（snail-final-response.ts）
const mcpToSpeakersStore = new Map<number, string[]>();

// collaboration 层（invokeAgent 完成后）
const mcpToSpeakers = mcpToSpeakersStore.get(messageId);
mcpToSpeakersStore.delete(messageId);  // 读后即删

// 合并逻辑
const textMentions = this.resolveReplies(stage, roleInstance, messageId);
const allMentions = [...new Set([...(mcpToSpeakers ?? []), ...textMentions])];
this.deps.messagePort.updateMessageTargets(messageId, allMentions);
```

#### 为什么用 in-memory store 而非 DB

- `set_final_body` 在 MCP handler 层执行，无法直接调用 collaboration 层的 `route()`
- `invokeAgent` 完成后在 collaboration 层执行，需要读取 MCP 声明的 `to_speakers`
- 同一进程内，in-memory store 是最简单的跨层通信方式
- 生命周期：`set_final_body` 写入 → `invokeAgent` 完成后读取并删除，无持久化需求

### P2 详设：JSON payload 降级

#### `extractTerminalContext` 变更

在取最后一个 text event 作为 `final_text` 之前，尝试解析 JSON payload：

```
extractTerminalContext(messageId, status) {
  // 优先级 1: mcp_final_body（不变）
  existing = getContext(messageId)
  if (existing?.kind === "mcp_final_body") return existing

  // 优先级 2: 最后一个 text event
  events = getMessageEvents(messageId)
  for (index = events.length - 1; index >= 0; index--) {
    event = events[index]
    if (event.payload.type === "text" && event.payload.text.trim()) {
      // 新增：尝试解析 JSON payload
      parsed = tryParseJsonPayload(event.payload.text)
      if (parsed) {
        return { kind: "final_text", context: parsed.fallback_text }
      }
      return { kind: "final_text", context: event.payload.text }
    }
  }

  // 优先级 3: 兜底（不变）
  return { kind: "event_summary", context: fallback }
}
```

#### JSON payload 识别规则

```
tryParseJsonPayload(text) {
  try {
    obj = JSON.parse(text)
    if (obj.format === "blocks" && typeof obj.fallback_text === "string") {
      return { fallback_text: obj.fallback_text }
    }
  } catch {}
  return null
}
```

只识别 `format === "blocks"` 且有 `fallback_text` 字段的 JSON，避免误解析其他 JSON 内容。

## 生效路径

- `src/domain/snail-mcp-server/_internal/servers/snail-final-response.ts` — 新增 `get_current_message_id` 工具 + `set_final_body` 增加 `to_speakers`
- `src/app/issue-collaboration/collaboration.ts` — `invokeAgent` 后处理中的 mention 合并 + `extractTerminalContext` JSON payload 识别

## 设计约束摘要

- **边界**：`set_final_body` 是 Agent 声明最终答复的正途，text event 是降级兜底。不得将 text event 提升为最高优先级。
- **关键决策**：新增 `get_current_message_id` MCP 工具，Agent 显式获取 message_id 后传给 `set_final_body`。链路透明，不会传错。
- **关键决策**：`to_speakers` 为必选参数。MCP 声明的 `to_speakers` 通过 in-memory store 传递给 collaboration 层，与文本 `@角色名` 合并去重后写入 `message.to_speakers`，由 Router 的 `route()` 触发 dispatch。
- **关键决策**：JSON payload 识别仅限 `format === "blocks"` 且有 `fallback_text` 的格式。
- **语义不变量**：`extractTerminalContext` 的优先级链 `mcp_final_body > final_text > event_summary` 不得改变。
- **非目标**：不改变 adapter 层 `mentions` 硬编码为 `[]` 的现状。

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/domain/snail-mcp-server/_internal/servers/snail-final-response.ts` | 修改 | 新增 `get_current_message_id` 工具；`set_final_body` 增加 `to_speakers`（required）+ in-memory store |
| `src/app/issue-collaboration/collaboration.ts` | 修改 | `invokeAgent` 后处理：从 in-memory store 读取 MCP to_speakers，合并去重，写入 `message.to_speakers`；`extractTerminalContext`：增加 JSON payload 识别 |
| 相关测试文件 | 新增/修改 | 覆盖 B1-B9 业务行为 |

## 验证

### P0 — set_final_body 可靠化

- [ ] Agent 调用 `get_current_message_id(issue_id)` 返回正确的 message_id
- [ ] Agent 调用 `set_final_body(text, message_id, to_speakers)` 成功写入 `mcp_final_body`
- [ ] DB 中无 streaming message 时 `get_current_message_id` 返回明确错误
- [ ] `issue_id` 为空时报错
- [ ] `message_id` 无效时 `set_final_body` 报错
- [ ] `text` 为空时报错
- [ ] `to_speakers` 为空数组时报错

### P1 — mention 路由合并

- [ ] `to_speakers` 参数与文本 `@角色名` 合并去重后写入 `message.to_speakers`
- [ ] Router 的 `route()` 正确触发 dispatch
- [ ] 无效 mention 被过滤
- [ ] 未调用 `set_final_body` 时保持现有文本提取行为

### P2 — JSON payload 降级

- [ ] `format === "blocks"` 的 JSON payload 被识别并提取 `fallback_text`
- [ ] 普通 JSON 文本不被误解析
- [ ] 纯文本保持现有行为

### 通用

- [ ] TypeScript 编译通过
- [ ] 现有测试通过
- [ ] 最终答复来源标签正确显示 `mcp_final_body`

## 关联

- **前置**: F2026052605（MCP 最终正文初始设计）
- **前置**: F2026060201（set_final_body 运行时不可用修复）
- **前置**: F2026062209（最终答复来源标签）
- **前置**: F20260625swf8（事件驱动路由重构 — 本 feature 的 P1 方案适配新架构）
- **相关**: F2026052006（mention 机制修复）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|-----------|------|------|
| 1 | `message_id` 如何可靠获取 | 新增 `get_current_message_id` MCP 工具，Agent 显式获取后传给 `set_final_body`。链路透明，不会传错 | 2026-06-25 |
| 2 | `to_speakers` 是否必填 | 必选。Agent 调用 `set_final_body` 时必须声明路由目标，消除"忘记传"的风险 | 2026-06-25 |
| 3 | JSON payload 识别范围 | 仅限 `format === "blocks"` 且有 `fallback_text`，避免误解析 | 2026-06-25 |
| 4 | 一步查询 vs 两步调用 | 选择两步方案：`get_current_message_id` + `set_final_body`。链路透明 > 调用次数，Agent 获取 message_id 后可复用 | 2026-06-25 |
| 5 | P1 路由机制适配 F20260625swf8 | `call_signal` 表已删除，改用 in-memory store 传递 `to_speakers` 到 collaboration 层，写入 `message.to_speakers`，由 Router `route()` 触发 dispatch | 2026-06-25 |
| 6 | **[纠错]** 路由目标是严格优先级，不是合并 | 开发者错误地将 MCP to_speakers、message-payload mentions、文本 @mentions 合并去重。正确逻辑：有 MCP 用 MCP，没有才降级到 message-payload，再没有才降级到文本提取。不存在"合并"。此错误源于对业务语义的误解——路由目标是"谁该行动"的声明，不是多个来源的并集 | 2026-06-26 |
