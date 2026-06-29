---
id: F20260629q5gz
title: final-response-context-leak-fix
tags: [bugfix, mcp, collaboration]
change_type: bugfix
created: 2026-06-29
status: implemented
---

# 最终答复串 Issue 严重 Bug 修复

> **交叉审视记录**：两位架构师经两轮交叉审视达成共识。原始方案 4 项变更修订为 3 项（变更 3 拆出为 follow-up），变更 2 方案经两轮挑战后确定为 `stage_id` 归属校验。

## 1. 问题描述

`set_final_body` MCP 工具在 resume 路径下写入了错误的 `message_id`，导致一条消息的最终答复正文覆盖了另一条（不同 stage/issue）消息的内容。

### 1.1 直接证据

| 时间 | 事件 | 说明 |
|------|------|------|
| 01:21:07 | Message 1166 创建 | 审查者-2 在 stage "484检视"（`af19cc04`）中被调用 |
| 01:22:23 | Message 1166 完成 | agent 产出 PR #484 复检结果，`contextKind=final_text` |
| 01:33:28 | Message 1178 创建 | 架构师-1 在 stage "消息丢失"（`940b21db`）中被调用 |
| **01:34:35** | **串台写入** | Message 1178 的 agent 调用 `set_final_body(message_id="1166", text="交叉审视意见...")` |
| 01:34:38 | Message 1178 完成 | `extractTerminalContext` 发现 1178 无 `mcp_final_body`，降级为 `final_text` |

**结果**：Message 1166 的 `mcp_final_body` 被覆盖为 "消息丢失" issue 的审视内容，与 PR #484 完全无关。

### 1.2 全局审计

对数据库中所有 `set_final_body` 调用的审计（通过 `message_event` 表中 `tool_call` payload 的 `message_id` 字段）：

| 模式 | 数量 | 示例 | 说明 |
|------|------|------|------|
| 正确匹配 | ~10 | `1178→1178` | first call 路径，`contextEnv` 注入正常 |
| 字面量字符串 | ~8 | `current`, `auto`, `default` | agent 不知道如何获取 `message_id` |
| 模板变量 | ~6 | `$message_id`, `{{message_id}}`, `env.message_id` | agent 尝试引用环境变量但格式错误 |
| 错误数字 ID（串台） | 3 | `1170→1164`, `1178→1166`, `1180→1168` | resume 路径传入了其他消息的 ID |
| 无效值 | ~5 | `1`, `msg_01K8ZJX...` | 兜底错误 |

**结论**：resume 路径的 agent 几乎从不能正确获取 `message_id`。

## 2. 根因分析

### 2.1 核心断点：resume 路径不注入 `contextEnv`

**First call 路径**（正确）：
```
collaboration.ts:366  context: { message_id: String(agentMessage.id), ... }
adapter.ts:124        contextEnv = buildContextEnv(request)       ← 包含 message_id
adapter.ts:125        invokeOptions = buildOptions(snail, options, contextEnv)
claude-code-stateful.ts:141  env: { ...process.env, ...options.contextEnv }  ← 子进程有 message_id
```

**Resume 路径**（缺失）：
```
collaboration.ts:368  resumeRequest: { messageId: String(agentMessage.id), ... }
adapter.ts:182        invokeOptions = buildOptions(snail, options)  ← 缺少第三参数 contextEnv
claude-code-stateful.ts:141  env: { ...process.env, ...options.contextEnv }  ← contextEnv=undefined，子进程无 message_id
```

### 2.2 因果链

```
doInvokeResume 不注入 contextEnv
  → agent 子进程无 message_id 环境变量
    → agent 无法从环境获取当前消息 ID
      → agent 从 session 历史中推断（或猜测）message_id
        → 传入错误的 message_id（属于其他消息）
          → set_final_body 写入错误消息
            → 该消息的原始内容被覆盖（串台）
```

### 2.3 防御层缺失

`set_final_body` handler（`snail-final-response.ts`）仅校验：
- `text` 非空
- `message_id` 是正整数

**不校验**：
- `message_id` 是否属于当前 invocation 的 stage
- `message_id` 是否与 agent 的 session 对应
- 任意正整数均可写入，无归属校验

### 2.4 `conversation_id` 参数形同虚设

工具 schema 声明了 `conversation_id` 参数，但 handler 从未读取或校验。Agent 传入的 `conversation_id` 值也五花八门（UUID、stage_id、随机字符串），无法用于校验。

## 3. 核心业务行为

修改 `set_final_body` 相关功能后，系统必须满足以下行为：

| ID | 当 X 时 | 应该 Y |
|----|---------|--------|
| B1 | agent 调用 `set_final_body` | `message_id` 必须是当前 invocation 创建的消息 ID，不允许写入其他消息 |
| B2 | resume 路径调用 agent | 子进程必须有 `message_id` 环境变量，值为当前 invocation 的消息 ID |
| B3 | `set_final_body` 收到不属于当前 stage 的 `message_id` | 拒绝写入，返回错误 |
| B4 | agent 未调用 `set_final_body` 就结束了 | `extractTerminalContext` 降级为 `final_text`（现有行为，不变） |
| B5 | first call 和 resume 路径均可用 | 两条路径的 `contextEnv` 注入行为一致 |

## 4. 设计方案

> **交叉审视修订**：原始 4 项变更修订为 3 项。变更 3（统一 SNAIL_CTX_ 前缀）拆出为 follow-up，非串台修复必要条件。

### 4.1 变更 1：resume 路径注入 contextEnv（根因修复）

**决策**：`doInvokeResume` 必须注入 `contextEnv`，包含 `message_id` 和 `stage_id`。

