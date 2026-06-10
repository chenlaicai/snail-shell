# Feature Chain 模块分析（v1 遗留）

> 本文档基于 `v1/` 目录下的遗留代码分析，用于指导 v2 重写。

---

## 一、业务场景

### 1.1 Feature Chain 是什么

Feature Chain 是 **Feature 设计文档的知识检索系统**。让 AI Agent（架构师、开发者）能够搜索、检索、追溯存储在 `docs/features/` 目录下的历史 Feature 设计文档，通过 `from_ids` 引用链形成设计血缘的有向无环图。

核心价值：**防止重复设计讨论**，让过去的设计决策可发现、可追溯。

### 1.2 核心业务场景

| 场景 | 说明 |
|------|------|
| **全文搜索** | Agent 通过 `search` 命令搜索历史 Feature 文档（FTS5 索引 title/summary/tags/modules/body） |
| **文档获取** | Agent 通过 `get` 命令获取单个 Feature 的完整文档（frontmatter + markdown body） |
| **引用链追溯** | Agent 通过 `chain` 命令追溯引用关系（backward/forward/both） |
| **增量更新** | 开发中的 Feature 可更新 `from_ids`/`tags`/`modules`（已合入的不可变） |
| **启动时全量重建** | 系统启动时扫描 `docs/features/` 重建索引 |

### 1.3 Feature Chain 与其他模块的关系

- **SOP（Design Stage）**：code-delivery SOP 的设计阶段 handbook 要求 Agent 在设计前搜索历史 Feature（GATE-4: Background Traceability）
- **Knowledge Library**：设计阶段同时查询 feature-chain 和 knowledge-library 两个知识源
- **Skill**：feature-chain Skill 是 Agent 访问该系统的唯一入口
- **db-bridge**：Skill 脚本通过 db-bridge.js 访问数据库，不直接连接
- **无 Web UI**：纯后端索引，无 API 端点和前端页面

---

## 二、数据模型

### 2.1 Feature 文档格式

文件命名：`F{YYYYMMDDNN}-{descriptive-title}.md`（如 `F2026060112-workspace-management.md`）

YAML frontmatter：
```yaml
---
id: F2026060112
title: Workspace Management
from_ids: [F2026052803, F2026051501]
tags: [workspace, persistence]
modules: [workspace-workflow, persistence]
doc_kind: feature
---
```

### 2.2 FeatureDoc 接口

```typescript
interface FeatureDoc {
  id: string;        // "F2026060112"
  title: string;
  fromIds: string[]; // 前置 Feature ID 列表
  tags: string[];
  modules: string[];
  docPath: string;   // 绝对文件路径
  createdAt: string; // 从文件名提取的日期
  summary: string;   // 自动提取的摘要（Background 段前 200 字符）
  body: string;      // 完整 markdown body
}
```

### 2.3 数据库表

**feature_chain_index 表**：
```sql
CREATE TABLE feature_chain_index (
  feature_id TEXT PRIMARY KEY,     -- "F2026060112"
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  from_ids TEXT NOT NULL DEFAULT '[]',   -- JSON array
  tags TEXT NOT NULL DEFAULT '[]',       -- JSON array
  modules TEXT NOT NULL DEFAULT '[]',    -- JSON array
  doc_path TEXT NOT NULL,                -- 绝对文件路径
  created_at TEXT NOT NULL               -- 从文件名提取
);
```

**feature_chain_search 表**（FTS5）：
```sql
CREATE VIRTUAL TABLE feature_chain_search USING fts5(
  feature_id UNINDEXED,
  title,
  summary,
  tags,
  modules,
  body
);
```

**feature_chain_backlink 表**（反向边）：
```sql
CREATE TABLE feature_chain_backlink (
  feature_id TEXT NOT NULL,        -- 被引用的 Feature（目标）
  from_feature_id TEXT NOT NULL,   -- 引用方（来源）
  PRIMARY KEY (feature_id, from_feature_id)
);
-- 索引: (from_feature_id)
```

当 Feature B 的 `from_ids: [A]` 时，backlink 表存储 `(feature_id=A, from_feature_id=B)`，支持高效正向遍历："谁引用了 Feature A？"

