---
id: F2026062210
title: snail-issue MCP Server 整合
status: in-progress
created_at: 2026-06-22
---

# F2026062210 - snail-issue MCP Server 整合

## 背景

当前 issue 生命周期相关的操作（record-issue-repo-context、set-task-anchor、query-current-context、conversation-history）通过 Skill + db-bridge.js 脚本实现。这种方式存在以下局限性：

1. **依赖外部脚本执行**：需要通过 Bash 执行 Node.js 脚本，在某些场景下不可用
2. **路径查找问题**：worktree 内可能找不到 db-bridge.js
3. **类型不安全**：JavaScript 实现，运行时才发现错误
4. **架构不一致**：其他 MCP Server（snail-final-response、snail-evolution、snail-knowledge）都直接访问数据库

## 目标

创建 `snail-issue` MCP Server，将 issue 生命周期相关的操作整合到统一的 MCP Server 中，实现：

1. **直接数据库访问**：不依赖外部脚本，直接在进程内访问数据库
2. **类型安全**：TypeScript 实现，编译期检查
3. **架构一致**：与其他 MCP Server 保持一致的实现模式
4. **向后兼容**：保留现有 Skill 作为文档层，MCP 作为执行层

## 非目标

1. **不修改现有 Skill 的调用方式**：Skill 仍然可以通过 `/skill` 命令调用
2. **不修改数据库 Schema**：只改变访问方式，不改变数据结构
3. **不迁移所有 Skill**：只迁移需要数据库访问的 Skill

## 设计

### 1. 依赖注入接口设计

创建 `IssueMCPPort` 接口，定义 MCP Server 需要的数据访问方法：

```typescript
// src/domain/snail-mcp-server/issue-port.ts

import type { Issue, Stage } from "@domain/issue/model";
import type { Conversation, Message } from "@domain/conversation/model";

/** Issue MCP 端口定义 */
export interface IssueMCPPort {
  // ── Stage 操作 ──────────────────────────────────────────

  /** 记录 stage 的 output_artifacts（合并语义） */
  recordStageContext(
    stageId: string,
    entries: Record<string, unknown>
  ): Promise<{
    ok: true;
    stage_id: string;
    output_artifacts: Record<string, unknown>;
  }>;

  /** 获取 issue 的活跃 stage */
  getActiveStage(issueId: string): Promise<Stage | null>;

  /** 列出所有 stage 的 worktree_path 映射 */
  listStagesForWorkdir(): Promise<Array<{ id: string; worktree_path: string | null }>>;

  // ── Issue 操作 ──────────────────────────────────────────

  /** 设置 issue 的 task_anchor */
  setTaskAnchor(
    issueId: string,
    taskAnchor: string
  ): Promise<{ ok: true; issue_id: string; task_anchor: string }>;

  // ── Context 查询 ──────────────────────────────────────────

  /** 查询当前 conversation 的上下文 */
  queryContext(conversationId: string): Promise<{
    conv: Conversation;
    stage: Stage | null;
    stageDef: unknown | null;
    stageRoles: unknown[];
    issue: Issue | null;
    workspace: unknown | null;
    inputArtifacts: Record<string, unknown>;
  }>;

  // ── Conversation History 操作 ──────────────────────────────────────────

  /** 全文搜索对话历史 */
  searchHistory(params: {
    issueId?: string;
    conversationId?: string;
    query: string;
    limit?: number;
  }): Promise<{
    mode: string;
    query: string;
    issue_id: string | null;
    context_resolved: string;
    messages: Message[];
  }>;

  /** 最近对话 */
  getRecentHistory(params: {
    issueId?: string;
    conversationId?: string;
    limit?: number;
  }): Promise<{
    mode: string;
    issue_id: string | null;
    context_resolved: string;
    messages: Message[];
  }>;

  /** 分页查询对话历史 */
  getPageHistory(params: {
    issueId?: string;
    conversationId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    mode: string;
    issue_id: string | null;
    context_resolved: string;
    messages: Message[];
  }>;

  /** 窗口查询对话历史 */
  getWindowHistory(params: {
    conversationId: string;
    anchorMessageId: number;
    before?: number;
    after?: number;
    direction?: "forward" | "backward";
  }): Promise<{
    mode: string;
    messages: Message[];
  }>;

  /** 按 ID 批量查询对话历史 */
  getHistoryByIds(params: {
    conversationId: string;
    messageIds: number[];
  }): Promise<{
    mode: string;
    messages: Message[];
  }>;

  /** 重建对话历史索引 */
  reindexHistory(params: {
    conversationId?: string;
  }): Promise<{
    mode: string;
    conversation_id: string | null;
    [key: string]: unknown;
  }>;
}
```

