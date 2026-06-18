---
id: F2026061801
title: unify-knowledge-fts5-to-platform-db
from_ids:
  - F2026061702
tags:
  - knowledge
  - database
  - refactor
  - architecture
modules:
  - domain/knowledge
  - infra/database
doc_kind: spec
---

# F2026061801 [knowledge][Refactor] 统一 knowledge FTS5 索引到平台数据库

## 背景

F2026061702 实现了 knowledge 域的 FTS5 全文搜索索引，但存在架构不一致问题：

- `KnowledgeSearchIndex` 自己创建 SQLite 连接，不使用 infra 层的 `SQLiteDatabase`
- 数据库文件放在 `data/knowledge-search.db` 而非 `data/database/`
- 单独的关闭钩子，资源管理不统一

其他 domain（issue、message、evolution、snail、im）都使用注入的 `SQLiteDatabase`，knowledge 是唯一一个自己管理 DB 连接的。

## 设计原则

### 1. 统一数据库访问模式

所有 domain 应使用相同的数据库连接模式：通过依赖注入获取 `SQLiteDatabase` 实例。

### 2. 单一数据库文件

所有业务表（包括 FTS5 虚拟表）应存储在同一个 `snail-shell.db` 中，简化运维和备份。

### 3. 统一资源管理

数据库连接的生命周期由 `SQLiteDatabase` 统一管理，关闭钩子只需关闭一个实例。

## 架构

### 变更前

```
┌─────────────────┐     ┌─────────────────┐
│ Issue Domain    │     │ Knowledge Domain │
│ (注入 SQLiteDatabase) │     │ (自己创建 Database) │
└────────┬────────┘     └────────┬────────┘
         │                       │
         ▼                       ▼
   snail-shell.db          knowledge-search.db
   data/database/          data/
```

### 变更后

```
┌─────────────────┐     ┌─────────────────┐
│ Issue Domain    │     │ Knowledge Domain │
│ (注入 SQLiteDatabase) │     │ (注入 SQLiteDatabase) │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
              snail-shell.db
              data/database/
```

## 文件变更

### 修改

- `src/infra/database.ts` — 添加 `raw()` 方法暴露底层 better-sqlite3 实例
- `src/domain/knowledge/_internal/search-index.ts` — 重构构造函数接受 `SQLiteDatabase`
- `src/domain/knowledge/_internal/initor.ts` — 接受 `db` 参数而非 `repoRoot`
- `src/main.ts` — 传递 `db`，统一关闭钩子

### 新增

- 无

### 删除

- `data/knowledge-search.db` — 合并到 `snail-shell.db`

## 核心实现

### SQLiteDatabase 扩展

```typescript
export class SQLiteDatabase {
  // ... 现有方法 ...

  /** 获取底层 better-sqlite3 实例（用于 FTS5 等高级场景） */
  raw(): Database.Database {
    return this.db;
  }
}
```

### KnowledgeSearchIndex 重构

```typescript
export class KnowledgeSearchIndex {
  private db: Database.Database;

  constructor(db: SQLiteDatabase) {
    this.db = db.raw();
    this.initSchema();
  }

  /** 关闭数据库连接（由 SQLiteDatabase 统一管理，此处为空实现） */
  close(): void {
    // 连接由 SQLiteDatabase 统一管理，不需要单独关闭
  }
}
```

### 统一关闭钩子

```typescript
function registerShutdownHooks(modules: Modules, db: SQLiteDatabase): void {
  let closed = false;
  const shutdown = () => {
    if (closed) return;
    closed = true;
    console.log("[shutdown] Closing database...");
    db.close();
  };
  process.on("exit", shutdown);
  process.on("SIGINT", () => { shutdown(); process.exit(0); });
  process.on("SIGTERM", () => { shutdown(); process.exit(0); });
}
```

## 数据流

**启动**：`main → initModules → new SQLiteDatabase → initKnowledge(db) → KnowledgeSearchIndex(db)`

**搜索**：`search_knowledge → index.search(FTS5) → 返回snippet+entry`

**关闭**：`SIGTERM → shutdown → db.close() → 所有连接统一关闭`

## 兼容性

- FTS5 表结构不变，数据自动迁移到新数据库
- 启动时 `validate` + `rebuild` 机制确保索引完整性
- 无 API 变更，MCP 工具接口保持一致
