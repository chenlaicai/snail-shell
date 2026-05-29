---
id: F2026052805
title: evolution-center
from_ids: []
tags: [evolution, knowledge, refactor]
modules: [evolution]
doc_kind: spec
---

# F2026052805 [evolution] 演进中心模块重构

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

当前"知识中心"模块的本质不止是"知识"，而是一套完整的"自我评估/自我进化机制"：

1. **输入不限于知识**：问题、bug、待演进项、idea 等都是输入
2. **处理方式**：人+AI 共同对话处理，复用项目管理 SOP
3. **输出多样**：项目演进（PR）、知识库沉淀、结论等
4. **归属明确**：演进项必须归属某个项目（project_id 必填）

当前模型以"知识"为核心，导致：
- 名称与功能不符（"知识中心"无法覆盖问题、bug、idea 等）
- 数据模型过于复杂（固定的 kind 枚举、冗余的 scope_type）
- 治理流程与项目管理割裂（独立的 knowledge_governance 表）

## 目标

将"知识中心"重构为"演进中心"，实现：

1. **改名**：knowledge_governance → evolution，统一术语
2. **简化模型**：移除固定枚举，改用 tags；移除冗余表
3. **复用项目管理**：演进项通过 Feature 进入项目管理流程
4. **明确归属**：演进项必须归属某个项目，知识库通过 source 关联

## 非目标

1. 不处理兼容性/迁移（直接改名，不写迁移脚本）
2. 不扩展知识库的 scope（保持 global / project）
3. 不改变项目的 Stage/SOP 机制（演进中心复用现有机制）

## 设计

### P1 详设：数据模型重构

#### EvolutionItem（原 KnowledgeItem）

```typescript
export interface EvolutionItem {
  id: string;
  project_id: string;           // 来源项目（必填）
  feature_id: string | null;    // 关联的 Feature（治理时创建）
  title: string;
  content: string;              // 包含来源信息、背景、上下文等
  tags: string[];               // 标签，替代固定枚举
  metadata: string | null;      // 可选的结构化元数据
  created_at: string;
  updated_at: string;
}
```

**变更说明**：
- 移除 `scope_type`、`scope_ref`、`kind`、`status`、`governance_level`、`rationale`、`created_by`、`approved_by`、`approved_at`
- 移除 `knowledge_source` 表（来源信息记录在 content 中）
- 移除 `knowledge_governance` 表（治理在 Feature Stage 中完成）
- 移除 `knowledge_candidate_review` 表（评审在 Feature Stage 中完成）
- `project_id` 改为必填（string，非 string | null）
- 状态完全依赖 Feature 阶段流转，EvolutionItem 本身不存储 status 字段

#### KnowledgeLibraryEntry（知识库）

```typescript
export interface KnowledgeLibraryEntry {
  id: string;
  scope: "global" | "project";  // 归属层级
  project_id: string | null;    // scope=project 时必填
  title: string;
  content: string;
  source_evolution_item_id: string | null;  // 来源演进项
  created_at: string;
  updated_at: string;
}
```

**变更说明**：
- 移除 `kind`、`summary`、`use_scenarios`、`non_use_scenarios`、`status`
- `source_evolution_item_id` 替代原来的 `source_knowledge_id`
- 知识库条目不存储 status 字段，简化数据模型

### P2 详设：服务层与 API 重构

#### 服务层（evolution-service.ts）

```typescript
// 创建演进项
export function createEvolutionItem(store: ConversationStore, input: CreateEvolutionItemInput): EvolutionItem;

// 查询演进项
export function getEvolutionItem(store: ConversationStore, id: string): EvolutionItem | null;
export function listEvolutionItems(store: ConversationStore, filters: EvolutionItemListFilters): EvolutionItem[];

// 更新演进项（关联 Feature）
export function updateEvolutionItem(store: ConversationStore, id: string, input: UpdateEvolutionItemInput): EvolutionItem;
```

#### API 路由（evolution-routes.ts）

```
POST   /evolution/items          - 创建演进项
GET    /evolution/items          - 查询演进项列表
GET    /evolution/items/:id      - 获取演进项详情
PATCH  /evolution/items/:id      - 更新演进项
```

### P3 详设：项目配置与 Prompt

#### 项目配置（project-config-seed.json）

```json
{
  "project": {
    "id": "evolution-center",
    "module": "evolution",
    "name": "Evolution Center",
    "summary": "Snail Shell 演进中心治理空间。",
    "project_root": "{{process.cwd()}}"
  },
  "sops": [
    {
      "sop_id": "sop-evolution",
      "is_default": true,
      "role_bindings": {
        "evolution-executor": "codex-gpt-5-5"
      }
    }
  ]
}
```