### 2. MCP Server 工具列表

创建 `snail-issue` MCP Server，包含以下工具：

| 工具名称 | 描述 | 输入参数 | 输出 |
|---------|------|---------|------|
| `record_repo_context` | 记录 stage 的 output_artifacts | `stage_id`, `entries` | `{ ok: true, stage_id, output_artifacts }` |
| `set_task_anchor` | 设置 issue 的 task_anchor | `issue_id`, `task_anchor` | `{ ok: true, issue_id, task_anchor }` |
| `query_context` | 查询当前 conversation 的上下文 | `conversation_id` | `{ conv, stage, stageDef, stageRoles, issue, workspace, inputArtifacts }` |
| `search_history` | 全文搜索对话历史 | `issue_id?`, `conversation_id?`, `query`, `limit?` | `{ mode, query, issue_id, context_resolved, messages }` |
| `get_recent_history` | 最近对话 | `issue_id?`, `conversation_id?`, `limit?` | `{ mode, issue_id, context_resolved, messages }` |
| `get_page_history` | 分页查询对话历史 | `issue_id?`, `conversation_id?`, `limit?`, `offset?` | `{ mode, issue_id, context_resolved, messages }` |
| `get_window_history` | 窗口查询对话历史 | `conversation_id`, `anchor_message_id`, `before?`, `after?`, `direction?` | `{ mode, messages }` |
| `get_history_by_ids` | 按 ID 批量查询对话历史 | `conversation_id`, `message_ids` | `{ mode, messages }` |
| `reindex_history` | 重建对话历史索引 | `conversation_id?` | `{ mode, conversation_id, ... }` |
| `get_active_stage` | 获取 issue 的活跃 stage | `issue_id` | `{ stage }` |
| `list_stages_for_workdir` | 列出所有 stage 的 worktree_path 映射 | 无 | `{ stages }` |

### 3. 上下文注入机制

**主方式**：环境变量（自动注入，无需调用方显式传递）
- `SNAIL_CTX_CONVERSATION_ID`：当前 conversation ID
- `SNAIL_CTX_ISSUE_ID`：当前 issue ID
- `SNAIL_CTX_STAGE_ID`：当前 stage ID

**备方式**：调用参数（覆盖跨 conversation 场景）
- 工具参数中的 `conversation_id`、`issue_id`、`stage_id`

**优先级**：调用参数 > 环境变量

### 4. 向后兼容策略

**渐进式迁移**：

1. **Phase 1**：创建 `snail-issue` MCP Server，实现核心工具
2. **Phase 2**：更新 Skill 定义，将 Instructions 改为"调用 MCP Tool xxx"
3. **Phase 3**：保留 Skill 作为"文档层"，MCP 作为"执行层"
4. **Phase 4**（可选）：如果 Skill 完全不再使用，标记为废弃

**Skill 文档更新示例**：

```markdown
# record-issue-repo-context

## Purpose
记录 Issue 的仓库资源信息（分支、worktree、PR）到 Stage 的 output_artifacts。

## When To Use
创建 worktree 和分支后，需要记录到 stage output_artifacts 时。

## Instructions
调用 MCP Tool `snail-issue.record_repo_context`，传入以下参数：
- `stage_id`：Stage ID（优先使用）
- `entries`：要记录的键值对，如 `{ "worktree_path": "/path/to/worktree", "branch_name": "feature/xxx" }`

## 示例
```
/snail-issue record_repo_context stage_id=xxx entries={"worktree_path":"/path","branch_name":"feature/xxx"}
```
```

