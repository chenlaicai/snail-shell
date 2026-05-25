# F2026052401 系统提示词注入优化

## 背景

当前系统提示词存在三个核心问题，导致研发者（agent）不遵循研发流程执行：

1. **Skill 全量注入 Bug**：`builder.ts` 的 `injectSkills()` 将 5 个 skill 全部正文（~691 行）注入 systemPrompt，与设计文档（`.meta/README.md`）的渐进式披露原则直接矛盾。
2. **`--system-prompt` 覆盖 Claude 内置 prompt**：Claude Code 两处 adapter 使用 `--system-prompt` 完全替换 Claude 内置 system prompt，导致 Claude 丢失编码 agent 的工具使用规范、代码风格约束等"编码 OS"。OpenCode 和 Codex 保留了内置 prompt（注入走用户消息前缀），效果更好。
3. **提示词文本冗余**：prompt 间存在确切重复（S-01/S-03 的 stage 推进规则）、概念重复（B-03 HARD+STD）、"→ 解释"膨胀、GUIDE 过细等问题。

三 Agent（Claude Code / OpenCode / Codex）内置 prompt 交叉对比结论：Snail Shell 94 条规则中 ~85 条是独有的，不能删除。精简的主手段是修 bug、下沉详细步骤到 skill、消除文本冗余。

## 目标

- 修复 skill 全量注入 bug，实现渐进式披露（prompt 引用 -> 模型自行查阅 SKILL.md）
- 移除 Claude Code `--system-prompt`，改为用户消息前缀注入，保留 Claude 内置 system prompt
- 精简 prompt 文本：去重、下沉详细步骤到 skill、压缩冗余文字
- Stage 状态外化注入（当前阶段 + 下一步动作）
- 每次注入总文本量从 ~990 行降至 ~280 行（↓72%）

## 非目标

- 不修改 OpenCode / Codex / Gemini 的注入路径（它们已使用用户消息前缀注入）
- 不增加新的 skill 或 prompt 模块
- 不修改 prompt 的 Frame 组装逻辑和 prompt ID 体系
- 不修改 prompt-evaluation 评估样本（测试的是行为而非文本）

## 设计

### 1. Skill 注入 Bug 修复

移除 `builder.ts:74` 的 `injectSkills()` 调用。skill 正文不再注入 systemPrompt。skill 已通过 `expandPromptReferences()` 的 Skill References 段渐进式披露（名称 + 路径 + 使用条件），模型按需查阅 SKILL.md。`AgentCapability.skills` 保留结构化元数据，供未来 agent adapter 做 native skill 注入。

### 2. Claude Code 注入方式变更

- `claude-code-stateful.ts`：移除 `buildArgs()` 中的 `--system-prompt`，在 `buildUserContent()` 中将 `bootstrap.systemPrompt` 作为用户消息前缀
- `claude-code.ts`（stateless）：移除 `invokeStateless()` 中的 `--system-prompt`，将 systemPrompt 作为独立 content block（保留 transcript JSON 完整性）

Claude 内置 ~50 条规则的"编码 OS"得以保留。总指令密度分布在两个稳定层上：内置编码 OS + Snail Shell 工作流规则。

### 3. Prompt 文本精简

- **S-03**（86→73 行）：删除与 S-01 重复的 stage 推进规则；record-feature-repo-context 7 行详细步骤压缩为 1 行 + "详见 developer-handbook"；DB schema/migration/测试质量等详细约束压缩为核心 1 行 + "详见 developer-handbook"；UI/Mermaid 条件合并为 1 行引用
- **B-01**（58→51 行）：删除 message-out 命令格式（属于 skill 操作步骤，违反 B-01:33 自身"不复制 skill 正文"原则）；GUIDE 5→2 合并（8 条计划拆分规则收敛为"一步到位"和"主动披露"两条）
- **B-03**（19→17 行）：合并 HARD+STD 中 EnterPlanMode/ExitPlanMode/AskUserQuestion 的重复规则
- **S-01**（+2 行）：添加 stage 状态外化占位符 `{{stage_progress_label}}` `{{stage_next_action}}`

