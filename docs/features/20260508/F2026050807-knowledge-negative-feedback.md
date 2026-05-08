# F2026050807 知识负向反馈法

## 背景

当前 agent 提取知识候选时不会先查看知识库已有内容，导致相同语义的知识被重复提交。重复知识不仅增加审批噪音，也暴露出一个更关键的问题：如果已有知识已经审批并注入系统提示词，agent 仍再次提取同一内容，说明该知识可能没有真实产生约束效果。

现有 `use_count` 统计只记录 prompt 注入、手动引用等“命中或使用路径”，不能证明知识真的影响了 agent 行为。因此需要新增一条负向反馈路径：当候选提取发现已有同类知识时，不再重复创建，而是把这次重复提取记录到原知识上，作为后续分析和优化的依据。

## 目标

- 知识候选创建入口在写入前检查当前知识库中是否已有同项目、同作用域、同类型且内容一致的知识。
- 如果发现重复知识，不再创建新的 candidate。
- 如果重复命中的是待审批 candidate，允许用新输入优化既有 candidate 内容并追加来源，降低审批队列重复噪音。
- 如果重复命中的是 active 或其他已治理知识，不自动改写内容，只追加来源并记录负向反馈，避免绕过审批治理边界。
- 将重复提取记录为独立的知识使用类型，区别于 prompt 注入命中次数。
- 更新 `knowledge-candidate` skill 说明，让 agent 知道候选写入入口会查重合并，重复命中不是新候选。

## 非目标

- 不引入 LLM 语义相似度判断；本次先使用规范化文本一致性，避免误合并不同规则。
- 不自动对失效知识做根因分析或改写 active 知识；未来可以基于负向反馈计数再设计 agent 介入流程。
- 不改变现有 prompt 注入策略、审批策略和知识中心 UI 的治理流程。
- 不清理历史上已经存在的重复知识。

## 设计

知识重复判断应服务候选创建入口，而不是只服务某个 UI 或某个 agent skill。实现上在存储层增加 `createOrMergeCandidate`：

- 查找范围限定在 `project_id`、`scope_type`、`scope_ref`、`kind` 相同的知识内，避免跨项目或跨角色误合并。
- 文本一致性使用标题与正文的规范化结果比较，消除空白、标点和大小写差异，但不尝试同义改写判断。
- 命中 candidate 时，在单个事务内更新既有候选的标题、正文、理由、metadata，并追加新来源。
- 命中 active、deprecated、archived 等已治理知识时，不更新知识正文，只追加来源并记录一次 `duplicate_candidate` 事件。
- 每次重复命中都会写入 `knowledge_use`，`use_type = duplicate_candidate`，`outcome` 记录命中的知识状态，`feedback` 记录新候选标题与来源摘要。

该设计把“重复候选”建模为知识反馈事件，而不是新的知识实体。这样既能阻止重复候选继续扩散，也能让后续治理看到某条知识的负向反馈次数。

## 生效路径

- 代码：`src/persistence/knowledge-model.ts` 提供候选查重、合并和负向反馈记录。
- 代码：`src/persistence/store.ts` 暴露 `createOrMergeKnowledgeCandidate`。
- 脚本：`src/bin/knowledge-candidate.ts` 与 `.meta/scripts/knowledge-candidate` 使用查重合并入口。
- 类型：`src/persistence/knowledge-types.ts` 增加 `duplicate_candidate` 使用类型。
- Skill：`.meta/skills/knowledge-candidate/SKILL.md` 说明候选创建会查重合并。
- 测试：脚本测试与持久化测试覆盖重复 candidate 合并、active 知识负向反馈和原有创建路径。

## 改动范围

- 新增 feature 文档：`docs/features/20260508/F2026050807-knowledge-negative-feedback.md`。
- 调整知识存储模型与类型：`src/persistence/knowledge-model.ts`、`src/persistence/knowledge-types.ts`、`src/persistence/store.ts`。
- 调整候选写入脚本：`src/bin/knowledge-candidate.ts`。
- 更新 skill 文档：`.meta/skills/knowledge-candidate/SKILL.md`。
- 更新测试：`tests/scripts/knowledge-candidate-test.ts`、`tests/persistence/persistence-test.ts`。

## 验证

- 运行 `npm run test`，覆盖 lint、build 与全量测试。
- 手动检查 `knowledge-candidate` 脚本输出，确认新增候选返回 `created`，重复命中返回 `merged` 并携带既有知识 id。

## 风险与决策记录

- 决策：本次只对规范化标题和正文一致的候选做自动合并，不做模糊语义合并。原因是知识会反哺 prompt，误合并不同规则比漏合并更危险。
- 决策：active 知识重复命中时不自动优化正文。原因是 active 知识已经通过审批治理，自动改写会绕过人工审批；本次仅记录负向反馈，为未来根因分析提供数据。
- 风险：相同语义但措辞不同的重复知识仍可能形成新 candidate。该风险暂时接受，后续可以基于人工审批或独立语义相似度设计处理。

## 范围变更记录

- 初始范围：实现知识候选创建前查重、重复时合并或记录负向反馈，并补充文档与验证。
