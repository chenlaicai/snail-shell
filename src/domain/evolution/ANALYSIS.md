# Evolution 模块分析（v1 遗留）

> 本文档基于 `v1/` 目录下的遗留代码分析，用于指导 v2 重写。

---

## 一、业务场景

### 1.1 Evolution 是什么

Evolution（演进治理）是 Snail Shell 的**知识治理系统**。当 Agent 在工作中发现可复用的洞察（偏好、规则、教训、决策等），通过 evolution-candidate Skill 提交候选条目，系统自动创建一个治理对话，由 AI 进行事实验证、查重、裁决，最终将治理结果写回或沉淀到知识库。

核心设计：**候选提交 → 原子创建治理管线 → 治理对话 → 结果沉淀**。每个 Evolution Item 创建时原子性地生成 4 条记录（evolution_item + issue + stage + conversation），治理对话通过 owner_type="evolution" 走特殊 prompt 构建路径。

### 1.2 核心业务场景

| 场景 | 说明 |
|------|------|
| **候选提交** | Agent 通过 evolution-candidate Skill 提交候选条目（偏好、规则、教训、决策、模式等） |
| **原子创建治理管线** | 创建 evolution_item 时同时创建专用 issue（含 SOP 快照）、stage、conversation |
| **治理对话** | AI 在治理对话中验证事实、查重、裁处置方式，结果写回 evolution_item |
| **结果沉淀** | 治理完成后可产生：system prompt、Skill、文档、代码、知识库条目 |
| **Web 管理** | Evolution Center 页面展示列表、详情、创建表单 |
| **全文搜索** | FTS5 搜索 evolution_item 的 title 和 content |

### 1.3 Evolution 与其他模块的关系

- **Issue**：每个 Evolution Item 创建一个专用治理 Issue（1:1），Issue 持有 SOP 快照
- **Stage**：治理 Issue 有一个 Stage（type="development"，sequence=1），单 stage 无转换
- **Conversation**：治理对话通过 owner_type="evolution" + owner_id=item.id 关联
- **SOP**：治理 Issue 使用专用的 evolution SOP（单 stage，无 transitions）
- **Knowledge Library**：治理结果可沉淀为知识库条目，通过 source_evolution_item_id FK 追溯来源
- **Skill**：evolution-candidate Skill 是提交候选的唯一入口
- **Prompt Center**：owner_type="evolution" 时走 buildEvolutionSystemPrompt() 特殊路径
- **Role**：治理对话的 default_role="演进执行者"，participating_roles=["项目负责人","演进执行者"]

---

## 二、数据模型

### 2.1 数据库表

**evolution_item 表**：
```sql
CREATE TABLE evolution_item (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  issue_id TEXT REFERENCES issue(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',      -- JSON array of strings
  metadata TEXT,                        -- JSON, 扩展元数据
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- 索引: (workspace_id, updated_at), (issue_id)
```

**evolution_item_search 表**（FTS5）：
```sql
CREATE VIRTUAL TABLE evolution_item_search USING fts5(
  evolution_item_id UNINDEXED,
  workspace_id UNINDEXED,
  title,
  content
);
```

**关联表**：
- `issue`：evolution_item.issue_id → issue.id（1:1，专用治理 Issue）
- `stage`：治理 Issue 的 stage（type="development"，sequence=1）
- `conversation`：owner_type="evolution"，owner_id=item.id（1:1，治理对话）
- `knowledge_library`：source_evolution_item_id → evolution_item.id（治理结果沉淀）

### 2.2 TypeScript 类型定义

**EvolutionItem**：
```typescript
interface EvolutionItem {
  id: string;
  workspace_id: string;
  issue_id: string | null;
  title: string;
  content: string;
  tags: string[];        // JSON 解析后
  metadata: unknown;     // JSON 解析后
  created_at: string;
  updated_at: string;
}
```

**EvolutionItemWithConversation**：
```typescript
interface EvolutionItemWithConversation extends EvolutionItem {
  conversation: Conversation | null;
}
```

**CreateEvolutionItemInput**：
```typescript
interface CreateEvolutionItemInput {
  id: string;
  workspaceId: string;
  title: string;
  content: string;
  tags?: string[];
  metadata?: unknown;
}
```

**UpdateEvolutionItemInput**：
```typescript
interface UpdateEvolutionItemInput {
  issueId?: string;
  title?: string;
  content?: string;
  tags?: string[];
  metadata?: unknown;
}
```

**EvolutionItemListFilters**：
```typescript
interface EvolutionItemListFilters {
  workspaceId?: string;
  issueId?: string;
  tags?: string[];
  query?: string;   // FTS 搜索
  limit?: number;
  offset?: number;
}
```

**EvolutionItemSearchResult**：
```typescript
interface EvolutionItemSearchResult {
  id: string;
  workspace_id: string;
  issue_id: string | null;
  title: string;
  content: string;
  tags: string[];
  snippet: string;       // FTS 摘要
  conversation: Conversation | null;
  updated_at: string;
}
```

