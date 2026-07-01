---
id: F20260701k2ua
title: fix-set-final-body-stale-message-id
from_ids: [F20260630wtu5, F20260629q5gz]
tags: [mcp, collaboration, bugfix]
modules: [snail-mcp-server, collaboration, snail]
doc_kind: spec
change_type: bugfix
---

# F20260701k2ua [mcp/collaboration] set_final_body 串台写入：移除 agent 侧 message_id 传递

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

"evolution生成梳理" issue 中，架构师-2 在 2026-07-01 12:38:46 的发言（message 2372）出现异常：
- 流式过程中用户看到 `snail-final-response.set_final_body · 2365`（工具调用成功）
- 最终答复显示 "Final body 已提交，本轮答复完成。" + kind `final_text`（而非预期的 2365 字符正文 + kind `mcp_final_body`）

此前 F20260629q5gz 修复了 `set_final_body` 在 resume 路径下串台写入的问题（跨 stage），F20260630wtu5 修复了重复调用死循环。本次问题是**同 stage 内跨 message 的串台**。

### 根因分析

**确定的事实：**

| 确定 | 不确定 |
|------|--------|
| Agent 传了 `message_id: "2365"`（过期，当前消息是 2372） | **为什么** agent 读到 2365（env var 缓存？session context？其他？） |
| Handler 写入成功（stage 归属校验通过，2365 属于同一 stage） | — |
| Context 写到了错误的消息上（2365 覆写，2372 丢失） | — |

从数据库提取的 message 2372 事件序列：

| seq | 类型 | 关键信息 | 时间 |
|-----|------|----------|------|
| 0 | text | Agent 的分析文本（长文回复） | 04:39:08 |
| 1 | tool_call | `set_final_body(message_id="2365", stage_id="3ec0b2eb-...", text="...")` | 04:39:18 |
| 2 | text | "Final body 已提交，本轮答复完成。" | 04:39:23 |

**数据库验证：**

| message_id | context kind | context 内容 |
|------------|-------------|-------------|
| 2365 | `mcp_final_body` | 本该属于 message 2372 的回复正文 |
| 2372 | `final_text` | "Final body 已提交，本轮答复完成。" |

**根本原因**：`set_final_body` handler 对 `message_id` 参数完全信任，没有时效性校验。只要 agent 传入一个属于同一 stage 的 message_id（无论是否过期），handler 都会写入。

**触发原因**：agent 在 resumed session 中传入了旧 message_id。具体机制（env var 缓存、session context、其他）待查，但不影响方案设计。

### 当前 message_id 注入链路（将被移除）

```
路径 A：首次调用
collaboration.ts:382  context[SNAIL_CTX_MESSAGE_ID] = String(agentMessage.id)
  → adapter.ts:127  buildContextEnv → env[SNAIL_CTX_MESSAGE_ID]
  → claude-code-stateful.ts:141  spawn({ env: { ...process.env, ...contextEnv } })
  → Agent 进程环境变量 SNAIL_CTX_MESSAGE_ID=2372

路径 B：resume 调用
collaboration.ts:384  resumeRequest.messageId = String(agentMessage.id)
  → adapter.ts:186  contextEnv[SNAIL_CTX_MESSAGE_ID] = request.messageId
  → claude-code-stateful.ts:141  spawn({ env: { ...process.env, ...contextEnv } })
  → Agent 进程环境变量 SNAIL_CTX_MESSAGE_ID=2372
```

问题：即使环境变量注入正确，agent 仍可能读到旧值。**只要 agent 侧存在 message_id 的来源，就存在传错的可能。**

## 目标

消除 `set_final_body` 串台写入风险：**从 agent 侧移除旧 id 来源（env var 注入）+ handler 侧拦截过期 id（时效性校验）+ MCP tool 实时查询**。

## 非目标

- 不改变 `extractTerminalContext` 的回退逻辑（该逻辑本身正确）
- 不改变 Claude Code 的 session resume 机制

## 核心业务行为

| ID | 当 X 时 | 应该 Y |
|----|---------|--------|
| B1 | `set_final_body` 被调用且 `message_id` 指向一条 status 不是 `streaming` 的消息 | handler 拒绝写入，返回明确错误："message {id} is not streaming (actual: {status})" |
| B2 | `set_final_body` 被调用且 `message_id` 不是当前 stage 中最后一条 streaming 消息 | handler 拒绝写入，返回明确错误："message {id} is not the active streaming message for this stage" |
| B3 | agent 调用 `get_current_message_id(stage_id)` 查询当前消息 | handler 返回 `{ message_id, from_speaker }` 或明确错误 |
| B3-fail | `get_current_message_id` 被调用但 stage 无 status=streaming 的消息 | 返回明确错误："no active streaming message found for stage {stageId}" |
| B4 | `set_final_body` 成功写入 `mcp_final_body` context | 同一 message 的 `extractTerminalContext` 必须返回 `mcp_final_body` kind（已有逻辑，不需改动） |

## 设计

### 修复方案：移除 agent 侧 env var 注入 + handler 校验增强 + MCP tool 查询

#### 改动 1：移除 `SNAIL_CTX_MESSAGE_ID` 环境变量注入（snail adapter 层）

不再将 message_id 注入 agent 进程环境变量：

- **首次调用**：从 `firstCallRequest.context` 中移除 `[CONTEXT_KEYS.MESSAGE_ID]` 键（`collaboration.ts` executeAgentInvocation）
- **resume 调用**：移除 `contextEnv[CONTEXT_KEYS.MESSAGE_ID] = request.messageId`（`adapter.ts` invokeResume）

