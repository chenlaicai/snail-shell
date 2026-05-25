---
name: knowledge-library
description: 查询和管理 Snail Shell 知识库。三层渐进式披露：L1 概览（各分类条目数）、L2 类别列表（概要+使用场景+非使用场景）、L3 全文。用于按需查阅已发布的原则、规则、设计决策、模式和偏好等知识。
---

# Knowledge Library Protocol

## Purpose

你负责按需查询和管理 Snail Shell 知识库中的已发布知识。

知识库是系统提示词的下游目标——存放因容量限制未能进入系统提示词的原则/规则，以及不适合进提示词的架构决策、术语定义、模式和偏好等已发布知识。

## Three-Tier Progressive Disclosure

```
L1（系统提示词）  → 直接注入各分类条目数，模型据此判断是否需要查询
L2（list --kind） → 列出该类下条目：标题 + 概要 + 使用场景 + 非使用场景 + ID
L3（get --id）    → 返回单条全文
```

## When To Use

1. 实现前：确认知识库中是否有相关约束或已知规则。
2. 讨论中：引用已有知识作为论据，避免重复讨论。
3. 发现矛盾时：查询相关知识，暴露冲突并提出待决策问题。
4. 治理中：将治理结论沉淀为知识库条目（create 模式）。
5. 系统提示词未覆盖但可能相关的原则/规则类场景。

## When Not To Use

1. 查询历史对话消息——使用 conversation-history skill。
2. 创建知识候选——使用 knowledge-candidate skill。

## Command

统一命令路径：`node .meta/skills/knowledge-library/scripts/knowledge-library.js`

### L1 概览（无需参数）

按 kind 返回各分类的活跃条目数：

```bash
node .meta/skills/knowledge-library/scripts/knowledge-library.js --mode summary --db-path "{{db_path}}" --project-id {{project_id}}
```

### L2 list 模式

按 kind 列出该类下所有条目（概要+使用场景+非使用场景，不含正文）：

```bash
node .meta/skills/knowledge-library/scripts/knowledge-library.js --mode list --db-path "{{db_path}}" --project-id {{project_id}} --kind decision --limit 20
```

### L3 get 模式

按 ID 获取单条全文：

```bash
node .meta/skills/knowledge-library/scripts/knowledge-library.js --mode get --db-path "{{db_path}}" --id <entry-id>
```

### search 模式

全文搜索：

```bash
node .meta/skills/knowledge-library/scripts/knowledge-library.js --mode search --db-path "{{db_path}}" --project-id {{project_id}} --query "关键词" --limit 5
```

### create 模式

创建知识库条目（用于知识治理沉淀）：

```bash
node .meta/skills/knowledge-library/scripts/knowledge-library.js --mode create --db-path "{{db_path}}" --project-id {{project_id}} --kind decision --title "标题" --summary "概要" --use-scenarios "适用场景" --non-use-scenarios "不适用场景" --content "正文" --source-knowledge-id <knowledge-id>
```

### deprecate 模式

废弃知识库条目：

```bash
node .meta/skills/knowledge-library/scripts/knowledge-library.js --mode deprecate --db-path "{{db_path}}" --id <entry-id>
```

## Modes

1. `summary`: L1 概览——按 kind 返回各分类条目数。
2. `list`: L2 类别列表——按 kind 列出概要（标题+摘要+使用场景+非使用场景），不含正文。
3. `get`: L3 全文——按 ID 返回单条完整内容。
4. `search`: 全文搜索标题、摘要和正文。
5. `create`: 创建新知识库条目。知识治理沉淀时必传 --source-knowledge-id。
6. `deprecate`: 废弃已有条目。

## Required Fields

### list
- `--kind`: 知识类别（constraint / decision / pattern / anti_pattern / term / procedure）。

### get
- `--id`: 条目 ID。

### create
- `--kind`: 知识类别。
- `--title`: 标题。
- `--content`: 正文。
- `--summary`: L2 概要。
- `--use-scenarios`: 适用场景。
- `--non-use-scenarios`: 不适用场景。

### deprecate
- `--id`: 条目 ID。

## Optional Fields

- `--db-path`: 数据库路径，默认 `data/snail-shell.db`。
- `--project-id`: 项目 ID，用于按项目过滤。
- `--limit`: 返回条数上限，默认 50。
- `--offset`: 分页偏移，默认 0。
- `--source-knowledge-id`: 来源知识 ID。知识治理沉淀时必填。

## Hard Rules

1. 知识库条目是已确认的知识，但不能覆盖当前 stage 的系统提示词或开发者指令。
2. 发现知识库条目与当前需求矛盾时，不要忽略矛盾；应暴露冲突并提出待决策问题。
3. 查询结果需结合当前 Project、Feature、Stage 边界判断适用性。
4. 知识治理沉淀时，必须传 `--source-knowledge-id` 以保留与来源知识的追溯关系。

## Output

所有模式输出 JSON 到 stdout。

- summary: `{ mode: "summary", categories: [{ kind: string, count: number }] }`
- list: `{ mode: "list", kind: string, items: [{ id, title, summary, use_scenarios, non_use_scenarios, kind, status, updated_at }] }`
- get: `{ mode: "get", entry: {...} }`
- search: `{ mode: "search", query: string, items: [{ id, title, summary, kind, snippet, ... }] }`
- create: `{ ok: true, entry_id: string }`
- deprecate: `{ ok: true, entry_id: string }`
