---
id: I2026052002
title: 进一步包装 snail 模块的 agent 能力
from_ids: []
tags: [agent, integration]
modules: [project_management]
---
# I2026052002 进一步包装 snail 模块的 agent 能力

## 背景

当前 Snail Shell 的 agent 运行时会话管理存在两个结构性问题：

1. **运行时 session 绑定耦合在 conversation 上**：`conversation.runtime_sessions` 是一个 JSON 列，存储各 role 的外部 runtime session ID。这种设计把 agent 运行时的生命周期信息混入业务对话模型，且不支持 session 的创建时机、模板参数（runtime/model/context_provider）等历史追溯。

2. **知识治理对话使用独立表**：`knowledge_governance_conversation` 及其关联的 message/event/dispatch 表与项目 conversation 表结构高度重复，但通过分支逻辑 (`isKnowledgeGovernanceConversation`) 在 store 中区分路由。这导致 store 方法内部充斥双重路径，增加维护成本和 bug 风险。

## 目标

1. **新增 `snail_agent_session` 表**：独立记录每次 agent 运行，固化 runtime/model/context_provider，支持 stateful/stateless 两类上下文管理方式
2. **清理旧 `runtime_sessions` JSON 列**：从 `conversation` 表移除 `runtime_sessions` 列及相关类型
3. **将知识治理对话迁移到统一 `conversation` 表**：通过已有的 `owner_type`/`owner_id` 列区分业务归属，删除 `knowledge_governance_conversation` 及关联的 message/event/dispatch 专用表
4. **清理 store 中的双重路径分支逻辑**：移除所有 `isKnowledgeGovernanceConversation` 判断
5. **snail_agent_session 初始化时校验 context_provider 与 runtime 能力匹配**：stateful runtime 支持 agent 自维护上下文，stateless runtime 只能使用 shell 维护上下文

## 非目标

- 不改变 agent runtime 的调用协议（只改变 session ID 的来源方式）
- 不改变知识治理的业务流程（只改变底层存储）
- 不新增 handoff（会话交接）功能，但 `handoff_from_id` 字段预留

## 设计

### snail_agent_session 表

```sql
CREATE TABLE snail_agent_session (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role_name TEXT NOT NULL,
  runtime TEXT NOT NULL,          -- 创建时从 template 固化
  model TEXT NOT NULL,            -- 创建时从 template 固化
  context_provider TEXT NOT NULL, -- "shell" | "agent"，创建时从 template 固化
  external_session_id TEXT,       -- stateful runtime 返回的 session ID
  handoff_from_id TEXT REFERENCES snail_agent_session(id), -- 预留
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversation(id) ON DELETE CASCADE
);
```

**设计取舍**：
- runtime/model/context_provider 在 session 创建时从 SnailTemplate 固化，后续 template 变更不影响已创建 session 的可追溯性
- 每次 agent 调用前通过 `lookupOrCreateSnailAgentSession` 查找当前 role 的最新 session，不存在则创建
- external_session_id 在 agent 返回后更新；interrupt/stop 时清空

### context_provider 模型

`SnailTemplate` 新增 `contextProvider: "shell" | "agent"` 字段：

- **"shell"**：Snail Shell 维护上下文，通过实时总结 + 历史查询 skill + 最新 N 轮对话
- **"agent"**：Agent 自维护上下文，通过 resume sessionId + 最新消息（仅 stateful runtime 支持）

创建 snail_agent_session 时校验：stateful runtime 支持 "shell" 或 "agent"，stateless runtime 只能使用 "shell"。

### 知识治理对话迁移

- 删除 `knowledge_governance_conversation`、`knowledge_governance_message`、`knowledge_governance_message_event`、`knowledge_governance_message_context`、`knowledge_governance_message_dispatch` 五张专用表
- 知识治理对话写入统一 `conversation` 表，`owner_type = 'knowledge_governance'`，`owner_id = governance_id`
- `KnowledgeGovernance.conversation` 类型从 `KnowledgeGovernanceConversation | null` 改为 `Conversation | null`
- 删除 `src/persistence/knowledge-governance-conversation-model.ts`

### 协作依赖接口变更

```typescript
// 旧接口
updateConversationRuntimeSessionId(conversationId, roleName, sessionId)

// 新接口
lookupOrCreateSnailAgentSession(conversationId, roleName, role) => SnailAgentSession
updateSnailAgentSessionExternalId(sessionId, externalSessionId)
```

