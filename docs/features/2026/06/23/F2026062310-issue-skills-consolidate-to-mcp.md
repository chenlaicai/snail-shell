---
id: F2026062310
title: issue-skills-consolidate-to-mcp
from_ids: []
tags: [mcp, skill, issue]
modules: [mcp, issue, skill]
doc_kind: spec
change_type: feature
---

# F2026062310 [mcp] issue skills 整合为 snail-issue MCP server

## 背景

Issue 相关操作分散在两种机制中：
- **8 个 Skill**（有 JS 脚本）：Agent 加载 SKILL.md → 执行 shell → db-bridge → SQLite
- **2 个 MCP Tool**：set_final_body（snail-final-response）、complete_evolution_item（snail-evolution）

Skill 的脚本本质上就是 tool，但调用链更长（加载 skill → 读 md → shell out → db-bridge → SQLite）。MCP tool 直接在进程内调用，更简洁。

## 目标

将所有 issue 操作型 skill 合并为一个 `snail-issue` MCP server，agent 直接 call tool。

## 非目标

- 不改变 workflow 指导型 skill（cd-shared/design/development/review/merge、prompt-constraints 等）
- 不改变现有 issue/stage/conversation 的数据模型和业务逻辑
- 不改变 agent 的系统提示词注入机制

## Breaking Changes

- `set_final_body` 移除了 `conversation_id` 参数（旧 handler 未使用该参数，MCP 忽略多余参数，无功能影响）
- `set_final_body` 的 `text` 参数从 required 改为与 `blocks` 二选一（`oneOf` schema 约束）

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | When agent 需要设置最终答复 | 调用 snail-issue.set_final_body，支持 text 或 blocks 模式 | lint + typecheck |
| B2 | When agent 需要记录 repo context | 调用 snail-issue.record_repo_context 写入 stage output_artifacts | lint + typecheck |
| B3 | When agent 需要设置任务锚 | 调用 snail-issue.set_task_anchor 写入 issue.task_anchor | lint + typecheck |
| B4 | When agent 需要查询当前上下文 | 调用 snail-issue.query_current_context 获取完整运行时上下文 | lint + typecheck |
| B5 | When agent 需要查询历史消息 | 调用 snail-issue.conversation_history，支持 5 种查询模式 | lint + typecheck |
| B6 | When agent 识别到可演进项 | 调用 snail-issue.create_evolution_candidate 原子创建 4 条记录 | lint + typecheck |
| B7 | When agent 完成演进治理 | 调用 snail-issue.complete_evolution_item 回写结果 | lint + typecheck |
| B8 | When agent 搜索历史 Feature | 调用 snail-issue.search_feature_chain 查询索引 | lint + typecheck |

## 设计

### 1. 新增 snail-issue MCP server

`src/domain/snail-mcp-server/_internal/servers/snail-issue.ts`

8 个 tool，依赖注入：MessagePort、StagePort、IssuePort、EvolutionPort、CollaborationInput、SQLiteDatabase。

### 2. set_final_body 改造

新增可选 `blocks` 参数（结构化 JSON 数组），吸收 message_payload 功能：
- 传 `text` → 纯 markdown（现有行为不变）
- 传 `blocks` → 存储 `{ format: "blocks", blocks: [...] }`

### 3. Issue 模型扩展

- `Issue` 接口新增 `task_anchor: string | null`
- `IssuePort` 新增 `updateTaskAnchor(id, taskAnchor)`
- SQLite migration：`ALTER TABLE issue ADD COLUMN task_anchor TEXT`

### 4. 查询函数

`src/domain/snail-mcp-server/_internal/issue-query-functions.ts`

从 db-bridge.js 移植的查询逻辑，直接使用 SQLiteDatabase 调用：
- queryConversationContext：跨表查询 conversation/stage/issue
- queryConversationHistory：5 种历史消息查询模式
- createCreateEvolutionCandidate：原子创建演进候选
- searchFeatureChain：Feature 文档索引搜索

### 5. opencode.json 完整覆盖

`src/infra/acs/_internal/utils/mcp-config.ts`

`writeOpenCodeMcpConfig` 原来做合并添加，旧 MCP server 条目会残留。改为完整覆盖 `mcp` section，确保移除的 server 不会残留在 opencode.json 中。

### 6. 依赖注入

`SnailMCPServerDeps` 扩展，使用 ref 模式解决初始化顺序问题：
- evolutionRef（延迟注入 EvolutionPort）
- collaborationRef（延迟注入 CollaborationInput）
- queryConversationContextRef/queryConversationHistoryRef/searchFeatureChainRef

## 生效路径

- `src/domain/snail-mcp-server/_internal/servers/snail-issue.ts` — 新增
- `src/domain/snail-mcp-server/_internal/issue-query-functions.ts` — 新增
- `src/domain/snail-mcp-server/_internal/initor.ts` — 修改
- `src/infra/acs/_internal/utils/mcp-config.ts` — 修改
- `src/domain/issue/model.ts` — 修改
- `src/domain/issue/port.ts` — 修改
- `src/domain/issue/_internal/repository.ts` — 修改
- `src/domain/issue/_internal/adapter.ts` — 修改
- `src/api-contracts/dto.ts` — 修改
- `src/main.ts` — 修改
- `data/file/mcp.json.example` — 修改
- `data/file/skills/conversation-history/` — 删除
- `data/file/skills/evolution-candidate/` — 删除
- `data/file/skills/feature-chain/` — 删除
- `data/file/skills/message-payload/` — 删除
- `data/file/skills/query-current-context/` — 删除
- `data/file/skills/record-issue-repo-context/` — 删除
- `data/file/skills/set-task-anchor/` — 删除
- `src/domain/snail-mcp-server/_internal/servers/snail-final-response.ts` — 删除
- `src/domain/snail-mcp-server/_internal/servers/evolution.ts` — 删除

## 改动范围

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `servers/snail-issue.ts` | 新增 | snail-issue MCP server（8 tools） |
| `issue-query-functions.ts` | 新增 | 查询函数实现 |
| `initor.ts` | 修改 | 注册 snail-issue，移除旧 server |
| `mcp-config.ts` | 修改 | opencode.json 完整覆盖，清除旧 server 残留 |
| `issue/model.ts` | 修改 | Issue 新增 task_anchor |
| `issue/port.ts` | 修改 | IssuePort 新增 updateTaskAnchor |
| `issue/_internal/repository.ts` | 修改 | schema + migration + 实现 |
| `issue/_internal/adapter.ts` | 修改 | updateTaskAnchor 实现 |
| `dto.ts` | 修改 | IssueDto 新增 task_anchor |
| `main.ts` | 修改 | 注入新依赖 |
| `mcp.json.example` | 修改 | 更新内置 server 说明 |
| `skills/conversation-history/` | 删除 | 已迁移到 MCP |
| `skills/evolution-candidate/` | 删除 | 已迁移到 MCP |
| `skills/feature-chain/` | 删除 | 已迁移到 MCP |
| `skills/message-payload/` | 删除 | 已迁移到 MCP |
| `skills/query-current-context/` | 删除 | 已迁移到 MCP |
| `skills/record-issue-repo-context/` | 删除 | 已迁移到 MCP |
| `skills/set-task-anchor/` | 删除 | 已迁移到 MCP |
| `servers/snail-final-response.ts` | 删除 | 合并入 snail-issue |
| `servers/evolution.ts` | 删除 | 合并入 snail-issue |

## 验证

- [x] lint 通过
- [x] typecheck 通过
- [x] build 通过
- [ ] 启动后 curl /mcp/snail-issue 返回 8 个 tool
- [ ] 逐个 tool 功能测试
