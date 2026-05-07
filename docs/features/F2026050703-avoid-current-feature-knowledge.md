# F2026050703 避免当前 Feature 目标重复提取为知识

## 背景

当前知识候选触发规则会把用户在 feature 开发过程中提出、且已经要求本轮实现的目标也识别为候选知识。例如“已合入 feature 文档不得二次修改”本身就是对应 feature 的目标，并已通过文档和提示词长期入口生效；如果再额外创建知识候选，会让 feature 目标和知识提取重复，增加审批噪音。

## 目标

1. 明确知识候选不应重复提取当前 feature 正在交付的目标、验收规则或已纳入本轮变更的长期入口内容。
2. 保留知识候选对真正新增、可复用且未由当前 feature 直接交付的长期规则、偏好、决策和失败教训的触发能力。
3. 同步收紧会话级入口、研发者职责、检视者职责和 `knowledge-candidate` skill 的判断边界。

## 非目标

1. 不改变知识候选的数据模型、审批状态、脚本参数或 UI。
2. 不移除阶段收口前检查候选知识的要求。
3. 不补删或迁移既有候选知识数据；本 feature 只修正后续判断规则。
4. 不调整其他 feature 已合入文档的历史内容。

## 设计

知识候选判断增加“当前 feature 交付去重”边界：

1. 如果某条规则、决策或操作要求是当前 feature 的目标、验收标准、范围变更，或已经在本轮通过 `AGENTS.md`、`.meta/prompts/`、`docs/README.md`、`core/`、`user-manual/`、代码或脚本等长期入口生效，则不再创建候选知识。
2. 如果对话、实现、检视或验证中暴露出超出当前 feature 目标的新长期规则、通用失败教训、后续治理问题或可复用流程，并且未通过本轮变更直接固化，仍应按 `knowledge-candidate` skill 创建候选。
3. 如果同一内容既是当前 feature 交付目标，又需要进入长期入口，应优先通过本 feature 的正式 diff 和 feature 文档记录，而不是额外进入待审批知识队列。

该设计保留知识候选的兜底能力，但避免把正在实现的 feature 本身变成重复知识。

## 生效路径

1. `.meta/prompts/scene/conversation/SYS-CONV-KNOWLEDGE-CANDIDATE-knowledge-candidate.md` 定义通用去重边界。
2. `.meta/prompts/global/roles/PRM-GLOBAL-IMPLEMENTATION-EXECUTION-implementation-execution.md` 要求研发者在收口检查时先排除当前 feature 已交付内容。
3. `.meta/prompts/global/roles/PRM-GLOBAL-REVIEW-REPORTING-review-reporting.md` 要求检视者在评论或复检前先排除当前 PR 已覆盖内容。
4. `.meta/skills/knowledge-candidate/SKILL.md` 在 skill 使用规则中明确不要为当前 feature 正在交付或已通过本轮变更生效的内容创建候选。
5. `AGENTS.md` 同步记录 Snail Shell 本仓库的长期工作规则，避免仓库说明与 `.meta/prompts` 漂移。

## 改动范围

1. 新增 `docs/features/F2026050703-avoid-current-feature-knowledge.md`。
2. 更新 `.meta/prompts/scene/conversation/SYS-CONV-KNOWLEDGE-CANDIDATE-knowledge-candidate.md`。
3. 更新 `.meta/prompts/global/roles/PRM-GLOBAL-IMPLEMENTATION-EXECUTION-implementation-execution.md`。
4. 更新 `.meta/prompts/global/roles/PRM-GLOBAL-REVIEW-REPORTING-review-reporting.md`。
5. 更新 `.meta/skills/knowledge-candidate/SKILL.md`。
6. 更新 `AGENTS.md`。

## 验证

1. 确认新增 feature 文档编号符合 `docs/README.md` 规则。
2. 确认知识候选仍保留阶段收口检查和强触发场景。
3. 确认新增边界覆盖“当前 feature 目标已在本轮实现，不再重复提取为知识”的用户反馈场景。
4. 运行 `npm run check`。

## 风险与决策记录

当前没有未经确认的问题。

决策记录：本 feature 选择在 prompt 和 skill 使用规则中收紧判断边界，而不改知识候选数据模型。原因是问题发生在 agent 是否调用 skill 的决策阶段，不是候选存储或审批流程本身。

## 范围变更记录

当前没有范围变更。
