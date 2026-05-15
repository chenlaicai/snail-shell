# F2026051502 设计决策库

## 背景

`docs/core` 文档因代码重构频繁 drift，维护成本高且容易过时。讨论结论：

- **代码 = what**：代码描述系统怎么做
- **设计决策 = why**：记录系统为什么这样做

已有知识中心模块提供完整的知识治理飞轮（候选提取 → 入口校验 → 查重 → 场景分类 → 裁决 → 产物），但产物目标仅限系统提示词、技能、文档等。需要新增"设计决策"作为治理的又一个正式产物类型，建立可查询的设计决策库。

## 目标

1. 新增 `design_decision` 表，存储治理产出的正式设计决策
2. 新增 `design-decision` skill，提供增删改查能力
3. 系统提示词新增 S-07 引用该 skill，供日常工作中查阅
4. 知识治理新增 `design_decision_entry` 作为有效 artifact_type
5. 项目级范围隔离，每个项目各自维护决策库

## 非目标

1. 替代代码注释中的 why 说明
2. 自动生成设计决策（必须由 AI+人在治理对话中协作完成）
3. 系统提示词直接读取决策表（只引用 skill，不直接碰 DB）

## 设计

### 全链路

```
知识治理对话（F-02 提示词说明 design_decision_entry 为有效产物类型）
  ↓ AI+人协作决定沉淀为设计决策 → AI 使用 design-decision skill 写入
design_decision 表
  ↓
design-decision skill（增删改查）
  ↓
S-07 系统提示词（skill_references 引用，供日常工作中查询）
```

### 数据模型

#### `design_decision` 表

| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | UUID |
| project_id | TEXT FK | 所属项目，NULL 表示全局 |
| scope_type | TEXT | 作用域类型（如 module、feature、architecture） |
| scope_ref | TEXT | 作用域引用（如模块名、特性名） |
| title | TEXT | 决策标题 |
| content | TEXT | 决策内容（why + what + 约束） |
| status | TEXT | active / superseded / deprecated |
| source_knowledge_id | TEXT FK | 来源知识条目 ID |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

#### `design_decision_search` FTS5 虚拟表

对 title 和 content 建立全文索引，支持snippet 提取。

### Skill 设计

`design-decision` skill 支持五种模式：

| 模式 | 说明 | 必需参数 |
|---|---|---|
| search | FTS 全文搜索 | `--query` |
| list | 条件过滤列表 | 无（可选 `--project-id`, `--scope-type`, `--status` 等） |
| get | 按 ID 精确获取 | `--id` |
| create | 创建新决策 | `--title`, `--content`, `--scope-type` |
| deprecate | 废弃决策 | `--id` |

所有查询模式默认按 `--project-id` 过滤，确保项目级范围隔离。

### 系统提示词集成

S-07 提示词声明 `skill_references` 指向 `design-decision` skill（mode: conditional），描述能力边界和使用时机：

- 实现前确认约束
- 检视时验证一致性
- 讨论中引用已有决策
- 发现矛盾时暴露冲突

F-01（项目推进会话）和 F-02（知识治理对话）架子均引用 S-07。

### 知识治理集成

F-02 架子的知识治理上下文段落新增 `design_decision_entry` 作为有效的 `artifact_type`。治理对话中 AI+人协作完成决策后，AI 通过 skill 的 create 模式写入决策表，治理流程回写 disposition 状态。

## 改动范围

### 新增文件

1. `src/shared/design-decision-types.ts` - 类型定义
2. `src/persistence/design-decision-model.ts` - 数据模型（CRUD + FTS）
3. `src/knowledge-center/design-decision-service.ts` - 服务层
4. `src/bin/design-decision.ts` - CLI 入口
5. `.meta/skills/design-decision/SKILL.md` - 技能定义
6. `.meta/skills/design-decision/design-decision` - Shell wrapper
7. `.meta/prompts/prompts/S-07-设计决策能力.md` - 提示词

### 修改文件

1. `src/persistence/schema.ts` - 新增 `design_decision` 表和索引
2. `src/shared/knowledge-types.ts` - `KnowledgeGovernanceArtifactType` 新增 `design_decision_entry`
3. `src/persistence/store.ts` - 集成 `DesignDecisionModel`
4. `src/knowledge-center/index.ts` - 新增 re-export
5. `src/prompt-center/builder.ts` - `buildProjectVariables` 新增 `project_id`
6. `.meta/prompts/frames/F-01-project-conversation.md` - 引用 S-07
7. `.meta/prompts/frames/F-02-knowledge-governance.md` - 引用 S-07 + 补充 artifact_type 说明

## 验证

1. `npm run build` 编译通过
2. 启动后 `design_decision` 和 `design_decision_search` 表自动创建
3. `design-decision --mode search --project-id <id> --query "xxx"` 返回 FTS 搜索结果
4. `design-decision --mode create --title "..." --content "..." --scope-type module` 写入成功
5. 系统提示词中出现 S-07 的 Skill References 段落
6. F-02 治理提示词中 `design_decision_entry` 作为有效 artifact_type 出现

## 风险与决策记录

### 决策 1：独立表而非扩展知识表

**选择**：新建 `design_decision` 表，不复用 `knowledge_item` 表

**原因**：知识表本质是候选数据，设计决策是治理后的正式产物，数据模型和生命周期不同

**代价**：需要新建 model、service、CLI

### 决策 2：治理写入走 skill 而非代码

**选择**：治理对话中 AI 通过 skill 写入，不在 `updateGovernance()` 代码中自动写入

**原因**：设计决策需要 AI+人协作判断，不能自动沉淀

**代价**：依赖 AI 正确调用 skill

### 决策 3：source_knowledge_id 可选

**选择**：`source_knowledge_id` 允许 NULL，知识治理沉淀时必填，非治理场景可省略

**原因**：并非所有设计决策都经过知识治理流程，团队可能直接记录决策；强制关联会限制使用场景

**代价**：无法在数据库层面强制"每条决策必须有来源知识"的约束

### 决策 4：系统提示词只引用 skill

**选择**：S-07 只声明 skill_references，不直接查询决策表

**原因**：保持提示词层与数据层解耦，由 skill 封装数据访问

**代价**：AI 需要额外一步调用 skill 才能获取决策内容
