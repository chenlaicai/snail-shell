---
id: F2026061702
title: knowledge-fts5-index
from_ids:
  - F2026052504
tags:
  - knowledge
  - search
  - fts5
  - mcp
modules:
  - domain/knowledge
  - domain/snail-mcp-server
doc_kind: spec
---

# F2026061702 [knowledge][Feature] 知识库 FTS5 搜索索引

## 背景

v1 知识库使用 SQLite + FTS5 提供全文搜索，但 skill 脚本通过 `execFileSync` 调用，存在进程隔离问题：

- 每次调用启动 2 个 Node.js 子进程
- 数据库连接每次重新打开/关闭
- 无状态，无法复用查询结果
- 性能开销约 100-200ms

新架构已将知识库持久化迁移到文件系统（markdown + frontmatter），但丢失了 FTS5 全文搜索能力。当前 `search_knowledge` MCP 工具使用内存过滤（`String.includes()`），不是真正的全文搜索。

## 设计原则

### 1. 文件系统是唯一真相源

知识库条目以 markdown 文件存储，scope 由文件所在目录决定。FTS5 索引只是搜索加速层，可从文件随时重建。

### 2. 索引可重建、可恢复

索引损坏不应影响系统运行。启动时校验索引完整性，缺失条目自动从文件重建。

### 3. MCP 是唯一访问方式

废弃 v1 的 skill 脚本架构，所有知识库操作通过 MCP 协议提供。

## 架构

```
┌─────────────────────────────────────────────────────────┐
│  MCP Server (knowledge.ts)                              │
│  search_knowledge → 查FTS5索引 → 返回snippet+entry      │
│  add_knowledge    → 写文件 → 同步写FTS5索引              │
│  remove_knowledge → 删文件 → 同步删FTS5索引              │
└─────────────────────────────────────────────────────────┘
                          │
           ┌──────────────┴──────────────┐
           ▼                             ▼
   ┌───────────────┐            ┌───────────────┐
   │ FileKnowledge │            │ KnowledgeSearch│
   │ Repository    │            │ Index (FTS5)   │
   │ (真相源)       │            │ (搜索索引)      │
   └───────────────┘            └───────────────┘
           │                             │
           ▼                             ▼
   knowledge/*.md              knowledge-search.db
   (markdown+frontmatter)      (SQLite FTS5)
```

## 文件变更

### 新增

- `src/domain/knowledge/_internal/search-index.ts` — FTS5 搜索索引

### 修改

- `src/domain/knowledge/port.ts` — 新增 `search` 方法
- `src/domain/knowledge/_internal/adapter.ts` — 集成 search-index
- `src/domain/knowledge/_internal/initor.ts` — 初始化索引
- `src/domain/snail-mcp-server/_internal/servers/knowledge.ts` — search 走 FTS5

## 核心实现

### KnowledgeSearchIndex

```typescript
export class KnowledgeSearchIndex {
  private db: Database.Database;

  constructor(private indexPath: string) {
    this.db = new Database(indexPath);
    this.initSchema();
  }

  search(query: string, workspacePath?: string): SearchResult[] { ... }
  upsert(entry: KnowledgeEntry): void { ... }
  remove(id: string): void { ... }
  rebuild(entries: KnowledgeEntry[]): void { ... }
  validate(fileEntryIds: string[]): string[] { ... }
}
```

### KnowledgePort 扩展

```typescript
export interface KnowledgePort {
  list(): KnowledgeEntry[];
  findByWorkspace(workspace: Workspace): KnowledgeEntry[];
  add(input: CreateKnowledgeInput): KnowledgeEntry;
  remove(input: RemoveKnowledgeInput): void;
  // 新增
  search(query: string, workspace?: Workspace): SearchResult[];
}

export interface SearchResult {
  entry: KnowledgeEntry;
  snippet: string;
}
```

### 双写机制

- `add` → `repo.add(写文件)` → `index.upsert(写FTS5)`
- `remove` → `repo.remove(删文件)` → `index.remove(删FTS5)`

### 启动校验

```typescript
const fileEntries = repo.list();
const missingIds = index.validate(fileEntries.map(e => e.id));
if (missingIds.length > 0) {
  index.rebuild(fileEntries);
}
```

## 数据流

**写入**：`add_knowledge → repo.add(文件) → index.upsert(FTS5) → 返回entry`

**搜索**：`search_knowledge → index.search(FTS5) → 返回snippet+entry`

**启动**：`init → repo.list(文件) → index.validate(比对) → 有缺失则rebuild`

## 索引存储

- 索引文件：`data/knowledge-search.db`
- 与平台级数据同目录，不属于 workspace
- FTS 分词器：`unicode61`（支持中文）