## 生效路径

1. 创建 `src/domain/snail-mcp-server/issue-port.ts`：定义 `IssueMCPPort` 接口
2. 创建 `src/domain/snail-mcp-server/_internal/issue-adapter.ts`：实现 `IssueMCPPort` 接口
3. 创建 `src/domain/snail-mcp-server/_internal/servers/snail-issue.ts`：创建 MCP Server
4. 修改 `src/domain/snail-mcp-server/_internal/initor.ts`：注册 MCP Server
5. 更新 Skill 定义：将 Instructions 改为调用 MCP Tool

## 设计约束摘要

1. **数据库访问**：通过 `IssueMCPPort` 接口注入，不直接访问数据库
2. **上下文注入**：环境变量为主，调用参数为备，必须添加错误处理
3. **向后兼容**：保留 Skill 作为文档层，MCP 作为执行层，AI 直接调用 MCP Tool
4. **类型安全**：TypeScript 实现，编译期检查
5. **返回类型**：简化返回类型，只返回必要信息，与现有 MCP Server 风格一致

## 关键决策记录

### 决策点 1：是否合并为单一 Server？

**正方论点**：
- 语义内聚：所有工具都围绕 issue → stage → conversation 链路
- 依赖注入简单：只需注入一个 `IssueMCPPort` 接口
- 与现有架构一致：其他 MCP Server 都是单一 Server

**反方论点**：
- 如果未来 issue 相关工具爆炸式增长，可能需要拆分

**最终决策**：单一 Server

**决策依据**：当前需求明确，工具数量可控，保持简单

**参与者**：架构师-1、架构师-2

### 决策点 2：如何处理现有 Skill？

**正方论点（保留 Skill）**：
- 向后兼容：不破坏现有工作流
- 文档价值：Skill 作为使用指南
- 渐进迁移：可以逐步切换到 MCP

**反方论点（废弃 Skill）**：
- 架构简洁：减少维护成本
- 避免混淆：只有一种调用方式

**最终决策**：保留 Skill 作为文档层，MCP 作为执行层

**决策依据**：用户需求是"整合到 MCP"，不是"废弃 Skill"，保持向后兼容

**参与者**：架构师-1、架构师-2

### 决策点 3：上下文注入方式？

**正方论点（环境变量为主）**：
- 自动注入：无需调用方显式传递
- 与现有机制一致：skill 使用 `{{stage_id}}` 注入

**反方论点（调用参数为主）**：
- 显式传递：更清晰，易于调试
- 灵活性：支持跨 conversation 场景

**最终决策**：环境变量为主，调用参数为备

**决策依据**：大多数场景下，上下文是固定的，环境变量可以自动注入；跨场景时，调用参数可以覆盖

**参与者**：架构师-1、架构师-2

### 决策点 4：返回类型的复杂度

**正方论点（复杂返回类型）**：
- 提供完整信息，减少调用方的额外查询
- 与现有 skill 的输出格式一致

**反方论点（简单返回类型）**：
- 减少调用方的解析复杂度
- 与现有 MCP Server 的风格一致（如 `{ ok: true }`、`{ items: [...] }`）

**最终决策**：简化返回类型，只返回必要信息

**决策依据**：
- `record_repo_context`：返回 `{ ok: true, stage_id, output_artifacts }`（去掉 `issue_id`、`issue_title`、`stage_type`）
- `set_task_anchor`：返回 `{ ok: true, issue_id, task_anchor }`
- `query_context`：保持完整返回（调用方需要完整上下文）
- `search_history` 等：保持 `{ mode, messages }` 格式（与现有 skill 输出一致）

**参与者**：架构师-1、架构师-2

### 决策点 5：上下文注入的可靠性

**正方论点（环境变量为主）**：
- 自动注入，无需调用方显式传递
- 与现有机制一致

**反方论点（调用参数为主）**：
- 显式传递，更清晰，易于调试
- 不依赖环境变量

