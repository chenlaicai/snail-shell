# Knowledge Library 模块分析（v1 遗留）

> 本文档基于 `v1/` 目录下的遗留代码分析，用于指导 v2 重写。

---

## 一、业务场景

### 1.1 Knowledge Library 是什么

Knowledge Library（知识库）是 Snail Shell 的**持久化知识存储系统**。存储经过治理沉淀的知识条目，支持按 scope（global/workspace）组织和 FTS5 全文搜索。

核心设计：**扁平结构 + scope 维度 + 来源追溯**。条目无分类/标签层级，仅通过 scope（global/workspace）区分可见范围，通过 source_evolution_item_id 追溯治理来源。

### 1.2 核心业务场景

| 场景 | 说明 |
|------|------|
| **治理沉淀** | Evolution 治理完成后，将裁决结果沉淀为知识库条目（source_evolution_item_id 追溯来源） |
| **Agent 查询** | Agent 通过 knowledge-library Skill 查询、搜索知识库条目 |
| **Agent 创建** | Agent 通过 knowledge-library Skill 创建新条目（需指定 scope） |
| **全文搜索** | FTS5 搜索 title 和 content，按 relevance 排序 |
| **Web 展示** | Knowledge Center 页面按 scope 分组展示，当前只读（无 CRUD UI） |
| **Prompt 注入** | system prompt 注入知识库摘要（"global 5 items, workspace 3 items"），引导 Agent 使用 Skill 查询 |

### 1.3 Knowledge Library 与其他模块的关系

- **Evolution**：治理结果沉淀为知识库条目，source_evolution_item_id FK 追溯来源（ON DELETE SET NULL）
- **Workspace**：scope="workspace" 的条目绑定 workspace_id，scope="global" 的条目 workspace_id=NULL
- **Skill**：knowledge-library Skill 提供 summary/list/get/search/create 五种操作模式
- **Prompt Center**：system prompt 注入知识库摘要，引导 Agent 按需查询
- **Agent**：Agent 在对话中通过 Skill 读写知识库，不能直接访问数据库
- **Issue/Stage**：知识库条目不直接关联 Issue 或 Stage，是上下文无关的制品

---

## 二、数据模型

### 2.1 数据库表

**knowledge_library 表**：
```sql
CREATE TABLE knowledge_library (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'workspace',  -- global | workspace
  workspace_id TEXT,                         -- scope=global 时为 NULL
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_evolution_item_id TEXT REFERENCES evolution_item(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- 索引: (scope, workspace_id, updated_at), (source_evolution_item_id)
```

**knowledge_library_search 表**（FTS5）：
```sql
CREATE VIRTUAL TABLE knowledge_library_search USING fts5(
  entry_id UNINDEXED,
  scope UNINDEXED,
  workspace_id UNINDEXED,
  title,
  content
);
```

### 2.2 TypeScript 类型定义

**KnowledgeLibraryScope**：
```typescript
type KnowledgeLibraryScope = "global" | "workspace";
```

**KnowledgeLibraryEntry**：
```typescript
interface KnowledgeLibraryEntry {
  id: string;
  scope: KnowledgeLibraryScope;
  workspace_id: string | null;
  title: string;
  content: string;
  source_evolution_item_id: string | null;
  created_at: string;
  updated_at: string;
}
```

**KnowledgeLibrarySearchResult**：
```typescript
interface KnowledgeLibrarySearchResult extends KnowledgeLibraryEntry {
  snippet: string;  // FTS5 摘要（24 tokens，[/] 标记）
}
```

**CreateKnowledgeLibraryInput**：
```typescript
interface CreateKnowledgeLibraryInput {
  id: string;
  scope: KnowledgeLibraryScope;
  workspaceId?: string;
  title: string;
  content: string;
  sourceEvolutionItemId?: string;
}
```

**UpdateKnowledgeLibraryInput**：
```typescript
interface UpdateKnowledgeLibraryInput {
  scope?: KnowledgeLibraryScope;
  workspaceId?: string;
  title?: string;
  content?: string;
}
```

