---
id: F2026062208
title: snail-collaboration-mcp
from_ids: []
tags: [core, mcp, collaboration]
modules: [domain/snail-mcp-server, app/issue-collaboration, infra/acs]
doc_kind: spec
---

# F2026062208 [core] snail-collaboration MCP 服务器

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

Snail agent 的协作行为当前完全依赖自然语言输出中的 @mention 正则匹配和 JSON.parse 来驱动：

1. **@mention 路由**：系统用正则 `/@([\p{L}\p{N}_-]+)/gu` 从 agent 的文本输出中提取 mentions，然后创建 `CallSignal` 触发目标 agent 调用。Agent 不知道 @mention 是唯一的协作通道，也没有结构化工具来声明路由意图。
2. **Stage transition 检测**：系统从 agent 输出的 text 事件中尝试 `JSON.parse`，寻找 `stage_transition` 键。Agent 没有专用工具来声明 stage transition，必须在 text 中嵌入 JSON。
3. **上下文注入**：system-reminder 一次性注入所有上下文信息（角色、流转、产物），agent 无法按需查询。

这导致协作是"自然语言输出的副作用"而非"结构化协议"，PR #411 场景中检视者写了意见但没有 @ developer，协作断裂。

## 目标

将协作从"文本模式匹配"升级为"结构化 MCP 工具调用"：

### P1 — 新增 snail-collaboration MCP 服务器

- 新增 `snail-collaboration` MCP 服务器，提供 `send_message`、`suggest_stage_transition`、`query_context` 三个结构化协作工具
- `send_message` 替代 @mention 正则匹配，同时承担最终正文设置
- `suggest_stage_transition` 替代 JSON.parse hack
- `query_context` 让 agent 按需查询上下文信息
- 重构 `buildSystemReminder`，将旧的"协作规则"替换为详细的协作工具说明

### P2 — 统一环境变量命名

- `buildContextEnv` 统一使用 `SNAIL_CTX_*` 前缀
- 新增 `SNAIL_CTX_MESSAGE_ID` 和 `SNAIL_CTX_ROLE_INSTANCE` 常量

## 非目标

- 废弃 `set_final_body` MCP 工具（保留用于纯展示场景）
- 废弃 @mention 正则匹配（保留作为 fallback）
- 前端 UI 变更（本次仅涉及后端 MCP 服务器和协作逻辑）
- 新增测试（后续 PR 补充）

## 核心业务行为

| # | 场景 | 预期行为 |
|---|------|----------|
| B1 | 当 agent 调用 `send_message({ to: ["开发者"], text: "请修复" })` | 系统设置 `send_message_body` context，更新消息目标为 `["开发者"]`，为每个目标创建 CallSignal，`routeAgentReplies` 跳过覆写 |
| B2 | 当 agent 调用 `set_final_body({ text: "分析结果：@开发者 请看" })` | 系统设置 `mcp_final_body` context，`routeAgentReplies` 正常执行，text 中的 @mention 被提取并路由 |
| B3 | 当 agent 调用 `suggest_stage_transition({ target_key: "review", reason: "代码完成" })` | 系统验证 target_key 在 available_transitions 中，返回结构化结果，`detectStageTransition` 从 tool_call 事件中提取 stage transition 建议 |
| B4 | 当 agent 调用 `query_context({ query: "roles" })` | 系统返回当前 stage 的角色实例列表和默认角色 |
| B5 | 当 agent 调用 `send_message({ to: ["typo_role"], text: "..." })` | 系统抛出明确错误："Invalid target speakers: typo_role. Valid: ..." |
| B6 | 当 agent 调用 `send_message` 后完成 | `routeAgentReplies` 检查到 `send_message_body` context，跳过 @mention 扫描覆写 |
| B7 | 当 agent 调用 `set_final_body` 后完成 | `routeAgentReplies` 检查到 `mcp_final_body` context 但不是 `send_message_body`，正常执行 @mention 扫描 |
| B8 | 当 system-reminder 构建时 | "协作规则"部分替换为详细的协作工具说明，包含 `send_message`、`set_final_body`、`suggest_stage_transition`、`query_context` 的用法和示例 |
| B9 | 当 `buildContextEnv` 处理 context 对象时 | 通过 `CONTEXT_KEY_MAP` 将 `issue_id`→`SNAIL_CTX_ISSUE_ID`、`stage_id`→`SNAIL_CTX_STAGE_ID`、`message_id`→`SNAIL_CTX_MESSAGE_ID`、`role_instance`→`SNAIL_CTX_ROLE_INSTANCE` 映射 |