**最终决策**：保持环境变量为主，但添加错误处理

**决策依据**：
- 在工具实现中，如果环境变量未设置且调用参数也未提供，返回明确的错误信息
- 错误信息示例：`"conversation_id is required. Set SNAIL_CTX_CONVERSATION_ID environment variable or pass conversation_id parameter."`

**参与者**：架构师-1、架构师-2

### 决策点 6：Skill 如何调用 MCP Tool？

**正方论点（Skill 脚本调用 MCP）**：
- 保持现有 Skill 的调用方式
- 用户可以通过 `/skill` 命令调用

**反方论点（AI 直接调用 MCP）**：
- 减少中间层，降低复杂度
- Skill 变成纯文档，MCP 作为执行层

**最终决策**：AI 直接调用 MCP Tool

**决策依据**：
- Skill 是 Claude Code 的 prompt 模板机制，本身不执行代码
- Skill 的 Instructions 部分告诉 AI 如何操作
- AI 读取 Instructions 后，直接调用 MCP Tool
- 这样 Skill 就变成了"文档层"，MCP 作为"执行层"

**参与者**：架构师-1、架构师-2

## 变更影响面分析

### 变更类型标签

**change_type**: `feature`

**理由**：创建新的 MCP Server，整合现有 Skill 的功能，属于新功能开发。

### 验证命令

```bash
# 验证 MCP Server 注册成功
curl -s http://localhost:3000/mcp/snail-issue | jq .

# 验证 record_repo_context 工具
curl -X POST http://localhost:3000/mcp/snail-issue \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"record_repo_context","arguments":{"stage_id":"xxx","entries":{"worktree_path":"/test","branch_name":"test"}}}}'

# 验证 set_task_anchor 工具
curl -X POST http://localhost:3000/mcp/snail-issue \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"set_task_anchor","arguments":{"issue_id":"xxx","task_anchor":"test"}}}'

# 验证 query_context 工具
curl -X POST http://localhost:3000/mcp/snail-issue \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"query_context","arguments":{"conversation_id":"xxx"}}}'
```

## 改动范围

### 新增文件

1. `src/domain/snail-mcp-server/issue-port.ts`：`IssueMCPPort` 接口定义
2. `src/domain/snail-mcp-server/_internal/issue-adapter.ts`：`IssueMCPPort` 实现
3. `src/domain/snail-mcp-server/_internal/servers/snail-issue.ts`：MCP Server 定义

### 修改文件

1. `src/domain/snail-mcp-server/_internal/initor.ts`：注册 `snail-issue` MCP Server
2. `data/file/skills/record-issue-repo-context/SKILL.md`：更新 Instructions
3. `data/file/skills/set-task-anchor/SKILL.md`：更新 Instructions
4. `data/file/skills/query-current-context/SKILL.md`：更新 Instructions
5. `data/file/skills/conversation-history/SKILL.md`：更新 Instructions

### 配置文件

无

### 提示词和文档

1. `docs/features/2026/06/22/F2026062209-snail-issue-mcp-server.md`：本 Feature 文档

## 核心业务行为

1. 当调用 `record_repo_context` 工具时，应该将传入的 entries 合并到 stage 的 output_artifacts 中
2. 当调用 `set_task_anchor` 工具时，应该更新 issue 的 task_anchor 字段
3. 当调用 `query_context` 工具时，应该返回 conversation 关联的完整上下文
4. 当调用 `search_history` 工具时，应该返回匹配查询的消息列表
5. 当调用 `get_recent_history` 工具时，应该返回最近的对话消息
6. 当调用 `get_active_stage` 工具时，应该返回 issue 的活跃 stage
7. 当环境变量 `SNAIL_CTX_CONVERSATION_ID` 已设置时，工具应该自动使用该值作为默认 conversation_id
8. 当调用参数和环境变量都存在时，应该优先使用调用参数
9. 当 `conversation_id` 既未通过参数传入也未通过环境变量设置时，应该抛出明确的错误信息
10. 当 `stage_id` 既未通过参数传入也未通过环境变量设置时，应该抛出明确的错误信息
