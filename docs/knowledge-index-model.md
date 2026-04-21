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

## Stage 自动知识提案索引

在当前版本中，知识索引层补充一类新的内建索引对象：

- `knowledge_proposals`

它的定位不是正式知识正文，而是 stage 收尾时由系统自动识别、等待用户确认的知识候选。

### 设计目的

它用于回答这些问题：

- 本轮 stage 识别出了哪些可沉淀知识
- 每条候选来自哪些 conversation 和 artifact
- 系统建议它属于哪类知识
- 系统建议它的作用范围和约束级别是什么
- 用户最终是否确认沉淀

### 建议字段

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL`
- `stage_id TEXT NOT NULL`
- `source_stage_type TEXT NOT NULL`
- `title TEXT NOT NULL`
- `summary TEXT NOT NULL`
- `knowledge_type TEXT NOT NULL`
- `status TEXT NOT NULL`
- `rationale TEXT NOT NULL`
- `applicability TEXT NOT NULL`
- `review TEXT NOT NULL`
- `evidence TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `decided_at TEXT`

### 字段说明

#### `knowledge_type`

当前建议值：

- `principle`
- `protocol`
- `experience`

#### `status`

当前建议值：

- `pending_review`
- `accepted`
- `accepted_project_local`
- `rejected`
- `deferred`

#### `review`

用于存放系统后台评审建议，例如：

- 建议 scope
- 建议 authority
- 置信度
- 支持沉淀的理由
- 不建议沉淀的理由
- 如果判断错误的风险
- 评审模式是单模型还是临时 council

#### `evidence`

用于存放结构化证据引用，例如：

- `conversation_ids`
- `artifact_ids`
- `formal_artifact_ids`

### 为什么先引入 proposal 层，而不是直接写正式知识

因为当前阶段已经明确：

1. stage 收尾时可以自动识别知识候选
2. 但最终是否沉淀，应由用户确认
3. 系统识别与正式知识之间需要一个治理缓冲层

因此 `knowledge_proposals` 的存在是为了保证：

1. 自动化可推进
2. 决策权不被系统越权拿走
3. 候选知识仍然保持完整证据链

## 正式知识条目索引

在 proposal 层之后，当前版本进一步引入：

- `knowledge_entries`

它表示已经被用户确认接纳的正式知识条目。

### 设计目的

它用于回答这些问题：

- 哪些知识候选已经被正式接纳
- 它最终以什么 scope 和 authority 生效
- 它来自哪个 proposal
- 它和哪些 conversation / artifact 保持证据关系

### 建议字段

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL`
- `stage_id TEXT NOT NULL`
- `proposal_id TEXT NOT NULL UNIQUE`
- `title TEXT NOT NULL`
- `summary TEXT NOT NULL`
- `knowledge_type TEXT NOT NULL`
- `scope TEXT NOT NULL`
- `authority TEXT NOT NULL`
- `status TEXT NOT NULL`
- `rationale TEXT NOT NULL`
- `applicability TEXT NOT NULL`
- `evidence TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

### proposal 与 entry 的关系

当前阶段明确要求：

1. proposal 负责承载自动识别与评审建议
2. entry 负责承载最终正式知识
3. entry 必须能回链到 proposal
4. proposal 也应能记录自己最终转成了哪个 entry

这样系统才既保留候选层，也保留正式层，不会把治理过程直接抹平。

## 知识消费层的索引要求

当前版本进一步明确：

1. 正式知识不仅需要可回溯，也需要可注入运行时上下文
2. 因此知识索引层还应支持按执行场景筛选 entry

当前最小消费筛选维度包括：

1. `stage`
2. `snail`
3. `project kind`
4. `authority`

### 为什么需要这层筛选

因为如果把所有正式知识都无差别注入 prompt：

1. prompt 会迅速膨胀
2. 高优先级知识会被淹没
3. 局部知识会误伤不相关场景

