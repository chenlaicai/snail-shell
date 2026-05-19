# F2026051902 项目管理右侧栏优化

## 背景

项目管理模块重构后，项目页右侧栏仍沿用旧的 Repository Context、Stage、Participants、Deliverables 与抽屉式 Inspector 组合。当前信息层级和用户在项目推进中的关注点不匹配：最上方没有优先呈现当前 stage，参与者只显示 snail 名称和运行时，当前上下文内容缺失，输入/输出产物分散，左侧 System State 与右侧 Inspector 都变成低价值入口。

## 目标

1. 项目管理右侧栏最上方直接显示当前 stage 信息。
2. 参与者区域显示 role、snail 与职责/规则信息，而不是只显示 snail 名称。
3. 当前上下文 content 可见，帮助理解当前 conversation 的来源和承接关系。
4. 右侧栏底部集中显示输入产物和输出产物信息。
5. 移除项目页左侧 System State 入口和右侧 Inspector 抽屉，把必要信息收敛到右侧栏本体。
6. 信息较多时通过 hover title 和截断展示降低视觉噪音。

## 非目标

1. 不调整项目、feature、stage、conversation 的数据模型。
2. 不改变 stage 推进、研发迭代重开、repo context 记录等业务行为。
3. 不重构知识中心、Prompt Center、Skill Center 或 Snail Den 的右侧栏。
4. 不新增运行时诊断页或系统状态可视化能力。

## 设计

项目管理右侧栏采用从当前任务到交付凭证的纵向信息架构：

1. `Stage` 卡片位于顶部，展示 stage 标题、序号、状态、feature、目标和下一步。
2. `Participants` 卡片按当前 stage 的 role definitions 映射参与者，展示角色名称、绑定 snail、主响应标识、运行时、职责说明和工作规则摘要。
3. `Context` 卡片展示当前 project、feature、conversation、conversation 来源和 repository context。repository context 的编辑入口保留在卡片内，避免依赖 Inspector。
4. `Artifacts` 卡片放在底部，分别展示 stage 输入产物、输出产物、输入/输出描述，并保留输出产物添加/删除能力。
5. 多行描述以 CSS line clamp 和 `title` 属性提供 hover 详细内容，避免右侧栏被长文本撑开。
6. 删除 Inspector 抽屉相关 DOM 与事件绑定；保留 stage chain 渲染函数用于既有逻辑兼容，但不在项目管理主界面呈现。

## 生效路径

本 feature 通过 `src/web/ui-shell.js`、`src/web/workspace-context.js`、`src/web/app.js`、`src/web/styles.css` 生效。

## 改动范围

1. `src/web/ui-shell.js`：调整项目管理右侧栏结构，删除左侧 System State 与 Inspector 抽屉。
2. `src/web/workspace-context.js`：重写项目管理上下文栏渲染逻辑，增加 stage、participants、context、artifacts 的目标结构。
3. `src/web/app.js`：移除 Inspector/System State 绑定，改为把 repo context 编辑能力传入右侧栏。
4. `src/web/styles.css`：补充右侧栏信息密度、hover 截断、参与者卡片和产物卡片样式。
5. `src/web/stage-contract-view.js`、`src/web/dispatch-state-view.js`：删除不再被项目管理页使用的旧视图模块。

## 验证

1. 运行类型检查或构建验证前端脚本无语法错误。
2. 人工检查项目管理页右侧栏顺序、信息可见性和输出产物操作入口。
3. 确认左侧 System State 与右侧 Inspector 不再出现。
4. 已执行 `npm run build`，构建通过；仓库内仍存在若干既有 lint warning，但未引入新的 error。

## 风险与决策记录

已决策：Inspector 和 System State 当前对项目管理页不是必要信息入口，本 feature 直接移除项目页入口和抽屉，不保留旧路径。

## 范围变更记录

暂无。
