# Snail Shell Knowledge Index Model

## 目的

本文档定义 Snail Shell 知识体系的索引层模型。

这里的“知识索引层”指的是：

- 文档不是孤立文件
- session 不是孤立对话
- project 不是孤立工作对象

而是要通过数据库中的结构化索引，把它们连接成一条可查询、可回溯、可扩展的知识网络。

## 核心定位

Snail Shell 的知识体系分两层：

1. 文档内容层
   使用 markdown 或其他文件形式保存长文本和非结构化内容。

2. 数据库索引层
   使用结构化记录保存文档、session、project、artifact 之间的关系。

数据库索引层不是用来替代文档正文，而是用来回答这些问题：

- 某个知识条目在哪里
- 它和哪些 session 有关
- 它和哪些 project 有关
- 它属于什么 change type
- 它是否替代了其他文档
- 它处于哪条演进链上

## 设计原则

### 1. 数据库是索引主层，不是正文主层

数据库应存储结构化元数据和关系，而不是把 markdown 正文本身作为唯一知识承载体。

### 2. 文件是内容载体，不是检索主入口

文件负责保存长文本内容，但不承担主要检索职责。

### 3. 文档与 session 必须可以双向追溯

未来必须支持：

1. 从某篇文档找到其来源 session
2. 从某个 session 找到其产出的文档

### 4. 模型必须同时服务两类知识

该模型不只服务 `docs/evolution/`。

它未来还应服务另一类知识：Snail Shell 工作产出的项目全过程知识。

因此索引模型不能只针对当前这一批 evolution docs 写死，而应保留扩展空间。

## 索引对象范围

知识索引层第一阶段至少要覆盖：

1. 演进文档
2. 相关 session
3. 相关 project
4. 相关 artifact
5. 文档之间的引用与替代关系

## 核心实体

建议引入三个核心表，作为第一版知识索引层。

## 1. `knowledge_documents`

表示一个被纳入知识体系索引的文档。

它不负责保存全文正文，但负责保存：

- 这个文档是谁
- 它的文件路径是什么
- 它属于哪类变更
- 它属于哪类知识文档
- 它是否仍然有效

### 建议字段

