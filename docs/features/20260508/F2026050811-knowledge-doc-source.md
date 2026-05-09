# F2026050811 知识文档权威源

## 背景

当前知识本体、审批状态、prompt 使用策略、搜索索引和使用记录都存放在 SQLite 中。用户指出知识是系统运行沉淀下来的长期规则、偏好、设计决策和经验，本质上是 Snail Shell 系统的一部分，而不是只属于单次运行态的数据。如果数据库被清空，已批准知识会丢失，系统也无法通过代码审查和 Git 历史追踪知识如何进入长期行为。

进一步讨论后确认，候选知识仍然应作为运行态数据存在；真正需要改变的是批准、更新和停用流程。批准不应再直接把数据库记录改成 active，而应创建仓库文档变更 PR。只有 PR 经过检视、修改并合入后，且系统更新重启并在启动同步中识别到对应知识文档，知识才算真正进入运行时生效状态。

## 目标

1. 将已生效知识的权威源从 SQLite 调整为 `docs/knowledge/**/*.md` 文档。
2. 保留 SQLite 作为候选队列、运行时投影、搜索索引、prompt 注入匹配、PR 工作单和使用记录存储。
3. 让新增、更新、停用、替换知识统一通过知识变更请求和 PR 落地。
4. 明确 PR 合入不等于运行时生效；只有系统基于包含该 PR 的仓库版本启动并完成知识文档同步后，运行时状态才更新为生效。
5. 支持 PR review 后追加修改、变更文档内容、更新 hash 和状态追踪。
6. 系统启动时扫描知识文档，同步到数据库投影，并回填知识变更请求的运行时状态。
7. 将当前数据库存量知识调整为未生效，避免历史数据库 active 状态继续被误认为长期生效知识。
8. 提供自动化测试覆盖文档解析、启动同步、状态回填、prompt 注入边界和存量知识未生效迁移。

## 非目标

1. 不把候选知识直接写入 `docs/knowledge`；候选在 PR 合入前仍是运行态数据。
2. 不把 `knowledge_use`、使用次数、最近注入时间或 review 事件日志写入知识文档。
3. 不引入纯文件运行模式；数据库仍负责运行时查询、搜索、使用记录和工作流状态。
4. 不让 UI 或 API 直接修改已由文档托管的 active 知识本体；此类变更必须走 PR。
5. 不把 PR 创建视为生效，也不把 PR 合入视为运行时生效。
6. 不为当前数据库中的历史 active 知识自动生成已生效文档；本 feature 按用户确认将其调整为未生效。

## 设计

### 分层模型

知识生命周期拆成三层：

1. 候选层：运行过程中识别出的待审批知识，存放在 SQLite。
2. 文档层：已通过 PR 合入的长期知识，存放在 `docs/knowledge/**/*.md`，是权威源。
3. 投影层：系统启动时从文档同步到 SQLite 的运行时视图，用于搜索、列表和 prompt 注入。

SQLite 中的 `knowledge_item` 保留，但其 active/deprecated/superseded 等长期状态只可信于文档同步结果。候选、拒绝记录和 `pending_document`（已批准等待文档 PR 落地）等工作流中间状态仍由数据库维护。

### 知识文档格式

每条长期知识使用一个 Markdown 文件，frontmatter 保存机器可读字段，正文保存人类可读内容。必填字段包括：

1. `id`：稳定知识 ID，不能从文件名派生。
2. `status`：`active`、`deprecated`、`superseded` 或 `archived`。
3. `kind`、`governance_level`、`scope_type`、`scope_ref`、`project_id`。
4. `title`、`content`、`rationale`。
5. `source_candidate_id`、`change_request_id`、`introduced_by_pr` 等追踪字段。
6. `prompt` 策略，用于启动同步后写入 `knowledge_usage_policy`。
7. `sources`，用于保留可追溯来源。

文档不保存 `use_count`、`knowledge_use` 或 PR review 事件日志。

### 变更请求

新增 `knowledge_change_request` 记录一次知识文档变更工作单。它覆盖新增、更新、停用、替换、归档和 prompt 策略调整。

核心字段包括：