### 2.3 Evolution SOP 定义

```yaml
name: 演进治理流程
description: 演进项治理。入口校验、查重、分析、裁决和产物处理。
first_stage: development

stage_definitions:
  - key: development
    title: 演进治理
    sequence: 1
    input_description: 演进项内容
    output_description: 完整治理：验证事实、查重、裁处置、写回结果；可产 prompt/skill/文档/代码
    acceptance_focus:
      - 来源和事实已验证
      - 裁处置已写回
      - 条目不绕过治理自动生效
    acceptance_checklist:
      - id: evo-01
        description: 来源和事实已验证
        required: true
      - id: evo-02
        description: 裁处置已写回
        required: true
    roles:
      - key: executor
        name: 演进执行者
        is_primary: true
        count: 1
        # handbook: 可选

# 无 transitions — 单 stage 即终态
```

### 2.4 前端分类（非数据库字段）

前端创建表单提供 type 下拉选项，值存入 tags 或 metadata：
- `preference`（偏好）
- `rule`（规则）
- `pattern`（模式）
- `lesson`（教训）
- `decision`（决策）

---

## 三、核心流程

### 3.1 候选提交流程（Skill 路径）

```
Agent 发现可复用洞察
  → evolution-candidate Skill（SKILL.md 协议）
  → evolution-candidate.js CLI 脚本
  → db-bridge.js --mode evolution-create
  → 原子事务创建 4 条记录：
    1. INSERT evolution_item
    2. 构建 evolution SOP 快照 → INSERT issue（含 sop_snapshot）
    3. INSERT stage（type="development"，sequence=1，status="in_progress"）
    4. INSERT conversation（owner_type="evolution"，default_role="演进执行者"）
    5. UPDATE evolution_item.issue_id = issue.id
    6. 重建 FTS5 索引
  → 返回 { ok: true, evolution_item_id, issue_id, conversation_id }
```

### 3.2 候选提交流程（API 路径）

```
POST /api/evolution/items
  → evolution-routes.ts → parseCreateBody() 校验
  → WorkspaceManager.createEvolutionItem(input, roleSnailMapping)
  → evolutionCenter.createEvolutionItem(store, input, roleSnailMapping)
  → EvolutionModel.create() → 同样的原子事务
```

### 3.3 治理对话流程

```
用户进入治理 Conversation
  → manager-collaboration.ts 检测 owner_type === "evolution"
  → buildEvolutionSystemPrompt()
    → 解析 evolution_item（通过 owner_id）
    → 解析 workspace、issue、stage
    → 从 SOP 快照读取 stage 定义（SopSnapshotReader）
    → 解析 role 定义
    → 调用 buildConversationSystemPrompt()，传入 evolutionContext
  → Prompt Center 注入 "Evolution Governance Context" 特殊段落
  → AI 进行治理：验证事实、查重、裁处置
  → 治理结果通过 PATCH /api/evolution/items/:id 写回
  → 可选产出：prompt、skill、文档、代码、知识库条目
```

### 3.4 治理结果沉淀

```
治理完成
  → PATCH /api/evolution/items/:id（写回 title、content、tags、metadata）
  → 可选：POST /api/knowledge/items（创建知识库条目，source_evolution_item_id 追溯来源）
  → 可选：更新 system prompt、创建 Skill、生成文档/代码
```

---

## 四、关键设计决策（v1）

1. **原子创建治理管线** — evolution_item + issue + stage + conversation 在同一事务中创建
2. **专用 SOP 快照** — 治理 Issue 携带 evolution SOP 的完整快照，后续 SOP 变更不影响
3. **owner_type 特殊路由** — conversation.owner_type="evolution" 触发特殊 prompt 构建路径
4. **不绕过治理** — Evolution Item 必须经过治理对话裁决，不能自动生效
5. **Skill 提交 + API 管理双路径** — Skill 是 Agent 提交候选的入口，API 支持 CRUD 和治理结果写回
6. **FTS5 全文搜索** — title 和 content 索引，支持按 workspace 过滤
7. **来源追溯** — knowledge_library.source_evolution_item_id FK 追溯治理来源

---

## 五、v2 重写待决问题

1. **原子创建是否保留？** 当前 4 条记录的原子事务是否需要调整？
2. **Evolution SOP 是否可配置？** 当前硬编码的单 stage SOP 是否需要支持多 stage 治理流程？
3. **治理对话的 Role 机制？** 当前固定 "演进执行者" + "项目负责人"，是否需要更灵活的角色配置？
4. **候选分类是否入库？** 前端的 type 分类（preference/rule/pattern/lesson/decision）是否需要数据库字段？
5. **治理结果的自动化？** 当前所有结果需人工确认，是否需要部分自动化？
6. **Evolution Item 的状态管理？** 当前无显式状态字段，是否需要（如 draft/governing/resolved/archived）？
7. **批量治理？** 是否需要支持批量候选提交和批量治理？
8. **治理历史和审计？** 是否需要记录治理过程的完整审计日志？