## 设计

### P1 详设

#### 1. snail-collaboration MCP 服务器

新增 `src/domain/snail-mcp-server/_internal/servers/snail-collaboration.ts`，遵循现有 MCP 服务器模式（`createFinalResponseServer`、`createEvolutionServer` 等）。

**三个工具**：

| 工具 | 参数 | 副作用 | 替代 |
|------|------|--------|------|
| `send_message` | `to: string[]`, `text: string` | 设置 `send_message_body` context + `updateMessageTargets` + `createCallSignal` | @mention 正则 |
| `suggest_stage_transition` | `target_key: string`, `reason: string`, `guard?: string` | 无直接副作用，返回结构化结果供 `detectStageTransition` 提取 | JSON.parse hack |
| `query_context` | `query: "roles" \| "transitions" \| "artifacts" \| "all"` | 无副作用，返回查询结果 | system-reminder 信息过载 |

**Handler 上下文获取**：通过 `process.env.SNAIL_CTX_STAGE_ID` 和 `process.env.SNAIL_CTX_MESSAGE_ID` 读取当前协作上下文（由 `buildContextEnv` 注入）。

**`send_message` 角色校验**：handler 调用 `stagePort.findStage(stageId)` 获取 stage，校验 `to` 中的角色是否在 `stage.role_instances` 或为 `"user"`，不在则抛出明确错误。

#### 2. `send_message_body` vs `mcp_final_body` kind 区分

引入新的 `MessageContextKind: "send_message_body"` 来区分 `send_message` 和 `set_final_body` 的来源：

- `send_message` handler 设置 `kind: "send_message_body"`
- `set_final_body` handler 设置 `kind: "mcp_final_body"`（不变）
- `routeAgentReplies` 检查 `kind === "send_message_body"` 时跳过覆写（send_message 已处理路由）
- `routeAgentReplies` 检查 `kind === "mcp_final_body"` 时正常执行（set_final_body 的 @mention 需要路由）
- `extractTerminalContext` 对两种 kind 同等优先级处理

#### 3. `extractStageTransitionSuggestion` 扩展

当前仅检查 `signal` 和 `text` 类型事件。扩展为也检查 `tool_call` 类型事件：

```
tryExtractFromToolCall → tryExtractFromSignal → tryExtractFromText
```

每个检查提取为独立方法，降低复杂度。

#### 4. `buildContextEnv` 统一 SNAIL_CTX_* 前缀

新增 `CONTEXT_KEY_MAP` 映射表：

| context key | 环境变量名 |
|-------------|-----------|
| `issue_id` | `SNAIL_CTX_ISSUE_ID` |
| `stage_id` | `SNAIL_CTX_STAGE_ID` |
| `message_id` | `SNAIL_CTX_MESSAGE_ID` |
| `role_instance` | `SNAIL_CTX_ROLE_INSTANCE` |

未在映射表中的 key 保持原样（fallback: `env[key] = String(value)`）。

#### 5. `buildSystemReminder` 重构

旧的"协作规则"部分：
```
- 你可以通过 @角色实例 请求其他角色回应
- 如果阶段看起来完成了，建议 stage_transition 等待用户确认
- 永远不要自动推进 Stage
```

替换为详细的协作工具说明，包含每个工具的用法、参数、示例。示例中使用 `stage.default_role_instance` 替代硬编码 "开发者" fallback。

## 生效路径

- 代码：`src/domain/snail-mcp-server/_internal/servers/snail-collaboration.ts`（新增）、`src/domain/snail-mcp-server/_internal/initor.ts`（注册）、`src/main.ts`（依赖注入）、`src/app/issue-collaboration/collaboration.ts`（buildSystemReminder + 事件解析扩展）、`src/domain/message/model.ts`（新增 kind）、`src/infra/acs/context-keys.ts`（新增常量）、`src/infra/acs/_internal/utils/context-env.ts`（统一前缀）
- 文档：本 feature 文档

## 设计约束摘要