1. `type`：`create`、`update`、`deprecate`、`supersede`、`archive`、`prompt_policy_update`。
2. `request_state`：`draft`、`in_progress`、`completed`、`cancelled`、`failed`。
3. `pr_state`：`none`、`open`、`changes_requested`、`approved`、`merged`、`closed`。
4. `runtime_state`：`not_applicable`、`pending_restart`、`syncing`、`active`、`failed`。
5. `candidate_id`、`knowledge_id`、`target_knowledge_id`、`document_path`。
6. `branch_name`、`worktree_path`、`pr_url`、`pr_number`、`latest_commit_sha`、`merge_commit_sha`。
7. `expected_document_hash` 和 `synced_document_hash`。

新增 `knowledge_change_request_event` 记录 PR 打开、review 要求修改、追加 commit、审批、合入、启动同步成功或失败等事件。这样 PR review 后多次修改不会丢失追踪。

### 批准流程

批准候选不再直接把候选改为 active，而是：

1. 创建 `knowledge_change_request(type = create)`。
2. 将原候选标记为 `pending_document`，表达“已批准等待文档 PR 落地”，但不赋予长期 active 语义。
3. 预生成 `target_knowledge_id` 和目标文档路径。
4. 在当前仓库生成 `docs/knowledge/pending/<targetKnowledgeId>.md` 草稿。
5. 审批流程自动触发 `knowledge-doc-pr` 能力，脚本基于最新 `origin/main` 创建隔离 worktree，把草稿复制为正式 `docs/knowledge/<targetKnowledgeId>.md`，提交 commit，并通过显式 `--head <knowledge-branch> --base main` 创建 PR，同时回写 request 的仓库上下文和 expected hash。
6. PR review 可要求修改；每次修改后更新 request 的 `latest_commit_sha`、`expected_document_hash` 和事件记录。
7. PR 合入由人执行；系统启动时自动查询 GitHub PR 状态并回写 request，不要求合入后额外执行 merged 回写脚本。
8. 系统更新重启后，启动同步器读取 main 中的知识文档；`docs/knowledge/pending/**` 草稿目录不参与运行时同步。
9. 同步器只有在 request 已确认 `pr_state = merged` 且扫描到正式目标文档时，才以扫描到的最终文档 hash 更新 request，并回写 `runtime_state = active`、`request_state = completed`。

### 更新与停用流程

已文档化知识的更新、停用和替换都走同一条链路：创建变更请求、修改文档、提交 PR、review 迭代、合入、重启同步后生效。

停用必须区分语义：

1. 仅停止 prompt 注入：修改文档中的 `prompt.allow_prompt_injection = false` 或 `prompt.mode = none`。
2. 标记过时：将 `status` 改为 `deprecated` 并记录原因。
3. 被新知识替代：旧知识 `status = superseded`，新知识 `supersedes` 旧 ID。
4. 归档：将 `status` 改为 `archived`，不再参与 prompt 注入。

同步器只让 `active` 且 prompt 策略允许的文档知识进入 prompt 注入候选。

### 启动同步

系统启动时执行知识文档同步：

1. 扫描 `docs/knowledge/**/*.md`，但排除 `docs/knowledge/pending/**` 草稿。
2. 解析并校验 frontmatter 与正文。
3. 计算文档 hash。
4. 将文档知识 upsert 到 `knowledge_item`。
5. 同步 `knowledge_source` 和 `knowledge_usage_policy`。
6. 重建 `knowledge_search`。
7. 将不存在于文档中的历史 active 数据库知识调整为未生效状态，避免数据库旧状态继续污染运行时。
8. 将本次扫描中未再出现的旧文档投影调整为未生效，并移出搜索索引和 prompt 策略，避免删除、移动或改 ID 的文档仍通过旧 SQLite 投影继续生效。
9. 根据 `change_request_id`、GitHub PR merged 状态、文档 hash 和当前仓库中正式文档存在事实回填 `knowledge_change_request`；带 `change_request_id` 的正式文档必须在对应 PR 已确认 merged 后，才记录最终文档 hash 并成为 runtime active。

同步收敛仍区分 pending 草稿和正式文档：pending 草稿不能写入 active 投影，也不能被当作文档删除来停用已有 active 投影；正式文档必须同时满足 PR 已确认 merged 和当前代码仓可扫描，才代表已合入、已部署并可生效。

启动同步是运行时生效边界。PR 合入后，如果当前进程尚未更新并重启，知识中心必须显示“PR 已合入，等待系统重启同步后生效”。

### 存量知识处理

用户确认当前数据库存量知识可以调整为未生效。本 feature 将没有对应文档来源的 active 知识从 prompt 注入路径中移出，并标记为未由文档激活。它们仍可作为候选或历史记录保留，但不能被视为长期生效知识。

