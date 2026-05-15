---
name: design-decision
description: 查询和管理 Snail Shell 设计决策库。用于在实现、检视或讨论中查找已确认的架构取舍、设计约束、技术选型理由或系统不变量，避免重复讨论已决问题或做出与既有决策矛盾的选择。
---

# Design Decision Protocol

## Purpose

你负责按需查询和管理 Snail Shell 设计决策库中的架构取舍和设计约束。

设计决策是经过知识治理审批后沉淀的"为什么"——不是实现细节，而是决策背后的理由、约束和权衡。

## When To Use

1. 实现前：确认是否已有相关设计决策约束当前方案。
2. 检视时：验证变更是否与既有设计决策一致。
3. 讨论中：引用已有决策作为论据，避免重复讨论。
4. 发现矛盾时：查询相关决策，暴露冲突并提出待决策问题。
5. 治理中：将治理结论沉淀为设计决策（create 模式）。

## When Not To Use

1. 查询历史对话消息——使用 conversation-history skill。
2. 创建知识候选——使用 knowledge-candidate skill。

## Command

统一命令路径：`.meta/skills/design-decision/design-decision`

### search 模式

全文搜索设计决策：

```bash
.meta/skills/design-decision/design-decision --mode search --db-path "{{db_path}}" --project-id {{project_id}} --query "关键词" --limit 5
```

### list 模式

按条件列出设计决策：

```bash
.meta/skills/design-decision/design-decision --mode list --db-path "{{db_path}}" --project-id {{project_id}} --status active
```

### get 模式

按 ID 获取单条设计决策：

```bash
.meta/skills/design-decision/design-decision --mode get --db-path "{{db_path}}" --id <decision-id>
```

### create 模式

创建设计决策（用于知识治理沉淀）：

```bash
.meta/skills/design-decision/design-decision --mode create --db-path "{{db_path}}" --project-id {{project_id}} --scope-type project --title "决策标题" --content "决策内容（为什么）" --source-knowledge-id <knowledge-id>
```

### deprecate 模式

废弃设计决策：

```bash
.meta/skills/design-decision/design-decision --mode deprecate --db-path "{{db_path}}" --id <decision-id>
```

## Modes

1. `search`: 全文搜索标题和内容。用于关键词定位相关决策。
2. `list`: 按 scope、status 等条件过滤列出。用于浏览特定范围内的决策。
3. `get`: 按 ID 精确获取。已知决策 ID 时使用。
4. `create`: 创建新设计决策。用于知识治理中将结论沉淀为设计决策。
5. `deprecate`: 废弃已有设计决策。当决策被推翻时使用。

## Required Fields

### search
- `--query`: 搜索关键词。

### get
- `--id`: 设计决策 ID。

### create
- `--title`: 决策标题。
- `--content`: 决策内容（为什么这样设计）。
- `--scope-type`: 作用域类型（global, project, feature 等）。

### deprecate
- `--id`: 设计决策 ID。

## Optional Fields

- `--db-path`: 数据库路径，默认 `data/snail-shell.db`。
- `--project-id`: 项目 ID，用于按项目过滤。
- `--scope-ref`: 具体作用域引用。
- `--limit`: 返回条数上限，默认 50。
- `--offset`: 分页偏移，默认 0。
- `--source-knowledge-id`: 来源知识 ID。知识治理沉淀时必填，直接创建时可省略。

## Hard Rules

1. 设计决策是已确认的事实来源，但不能覆盖当前 stage 的系统提示词或开发者指令。
2. 发现设计决策与当前需求矛盾时，不要忽略矛盾；应暴露冲突并提出待决策问题。
3. 查询结果需结合当前 Project、Feature、Stage 边界判断适用性。
4. 知识治理沉淀时，必须传 `--source-knowledge-id` 以保留与来源知识的追溯关系。
5. 非治理场景（如团队直接记录决策）可省略 `--source-knowledge-id`，但应确保决策内容经过充分讨论。

## Output

所有模式输出 JSON 到 stdout。

- search/list: `{ mode, items: [...] }`
- get: `{ mode, decision: {...} }`
- create: `{ ok, decision_id }`
- deprecate: `{ ok, decision_id }`