### 4. Stage 状态外化

`buildStageVariables()` 新增 `getStageProgress()` 辅助函数，根据 stage type 映射进度标签和下一步动作：
- development → "研发迭代 (第 1/2 阶段)" / "环境准备 (GATE-1~GATE-4)，详见 developer-handbook skill"
- review → "PR 检视 (第 2/2 阶段)" / "准备与上下文加载 (GATE-1~GATE-4)，详见 reviewer-handbook skill"

## 生效路径

- `.meta/prompts/prompts/S-03-研发者手册.md`：精简后的研发者行为规则
- `.meta/prompts/prompts/B-01-身份与责任契约.md`：去重精简的 Base 层规则
- `.meta/prompts/prompts/B-03-运行时边界.md`：合并后的运行时规则
- `.meta/prompts/prompts/S-01-项目上下文.md`：新增 stage 状态占位符
- `src/prompt-center/builder.ts`：移除 `injectSkills()` 调用 + `getStageProgress()`
- `src/agent/claude-code-stateful.ts`：移除 `--system-prompt`，用户消息前缀注入
- `src/agent/claude-code.ts`：同上，stateless 使用独立 content block

## 改动范围

- `src/prompt-center/builder.ts`
- `src/agent/claude-code-stateful.ts`
- `src/agent/claude-code.ts`
- `.meta/prompts/prompts/S-03-研发者手册.md`
- `.meta/prompts/prompts/B-01-身份与责任契约.md`
- `.meta/prompts/prompts/B-03-运行时边界.md`
- `.meta/prompts/prompts/S-01-项目上下文.md`
- `tests/agent/claude-code-test.ts`
- `tests/agent/claude-code-stateful-test.ts`
- `tests/meta/prompt-assets-test.ts`

## 验证

- [x] `tests/agent/claude-code-test.ts` 7 个测试全部通过
- [x] `tests/agent/claude-code-stateful-test.ts` 2 个测试全部通过
- [x] `tests/meta/prompt-assets-test.ts` 通过
- [ ] 实际调用 Claude Code stateful，验证研发者按流程执行（环境准备 -> 需求收敛 -> 实现 -> 验证提交）
- [ ] 实际调用 OpenCode，对比效果变化
- [ ] 验证 developer-handbook skill 可被模型按需查阅

## 风险与决策记录

- **Skill 引用可能失效**：如果模型不主动查阅 SKILL.md，详细步骤会丢失。缓解：S-03 保留了每个阶段的核心 1-2 条规则，确保最关键的约束仍然在 prompt 中；skill 引用通过 `[STD] ... 见 developer-handbook` 明确触发。
- **Claude Code 无 `--system-prompt` 时工具行为**：保留内置 prompt 后 Claude 会使用默认工具约定。这是期望行为（恢复编码 OS），但需验证是否与 Snail Shell 的 tool 约束冲突。
- **XML 标签保留**：XML 标签（`<constitution>` `<protocol>` `<guideline>` 等）是 PR #230 (F2026052101) 专门引入的"XML 锚点 + 优先级分层 + 渐进披露"设计，非历史残留。本次保留不变。

## 范围变更记录

- **第二轮精简**（commit bb72d39）：基于指令密度（120 条仍在边界线上）做进一步优化
  - B-01: 移除 4 条抽象/重叠规则——行动强度匹配、问题分类法、边界变化适应、验收对齐检查。这些过于抽象的规则模型无法可靠执行，反而占用注意力预算
  - S-03: 代码注释规则移到 developer-handbook skill（完整版本已在 skill 中）
  - S-03: Review 工作流程 5→3 条——签名模板和流程概览移到 skill
  - S-03: 提示词治理 4→1 条——详细规则已由 .meta/README.md 定义
  - S-03: 合并 feature 文档更新 + PR 收口规则
  - 效果: Snail Shell 80→70 条，含 Claude 内置 ~50 = ~120 条总指令

- **测试适配**（commit e6dd4ca）：prompt-assets 测试断言更新，PR 签名模板检查改为 Review 完成标准检查
