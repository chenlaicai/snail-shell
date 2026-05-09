# F2026050904 提示词结构落地重构

## 背景

上一轮 feature 已经通过 `docs/core/prompt-system-structure.md` 定义系统提示词的长期语义结构，但 `.meta/prompts/` 仍按历史的 `scene/conversation`、`global/roles`、`global/scenarios` 目录与 `conversation.system.global` 注入目标组织内容。

用户已确认本轮不是简单改名或搬移文件，而是需要完整盘点 `.meta/prompts` 并同步调整结构、内容与装配逻辑，按基础契约、项目推进场景、工作上下文、阶段角色手册、后台任务重新划分规则归属。

## 目标

1. 按 `docs/core/prompt-system-structure.md` 落地 `.meta/prompts/` 的语义目录和 target。
2. 将所有 AI 都应遵守的基础契约迁移到 `AI Base System Prompt`。
3. 将 Project、Feature、Stage、Conversation、Snail 等运行时事实与上下文装配说明迁移到项目推进会话的 `Work Context`。
4. 将 Implementation Snail、Acceptance Snail 等按 Stage 生效的行动规则迁移到 `Stage Role Playbook`。
5. 将 mention extractor、conversation summary 等后台任务迁移到 `Task Runtime Prompts`。
6. 同步调整 prompt registry、conversation prompt builder、Prompt Center 分类和测试，使运行时装配结果与新结构一致。

## 非目标

1. 不改变 Snail Shell 的 Stage 流程定义、artifact 类型或数据库 schema。
2. 不改写已合入 feature 文档的历史记录。
3. 不实现预留的非项目 `Chat Prompt` 场景。
4. 不改变 `message-out`、`knowledge-candidate` 等 skill 的命令协议正文。
5. 不把 Prompt Center 变成提示词模型定义来源；Prompt Center 只展示 registry 中的真实语义目标和装配结果。

## 设计

`.meta/prompts/` 调整为以下主结构：

1. `base/`：`target = ai.base.system`，承载 AI 基础契约、message-out 引用、历史访问入口、知识候选入口和特定 runtime 可信边界。
2. `scenarios/project-conversation/work-context/`：`target = scenario.project-conversation.work-context`，承载项目推进会话的项目、feature、stage、conversation、snail 事实上下文。
3. `scenarios/project-conversation/stage-role-playbooks/`：`target = scenario.project-conversation.stage-role-playbook`，承载按 stage、snail 和 repo 条件命中的角色行动手册。
4. `scenarios/task-runtime/`：继续使用具体 `task.*.system` target，承载后台任务的输入、处理规则和输出格式。
5. `snail profiles` 仍作为通过 snail registry 直接引用的角色身份片段保留，但只描述稳定身份和输出边界，不承载阶段行动手册。

运行时装配改为显式顺序：

1. 先装配 `ai.base.system`。
2. 再装配 `scenario.project-conversation.work-context`。
3. 再在专门章节中装配命中的 `scenario.project-conversation.stage-role-playbook`。
4. 最后装配已审批知识上下文。

这样可以保持“基础契约、上下文事实、角色行动、知识注入”四类内容的主归属清晰，同时避免 `conversation.system.global` 继续作为实际语义分类。

## 生效路径

本 feature 通过以下长期入口生效：

1. `.meta/prompts/`：提示词文件目录、metadata target 和正文归属。
2. `src/meta/prompt-registry.ts`：prompt target 匹配、重复校验和旧 target 迁移拦截。
3. `src/snails/prompt-builder.ts`：项目推进会话 system prompt 的装配顺序。
4. `src/web/prompt-library.js`：Prompt Center 按真实 target 展示语义分类。
5. `tests/meta/prompt-assets-test.ts`：覆盖新 target、装配和关键规则归属。
6. `docs/features/20260509/F2026050904-prompt-structure-refactor.md`：记录本次需求、设计、验证和范围变化。

## 改动范围

预计修改：

1. `.meta/prompts/base/*.md`
2. `.meta/prompts/scenarios/project-conversation/work-context/*.md`
3. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/*.md`
4. `.meta/prompts/scenarios/task-runtime/*.md`
5. `.meta/prompts/prompt.md.template`
6. `src/meta/prompt-registry.ts`
7. `src/snails/prompt-builder.ts`
8. `src/web/prompt-library.js`
9. `tests/meta/prompt-assets-test.ts`
10. `docs/features/20260509/F2026050904-prompt-structure-refactor.md`

预计删除或废弃历史位置：

1. `.meta/prompts/scene/conversation/*.md`
2. `.meta/prompts/scene/tasks/*.md`
3. `.meta/prompts/global/**/*.md`

## 验证

已执行：

1. `npm run check`：通过，包含 `generate-types`、`lint`、`build` 和 33 个编译后测试文件。
2. `tests/meta/prompt-assets-test.ts`：覆盖 `ai.base.system`、`scenario.project-conversation.work-context`、`scenario.project-conversation.stage-role-playbook` 和 `task.*.system` 的发现、排序、条件匹配和旧 target 禁用。
3. 已检查 `.meta/prompts/` 不再包含 `conversation.system.global`、`scene/conversation`、`scene/tasks` 或历史 `global/` 目录。
4. 已检查生成的 conversation system prompt 仍由基础契约、工作上下文、阶段角色手册、skill references 和知识上下文组成。

## 风险与决策记录

1. 决策：不保留 `conversation.system.global` 作为兼容 target。原因是本轮目标就是消除语义上含混的 global 注入层；继续兼容会让新旧模型并行存在，增加后续维护漂移。
2. 决策：Snail profile 保留为 registry 直接引用的身份片段。原因是它不是独立系统提示词分类，也不承载 stage 行动规则；保留直接引用能避免把 runtime 当前角色身份误归入阶段手册。
3. 决策：历史访问仍暂时通过基础 prompt 引用现有脚本入口，不新建 skill。原因是当前仓库尚未提供 conversation-history skill；本轮只按基础能力入口归属，不扩大到 skill 化改造。
4. 风险：本轮会改变 Prompt Center 看到的 target 名称，属于治理性可见变化；通过 feature 文档和测试记录该变化，并避免伪造旧 target 兼容。

## 范围变更记录

1. 初始范围即包含 `.meta/prompts`、prompt 装配逻辑、Prompt Center 分类、测试和当前 feature 文档。
