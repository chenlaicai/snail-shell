---
id: F2026052504
title: 决策库替换为知识库：三层渐进式披露
from_ids: []
tags: [knowledge, governance]
modules: [knowledge_governance]
---
# F2026052504 决策库替换为知识库：三层渐进式披露

## 背景

当前 Knowledge Center 有一个独立的"设计决策库"（design_decision 表），只存储架构取舍和设计约束。

"决策"概念过于狭窄——知识库应该覆盖原则/规则、模式、偏好、术语定义等更广泛的知识类型。同时，系统提示词容量有限（~120 条规则边界线），非核心的原则/规则需要一个"候补库"承载。

## 目标

- 将"设计决策库"替换为"知识库"（knowledge_library 表），统一收纳所有已发布知识
- 实现三层渐进式披露：L1 系统提示词入口 → L2 按类列表 → L3 全文
- 知识治理 artifact type 从 `design_decision_entry` 改为 `knowledge_library_entry`

## 非目标

- 不改变 knowledge_item 治理流程的数据模型
- 不改变知识治理的审批飞轮

## 设计

### 三层渐进式披露

```
L1（系统提示词 B-01） → 自然语言概览："当前知识库：constraint/约束 3 条、decision/决策 5 条..."
                       附带查阅指引，每次构建时查询 knowledge_library 表按 kind 生成
L2（skill list --kind）→ 列出该类下条目：标题 + 概要 + 使用场景 + 非使用场景 + ID
L3（skill get --id）  → 返回单条全文
```

L1 通过 `{{knowledge_library_summary}}` 模板变量注入到 B-01「知识库能力」节，覆盖所有 conversation（F-01/F-02 均引用 B-01）。

### 知识库分类（MECE 6 类）

| kind | 含义 | 互斥判据 |
|------|------|---------|
| `constraint` | 硬性约束、禁令 | MUST/MUST NOT |
| `decision` | 架构取舍及理由 | WHY |
| `pattern` | 推荐方案、最佳实践 | HOW（推荐） |
| `anti_pattern` | 已知错误、教训 | 不要做什么 |
| `term` | 概念定义、命名约定 | 是什么 |
| `procedure` | 操作流程、步骤 | 按什么步骤 |

六类互斥且覆盖全量——每条知识落在一个功能维度，不存在无法归类的知识。

### 数据模型

```sql
CREATE TABLE knowledge_library (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  kind TEXT NOT NULL,           -- KnowledgeKind (constraint/decision/pattern/anti_pattern/term/procedure)
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  use_scenarios TEXT NOT NULL DEFAULT '',
  non_use_scenarios TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  source_knowledge_id TEXT,     -- → knowledge_item(id)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
  FOREIGN KEY (source_knowledge_id) REFERENCES knowledge_item(id) ON DELETE SET NULL
);
```

### 知识流向

```
knowledge_item（治理源/索引）
  → governance 审批
    → system_prompt_pr     （核心原则 → 系统提示词）
    → knowledge_library     （非核心原则 + 架构决策 + 其他 → 知识库候补）
    → skill_pr / code_or_checker_pr / ...
```

## 改动范围

| 层 | 改动 |
|---|---|
| **Schema** | 删除 `design_decision` + `design_decision_search`；新建 `knowledge_library` + `knowledge_library_search` + 对应索引 |
| **类型** | `design-decision-types.ts` → `knowledge-library-types.ts`；`KnowledgeKind` 10→6 MECE（constraint/decision/pattern/anti_pattern/term/procedure）；`KnowledgeGovernanceArtifactType` 移除 `core_doc_pr`，新增 `knowledge_library_entry` |
| **数据模型** | `design-decision-model.ts` → `knowledge-library-model.ts`；新增 `kindSummaries()` 方法返回 L1 概览 |
| **服务层** | `design-decision-service.ts` → `knowledge-library-service.ts` |
| **Skill** | `design-decision` → `knowledge-library`；新增 `summary` 模式（L1 概览） |
| **提示词 B-01** | 新增「知识库能力」节，注入 `{{knowledge_library_summary}}` 自然语言概览 + 查阅指引 |
| **提示词 S-07** | 重写为"知识库能力"；聚焦三层披露协议规则（L1 引用 B-01） |
| **提示词 S-08** | 更新 design-decision → knowledge-library 引用；移除 core_doc_pr 残留 |
| **F-01/F-02 框架** | 章节标题「设计决策能力」→「知识库能力」；F-02 移除 core_doc_pr 残留文字 |
| **prompt-center** | `PromptBuildContext` 新增 `knowledgeLibrarySummaries`；`buildKnowledgeLibraryVariables()` 自然语言 |
| **project-workflow** | `buildConversationSystemPrompt` 注入知识库概览 |
| **knowledge-governance-prompt** | 知识治理对话补充 `knowledgeLibrarySummaries` 参数 |

## 验证

- [x] 全部 38 个测试通过
- [x] TypeScript 编译通过（--noEmit）
- [x] ESLint 无错误
- [x] knowledge-library skill 全部 6 种模式（summary/list/get/search/create/deprecate）手动验证通过
- [x] L1 注入验证：{{knowledge_library_summary}} 模板变量在 B-01 prompt 中正确展开为自然语言概览
- [ ] 实际调用中 AI 按三层模型查询知识库

## 风险

- **旧 decision 数据不兼容**：旧 `design_decision` 表在新 schema 中不存在，旧数据需人工迁移（见下方"迁移说明"）
- **L1 不为空时 AI 可能过度查询**：S-07 的 `<protocol>` 已约束"某类有条目时必须查询确认"，这是期望行为

## 迁移说明

旧 `design_decision` 表中的数据不会自动迁移。用户需手动执行迁移：

```sql
INSERT INTO knowledge_library (id, project_id, kind, title, summary, content, status, source_knowledge_id, created_at, updated_at)
SELECT id, project_id, 'decision', title, '', content, status, source_knowledge_id, created_at, updated_at
FROM design_decision;
```

新 `summary` / `use_scenarios` / `non_use_scenarios` 字段在迁移时留空，之后通过 skill 的 update 模式补填。