**正方**：
- 消除根因，agent 子进程在两条路径下都有 `message_id` 环境变量
- 同时注入 `stage_id`，为变更 2 的归属校验提供数据源

**反方**：
- resume 路径的 `SnailResumeRequest` 不含 `context` 对象，需要扩展类型
- 两条路径的 contextEnv 构造逻辑分叉（first call 走 `buildContextEnv`，resume 直接构造）

**决策**：采用。选择选项 B——在 `doInvokeResume` 中直接构造 `contextEnv = { message_id: request.messageId, stage_id: request.stageId }`，不走 `buildContextEnv`。理由：`SnailResumeRequest` 只有 `messageId` 和 `stageId` 两个值需要注入，不值得为此扩展 `buildContextEnv` 的输入类型。

**依赖**：`SnailResumeRequest` 类型新增 `stageId` 字段。协作层（`collaboration.ts:368`）构造 `resumeRequest` 时传入 `stageId: stage.id`——此处在 `executeAgentInvocation` 中 `stageId` 完全可用。

**涉及层**：`SnailAdapter`（adapter.ts）、`SnailResumeRequest`（model）、`collaboration.ts`

### 4.2 变更 2：`set_final_body` handler 增加 stage 归属校验（防御层）

**决策**：`conversation_id` 参数重命名为 `stage_id`，agent 从环境变量读取后传入，handler 校验 `message_id` 是否属于该 stage。

**正方**：
- 防御性编程，即使 agent 传入错误 `message_id`，handler 也能拦截
- `stage_id` 从环境变量 `stage_id` 获取（变更 1 保证注入），是确定性的，不像 `message_id` 那样缺失

**反方**：
- agent 仍需传入一个参数（`stage_id`），理论上可传错
- 增加一次 DB 查询（`getMessage` 检查 `stage_id`）

**交叉审视记录**：架构师-2 提议用 `expectedMessageId` 在 server 创建时注入（消除 agent 信任），但验证发现 `createFinalResponseServer` 是全局单例，`expectedMessageId` 会被并发 invocation 覆盖，不可行。最终采用 `stage_id` 归属校验作为折中方案。

**信任模型**：
- 主防线：变更 1 保证 agent 有正确的 `message_id` 环境变量
- 辅助防线：变更 2 校验 `message_id` 属于 `stage_id`，防止 agent 传错
- 两者叠加后串台概率极低

**涉及层**：`snail-final-response.ts`（MCP server handler）

### 4.3 变更 3：`conversation_id` → `stage_id` 参数重命名

**决策**：将 `set_final_body` schema 中的 `conversation_id` 重命名为 `stage_id`，handler 使用该值做归属校验。

**正方**：
- `conversation_id` 从未被 handler 使用，且 agent 传入值五花八门
- 重命名后该参数有了实际用途（归属校验），不再是废参数
- `stage_id` 语义准确——它就是 stage 的 ID

**反方**：无

**涉及层**：`snail-final-response.ts`（schema + handler）

## 5. 设计决策记录

| 决策 | 选择 | 正方 | 反方 | 结论 |
|------|------|------|------|------|
| resume 路径注入 contextEnv | 注入 `{ message_id, stage_id }` | 消除根因 | 需扩展 SnailResumeRequest 类型 | 采用 |
| handler 归属校验方式 | `stage_id` 校验 | 防御串台，`stage_id` 确定性 | agent 仍需传参，server 是单例无法注入 expectedMessageId | 采用 |
| 统一 SNAIL_CTX_ 前缀 | — | 消除歧义 | 非串台修复必要条件 | **拆出为 follow-up** |
| conversation_id 参数 | 重命名为 `stage_id` | 赋予实际用途 | 无 | 采用 |

## 6. 验证场景

| # | 场景 | 预期结果 |
|---|------|---------|
| 1 | First call 路径调用 agent，agent 调用 `set_final_body` | `message_id` 正确，`mcp_final_body` 写入当前消息 |
| 2 | Resume 路径调用 agent，agent 调用 `set_final_body` | 子进程有 `message_id` 和 `stage_id` 环境变量，`mcp_final_body` 写入当前消息 |
| 3 | Agent 传入不属于当前 stage 的 `message_id` | handler 校验 `stage_id` 归属失败，拒绝写入，返回错误 |
| 4 | Agent 未调用 `set_final_body` | `extractTerminalContext` 降级为 `final_text`（现有行为） |
| 5 | 并发调用两个不同 stage 的 agent | 各自的 `mcp_final_body` 写入各自的消息，互不干扰 |
| 6 | Agent 传入错误的 `stage_id` | handler 校验 `message_id` 归属失败，拒绝写入 |

## 7. 影响面

| 组件 | 变更类型 | 说明 |
|------|---------|------|
| `SnailAdapter` | bugfix | `doInvokeResume` 注入 `contextEnv = { message_id, stage_id }` |
| `SnailResumeRequest` | enhancement | 类型新增 `stageId` 字段 |
| `collaboration.ts` | enhancement | 构造 `resumeRequest` 时传入 `stageId` |
| `snail-final-response.ts` | bugfix | handler 增加 `stage_id` 归属校验 + `conversation_id` → `stage_id` 重命名 |
| `claude-code-stateful.ts` | 不变 | spawn 逻辑不变，仅上游 `contextEnv` 内容变化 |
| `claude-code.ts` | 不变 | 同上 |

## 8. Follow-up（不在本次 bugfix 范围）

| 项 | 说明 |
|----|------|
| 统一 `SNAIL_CTX_` 前缀 | `message_id` → `SNAIL_CTX_MESSAGE_ID` 等 key 统一，需同步修改 tool description |
| agent tool description 优化 | 明确指引 agent 使用环境变量获取 `message_id`，减少字面量/模板变量错误 |
