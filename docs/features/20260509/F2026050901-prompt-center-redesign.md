# F2026050901 Prompt Center 一级目录重构

## 背景

Prompt Center 当前隐藏在 Inspector 抽屉中，页面以 prompt target 列表为主，使用者只能看到一长串配置项，难以直观看出系统提示词由哪些层级组成，也难以理解不同层级各自包含什么内容。

用户要求把 Prompt Center 作为一级目录，并重新设计页面排版，使页面同时呈现提示词整体组成架构图和各部分具体内容；其中 project 级别提示词应体现每个 project 各有一份，点开 project 部分时列出各个 project。

## 目标

1. 将 Prompt Center 从低频 Inspector 入口提升为左侧一级目录入口。
2. 在 Prompt Center 页面展示系统提示词组成架构，而不是只按 target 平铺 prompt 列表。
3. 架构节点需要能切换查看对应部分的具体内容。
4. Project 节点展示当前 workspace 中的项目列表，体现 project 级 prompt 按 project 实例生效。
5. 保留搜索、target 过滤和 prompt 详情能力，避免回退现有配置检索能力。
6. 补充系统提示词语义结构设计文档，先从语义层面收敛提示词组成、职责边界和后续重构方向。

## 非目标

1. 不改变 prompt registry 的加载、匹配或渲染语义。
2. 本轮先不调整 `.meta/prompts/` 的规则内容，新增长期设计文档作为后续提示词语义重构依据。
3. 不改变项目、知识中心、Inspector 其他功能的业务行为。

## 设计

Prompt Center 作为一级目录后，页面分为三层：

1. 左侧一级目录入口选择 Prompt Center。
2. 主页面顶部展示系统提示词组成架构图，按 Conversation System、Global Injection、Snail Role、Project Context、Stage Context、Feature Context、History Context、Knowledge Context、Skill References、Task Runtime 等节点组织。
3. 主页面下方展示选中节点的内容。节点内容包含匹配 prompt、统计、条件、skill 引用和原始 prompt 内容；Project Context 节点额外列出当前 workspace projects。

保留 Inspector 中的 Prompt Center tab 作为配置检索入口，但它复用同一套分层组件，避免两个入口产生不一致的信息架构。

## 生效路径

本 feature 通过以下入口生效：

1. `src/web/ui-shell.js`：新增 Prompt Center 一级目录和主页面容器。
2. `src/web/primary-view.js`：一级目录视图切换支持 `prompts`。
3. `src/web/prompt-library.js`：Prompt Center 分层架构与内容渲染。
4. `src/web/app.js`：将 prompt 数据和 project 数据注入 Prompt Center。
5. `src/web/styles.css`：新增分层架构页面样式和移动端适配。

## 改动范围

预计修改：

1. `src/web/ui-shell.js`
2. `src/web/primary-view.js`
3. `src/web/prompt-library.js`
4. `src/web/app.js`
5. `src/web/styles.css`

新增：

1. `docs/features/20260509/F2026050901-prompt-center-redesign.md`
2. `docs/core/prompt-system-structure.md`

## 验证

1. 已运行 `npm run lint`，通过。
2. 已运行 `npm run build`，通过。
3. 已检查页面入口与 DOM 结构：Prompt Center 作为一级目录存在，Inspector Prompt Center 仍保留同一套分层组件。
4. 已检查 Project Context 节点的数据路径：`loadProjects()` 和 `renderProjects()` 会把当前 projects 同步到 Prompt Center，搜索和 target 过滤仍在当前节点内作用于 prompt 列表。

## 风险与决策记录