agent 侧不再通过 env var 获取 message_id，改为通过 `get_current_message_id` MCP tool 实时查询。

约束：
- `SnailResumeRequest.messageId` 字段保留（用于日志关联），但不再注入 env var
- `CONTEXT_KEYS.MESSAGE_ID` 常量保留（其他模块可能引用）

#### 改动 2：`set_final_body` handler 校验增强（snail-mcp-server 层）

`message_id` 保持 required。在 `verifyStageOwnership` 之后增加**时效性校验**：

1. 通过 `findLatestMessage(stageId)` 获取 stage 最新消息
2. 校验该消息 `status === "streaming"`（不是 streaming → 报错）
3. 校验该消息 `id === messageId`（传入的不是最新 streaming 消息 → 报错）

约束：
- 校验失败时抛出 Error，agent 会收到 tool error 并可重试
- 不改变已有的幂等防护逻辑（`submittedMessages` Set）

#### 改动 3：新增 `get_current_message_id` MCP tool（snail-mcp-server 层）

agent 在调用 `set_final_body` 前**必须**调用此 tool 查询当前 message_id：

- 输入：`stage_id`
- 输出：`{ message_id, from_speaker }` 或明确错误
- 注册在 `snail-final-response` server 中，复用已有的 `MessagePort` 和 `StagePort` 依赖

约束：
- agent 必须先调此 tool 拿到 message_id，再传入 `set_final_body`
- 查询失败（无 streaming 消息）时返回明确错误
- handler 侧层 1 校验作为安全网，拦截 agent 传入的过期 id

### 不兼容更新

| 变更 | 影响 | 迁移方式 |
|------|------|---------|
| 移除 `SNAIL_CTX_MESSAGE_ID` 环境变量注入 | agent 不再通过 `process.env.SNAIL_CTX_MESSAGE_ID` 获取 message_id | agent 必须使用 `get_current_message_id` MCP tool 获取 message_id |
| `set_final_body` handler 新增时效性校验 | 传入过期 message_id 会被拒绝（之前只校验 stage 归属） | agent 必须先调 `get_current_message_id` 获取最新 id |

## 决策记录

| 决策 | 选择 | 理由 | 替代方案 |
|------|------|------|---------|
| message_id 来源 | MCP tool 实时查询（替代 env var） | 每次拿最新值，不依赖缓存 | env var 注入（可能过期） |
| message_id 参数处理 | 保持 required | agent 必须显式传入，不允许省略 | 改为 optional + handler 推断（用户否决） |
| 校验失败行为 | 抛 Error（agent 可重试） | 优于静默降级 | 自动使用最新 streaming 消息 |
| 环境变量注入 | 移除 `SNAIL_CTX_MESSAGE_ID` | 从根源消除 agent 侧旧 id 的来源 | 保留注入 + 加校验（治标不治本） |

## 验收标准

| ID | 验收条件 | 验证方法 |
|----|---------|---------|
| AC-1 | `set_final_body` 传入过期 message_id 时拒绝 | 单元测试：传入 completed 消息 → reject |
| AC-2 | `set_final_body` 传入非最后一条 streaming message_id 时拒绝 | 单元测试：stage 有两条 streaming，传入较早的 → reject |
| AC-3 | `get_current_message_id` 返回正确的 streaming 消息 | 单元测试：stage 有 streaming 消息 → 返回其 id + from_speaker |
| AC-3b | `get_current_message_id` 在 stage 无 streaming 消息时返回错误 | 单元测试：stage 无 streaming 消息 → 返回明确错误 |
| AC-4 | `SNAIL_CTX_MESSAGE_ID` 不再注入 agent 进程 | 代码审查：确认 adapter 中移除注入 |
| AC-5 | Resumed session 中 agent 使用正确的 message_id | 端到端验证：同 stage 连续两轮对话，第二轮 context 为 mcp_final_body |

## 实现指引

### 改动范围

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/domain/snail/_internal/adapter.ts` | 行为变更 | 移除 resume 路径 `contextEnv[CONTEXT_KEYS.MESSAGE_ID]` 注入（:186） |
| `src/app/issue-collaboration/collaboration.ts` | 行为变更 | 移除首次调用 context 中的 `SNAIL_CTX_MESSAGE_ID`（:382）+ 更新 system reminder 中 `set_final_body` 指令（:598） |
| `src/domain/snail-mcp-server/_internal/servers/snail-final-response.ts` | 行为增强 | 新增 status=streaming + latest streaming 校验 + 新增 `get_current_message_id` tool + 更新工具描述 |
| `tests/snail-final-response.test.ts` | 测试新增 | AC-1 ~ AC-3 的单元测试 |

### 关键约束

- `verifyStageOwnership` 已有的 stage 归属校验保留不动，新增的时效性校验在其之后执行
- 时效性校验：`findLatestMessage` 返回 stage 最新消息（不限 status），**必须额外检查 `message.status === "streaming"`**
- `get_current_message_id` MCP tool 返回 `{ message_id, from_speaker }` 或明确错误
- `SnailResumeRequest.messageId` 字段保留（用于日志关联），但不再注入 env var
- 幂等防护逻辑（`submittedMessages` Set）保留不变

### 交叉审视细化项（架构师-2 findings，开发阶段处理）

| # | 发现 | 处置 |
|---|------|------|
| F1 | B3 缺少推断失败路径 | 已补充 B3-fail 行为条目 |
| F2 | `SnailResumeRequest.messageId` 注释与实际用途不符 | 开发阶段修正注释（移除 env var 注入后，注释自然准确） |
| F3 | `findLatestMessage` 不过滤 status | 已在关键约束中明确要求开发时添加 status 校验 |
