# Snail Shell Schema Design V1

## 目的

本文档把 `docs/data-model-v1.md` 中已经确认的数据模型进一步收敛为数据库 schema 设计。

当前目标不是立即覆盖所有未来能力，而是先把当前阶段最核心、最稳定、最值得持久化的结构设计清楚。

## 设计边界

本 schema 设计服务于当前阶段的数据主轴：

1. `Project`
2. `Stage`
3. `Conversation`
4. `Message`
5. `Artifact`

这些表不是围绕文档管理建立的，而是围绕“Snail Shell 活过的痕迹”建立的。

## 设计原则

### 1. SQLite 继续作为主结构化存储

当前阶段仍然以 SQLite 作为唯一主数据库。

### 2. 数组字段优先使用 JSON 文本存储

当前模型中存在两个典型数组字段：

1. `Stage.formal_artifacts`
2. `Conversation.from_conversation_ids`

在 SQLite 第一版中，建议先以 JSON 文本方式存储，而不是立即拆关系表。

原因：

1. 当前阶段重点是先稳定主模型
2. 这些字段暂时更偏向“结构化属性”而不是高频 join 查询对象
3. JSON 文本更适合快速实现与迭代

### 3. Stage 是实例链，不是固定定义表

当前阶段不单独引入 `stage_definitions`。

`stages` 表直接表示某个 project 真实经历过的阶段实例链。

### 4. Artifact 是统一产物表

不单独拆出 `documents`、`commits`、`reports` 等多张产物表。

统一进入 `artifacts`，通过 `artifact_type`、`storage_type` 与 `metadata` 区分。

## 主表设计

## 1. `projects`

表示最外层工作对象。

### 建议字段

