# F2026050704 避免当前 Feature 目标重复提取为知识

## 背景

当前知识候选触发规则会把用户在 feature 开发过程中提出、且已经要求本轮实现的目标也识别为候选知识。例如“已合入 feature 文档不得二次修改”本身就是对应 feature 的目标，并已通过文档和提示词长期入口生效；如果再额外创建知识候选，会让 feature 目标和知识提取重复，增加审批噪音。

## 目标

1. 明确知识候选不应重复提取当前 feature 正在交付的目标、验收规则或已纳入本轮变更的长期入口内容。
2. 保留知识候选对真正新增、可复用且未由当前 feature 直接交付的长期规则、偏好、决策和失败教训的触发能力。
3. 明确当前基线中的系统提示词、角色提示词、`AGENTS.md` 与 `knowledge-candidate` skill 的职责边界，避免本 PR 把同一判断规则重复写入多处。

## 非目标

1. 不改变知识候选的数据模型、审批状态、脚本参数或 UI。
2. 不移除阶段收口前检查候选知识的要求。
3. 不补删或迁移既有候选知识数据；本 feature 只修正后续判断规则。
4. 不调整其他 feature 已合入文档的历史内容。

## 设计

知识候选判断增加“当前 feature 交付去重”边界，并沿用当前基线中的提示词与 skill 职责拆分：

1. 如果某条规则、决策或操作要求是当前 feature 的目标、验收标准、范围变更，或已经在本轮通过 `AGENTS.md`、`.meta/prompts/`、`docs/README.md`、`core/`、`user-manual/`、代码或脚本等长期入口生效，则不再创建候选知识。
2. 如果对话、实现、检视或验证中暴露出超出当前 feature 目标的新长期规则、通用失败教训、后续治理问题或可复用流程，并且未通过本轮变更直接固化，仍应按 `knowledge-candidate` skill 创建候选。
3. 如果同一内容既是当前 feature 交付目标，又需要进入长期入口，应优先通过本 feature 的正式 diff 和 feature 文档记录，而不是额外进入待审批知识队列。

当前基线中的系统提示词、角色提示词和 `AGENTS.md` 已负责声明持续检查、触发场景、阶段收口前检查和调用 `knowledge-candidate` skill 的路由要求。本 PR 不修改这些触发入口，只在 `knowledge-candidate` skill 中集中维护 When To Use / When Not To Use、字段、命令和来源规则。

该设计保留知识候选的兜底能力，但避免把正在实现的 feature 本身变成重复知识，也避免后续调整候选排除边界时在系统提示词、角色提示词和 skill 之间产生规则漂移。

## 生效路径

1. 当前基线中的 `.meta/prompts/scene/conversation/SYS-CONV-KNOWLEDGE-CANDIDATE-knowledge-candidate.md` 定义知识候选的通用触发入口与 skill 路由。
2. 当前基线中的 `.meta/prompts/global/roles/PRM-GLOBAL-IMPLEMENTATION-EXECUTION-implementation-execution.md` 要求研发者在提交 PR、处理检视意见或回复 PR 前检查候选知识。
3. 当前基线中的 `.meta/prompts/global/roles/PRM-GLOBAL-REVIEW-REPORTING-review-reporting.md` 要求检视者在提交检视评论或最终复检结论前检查候选知识。
4. 当前基线中的 `AGENTS.md` 记录 Snail Shell 本仓库的长期触发入口。
5. 本 PR 更新 `.meta/skills/knowledge-candidate/SKILL.md`，集中维护使用边界，并明确不要为当前 feature 正在交付或已通过本轮变更生效的内容创建候选。

## 改动范围

1. 新增 `docs/features/20260507/F2026050704-avoid-current-feature-knowledge.md`。
2. 更新 `.meta/skills/knowledge-candidate/SKILL.md`。

## 验证

1. 确认新增 feature 文档编号符合 `docs/README.md` 规则。
2. 确认知识候选仍保留阶段收口检查和强触发场景。
3. 确认新增边界覆盖“当前 feature 目标已在本轮实现，不再重复提取为知识”的用户反馈场景。
4. 确认最终 diff 只包含 `knowledge-candidate` skill 和当前 feature 文档，提示词与 `AGENTS.md` 作为现有触发入口引用，不列为本 PR 改动文件。
5. 确认具体 When To Use / When Not To Use 集中在 `knowledge-candidate` skill。
6. 合入最新 `origin/main` 后确认 CI 不再因分支落后主干失败。
7. 运行 `npm run check`。

## 风险与决策记录

当前没有未经确认的问题。

决策记录：本 feature 选择在 prompt 和 skill 使用规则中收紧判断边界，而不改知识候选数据模型。原因是问题发生在 agent 是否调用 skill 的决策阶段，不是候选存储或审批流程本身。

检视处理记录：根据 PR 检视意见，本 feature 进一步收敛提示词与 skill 的职责边界。最终方案不修改系统提示词、角色提示词和 `AGENTS.md`，它们作为当前基线中已有的知识候选检查与 skill 调用入口；具体排除场景集中由 `knowledge-candidate` skill 维护。

## 范围变更记录

1. PR 检视阶段新增提示词治理要求：避免系统提示词、角色提示词、`AGENTS.md` 与 `knowledge-candidate` skill 重复描述同一排除判定；本 feature 因此将最终改动范围收敛为 `knowledge-candidate` skill 和当前 feature 文档。
2. PR 复检阶段发现 feature 文档与最终 diff 不一致；本 feature 修正生效路径、改动范围和验证记录，仅把提示词与 `AGENTS.md` 描述为当前基线中的触发入口，不再列为本 PR 改动文件。
3. CI 阶段发现分支落后最新 `main`，本 feature 合入 `origin/main` 以满足 CI 的主干同步要求；主干已将 feature 文档迁移到日期目录，因此本 feature 文档同步移动到 `docs/features/20260507/` 并改用当日下一个可用编号 `F2026050704`。
