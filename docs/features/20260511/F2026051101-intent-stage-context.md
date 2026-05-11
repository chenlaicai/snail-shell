# F2026051101 意图识别与 Stage 上下文追溯

## 背景

check0511 反馈暴露出两个项目推进问题：用户只是要求排查或分析系统问题时，Snail 可能把问题自动升级成提交 PR 这类会产生实际产物的高影响动作；进入新 Stage 后，Snail 可能直接反问用户问题背景，而不是先沿同一 Feature 的上一 Stage、PR 或 feature 文档线索自行追溯。

这两个问题的共同本质不是某一次 PR 行为错误，而是 AI 行动前没有区分用户意图强度、当前 Stage 成功标准和已有上下文证据。

## 目标

- 明确高影响动作必须匹配用户意图，不能把分析、排查、解释、评估或方案咨询自动升级为提交 PR 等实际产物动作。
- 明确 Implementation Snail 在研发迭代中遇到排障或方案咨询时，应先给出排查结论、影响分析和可选方案。
- 明确新 Stage 或既有 Feature 承接时，应先基于同一 Feature 的 Stage 输入、上一 Stage 产物、feature 文档、PR 记录和必要历史消息自行追溯上下文，再决定是否提问。
- 保持 `AGENTS.md` 与 `.meta/prompts/` 双线规则一致。

## 非目标

- 不改变工作流阶段定义、产物类型或 PR 创建机制。
- 不引入自动意图分类器或新的运行时代码路径。
- 不取消 Development Stage 在确认实现意图后提交 PR 的要求。

## 设计

通用层面，AI 基础判断契约新增“行动强度必须匹配用户意图和当前成功标准”的规则。该规则不绑定 Snail Shell 的 Project、Feature 或 Stage，适用于所有 AI 调用中的高影响动作边界。

项目推进层面，Implementation Snail / Development 行动手册新增两条角色阶段规则。第一条把“排障/分析请求”与“提交 PR 等高影响动作”分开，要求先交付分析结论和方案，只有用户明确要求实现且与当前 Stage PR 目标对齐时才继续实施。第二条要求新 Stage 或既有 Feature 承接时先追溯同 Feature 线索，避免在已有正式产物或历史线索可查时直接把背景补全责任推回给用户。

`AGENTS.md` 作为双线生效入口同步摘要规则，保持长期约束一致，但不复制提示词模块的完整上下文结构。

## 生效路径

- `.meta/prompts/base/P0004-AI判断与责任契约.md`
- `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md`
- `AGENTS.md`

## 改动范围

- 新增当前 feature 文档。
- 调整 AI 判断与责任契约。
- 调整 Implementation Snail / Development 行动手册。
- 同步 `AGENTS.md` 中的稳定规则摘要。

## 验证

- 运行 `npm run check`，确认提示词资产测试、构建和现有测试通过。
- 人工核对规则归属符合 `docs/core/prompt-system-structure.md`：通用高影响动作边界归入 AI Base，项目推进承接与 PR 动作边界归入 Development 行动手册。

## 风险与决策记录

- 决策：不新增运行时代码或自动分类器。本次问题可先通过提示词规则修正 AI 行动边界；如果后续仍出现误触发，再基于实际日志评估是否需要运行时防护。
- 决策：不要求每次新 Stage 都查询完整历史。规则要求先利用已注入的 Stage 输入、上一 Stage 产物、feature 文档和 PR 记录；只有当前摘要和最近消息不足时再使用 conversation history，避免无谓扩大上下文查询。

## 范围变更记录

- 初始范围：根据 check0511 反馈新增意图强度识别和 Stage 上下文追溯规则。