---

## 三、核心流程

### 3.1 启动时全量重建

```
main.ts → store.rebuildFeatureChainIndex()
  → rebuildFeatureChainIndex(db)
    → findFeatureFiles(docs/features/) → 递归扫描 F*.md 文件
    → 对每个文件 parseFeatureDoc(filePath)
      → 解析 YAML frontmatter（id, title, from_ids, tags, modules）
      → 提取 body markdown
      → extractSummary(body) → "Background" 段前 200 字符，fallback 全文前 200 字符
      → extractDate(filePath) → 从文件名提取 YYYY-MM-DD
    → 单事务内：
      → DELETE FROM feature_chain_index / feature_chain_search / feature_chain_backlink
      → INSERT INTO feature_chain_index（每个 feature）
      → INSERT INTO feature_chain_search（FTS5 索引）
      → 遍历每个 feature 的 from_ids → INSERT INTO feature_chain_backlink（反向边）
```

### 3.2 Skill 查询流程

```
Agent 调用 feature-chain Skill
  → feature-chain.js CLI 脚本
  → db-bridge.js --mode feature-chain-{search|get|chain}

search:
  → SELECT ... FROM feature_chain_search WHERE feature_chain_search MATCH ?
  → 返回 [{ feature_id, title, summary, tags, modules, snippet }]

get:
  → SELECT ... FROM feature_chain_index WHERE feature_id = ?
  → 读取 doc_path 对应的文件完整内容
  → 返回 { ...indexRow, body }

chain --direction backward:
  → SELECT from_ids FROM feature_chain_index WHERE feature_id = ?
  → 解析 JSON array → 查找每个 from_id 的 title + summary

chain --direction forward:
  → SELECT from_feature_id, title, summary
    FROM feature_chain_backlink JOIN feature_chain_index
    WHERE feature_chain_backlink.feature_id = ?

chain --direction both:
  → 同时执行 backward + forward
```

### 3.3 增量更新流程

```
updateFeatureChainLink(db, { featureId, fromIds?, tags?, modules? })
  → SELECT doc_path FROM feature_chain_index WHERE feature_id = ?
  → 读取文件 → 解析 frontmatter
  → 更新 from_ids/tags/modules
  → 写回文件（renderYamlFrontmatter → updateFeatureFrontmatter）
  → syncFeatureIndex(db, updatedFeature)
    → UPDATE feature_chain_index
    → DELETE + INSERT feature_chain_search
    → DELETE + INSERT feature_chain_backlink
```

---

## 四、关键设计决策（v1）

1. **文件即真相** — Feature 文档是磁盘上的 markdown 文件，数据库是派生索引
2. **启动时 nuke-and-pave** — 全量清空重建，简单可靠，因为索引仅启动时构建
3. **FTS5 全文搜索** — 索引 title/summary/tags/modules/body，tags 和 modules 数组用空格连接
4. **反向边表** — backlink 表预计算反向引用，支持高效正向遍历
5. **已合入不可变** — 已合入的 Feature 文档不可修改，仅开发中的可更新 from_ids
6. **无 Web UI** — 纯 Skill 访问，无 API 端点和前端页面
7. **db-bridge 代理** — Skill 脚本通过 db-bridge.js 访问数据库，不直接连接
8. **摘要自动提取** — 从 "Background" 段提取前 200 字符作为摘要

---

## 五、v2 重写待决问题

1. **索引是否需要实时更新？** 当前仅启动时重建，新文档需重启，是否需要文件监听？
2. **是否需要 Web UI？** 当前纯 Skill 访问，是否需要 Web 端搜索/浏览？
3. **是否需要 API 端点？** 当前无 HTTP 接口，是否需要 REST API？
4. **引用链是否需要多级遍历？** 当前仅一级 backward/forward，是否需要递归遍历？
5. **是否需要与 Knowledge Library 统一？** 两个知识系统是否需要合并？
6. **文档格式是否演进？** 当前固定 frontmatter 字段，是否需要更丰富的元数据？
7. **索引是否需要持久化增量？** 当前 nuke-and-pave，是否需要增量更新策略？
8. **是否需要版本管理？** Feature 文档的变更历史是否需要追踪？