- **边界**：`send_message` 是协作主路径（同时设置正文+路由），`set_final_body` 是纯展示路径（不触发他人）。两者不互斥，通过 kind 区分来源
- **关键决策**：引入 `send_message_body` kind 而非复用 `mcp_final_body`，避免 `set_final_body` 的 @mention 路由被阻断
- **非目标约束**：不废弃 `set_final_body`，不废弃 @mention 正则 fallback，不做前端 UI 变更
- **语义不变量**：`set_final_body` 行为不变（仍设置 `mcp_final_body`，@mention 路由仍生效）
- **已知限制**：`query_context` 返回的数据与 system-reminder 静态快照相同，当前不会返回更新的数据

<!-- [design-time] 章节结束 -->

## 改动范围

| 类型 | 文件/模块 | 说明 |
|------|-----------|------|
| 新增 | `src/domain/snail-mcp-server/_internal/servers/snail-collaboration.ts` | 协作 MCP 服务器（3 个工具） |
| 修改 | `src/domain/snail-mcp-server/_internal/initor.ts` | 注册新服务器，deps 新增 `stage: StagePort` |
| 修改 | `src/main.ts` | `initMCPServer` 传入 `stage: issue.stageAdapter` |
| 修改 | `src/app/issue-collaboration/collaboration.ts` | `buildSystemReminder` 重构 + `routeAgentReplies` kind 检查 + `extractStageTransitionSuggestion` 扩展 |
| 修改 | `src/domain/message/model.ts` | `MessageContextKind` 新增 `"send_message_body"` |
| 修改 | `src/infra/acs/context-keys.ts` | 新增 `MESSAGE_ID` 和 `ROLE_INSTANCE` 常量 |
| 修改 | `src/infra/acs/_internal/utils/context-env.ts` | 新增 `CONTEXT_KEY_MAP`，统一 `SNAIL_CTX_*` 前缀 |

## 验证

### P1

- [x] TypeScript 编译通过
- [x] ESLint 通过
- [x] Vite build 通过
- [x] 现有后端测试（11 个）全部通过
- [ ] agent 调用 `send_message` 后目标 agent 被正确触发
- [ ] agent 调用 `set_final_body` 后 text 中的 @mention 仍能正常路由
- [ ] agent 调用 `suggest_stage_transition` 后 stage transition 建议被正确提取
- [ ] agent 调用 `send_message` 传入非法角色名时收到明确错误

## 关联

- **前置**: 无
- **触发**: PR #411 检视评论场景暴露的协作断裂问题

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | `send_message` 与 `set_final_body` 的关系 | send_message 是超集，可替代 set_final_body | 两者职责不同，send_message 负责路由+正文，set_final_body 只负责正文 | send_message 是协作主路径，set_final_body 保留用于纯展示场景。通过 `send_message_body` vs `mcp_final_body` kind 区分来源 | 大多数协作场景（正文=路由消息）用 send_message 一步完成；纯展示场景仍需 set_final_body | 架构师 | 2026-06-22 |
| D2 | `routeAgentReplies` early return 条件 | 检查 `mcp_final_body` 简单直接 | `set_final_body` 也设置 `mcp_final_body`，会阻断 @mention 路由 | 检查 `send_message_body` 而非 `mcp_final_body`，精确区分来源 | `set_final_body` 的 @mention 路由不应被阻断，这是行为回退 | 架构师 | 2026-06-23 |
| D3 | `send_message` 是否校验 target speakers | 校验可防止 agent 发送到不存在的角色 | 增加 handler 复杂度，需要 stagePort 依赖 | 校验 `stage.role_instances` + "user"，非法目标抛明确错误 | agent 不知道消息未送达比抛错更危险 | 架构师 | 2026-06-23 |
| D4 | 环境变量命名 | 统一 `SNAIL_CTX_*` 前缀，与 CONTEXT_KEYS 一致 | 改名可能影响已有代码 | 统一使用 `SNAIL_CTX_*` 前缀，通过 `CONTEXT_KEY_MAP` 映射 | 消除死代码和命名不一致，MCP handler 读取正确的变量名 | 架构师 | 2026-06-23 |
| D5 | `query_context` 工具价值 | 当前与 system-reminder 数据冗余 | 未来 system-reminder 精简后可能成为 agent 按需获取信息的途径 | 暂保留，描述注明"仅在需要确认实时状态时使用" | 低维护成本，保留扩展空间 | 架构师 | 2026-06-23 |
