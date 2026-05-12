# F2026051204 提示词效果评估框架

## 背景

当前 Snail Shell 已有系统提示词结构规范和资产级测试，可以验证规则归属、渲染结果和关键约束是否进入运行时 prompt。但这类测试主要覆盖“提示词资产有没有写对”，还不能回答“提示词改完后 agent 行为是否真的更好”。

用户进一步指出两类核心问题：

1. 系统提示词优化目前主要依赖主观经验和日常使用感受，缺少可比较、可追溯的评估机制。
2. 底层已有多个可运行 agent，至少包括 `open code`、`claude code cli`、`codex`；评估不能把它们混成单一维度，而要分别记录各 runtime 的表现。

## 目标

1. 为 Snail Shell 建立可长期维护的提示词效果评估模型，明确结构评估、行为评估和体验评估的边界。
2. 新增一组正式评估样本资产，覆盖当前最关键的提示词行为风险。
3. 把 `opencode-cli`、`claude-code-cli`、`codex-cli` 明确纳入评估维度。
4. 提供仓库内可运行的校验入口和自动执行入口，确保评估样本字段完整、runtime 覆盖明确，并能按 `sample x runtime` 生成报告。
5. 将“提示词优化不能只靠主观感觉，且评估要区分多个 agent runtime”沉淀到长期入口，而不是只停留在本轮对话里。

## 非目标

1. 本次不改变现有 prompt registry 注入逻辑。
2. 本次不引入新的 stage、artifact 或知识治理状态机。
3. 本次不保证所有开发环境都安装了三个 CLI 或具备可用凭据；环境阻塞会进入报告，而不是回退为人工主流程。

## 设计

本次采用“正式评估资产 + 自动执行报告”的收敛路径。

长期模型层面，在 `docs/core/prompt-evaluation-framework.md` 中定义：

1. 提示词评估必须区分结构证据、行为证据和体验证据。
2. 行为评估是核心层，必须基于固定样本比较不同提示词版本。
3. `opencode-cli`、`claude-code-cli`、`codex-cli` 是当前强制分开的 runtime 维度。

仓库资产层面，在 `.meta/prompt-evaluations/` 中建立结构化样本清单。每个样本记录：

1. 稳定 ID。
2. 行为维度。
3. 来源问题与风险说明。
4. 场景输入摘要。
5. 期望行为与禁止行为。
6. 适用 runtime。

代码层面，新增 registry 和 runner 负责读取样本、构造目标任务、调用 runtime、调用 judge runtime 并生成报告。测试保证：

1. 每个样本都声明了 runtime 覆盖。
2. 每个样本都能区分 `expected_behaviors` 与 `forbidden_behaviors`。
3. 至少存在一个样本同时覆盖三类已验证 runtime。
4. 汇总输出能按 runtime 统计样本覆盖量。
5. runner 能按 `sample x runtime` 生成结构化结果，并保留 judge 判定。
6. runner 能把可识别的 CLI 缺失、凭据、权限、网络或超时类环境阻塞记录为 `blocked`，同时把 judge 解析失败等评估器错误保留为 `error`。

提示词治理规则层面，在 `P010201` 和 `AGENTS.md` 中补充：进行提示词优化时，必须显式判断是否需要更新评估样本，并区分不同 agent runtime 的验证结果。

## 生效路径

1. `docs/core/prompt-evaluation-framework.md` 定义长期评估模型。
2. `docs/features/20260512/F2026051204-prompt-effect-evaluation-framework.md` 记录本次 feature 的需求、设计、验证和决策。
3. `.meta/prompt-evaluations/prompt-behavior-samples.json` 沉淀正式评估样本资产。
4. `src/meta/prompt-evaluation-registry.ts` 提供样本读取、校验和汇总能力。
5. `src/meta/prompt-evaluation-runner.ts` 提供自动执行与报告生成能力。
6. `scripts/run-prompt-evaluations.ts` 提供命令行执行入口。
7. `tests/meta/prompt-evaluation-assets-test.ts` 对评估资产和 runner 做自动化校验。
8. `.meta/prompts/.../P010201-研发迭代手册.md` 与 `AGENTS.md` 同步提示词治理要求。

## 改动范围

1. 新增 `docs/core/prompt-evaluation-framework.md`。
2. 新增 `docs/features/20260512/F2026051204-prompt-effect-evaluation-framework.md`。
3. 新增 `.meta/prompt-evaluations/prompt-behavior-samples.json`。
4. 新增 `src/meta/prompt-evaluation-registry.ts`。
5. 新增 `src/meta/prompt-evaluation-runner.ts`。
6. 新增 `scripts/run-prompt-evaluations.ts`。
7. 修改 `src/meta/index.ts`。
8. 修改 `package.json`。
9. 新增 `tests/meta/prompt-evaluation-assets-test.ts`。
10. 修改 `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md`。
11. 修改 `AGENTS.md`。

## 验证

1. 运行 `npm run test -- tests/meta/prompt-evaluation-assets-test.ts` 不适用，因为当前测试入口会跑全量编译测试；本次以 `npm run test` 为准。
2. 自动化验证重点：评估样本 registry 读取成功，字段校验通过，runtime 汇总结果符合预期，runner 能生成结构化报告。
3. 自动执行入口：`npm run prompt:evaluate -- --judge-runtime opencode-cli --output .meta/prompt-evaluations/latest-report.json`。
4. 人工只用于复核 blocked/error/争议判定，不作为常规主流程。
5. review 修复补充验证：runner 的自动化测试覆盖目标 runtime 阻塞、judge runtime 阻塞和 judge 输出不可解析三类路径，确认环境阻塞不会被压成 `error`，且 judge 阻塞或解析失败时仍保留已收集的目标输出。

## 风险与决策记录

1. 决策：把多个 agent runtime 视为一等维度，而不是后续脚本里的可选筛选项。原因是 stateless 与 stateful runtime 的上下文模型不同，混合统计会掩盖真实回归。
2. 决策：提示词行为评估默认由 AI 自动执行并自动判定。人工验证只用于环境阻塞或争议复核，不能作为常规主流程。
3. 决策：当前阶段由负责提示词改动的 Snail 在验证阶段主动调用 runner；系统只提供入口工具，不强制由工作流或 CI 自动触发。原因是用户接受“Snail 自行调用、系统提供入口”的现状，当前无需把触发编排软件化。
4. 风险：自动判定仍可能误判，因此报告保留目标输出、judge 输出和判定理由，便于复核和迭代 judge 提示词。

## 范围变更记录

1. 用户在确认落地实现时补充要求：评估时必须把 `open code`、`claude code cli`、`codex` 作为独立维度记录。因此本次设计从“通用提示词评估框架”扩大为“包含多 runtime 维度的提示词评估框架”。
2. 用户指出“人工来做”是错误方向。因此本次范围继续扩大，补充自动执行 runner、命令行入口和报告结构，并把人工复核降级为异常路径。
3. 用户确认当前可接受的责任边界是“Snail 自行在修改提示词场景下调用，系统只负责提供入口工具”。因此本次不再继续扩大为系统自动触发或 CI 强制执行。
4. PR 检视指出 blocked 状态需要真实生效路径。因此 runner 范围补充环境阻塞分类逻辑和对应自动化测试，避免 CLI、凭据、权限、网络或超时类阻塞被误记为评估器 `error`。
