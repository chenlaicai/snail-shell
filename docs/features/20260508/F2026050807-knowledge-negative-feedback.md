# F2026050807 知识负向反馈法

## 背景

当前 agent 提取知识候选时不会先查看知识库已有内容，导致相同语义的知识被重复提交。重复知识不仅增加审批噪音，也暴露出一个更关键的问题：如果已有知识已经审批并注入系统提示词，agent 仍再次提取同一内容，说明该知识可能没有真实产生约束效果。

现有 `use_count` 统计只记录 prompt 注入、手动引用等“命中或使用路径”，不能证明知识真的影响了 agent 行为。因此需要新增一条负向反馈路径：当候选提取发现已有同类知识时，不再重复创建，而是把这次重复提取记录到原知识上，作为后续分析和优化的依据。

## 目标

- 知识候选创建入口在写入前检查当前知识库中是否已有同项目、同作用域、同类型且语义重复的知识。
- 如果发现重复知识，不再创建新的 candidate。
- 如果重复命中的是待审批 candidate，允许用新输入优化既有 candidate 内容并追加来源，降低审批队列重复噪音。
- 如果重复命中的是 active 或其他已治理知识，不自动改写内容，只追加来源并记录负向反馈，避免绕过审批治理边界。
- 将重复提取记录为独立的知识使用类型，区别于 prompt 注入命中次数。
- 更新 `knowledge-candidate` skill 说明，让 agent 知道候选写入入口会查重合并，重复命中不是新候选。

## 非目标

- 不引入向量库、embedding 索引或批量历史重复知识清理；本次只在候选创建入口对同范围候选集做 LLM 语义判断。
- 不自动对失效知识做根因分析或改写 active 知识；未来可以基于负向反馈计数再设计 agent 介入流程。
- 不改变现有 prompt 注入策略、审批策略和知识中心 UI 的治理流程。
- 不清理历史上已经存在的重复知识。

## 设计

知识重复判断应服务候选创建入口，而不是只服务某个 UI 或某个 agent skill。知识由 LLM 提取，重复通常表现为语义等价而非文本一致，因此不能用标题和正文规范化相等来冒充查重。

实现上拆分两层责任：

- 候选创建流程先从存储层取出同 `project_id`、`scope_type`、`scope_ref`、`kind` 的已有知识候选集。
- `KnowledgeDuplicateDetector` 调用 LLM 判断新候选是否和候选集中某条已有知识语义重复；提示词明确允许措辞、标题、详略不同，但主题相近、范围不同、结论不同或新增独立约束时不得判重。
- 存储层 `createOrMergeCandidate` 不再自行做文本查重，只接收上层传入的明确 `duplicateId`，并复核该 id 仍在同项目、同作用域、同类型内。
- 命中 candidate 时，在单个事务内更新既有候选的标题、正文、理由、metadata，并追加新来源。
- 命中 active、deprecated、archived 等已治理知识时，不更新知识正文，只追加来源并记录一次 `duplicate_candidate` 事件。
- 每次重复命中都会写入 `knowledge_use`，`use_type = duplicate_candidate`，`outcome` 记录命中的知识状态，`feedback` 记录新候选标题与来源摘要。

该设计把“重复候选”建模为知识反馈事件，而不是新的知识实体。这样既能阻止重复候选继续扩散，也能让后续治理看到某条知识的负向反馈次数。

## 生效路径

- 代码：`src/llm/knowledge-duplicate-detector.ts` 提供 LLM 语义重复判断。
- 代码：`src/persistence/knowledge-model.ts` 提供同范围候选集查询、按明确 duplicate id 合并和负向反馈记录。
- 代码：`src/persistence/store.ts` 暴露 `createOrMergeKnowledgeCandidate`。
- 脚本：`src/bin/knowledge-candidate.ts` 与 `.meta/scripts/knowledge-candidate` 使用查重合并入口。
- 服务：`src/project/manager.ts` 和 `src/api/knowledge-routes.ts` 让 UI/API 创建候选时也走语义查重入口。
- 类型：`src/persistence/knowledge-types.ts` 增加 `duplicate_candidate` 使用类型。
- Skill：`.meta/skills/knowledge-candidate/SKILL.md` 说明候选创建会查重合并。
- 测试：脚本测试与持久化测试覆盖重复 candidate 合并、active 知识负向反馈和原有创建路径。

## 改动范围

- 新增 feature 文档：`docs/features/20260508/F2026050807-knowledge-negative-feedback.md`。
- 新增 LLM 语义查重器：`src/llm/knowledge-duplicate-detector.ts`。
- 调整知识存储模型与类型：`src/persistence/knowledge-model.ts`、`src/persistence/knowledge-types.ts`、`src/persistence/store.ts`。
- 调整候选写入脚本：`src/bin/knowledge-candidate.ts`。
- 调整 API/Manager 创建路径：`src/api/knowledge-routes.ts`、`src/project/manager.ts`、`src/main.ts`。
- 更新 skill 文档：`.meta/skills/knowledge-candidate/SKILL.md`。
- 更新测试：`tests/scripts/knowledge-candidate-test.ts`、`tests/persistence/persistence-test.ts`、`tests/llm/knowledge-duplicate-detector-test.ts`、`tests/project/stage-cycle-test.ts`。

## 验证

- 运行 `npm run test`，覆盖 lint、build 与全量测试。
- 自动化测试覆盖 LLM 查重器能在文本不同但语义重复时接受已有知识 id，并对候选集外 id 或非 JSON 输出 fail closed。

## 风险与决策记录

- 决策：候选查重必须使用 LLM 语义判断，而不是文本一致性。原因是知识本身由 LLM 生成，两次提取同一结论时措辞完全一致的概率很低，文本一致性无法解决用户指出的真实重复问题。
- 决策：LLM 只在同项目、同作用域、同类型候选集中选择 duplicate id，存储层复核边界。原因是语义判断需要 LLM，但合并边界必须由确定性代码兜底。
- 决策：active 知识重复命中时不自动优化正文。原因是 active 知识已经通过审批治理，自动改写会绕过人工审批；本次仅记录负向反馈，为未来根因分析提供数据。
- 风险：LLM 语义判断仍可能漏判或误判。该风险通过同范围候选集、候选集外 id 拒绝、active 不自动改写和人工审批边界降低；未来如知识规模增长，可再引入 embedding 召回或人工复核队列。

## 范围变更记录

- 初始范围：实现知识候选创建前查重、重复时合并或记录负向反馈，并补充文档与验证。
- 用户反馈后范围调整：原实现只做规范化文本一致性查重，无法处理 LLM 生成知识的真实重复场景；本轮改为 LLM 语义查重，并将存储层职责收窄为按明确 duplicate id 合并和计数。