- `id TEXT PRIMARY KEY`
- `scope TEXT NOT NULL`
- `title TEXT NOT NULL`
- `file_path TEXT NOT NULL UNIQUE`
- `change_type TEXT NOT NULL`
- `document_type TEXT NOT NULL`
- `status TEXT NOT NULL`
- `summary TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `source_created_at TEXT`
- `source_updated_at TEXT`

### 字段说明

#### `scope`

用来区分该文档属于哪一类知识域。

第一阶段建议值：

- `snail_shell_evolution`
- `project_delivery`

当前 `docs/evolution/` 下的文档都属于：

- `snail_shell_evolution`

这样未来产品项目知识不需要另起一套完全不同的索引模型。

#### `change_type`

用于记录文件名中体现的变更类型。

当前建议值：

- `New-Feature`
- `Feature-Update`
- `Bugfix`

#### `document_type`

用于记录更细粒度的文档内部类型。

例如：

- `decision_record`
- `design_rationale`
- `round_record`
- `milestone_record`
- `evolution_summary`

#### `status`

用于表示当前文档是否仍是有效文档。

建议值：

- `active`
- `superseded`
- `archived`

#### `summary`

用于快速搜索和列表展示。

它不是正文替代品，只是一个短摘要。

## 2. `knowledge_document_links`

表示文档与文档之间的结构化关系。

### 建议字段

- `id TEXT PRIMARY KEY`
- `source_document_id TEXT NOT NULL`
- `target_document_id TEXT NOT NULL`
- `link_type TEXT NOT NULL`
- `created_at TEXT NOT NULL`

### 建议 `link_type`

- `references`
- `depends_on`
- `supersedes`
- `related_to`

### 作用

这个表用于表达：

1. 一篇文档引用另一篇文档
2. 一篇文档依赖另一篇文档
3. 一篇文档替代另一篇文档
4. 两篇文档存在弱相关关系

这样可以避免把文档关系只写死在 markdown 正文里，而没有结构化索引。

## 3. `knowledge_document_relations`

表示文档与非文档对象之间的关系。

这是关键表，因为 session、project、artifact 都不是 document，但都需要与 document 建立索引关系。

### 建议字段

- `id TEXT PRIMARY KEY`
- `document_id TEXT NOT NULL`
- `relation_type TEXT NOT NULL`
- `target_kind TEXT NOT NULL`
- `target_id TEXT NOT NULL`
- `created_at TEXT NOT NULL`

### 建议 `target_kind`

- `session`
- `project`
- `artifact`

### 建议 `relation_type`

- `derived_from_session`
- `discussed_in_session`
- `belongs_to_project`
- `describes_artifact`
- `related_artifact`

### 作用

这个表用于表达：

1. 一份文档来自哪些 session
2. 一份文档属于哪个 project
3. 一份文档和哪个 artifact 有直接关系

## 为什么不拆成很多专门关系表

例如可以想象单独建：

- `knowledge_document_sessions`
- `knowledge_document_projects`
- `knowledge_document_artifacts`

但第一版不建议这样做。

原因是：

1. 当前关系类型还在增长
2. 先做统一 relation 表更容易迭代
3. 等关系稳定到足够复杂时，再拆专门表也不迟

## 第一版建议表结构总结

第一版知识索引层建议只新增三张表：

1. `knowledge_documents`
2. `knowledge_document_links`
3. `knowledge_document_relations`

这已经足够支撑：

- 文档索引
- 文档与 session 关联
- 文档与 project 关联
- 文档与 artifact 关联
- 文档之间的 supersedes / references 关系

## 与当前模型的关系

知识索引层不是替代当前的 project / session / artifact 模型，而是建立在其上。

现有模型负责保存：

- 项目工作过程
- 对话记录
- artifact 记录

知识索引层负责把这些对象与文档组织成可回溯知识网络。

也就是说：

1. `projects` 仍然表示工作对象
2. `sessions` 仍然表示对话对象
3. `artifacts` 仍然表示工作产物对象
4. `knowledge_documents` 表示知识文档对象
5. `knowledge_document_relations` 负责把四者连接起来

## 第一版写入流程建议

当一份文档被纳入知识体系时，建议流程是：

1. 文件已经存在于文件系统
2. 系统读取其 metadata
3. 在 `knowledge_documents` 中创建或更新索引记录
4. 把 `related_sessions` 写入 `knowledge_document_relations`
5. 把 `related_docs` 写入 `knowledge_document_links`
6. 把 project 或 artifact 关联写入 `knowledge_document_relations`

这意味着：

数据库是从文件内容中提取结构化索引，而不是反过来让文档只能从数据库生成。

## 与文件 metadata 的关系

Markdown metadata block 应作为知识索引层的输入源之一。

例如当前文档头部中已经有：

- `title`
- `change_type`
- `document_type`
- `status`
- `created_at`
- `updated_at`
- `related_sessions`
- `related_docs`
- `supersedes`

这些字段未来可以作为索引入库的来源。

数据库记录不应盲目覆盖文件 metadata，而应以受控同步方式处理。

## 第一版不做什么

第一版知识索引层不需要立即解决以下问题：

1. 全文搜索引擎
2. 自动语义标签生成
3. 文档版本 diff 管理
4. 自动从所有 markdown 实时扫描同步
5. 多用户权限控制

当前重点只是先把“结构化索引关系”建立起来。

## 推荐索引字段

至少应建立这些索引：

1. `knowledge_documents(scope, change_type, source_created_at)`
2. `knowledge_documents(file_path)`
3. `knowledge_documents(status)`
4. `knowledge_document_links(source_document_id, link_type)`
5. `knowledge_document_links(target_document_id, link_type)`
6. `knowledge_document_relations(document_id, target_kind)`
7. `knowledge_document_relations(target_kind, target_id)`

## 一个最小示例

例如一份文档：

`docs/evolution/[20260403][Feature-Update]conversation-centered-workspace.md`

可能在数据库中表现为：

### `knowledge_documents`

- `scope = snail_shell_evolution`
- `title = 对话居中的工作区`
- `file_path = docs/evolution/[20260403][Feature-Update]conversation-centered-workspace.md`
- `change_type = Feature-Update`
- `document_type = design_rationale`

### `knowledge_document_relations`

- `document_id -> session_id` with `relation_type = derived_from_session`
- `document_id -> project_id` with `relation_type = belongs_to_project` if relevant

### `knowledge_document_links`

- `document_id -> implementation-plan-v1` with `link_type = references`

## 最终判断标准

如果某个模型设计能同时满足下面几点，就说明它符合 Snail Shell 的知识索引目标：

1. 文档能被结构化检索
2. 文档能回链到 session
3. 文档能挂接到 project 和 artifact
4. 文档之间的关系可追踪
5. 数据库与文件系统各自职责清晰

如果做不到这几点，说明它还不够像一个真正的知识索引层。