因此当前版本要求：

1. 只注入 active knowledge entries
2. 按 authority 分层展示
3. 按适用范围做最小筛选

## 知识事件索引

当前版本进一步引入：

- `knowledge_events`

它用于记录正式知识在运行期和演进期发生的关键事件。

### 设计目的

它用于回答这些问题：

- 哪些知识条目被 prompt 命中过
- 哪些知识后来被验证有效
- 哪些知识后来被挑战或失效
- 哪些知识已经被替代

### 建议字段

- `id TEXT PRIMARY KEY`
- `knowledge_entry_id TEXT NOT NULL`
- `project_id TEXT NOT NULL`
- `stage_id TEXT`
- `conversation_id TEXT`
- `event_kind TEXT NOT NULL`
- `note TEXT`
- `metadata TEXT`
- `created_at TEXT NOT NULL`

### 与 knowledge_entries 的关系

当前阶段要求：

1. `knowledge_entries` 负责表达当前正式知识状态
2. `knowledge_events` 负责表达知识在时间上的运行与演进轨迹

只有这两者同时存在，系统才能既回答“现在有什么知识”，也回答“这些知识后来发生了什么”。

## 知识视图层

当前版本进一步明确：

1. 知识视图是系统一级能力之下的独立二级功能
2. 它不附属于工作流详情页，而应有自己的查询、筛选和关系展示能力

当前知识视图至少应支持：

1. 聚合 summary
2. 健康度列表
3. 多维筛选
4. supersede 关系图谱
5. 单条知识详情与事件时间线

这意味着知识系统已经不再只是后台机制，而是产品显式能力的一部分。

## 知识运营视角

当前版本进一步明确：

1. 知识视图不仅要支持查询，还要支持治理运营
2. 因此知识视图应提供若干运营预设队列，而不只是一套通用筛选器

当前运营视角至少包括：

1. 待处理风险知识
2. 长期未激活知识
3. 近期被挑战知识
4. 高价值活跃知识
5. 近期演进链

这些预设的作用不是替代筛选器，而是帮助用户快速进入知识系统当前最需要处理的区域。

## 统一知识工作台

当前版本进一步明确：

1. 知识视图内部不应只覆盖正式知识
2. 候选知识和正式知识应在同一个知识工作台内协同治理

因此当前知识视图内部继续划分为两个子域：

1. `候选知识运营`
   关注 proposal 的待审核、延后、项目内接纳与近期拒绝队列

2. `正式知识运营`
   关注 entry 的健康度、验证、挑战与演进链

这样知识视图就能覆盖从 proposal 到 entry 的完整生命周期，而不是把候选治理永久留在工作流页中。

## 生命周期泳道与批量治理

当前版本进一步明确：

1. 统一知识工作台不应只有列表与详情，还应提供生命周期泳道
2. 运营视角下必须支持批量动作，而不只是单条处理

因此当前工作台继续补充：

1. 生命周期泳道
   用统一视角展示 proposal 与 entry 在不同状态位置上的分布

2. 批量治理动作
   至少支持批量处理 proposal、批量归档 entry

这样知识工作台才能从“查看系统”走向“处理系统”。

## 批量治理交互

当前版本进一步明确：

1. 批量治理不应依赖手工输入对象 id
2. 列表、泳道与批量动作应共用同一组选择状态

因此当前交互要求是：

1. 在候选知识列表中可直接多选 proposal
2. 在正式知识列表中可直接多选 entry
3. 在生命周期泳道中点击对象也应能加入或移出当前选择集
4. 批量工具栏应实时显示已选对象数

这样批量治理才真正成为可用交互，而不是只存在于 API 层。

## 治理确认层与视图联动

当前版本进一步明确：

1. 批量治理动作在执行前应有确认层
2. 知识视图中的不同分析视角应能相互高亮联动

因此当前交互还应满足：