1. 决策：本次只重构前端信息架构，不改变 prompt 后端模型。原因是用户反馈集中在可视化组织层级，现有后端已经能提供 prompt 文档元数据。
2. 风险：当前 project 级 prompt 的“每个 project 各有一份”在运行时由上下文注入体现，prompt registry 本身不存储 project 实例副本。页面通过 Project Context 节点列出 projects 来表达实例化范围，不伪造不存在的 prompt 文档副本。
3. 决策：用户进一步要求先从语义上重构提示词组成结构，并明确本次绝对不涉及代码；因此本轮只新增 `docs/core/prompt-system-structure.md` 作为长期设计基线，不改运行时代码和 `.meta/prompts/` 文件。
4. 决策：根据用户反馈，语义结构不采用过多独立层级；改为先区分 `Conversation System Prompt` 与 `Task Runtime Prompts` 两类顶层 prompt，再将 conversation 内部收敛为 `Collaboration Contract`、`Work Context`、`Stage Role Playbook`、`Work Guardrails` 四类，避免 Stage fact、Stage policy 和 Role 规则重复拆分。
5. 决策：根据用户进一步反馈，移除 `Work Guardrails` 独立层；其中不依赖角色阶段的治理规则归入 `Collaboration Contract`，特定角色在特定阶段才需要执行的注释、签名、测试、PR 留痕等规则归入 `Stage Role Playbook`。同时修正基础契约不再绑定 Snail Shell 项目边界，并为英文分类名补充中文名。
6. 决策：根据用户反馈，历史访问入口和 skill references 不作为 `Work Context` 的普通上下文事实，而归入 `Collaboration Contract` 的基础能力契约；知识不再作为独立提示词分类，而作为治理后的内容来源，按具体生效方式归入 `Collaboration Contract`、`Work Context`、`Stage Role Playbook` 或 `Task Runtime Prompts`。
7. 决策：根据用户进一步抽象，`Collaboration Contract` 不应仍停留在项目推进会话内部，而应提升为 `AI Base System Prompt（AI 基础系统提示词）`；第二层再区分 `Project Conversation Prompt（项目推进会话提示词）`、`Task Runtime Prompts（任务运行时提示词）` 和未来预留的 `Chat Prompt（闲聊提示词）`。同时将 `Work Context` 内部细分为 Project、Feature、Stage、Conversation、Participant 和 Active Knowledge 子块。
8. 决策：根据用户反馈，移除 `Active Knowledge` 作为 `Work Context` 子块，避免与“知识不作为独立系统提示词分类”冲突；历史访问不再单列为基础规则，而按能力引用处理；核心文档改为“规则 + 示例”结构，并删除推荐阅读、装配顺序、归属判定表和验收标准等建议性章节。
9. 决策：根据用户反馈，移除独立的“核心原则”章节；将有价值的归属规则合并进对应分类定义和维护规则，避免核心设计文档中出现与分类定义重复的原则段落。
10. 决策：根据用户澄清，不应机械按字面删除“原则”含义；核心文档改为在各分类下使用“归属规则 + 属于 + 不属于 + 示例”的结构，保留抽象判断规则，同时避免独立原则章节与分类定义重复。
11. 决策：根据用户反馈，保留“归属规则 + 属于 + 不属于 + 示例”的表达结构，但恢复分类层级：第一层为 `AI Base System Prompt`，第二层为 `Scenario System Prompts`，其下包含 `Project Conversation Prompt`、`Task Runtime Prompts`、`Chat Prompt`，其中 `Project Conversation Prompt` 再包含 `Work Context` 与 `Stage Role Playbook`。

## 范围变更记录

1. 实现时补充移动端与中等屏幕 CSS 适配，避免 Prompt Center 作为一级目录后在窄屏继续沿用三栏布局造成不可读。
2. 用户补充要求从语义上重新设计系统提示词组成结构，且先出文档、不涉及代码；因此新增长期核心文档范围，并保留运行时代码与 prompt 规则文件不变。
3. 用户指出原设计分层过多、Role 与 Stage 应联合建模、Task Runtime Prompts 应与 Conversation System Prompt 并列；已重写 `docs/core/prompt-system-structure.md` 中的目标语义结构与映射关系。
4. 用户指出 `Work Guardrails` 可拆掉、基础契约不应有 Snail Shell 项目边界、分类需要中文名；已将 Conversation System Prompt 内部收敛为三类语义：`Collaboration Contract（协作基础契约）`、`Work Context（工作上下文）`、`Stage Role Playbook（阶段角色行动手册）`。
5. 用户指出历史访问入口、skill references 更像基础契约，知识最终会按多种方式生效；已调整归属表、迁移原则和 Prompt Center 展示建议。
6. 用户指出项目推进只是 AI 使用主场景之一、基础契约应面向所有 AI 且与 project/stage 无关，并要求细化 `Work Context`；已将文档重构为“AI 基础系统提示词 + 场景系统提示词 + 项目推进内部结构”的三段式模型。
7. 用户指出 `Active Knowledge` 与知识定位冲突、历史访问与 skill reference 重复、文档应使用“规则 + 示例”结构且不保留推荐/建议章节；已整篇重写核心文档以落实该结构。
8. 用户指出“核心原则”章节与下方分类内容重复，且不像本设计文档需要遵守的原则；已删除该章节并合并必要规则。
9. 用户澄清核心诉求是保留抽象归属判断，而非按字面删除“原则”概念；已将分类定义改为“归属规则 + 属于 + 不属于 + 示例”。
10. 用户指出上一版把原有层级拍平成同级分类；已修正标题层级，恢复基础层、场景层和项目推进内部子层的从属关系。
