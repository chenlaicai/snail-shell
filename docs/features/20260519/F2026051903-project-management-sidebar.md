# F2026051903 项目管理右侧栏优化

## 背景

项目管理模块重构后，项目页右侧栏仍沿用旧的 Repository Context、Stage、Participants、Deliverables 与抽屉式 Inspector 组合。当前信息层级和用户在项目推进中的关注点不匹配：用户需要先理解当前推进闭环、输出产物与推进阶段的前后关系，再看是谁在执行和上下文来源，但旧结构把这些信息拆散成多个平级区域，导致理解成本偏高。

## 目标

1. 项目管理右侧栏围绕“当前推进闭环”组织信息：先确认本阶段要交付什么，再补齐输出产物，最后决定是否推进阶段。
2. 参与者区域显示 role、snail 与职责/规则信息，而不是只显示 snail 名称。
3. 当前上下文 content 可见，帮助理解当前 conversation 的来源和承接关系。
4. repository context 作为仓库级长期上下文，保留在右侧栏本体内但不再与推进闭环平级竞争。
5. 移除项目页左侧 System State 入口和右侧 Inspector 抽屉，把必要信息收敛到右侧栏本体。
6. 信息较多时通过 hover title 和截断展示降低视觉噪音。

## 非目标

1. 不调整项目、feature、stage、conversation 的数据模型。
2. 不改变 stage 推进、研发迭代重开、repo context 记录等业务行为。
3. 不重构知识中心、Prompt Center、Skill Center 或 Snail Den 的右侧栏。
4. 不新增运行时诊断页或系统状态可视化能力。

## 设计

项目管理右侧栏采用三段式信息架构：

1. `当前推进` 卡片位于顶部，展示 stage 标题、状态、Feature、conversation，并把“本阶段要交付什么、已有哪些输出产物、输出齐后才能推进阶段”组织成同一条闭环。
2. `谁在执行` 卡片按当前 stage 的 role definitions 映射参与者，展示角色名称、绑定 snail、主响应标识、运行时、职责说明和工作规则摘要。
3. `上下文来源` 卡片展示当前 project、feature、conversation、conversation 来源，帮助用户理解当前协作现场。
4. `Repository Context` 作为仓库级长期上下文保留在右侧栏本体内，但从语义上归入上下文层，不再与阶段推进闭环并列。
5. Stage 卡片内保留可见的「推进阶段」和「重开研发」操作，删除 Inspector 后不让既有工作流入口变成隐藏按钮。
6. 多行描述以 CSS line clamp 和 `title` 属性提供 hover 详细内容，避免右侧栏被长文本撑开。
7. 删除 Inspector 抽屉相关 DOM 与事件绑定；保留 stage chain 渲染函数用于既有逻辑兼容，但不在项目管理主界面呈现。

## 生效路径

本 feature 通过 `src/web/ui-shell.js`、`src/web/workspace-context.js`、`src/web/app.js`、`src/web/styles.css`、`.githooks/`、`scripts/check-feature-doc-numbering.ts` 和 `.meta/prompts/prompts/S-04-检视者手册.md` 生效。

## 改动范围

1. `src/web/ui-shell.js`：调整项目管理右侧栏结构，删除左侧 System State 与 Inspector 抽屉。
2. `src/web/workspace-context.js`：重写项目管理右侧栏渲染逻辑，改为单卡闭环展示推进状态、输出产物、参与者、上下文来源和 repository context；participants 以 stage role definition 的 `name` 关联 conversation 参与者，确保 role 职责/规则可见。
3. `src/web/app.js`：移除 Inspector/System State 绑定，改为把 repo context 编辑能力传入右侧栏。
4. `src/web/styles.css`：补充右侧栏单卡闭环布局、hover 截断、参与者卡片和产物卡片样式。
5. `src/web/stage-contract-view.js`、`src/web/dispatch-state-view.js`：删除不再被项目管理页使用的旧视图模块。
6. `.githooks/pre-commit`、`.githooks/pre-merge-commit`、`scripts/check-feature-doc-numbering.ts`、`tests/meta/feature-doc-numbering-test.ts`：将 feature 文档编号冲突提升为共享硬校验，覆盖普通提交、merge commit 和完整测试。
7. `.meta/prompts/prompts/S-04-检视者手册.md`：补充复检期间同步 main 后必须重跑 main 新鲜度与 feature 文档编号门禁。

## 验证

1. 运行类型检查或构建验证前端脚本无语法错误。
2. 人工检查项目管理页右侧栏顺序、信息可见性、stage 推进/重开研发入口和输出产物操作入口，确认输出产物与推进阶段在同一闭环中呈现。
3. 确认左侧 System State 与右侧 Inspector 不再出现。
4. 已执行 `npm run build`，构建通过；仓库内仍存在若干既有 lint warning，但未引入新的 error。

## 风险与决策记录

已决策：Inspector 和 System State 当前对项目管理页不是必要信息入口，本 feature 直接移除项目页入口和抽屉，不保留旧路径。

## 范围变更记录

1. 首轮检视发现参与者卡片错误依赖 `roleDef.snail_id`，而当前 stage API 只暴露 `name/snail_template_id/is_primary/description/working_rules`；已改为以 role definition `name` 为主数据源，并把 conversation 参与者作为补充。
2. 首轮检视发现删除 Inspector 后 stage 推进和重开研发只剩隐藏按钮；已迁移为 Stage 卡片内可见操作入口，保持非目标中的既有业务行为不变。
3. 复检发现 repository context 编辑按钮来自固定 shell DOM，随右侧栏重渲染重复绑定 click handler；已改为渲染时替换 `onclick`，避免点击「记录」触发多轮 prompt 或重复 PATCH。
4. 复检收口后发现同步 `origin/main` 引入同日 feature 文档编号冲突；已将本文档顺延为 `F2026051903`，并补充共享编号校验与检视者最终复检门禁，避免普通提交、merge commit 或最终测试绕过编号冲突检查。