1. 批量 proposal / entry 动作执行前，需要展示确认说明
2. 运营预设被激活时，应在对应卡片上体现高亮
3. 图谱节点、生命周期泳道、列表项应共享高亮焦点

这样知识工作台才能同时保证：

1. 操作安全性
2. 视图协同性

## 深联动与确认增强

当前版本进一步明确：

1. 批量确认层不应只显示动作名称，还应展示本次操作对象摘要与风险提示
2. 视图联动不应停留在单点高亮，而应能跨预设、泳道、图谱和列表传递焦点

因此当前交互进一步要求：

1. 批量操作确认层应展示对象标题摘要
2. 对高影响动作应展示额外风险提示
3. 激活运营预设时，应高亮关联泳道
4. 激活图谱焦点时，应同步高亮相关列表项与泳道项

这样知识工作台才能帮助用户真正理解“当前正在处理什么，以及它和整体生命周期的关系”。

## 关系链聚焦与治理日志

当前版本进一步明确：

1. 知识工作台应支持围绕一条 supersede 链进行聚焦分析
2. 知识治理动作应能在工作台中回看，而不只散落在事件记录里

因此当前交互进一步要求：

1. 选中某条知识时，应尽量高亮其所在 supersede 链
2. 图谱边高亮应体现当前链路，而不只是单节点
3. 工作台应提供最近治理日志面板，用于复盘 validate / contested / superseded 等关键动作

这样知识视图才能从治理工作台进一步走向分析与复盘工作台。

## 链路导航与日志筛选

当前版本进一步明确：

1. 关系链聚焦不应只停留在高亮，还应支持沿链导航
2. 治理日志不应只有全量列表，还应支持按动作类型快速筛选

因此当前交互还应满足：

1. 用户可在当前 supersede 链上执行上游 / 下游跳转
2. 用户可在需要时清除当前链路聚焦
3. 治理日志可按动作类型筛选，例如 validated / contested / superseded

这样知识工作台才能进一步提升分析效率与复盘效率。

## 时间复盘与链独显

当前版本进一步明确：

1. 治理日志筛选不应只有动作类型，还应有时间范围维度
2. 当前链聚焦不应只是高亮，必要时应支持只看当前链

因此当前交互还应满足：

1. 治理日志可按最近 24h / 7d / 30d 等时间窗口筛选
2. 当前链独显模式下，非链节点应被淡化或隐藏

这样知识视图才能进一步接近真正的时间复盘与链路分析工具。

## 路径图与审计流

当前版本进一步明确：

1. 当前链的表达不应只有高亮，还应尽量形成上游 / 当前 / 下游的路径语义
2. 治理日志的展示不应只有文本事件，还应带出动作严重度与作用范围等审计线索

因此当前交互还应满足：

1. 当前链应可按上游、当前、下游分层展示
2. 治理日志条目应尽量提供 severity / scope 等辅助信息

这样知识视图才能进一步从“可看懂”走向“更像专业分析与审计工具”。

## 路径骨架与按天复盘

当前版本进一步明确：

1. 当前链的表达可继续向路径骨架靠拢，而不只是多个卡片并列
2. 治理日志应支持按天分组，帮助用户按时间片复盘动作变化

因此当前交互还应满足：

1. 当前链在图谱区域可被表达为上游 -> 当前 -> 下游的骨架路径
2. 治理日志可按日期分组展示

这样知识视图才能进一步提升“路径感”和“时间片复盘感”。

## 路径图箭头化与每日汇总

当前版本进一步明确：

1. 当前链的路径骨架可继续增强为更明确的箭头流向表达
2. 治理日志按天分组时，应尽量附带每日动作汇总

因此当前交互还应满足：

1. 上游 -> 当前 -> 下游之间的方向性应更容易被感知
2. 每个日期分组下应快速看见该日发生了哪些类型的治理动作

这样知识视图才能进一步从“分组展示”走向“更强的路径阅读和时间复盘”。

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