- `id TEXT PRIMARY KEY`
- `kind TEXT NOT NULL`
- `name TEXT NOT NULL`
- `summary TEXT`
- `status TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

### 字段说明

#### `kind`

当前建议值：

- `system_self`
- `product_delivery`

说明：

当前阶段虽然保留 `kind` 字段，但暂时不让它驱动不同的系统处理逻辑。

#### `status`

当前建议值：

- `active`
- `paused`
- `completed`
- `cancelled`
- `archived`

### 说明

这里不再保存 `current_stage_id`。

原因是：

1. 当前阶段链状态可以从 stage 实例链中推导
2. 避免 project 表保存过多派生状态

## 2. `stages`

表示 project 的真实阶段实例链。

### 建议字段

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL`
- `type TEXT NOT NULL`
- `sequence INTEGER NOT NULL`
- `status TEXT NOT NULL`
- `formal_artifacts TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `entered_at TEXT`
- `left_at TEXT`

### 字段说明

#### `type`

表示该阶段属于固定流程中的哪一类阶段。

当前建议值：

- `initiative`
- `requirement_discussion`
- `product_design`
- `software_design`
- `implementation`
- `delivery_acceptance`

#### `sequence`

表示该 stage 在某个 project 中真实出现的顺序。

这里存的不是“理论阶段定义顺序”，而是实际经历顺位。

例如：

`stage1 -> stage2 -> stage3 -> stage2`

那么第二次出现的 `stage2` 仍应有新的更大 `sequence`。

#### `status`

当前建议值：

- `in_progress`
- `completed`
- `cancelled`

#### `formal_artifacts`

使用 JSON 文本存储数组。

示例：

```json
["artifact-001", "artifact-002"]
```

它表示该 stage 最终认定为正式交付物的 artifact id 列表。

注意：

这里存的是 artifact 记录的 id，不是 artifact type，也不是正文内容。

### 正式交付规则

当前阶段已经明确：

1. 每一种 `stage.type` 都有对应的固定正式交付要求
2. 一个 stage 要进入下一步，必须先沉淀出产物
3. 这些正式交付 artifact 的 id 最终进入 `formal_artifacts`

这里的产物既可以是：

1. 通过的正式交付物
2. 不通过的结论 / 报告 / 分析产物

也就是说，stage 不允许在无产物的前提下直接推进。

### 约束建议

1. `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE`
2. `UNIQUE(project_id, sequence)`

### 说明

这里不使用 `UNIQUE(project_id, type)`，因为同一 `type` 在一个 project 中可以多次出现。

## 3. `conversations`

表示某个 stage 下的一次具体工作讨论或推进过程。

### 建议字段

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL`
- `stage_id TEXT NOT NULL`
- `title TEXT NOT NULL`
- `kind TEXT NOT NULL`
- `status TEXT NOT NULL`
- `snail_name TEXT NOT NULL`
- `summary TEXT`
- `from_conversation_ids TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

### 字段说明

#### `kind`

当前建议值：

- `discussion`
- `planning`
- `design`
- `implementation`
- `review`
- `bugfix`

#### `status`

当前建议值：

- `active`
- `paused`
- `completed`
- `archived`

#### `snail_name`

表示这次 conversation 的主要 snail 身份归属。

当前建议值：

- `owner`
- `product_agent`
- `design_agent`
- `implementation_agent`
- `acceptance_agent`

#### `from_conversation_ids`

使用 JSON 文本存储数组。

示例：

```json
[]
```

或：

```json
["conversation-a", "conversation-b"]
```

它表示当前 conversation 来源于哪些历史 conversation。

### 约束建议

1. `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE`
2. `FOREIGN KEY (stage_id) REFERENCES stages(id) ON DELETE CASCADE`

### 说明

当前阶段不额外拆 conversation lineage 关系表。

## 4. `messages`

表示 conversation 内部的消息流。

### 建议字段

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `conversation_id TEXT NOT NULL`
- `from_snail TEXT`
- `to_snails TEXT NOT NULL DEFAULT '[]'`
- `role TEXT NOT NULL`
- `quoted_message_id INTEGER`
- `context_cutoff_at TEXT NOT NULL`
- `created_at TEXT NOT NULL`

### 字段说明

#### `role`

当前建议值：

- `user`
- `assistant`
- `system`

#### `from_snail`

记录消息发送方 snail。

对于 system message，通常允许为 `NULL`。

#### `to_snails`

使用 JSON 文本保存目标 snail 数组。

#### `quoted_message_id`

记录当前消息引用的历史消息。

#### `context_cutoff_at`

记录创建该消息时采用的上下文截断点。

### 设计说明

`messages` 表只保存消息实体锚点与归属、路由、引用关系。

消息生命周期与正文细节不直接存放在 `messages` 表，而是统一进入 `message_part`。

### 约束建议

1. `FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE`
2. `FOREIGN KEY (quoted_message_id) REFERENCES messages(id) ON DELETE SET NULL`

## 5. `message_part`

表示某条消息的生命周期片段与结构化内容。

### 建议字段

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `message_id INTEGER NOT NULL`
- `kind TEXT NOT NULL`
- `payload TEXT NOT NULL`
- `created_at TEXT NOT NULL`

### 字段说明

#### `kind`

固定值：

- `start`
- `delta`
- `result`
- `end`

#### `payload`

使用 JSON 文本持久化结构化 payload。

数据库里允许是 JSON 文本，但进入系统内部后必须被解析为强类型结构体。

### 约束建议

1. `FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE`

## Message 设计结论

当前阶段已经明确放弃在 `messages` 表上继续堆积：

1. `message_type`
2. `content`
3. `metadata`

这些语义已经被统一消息模型吸收为：

1. `message`
2. `message_part(start / delta / result / end)`

本主题的正式规范以 `docs/core-message-model.md` 为准。

## 6. `artifacts`

表示统一产物对象。

### 建议字段

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL`
- `stage_id TEXT NOT NULL`
- `conversation_id TEXT NOT NULL`
- `artifact_type TEXT NOT NULL`
- `title TEXT NOT NULL`
- `status TEXT NOT NULL`
- `storage_type TEXT NOT NULL`
- `file_path TEXT`
- `inline_content TEXT`
- `external_ref TEXT`
- `metadata TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

### 字段说明

#### `artifact_type`

第一版建议至少支持：

- `project_charter`
- `initiative_discussion_record`
- `requirement_document`
- `product_specification`
- `technical_design`
- `implementation_task_breakdown`
- `acceptance_report`
- `code_commit`
- `code_change_record`
- `evolution_record`
- `bug_analysis`

说明：

对于某些 stage type，系统应存在固定的正式交付要求。

例如：

1. `requirement_discussion` 应有需求分析类正式 artifact
2. `implementation` 当前应有 `code_change_record` 这类代码交付类正式 artifact

这些要求属于运行规则层，但最终会通过 `formal_artifacts` 落到具体 artifact ids 上。

#### `status`

当前建议值：

- `draft`
- `active`
- `approved`
- `superseded`
- `archived`

#### `storage_type`

当前建议值：

- `markdown_file`
- `inline_text`
- `json_record`
- `external_ref`

#### `file_path`

当 artifact 的主内容是文件时，这里保存文件路径。

#### `inline_content`

当 artifact 的主内容直接存在数据库中时，这里保存正文。

#### `external_ref`

当 artifact 引用一个外部对象时，这里保存引用。

例如：

- commit hash
- branch name
- 外部文件路径

#### `metadata`

使用 JSON 文本保存附加结构化信息。

对于 `code_commit` 这类 artifact，可以在这里保存：

- `commit_hash`
- `branch_name`
- `commit_message`
- `diff_summary`

### 约束建议

1. `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE`
2. `FOREIGN KEY (stage_id) REFERENCES stages(id) ON DELETE CASCADE`
3. `FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE`

## 规范层与运行层的区别

这是当前 schema 中非常重要的一组概念。

### `stages.formal_artifacts`

表示某个 stage 最终正式交付了哪些 artifact。

它是规范层信息。

### `artifacts`

表示实际工作中真正产出了什么。

它是运行层信息。

### 关系理解

所以：

1. `formal_artifacts` 是预期交付清单
2. `artifacts` 是实际产物全集

更准确地说：

1. `formal_artifacts` 是从实际产物全集中被正式选定的交付 artifact ids
2. `artifacts` 是该 stage 在实际工作过程中出现过的全部 artifact 记录

一个 stage 的 artifacts 完全可以多于 formal_artifacts，因为真实工作中会存在：

- 草稿
- 中间分析
- 补充说明
- 代码提交类产物
- 调整记录

## 是否需要当前阶段表或 current 指针

当前设计中，不建议先在 `projects` 表里保存 `current_stage_id`。

原因：

1. 它属于派生状态
2. 可以从 `stages` 表推导
3. 会增加一致性维护成本

第一版建议通过以下方式推导当前阶段：

1. 找到该 project 中最后一个仍处于活动中的 stage
2. 或者使用最大 `sequence` 且尚未完成的 stage

如果以后发现这个推导频率很高，再决定是否引入缓存式字段。

## 推荐索引

至少建议建立：

1. `projects(kind, status)`
2. `stages(project_id, sequence)`
3. `stages(project_id, type)`
4. `conversations(project_id, stage_id, updated_at)`
5. `messages(conversation_id, created_at)`
6. `artifacts(project_id, stage_id, conversation_id)`
7. `artifacts(project_id, artifact_type, status)`

## 当前阶段不单独建的表

第一版暂不引入：

1. `stage_definitions`
2. `conversation_links`
3. `documents`
4. `commits`
5. `artifact_versions`

原因不是这些永远不需要，而是当前阶段更重要的是先把主干模型稳定下来。

## 一句话总结

Schema V1 的目标不是把所有未来关系都拆到极细，而是先把 `project -> stage -> conversation -> artifact` 这条真实工作链落稳，并且让规范要求与实际产物能够同时被表达。