#### SOP 定义

```json
{
  "sop": {
    "id": "sop-evolution",
    "scope": "global",
    "key": "evolution",
    "name": "演进治理流程",
    "description": "演进项治理。"
  },
  "role_definitions": [
    {
      "id": "role-evolution-boss",
      "key": "boss",
      "name": "Boss Role",
      "description": "演进治理对话的决策者，最终确认治理结论。",
      "handbook_prompt_ref": null,
      "working_rules": []
    },
    {
      "id": "role-evolution-executor",
      "key": "evolution-executor",
      "name": "演进执行者",
      "description": "负责演进项的治理对话：入口校验、查重、分析、裁决和必要产物处理",
      "handbook_prompt_ref": "global:S-08",
      "working_rules": [
        "逐条分析演进项的内容、来源、类型和作用域",
        "在已知演进项库中查重，确认是全新、重复还是相关但不重复",
        "确定裁决去向和产物形式，与用户确认后通过演进 API 回写"
      ]
    }
  ],
  "stage_definitions": [
    {
      "id": "evolution-center-development",
      "key": "development",
      "title": "演进治理",
      "sequence": 1,
      "input_description": null,
      "output_description": "完成演进项治理，必要时提交系统提示词、skill、文档、代码或检查器 PR，并回写治理去向。",
      "acceptance_focus": [
        "演进项来源和事实被查证",
        "入口校验、查重、裁决去向已回写",
        "演进项不会绕过治理自动生效"
      ],
      "roles": [
        { "role_key": "boss", "is_primary": true },
        { "role_key": "evolution-executor" }
      ]
    }
  ]
}
```

#### Prompt 变更

- B-02-知识治理.md → B-02-演进治理.md
- S-08-知识执行者手册.md → S-08-演进执行者手册.md

<!-- [design-time] 章节结束 -->

## 改动范围

### 数据模型

- `src/shared/evolution-types.ts`（新增）
- `src/shared/knowledge-types.ts`（移除）
- `src/shared/knowledge-library-types.ts`（简化）
- `src/shared/domain-types.ts`（更新 ProjectModule）
- `src/shared/types.ts`（更新导出）
- `src/persistence/schema.ts`（更新表结构）
- `src/persistence/evolution-model.ts`（新增）
- `src/persistence/knowledge-model.ts`（移除）
- `src/persistence/knowledge-library-model.ts`（简化）

### 服务层

- `src/evolution-center/evolution-service.ts`（新增）
- `src/knowledge-center/knowledge-service.ts`（移除）

### API 路由

- `src/interaction-entry/api/evolution-routes.ts`（新增）
- `src/interaction-entry/api/knowledge-routes.ts`（移除）

### 项目配置

- `.meta/project-config-seed.json`（更新项目和 SOP）

### Prompt

- `.meta/prompts/prompts/B-02-演进治理.md`（新增）
- `.meta/prompts/prompts/B-02-知识治理.md`（移除）
- `.meta/prompts/prompts/S-08-演进执行者手册.md`（新增）
- `.meta/prompts/prompts/S-08-知识执行者手册.md`（移除）

### 测试

- `tests/web/evolution-center-test.ts`（新增）✓
- `tests/web/knowledge-center-test.ts`（移除）✓
- `tests/scripts/knowledge-candidate-test.ts`（移除）✓

## 验证

### P1 验证：数据模型

- [x] evolution_item 表创建成功
- [x] knowledge_item、knowledge_source、knowledge_governance、knowledge_candidate_review 表移除
- [x] knowledge_library 表简化成功
- [x] TypeScript 类型定义正确

### P2 验证：服务层与 API

- [x] 演进项 CRUD API 正常工作
- [x] 知识库 API 正常工作
- [x] 无编译错误

### P3 验证：项目配置与 Prompt

- [x] 演进中心项目创建成功
- [x] SOP 和角色定义正确
- [x] Prompt 文件正确加载

### 通用验证

- [x] 所有测试通过
- [x] 无 TypeScript 编译错误
- [x] 无 ESLint 错误

## 关联

- **前置**: 无

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | 是否保留兼容性/迁移 | 不保留，直接改名 | 2026-05-28 |
| 2 | 演进项是否需要固定 kind 枚举 | 不需要，改用 tags | 2026-05-28 |
| 3 | 治理流程是否独立 | 不独立，复用 Feature Stage | 2026-05-28 |
| 4 | 知识库 scope 是否扩展 | 不扩展，保持 global / project | 2026-05-28 |

## 范围变更记录

无
