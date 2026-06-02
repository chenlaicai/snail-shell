---
id: I2026050905
title: 提示词结构落地重构
from_ids: [I2026050903]
tags: [prompt, refactor]
modules: [knowledge_governance]
---
# I2026050905 提示词结构落地重构

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

1. `base/`：`target = ai.base.system`，承载 AI 基础契约、message-out 引用、知识候选入口和特定 runtime 可信边界；不承载依赖 Project、Feature、Stage 或 Conversation 的能力入口。
2. `scenarios/project-conversation/work-context/`：`target = scenario.project-conversation.work-context`，承载项目推进会话的项目、feature、stage、conversation、snail 事实上下文。
3. `scenarios/project-conversation/stage-role-playbooks/`：`target = scenario.project-conversation.stage-role-playbook`，承载按 stage、snail 和 repo 条件命中的角色行动手册。
4. `scenarios/task-runtime/`：继续使用具体 `task.*.system` target，承载后台任务的输入、处理规则和输出格式。

prompt id 使用分层编号，避免以大片英文命名承担治理结构，编号内部不使用横杆：

1. `P00XX` 表示 AI Base System Prompt。
2. `P0101XX` 表示 Project Conversation / Work Context。
3. `P0102XX` 表示 Project Conversation / Stage Role Playbook。
4. `P02XX` 表示 Task Runtime Prompts。

文件名必须以 `id-` 开头并包含简短可读标题，例如 `P010107-历史能力入口.md`；目录负责表达所属层级，文件名负责稳定定位和快速识别，`title` 负责表达完整语义。

历史上下文查询被识别为能力入口，不作为 base prompt 正文维护：

1. `.meta/skills/conversation-history/SKILL.md` 定义查询命令、模式和能力边界。
2. `P010107` 在项目推进会话 work context 中提供当前 conversation 的动态参数，并通过 `skill_references` 引用该能力。

Snail 角色不再维护脱离 Stage 的 prompt profile：

1. `.meta/snails.json` 保留 Snail 的数据事实，例如描述、能力预期、工作规则和偏好产物。
2. 当前响应 Snail 的事实进入 `Participant Scope`。
3. 角色身份、职责边界和行动规则归入对应 `Stage Role Playbook`。
4. `Boss Snail` 只是用户消息和人工路由的系统代号，不是 agent 角色，不生成系统提示词或 Stage Role Playbook。

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
4. `.meta/skills/conversation-history/SKILL.md`：历史上下文查询能力的 skill 入口。
5. `.meta/snails.json`：Snail 事实配置，不再引用独立 prompt profile。
6. `src/web/prompt-library.js`：Prompt Center 按真实 target 展示语义分类。
7. `tests/meta/prompt-assets-test.ts`：覆盖新 target、装配和关键规则归属。
8. `docs/features/20260509/I2026050905-prompt-structure-refactor.md`：记录本次需求、设计、验证和范围变化。

## 改动范围

预计修改：

1. `.meta/prompts/base/*.md`
2. `.meta/prompts/scenarios/project-conversation/work-context/*.md`
3. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/*.md`
4. `.meta/prompts/scenarios/task-runtime/*.md`
5. `.meta/skills/conversation-history/SKILL.md`
6. `.meta/snails.json`
7. `.meta/README.md`
8. `.meta/prompts/prompt.md.template`
9. `src/meta/prompt-registry.ts`
10. `src/snails/prompt-builder.ts`
11. `src/snails/registry.ts`
12. `src/web/prompt-library.js`
13. `src/web/stage-contract-view.js`
14. `scripts/generate-types.ts`
15. `tests/meta/prompt-assets-test.ts`
16. `tests/project/collaboration-test.ts`
17. `docs/features/20260509/I2026050905-prompt-structure-refactor.md`

预计删除或废弃历史位置：

1. `.meta/prompts/scene/conversation/*.md`
2. `.meta/prompts/scene/tasks/*.md`
3. `.meta/prompts/scene/snails/*.md`
4. `.meta/prompts/global/**/*.md`

## 验证

已执行：

1. `npm run check`：通过，包含 `generate-types`、`lint`、`build` 和 33 个编译后测试文件。
2. `tests/meta/prompt-assets-test.ts`：覆盖 `ai.base.system`、`scenario.project-conversation.work-context`、`scenario.project-conversation.stage-role-playbook` 和 `task.*.system` 的发现、排序、条件匹配、编号 id 规则和旧 target 禁用。
3. 已检查 `.meta/prompts/` 不再包含 `conversation.system.global`、`scene/conversation`、`scene/tasks`、`scene/snails`、`snail-profiles` 或历史 `global/` 目录。
4. 已检查历史上下文查询不在 `ai.base.system`，而是在项目推进会话 work context 中引用 `conversation-history` skill。
5. 已检查生成的 conversation system prompt 仍由基础契约、工作上下文、阶段角色手册、skill references 和知识上下文组成。

## 风险与决策记录

1. 决策：不保留 `conversation.system.global` 作为兼容 target。原因是本轮目标就是消除语义上含混的 global 注入层；继续兼容会让新旧模型并行存在，增加后续维护漂移。
2. 决策：不保留 `snail-profiles`。原因是它会形成脱离 Stage 的角色行为清单，与“角色行为必须绑定 Stage”冲突；Snail 数据事实留在 `.meta/snails.json` 和 participant context，身份与行动规则归入 Stage Role Playbook。
3. 决策：新增 `conversation-history` skill，并让项目推进会话 work context 引用它。原因是历史查询本质是能力入口，且依赖当前 conversation 与 db 参数，不符合 AI base“不依赖 Project/Feature/Stage/Conversation”的归属条件。
4. 决策：移除 Boss Snail 的 Stage Role Playbook。原因是 Boss Snail 是用户本人在系统里的消息代号，不是需要系统提示词驱动的 agent，给它写 prompt 会错误扩大角色模型。
5. 决策：prompt id 改用 `P<层级编号>`，prompt 文件名改用 `id-简短标题`。原因是 id 应稳定定位语义树位置，文件名标题负责人类快速识别，完整语义由 title 表达，避免大片英文 id 或纯编号文件名增加治理成本。
6. 风险：本轮会改变 Prompt Center 看到的 target 名称和 prompt id，属于治理性可见变化；通过 feature 文档和测试记录该变化，并避免伪造旧 target 兼容。

## 范围变更记录

1. 初始范围即包含 `.meta/prompts`、prompt 装配逻辑、Prompt Center 分类、测试和当前 feature 文档。
2. 根据用户反馈修正归属模型：历史上下文入口从 base prompt 改为 `conversation-history` skill + project conversation work context 引用；独立 `snail-profiles` 被移除，角色身份和行动规则并入 Stage Role Playbook。
3. 根据用户反馈移除 Boss Snail 的系统提示词/playbook 归属，并将 prompt id 与文件名从英文语义命名改为分层编号。
4. 根据用户反馈和检视意见，将 prompt 文件名从纯编号继续调整为 `id-简短标题`，保留稳定编号定位的同时恢复文件列表中的人工可读性，并同步更新长期 README 与当前 feature 交付记录。
5. 根据 rebase 后最新 `main` 的 feature 文档编号占用情况，将本 feature 文档从冲突的 `I2026050904` 调整为 `I2026050905`。
6. 根据用户反馈，将 prompt id 从带横杆的分层编号调整为无横杆格式；文件名继续使用 `id-简短标题`，例如 `P010107-历史能力入口.md`。
