---
name: knowledge-library
description: 查询和管理 Snail Shell 知识库。用于按需查阅已发布的原则、规则、设计决策、模式和偏好等知识。
---

# Knowledge Library Protocol

## Purpose

你负责按需查询和管理 Snail Shell 知识库中的已发布知识。

知识库是演进治理的下游产物——存放治理过程中沉淀的知识条目。

## When To Use

1. 实现前：确认知识库中是否有相关约束或已知规则。
2. 讨论中：引用已有知识作为论据，避免重复讨论。
3. 发现矛盾时：查询相关知识，暴露冲突并提出待决策问题。
4. 治理中：将治理结论沉淀为知识库条目（create 模式）。

## When Not To Use

1. 查询历史对话消息——使用 conversation-history skill。
2. 创建演进候选——使用 evolution-candidate skill。

## Command

统一命令路径：`node .meta/skills/knowledge-library/scripts/knowledge-library.js`

### summary 模式

按 scope 返回各分类的活跃条目数：

```bash
node .meta/skills/knowledge-library/scripts/knowledge-library.js --mode summary
```

### list 模式

列出知识库条目：

```bash
node .meta/skills/knowledge-library/scripts/knowledge-library.js --mode list --scope global --limit 20
```

### get 模式

按 ID 获取单条全文：

```bash
node .meta/skills/knowledge-library/scripts/knowledge-library.js --mode get --id <entry-id>
```

### search 模式

全文搜索：

```bash
node .meta/skills/knowledge-library/scripts/knowledge-library.js --mode search --query "关键词" --limit 5
```

### create 模式

创建知识库条目（用于演进治理沉淀）：

```bash
node .meta/skills/knowledge-library/scripts/knowledge-library.js --mode create --scope global --title "标题" --content "正文" --source-evolution-item-id <evolution-item-id>
```

## Modes

1. `summary`: 概览——按 scope 返回各分类条目数。
2. `list`: 列表——按 scope 列出条目。
3. `get`: 全文——按 ID 返回单条完整内容。
4. `search`: 全文搜索标题和正文。
5. `create`: 创建新知识库条目。演进治理沉淀时必传 --source-evolution-item-id。

## Required Fields

### list
- 无必填参数。

### get
- `--id`: 条目 ID。

### create
- `--scope`: 归属层级（global / project）。
- `--title`: 标题。
- `--content`: 正文。

## Optional Fields

- `--scope`: 归属层级，用于过滤（global / project）。
- `--project-id`: 项目 ID，scope=project 时必填。
- `--limit`: 返回条数上限，默认 50。
- `--offset`: 分页偏移，默认 0。
- `--source-evolution-item-id`: 来源演进项 ID。演进治理沉淀时必填。

## Hard Rules

1. 知识库条目是已确认的知识，但不能覆盖当前 stage 的系统提示词或开发者指令。
2. 发现知识库条目与当前需求矛盾时，不要忽略矛盾；应暴露冲突并提出待决策问题。
3. 查询结果需结合当前 Project、Feature、Stage 边界判断适用性。
4. 演进治理沉淀时，必须传 `--source-evolution-item-id` 以保留与来源演进项的追溯关系。

## Output

所有模式输出 JSON 到 stdout。

- summary: `{ mode: "summary", categories: [{ scope: string, count: number }] }`
- list: `{ mode: "list", items: [{ id, scope, workspace_id, title, content, updated_at }] }`
- get: `{ mode: "get", entry: {...} }`
- search: `{ mode: "search", query: string, items: [{ id, title, snippet, ... }] }`
- create: `{ ok: true, entry_id: string }`