### UI 与 API 边界

知识中心需要同时展示：

1. 文档状态：active、deprecated、superseded、archived。
2. PR 状态：open、changes requested、approved、merged、closed。
3. 运行时状态：当前已生效、等待重启、同步失败、未生效。

对文档托管知识，直接编辑数据库的 API 应拒绝或引导创建变更请求。候选知识仍允许在数据库中编辑、拒绝或发起落地 PR。

## 生效路径

1. `docs/knowledge/README.md` 记录知识文档格式、权威源规则、状态语义和变更流程。
2. `src/persistence/schema.ts` 增加知识变更请求与事件表，并为知识投影记录文档来源元数据提供字段或 metadata 约定。
3. `src/persistence/knowledge-model.ts` 支持文档同步 upsert、非文档 active 知识未生效迁移、变更请求状态回填和 prompt 注入过滤。
4. 新增知识文档 parser/syncer 模块，供启动流程和测试调用。
5. `src/project/manager.ts` 在初始化时触发知识文档同步，确保系统重启后才更新运行时状态。
6. API 和知识中心 UI 展示文档状态、PR 状态和运行时状态，并阻止直接修改文档托管知识。
7. 测试覆盖文档解析、同步、变更请求回填、存量 active 未生效处理和 prompt 注入边界。

## 改动范围

1. 新增 `docs/features/20260508/F2026050811-knowledge-doc-source.md`。
2. 新增 `docs/knowledge/README.md`。
3. 新增或调整知识文档解析、同步和变更请求相关 TypeScript 模块。
4. 更新数据库 schema、persistence model、project manager 启动流程和知识 API。
5. 新增 `.meta/scripts/knowledge-doc-pr`，并由审批流程自动触发，提供从批准草稿到知识文档 PR 的系统内执行路径。
6. 更新知识中心 UI 文案和状态展示。
7. 更新或新增 persistence、project、script、web 测试。

## 验证

1. 运行 `npm run check`。
2. 验证系统启动时可以从 `docs/knowledge` 同步 active 知识到数据库投影。
3. 验证文档缺失的历史 active 数据库知识不会进入 prompt 注入。
4. 验证 PR 合入但未重启时，变更请求仍显示等待重启。
5. 验证重启同步识别到文档后，变更请求运行时状态更新为 active。
6. 验证停用、更新和替换都通过文档状态或 prompt 策略变更表达，并在同步后影响 prompt 注入。

## 风险与决策记录

当前没有未经确认的问题。

决策记录：用户确认本 feature 不需要分步落地，应一步到位完成完整链路；当前数据库存量知识可以调整为未生效，避免继续把历史数据库状态当作长期生效知识。

决策记录：PR 合入不是运行时生效点。知识变更只有在系统更新重启后，启动同步器从 `docs/knowledge` 识别到对应文档并更新数据库投影，才算真正生效。

决策记录：PR review 修改是知识变更请求生命周期的一部分。系统必须记录最新 commit、文档 hash 和事件，不能假设 PR 创建后内容固定。

## 范围变更记录

1. Review 后补充批准候选的中间状态语义：数据库批准只进入 `pending_document`，不能继续复用长期 `active`。
2. Review 后补充启动同步的全量收敛语义：本次扫描未出现的旧文档投影必须停用并清理搜索索引和 prompt 策略。
3. Review 后补充 pending 草稿和正式文档生效边界：`docs/knowledge/pending/**` 不参与运行时同步；正式知识文档只有在当前运行代码仓扫描到后才允许 active。
4. Review 后补充从批准草稿到知识文档 PR 的可执行路径：新增 `knowledge-doc-pr` 脚本，避免流程停在 pending 草稿而无法实际使用。
5. Review 后补充知识文档 PR 生命周期闭环：创建 PR 时显式绑定知识文档分支，避免 request 关联到错误分支。
6. 用户反馈后修正端到端责任边界：审批后的 PR 创建应由系统代码自动触发，不依赖 Implementation Snail 手工执行；PR 合入后不需要额外脚本回写，但启动同步必须自动确认 GitHub PR merged 状态，不能仅凭本地正式文档存在就生效。
7. Review 后修正 hash 语义：审批/PR 创建时的 hash 只代表送审起点，PR review 修改后的正式文档 hash 由启动同步在扫描当前仓库时写回，避免 active 投影与 failed request 状态矛盾。