## 生效路径

- `src/persistence/schema.ts` — snail_agent_session 表定义 + 旧表清理
- `src/persistence/store.ts` — SnailAgentSession 类型 + CRUD 方法 + 分支逻辑清理
- `src/persistence/knowledge-model.ts` — 治理对话改用统一 conversation 表
- `src/persistence/helpers.ts` — 移除 governance conversation helper
- `src/persistence/types.ts` — 移除 RuntimeSessionBinding
- `src/shared/domain-types.ts` — Conversation 移除 runtime_sessions；移除 RuntimeSessionBinding
- `src/shared/knowledge-types.ts` — KnowledgeGovernanceConversation 替换为 Conversation
- `src/shared/index.ts` / `src/shared/types.ts` — 类型导出更新
- `src/agent/interface.ts` — SnailRuntimeMessageInput 新增 externalSessionId；SnailTemplate 新增 contextProvider
- `src/agent/claude-code-stateful.ts` / `codex.ts` / `gemini.ts` / `opencode.ts` — 改用 externalSessionId
- `src/message-bus/collaboration.ts` — 改用新协作依赖接口
- `src/message-bus/message-protocol.ts` — StreamingContext 携带 snailAgentSessionId
- `src/snail-den/index.ts` — SnailTemplate 新增 contextProvider
- `src/project-workflow/manager.ts` — 实现新协作依赖
- `.meta/project-config-seed.json` — 更新 template 引用
- `tests/` — 更新测试适配新接口

## 改动范围

| 模块 | 文件 | 改动类型 |
|------|------|----------|
| persistence | schema.ts | 新增 snail_agent_session 表 + 索引；删除 5 张 governance 表 |
| persistence | store.ts | 新增 SnailAgentSession 类型 + CRUD；清理 governance 分支逻辑 |
| persistence | knowledge-model.ts | 治理对话改用统一 conversation 表 |
| persistence | helpers.ts | 移除 parseJsonRecord、mapKnowledgeGovernanceConversation |
| persistence | types.ts | 移除 RuntimeSessionBinding 导出 |
| persistence | knowledge-types.ts | 移除 KnowledgeGovernanceConversation 导出 |
| persistence | knowledge-governance-conversation-model.ts | 删除 |
| shared | domain-types.ts | Conversation 移除 runtime_sessions；移除 RuntimeSessionBinding |
| shared | knowledge-types.ts | KnowledgeGovernance.conversation 改为 Conversation |
| shared | index.ts | 移除旧类型导出 |
| shared | types.ts | 移除旧类型导出 |
| agent | interface.ts | SnailRuntimeMessageInput + externalSessionId；SnailTemplate + contextProvider |
| agent | claude-code-stateful/codex/gemini/opencode.ts | 改用 externalSessionId |
| message-bus | collaboration.ts | 改用新协作依赖 |
| message-bus | message-protocol.ts | StreamingContext + snailAgentSessionId |
| snail-den | index.ts | SnailTemplate + contextProvider |
| project-workflow | manager.ts | 实现 lookupOrCreateSnailAgentSession |
| config | project-config-seed.json | 更新 template 引用 |
| tests | persistence-test.ts | 适配 governance 对话使用统一表 |
| tests | collaboration-test.ts | 适配新协作依赖接口 |

## 验证

1. `npx tsc --noEmit` 0 errors
2. `npm run lint` 0 errors, 0 warnings
3. `npx vitest run` 全部通过
4. 手动验证要点：
   - 知识治理候选创建后 governance conversation 正确写入统一 conversation 表
   - agent 调用时 snail_agent_session 正确创建/查找/更新 external_session_id
   - stateful runtime 的 session 在 interrupt/stop 后正确清空

## 风险与决策记录

- **数据库迁移**：已有数据库的 `knowledge_governance_*` 表不会被自动删除（SQLite CREATE TABLE IF NOT EXISTS 不处理 DROP）。旧表残留不影响功能，但需在后续版本中考虑清理策略。
- **context_provider 校验**：当前 template 初始化阶段通过 Snail Den 校验，运行时在创建 session 时再次校验 context_provider 与 runtime 的兼容性。该双重校验确保配置错误在早期暴露。

## 范围变更记录

（实现过程中如有范围变化，在此记录）