**KnowledgeLibraryListFilters**：
```typescript
interface KnowledgeLibraryListFilters {
  scope?: KnowledgeLibraryScope;
  workspaceId?: string;
  query?: string;   // FTS 搜索
  limit?: number;
  offset?: number;
}
```

---

## 三、核心流程

### 3.1 知识库摘要注入 Prompt

```
buildConversationSystemPrompt()
  → store.summaryKnowledgeLibrary(workspace.id)
  → SELECT scope, COUNT(*) ... WHERE workspace_id = ? OR workspace_id IS NULL GROUP BY scope
  → 注入 system prompt："当前知识库：global X 条，workspace Y 条"
  → 引导 Agent 使用 knowledge-library Skill 按需查询
```

### 3.2 Agent 查询流程（Skill）

```
Agent 需要查询知识
  → knowledge-library Skill（--mode search/list/get/summary）
  → knowledge-library.js CLI 脚本
  → db-bridge.js --mode knowledge-*
  → 查询 knowledge_library 表（FTS5 或普通 SQL）
  → 返回结果（含 snippet 摘要）
```

### 3.3 Agent 创建流程（Skill）

```
Agent 需要创建知识条目
  → knowledge-library Skill（--mode create）
  → --scope global|workspace --title "..." --content "..."
  → 可选：--source-evolution-item-id（治理沉淀时必须）
  → INSERT INTO knowledge_library
  → 重建 FTS5 索引
```

### 3.4 FTS5 搜索流程

```
search(filters)
  → buildFtsQuery(query) → 分词、转义、AND 连接
  → SELECT ... FROM knowledge_library_search
    WHERE knowledge_library_search MATCH ?
    AND scope = ? AND (workspace_id = ? OR workspace_id IS NULL)
    ORDER BY rank, updated_at DESC
  → 返回 snippet()（FTS5 内置摘要函数，24 tokens）
```

### 3.5 FTS5 索引维护

```
create() / update()
  → 写入 knowledge_library 表
  → reindex(entryId)
    → DELETE FROM knowledge_library_search WHERE entry_id = ?
    → INSERT INTO knowledge_library_search (entry_id, scope, workspace_id, title, content) ...
```

---

## 四、关键设计决策（v1）

1. **扁平结构，无分类层级** — 条目仅通过 scope（global/workspace）区分，无 category/tag/taxonomy
2. **FTS5 全文搜索** — title 和 content 索引，按 relevance 排序，返回 snippet 摘要
3. **来源追溯** — source_evolution_item_id FK 追溯治理来源（ON DELETE SET NULL）
4. **只读 API** — Web 端仅有 GET 端点，无 POST/PATCH/DELETE（mutations 是占位 stub）
5. **Skill 驱动写入** — Agent 通过 knowledge-library Skill 创建条目，不通过 Web UI
6. **Prompt 摘要注入** — system prompt 注入条目计数摘要，引导 Agent 按需深入查询
7. **Scope 可见性规则** — summary() 返回 WHERE workspace_id = ? OR workspace_id IS NULL，global 条目始终可见

---

## 五、v2 重写待决问题

1. **是否需要分类/标签？** 当前扁平结构是否满足需求，还是需要 taxonomy 支持？
2. **Web CRUD 是否需要？** 当前只读 API，是否需要 Web 端创建/编辑/删除？
3. **条目是否需要关联 Issue/Stage？** 当前上下文无关，是否需要支持上下文关联？
4. **搜索是否需要更复杂？** 当前 FTS5 AND 连接，是否需要 OR、短语搜索、高亮？
5. **Scope 是否需要扩展？** 当前仅 global/workspace，是否需要 project 级别？
6. **条目版本管理？** 是否需要变更历史和回滚？
7. **知识库容量管理？** 是否需要清理策略、归档机制？
8. **Agent 创建的权限控制？** 当前 Agent 可自由创建，是否需要审批流程？
