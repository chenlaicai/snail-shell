---
id: F2026051905
title: 项目配置独立视图
from_ids: []
tags: [config, convention]
modules: [project_management]
---
# F2026051905 项目配置独立视图

## 背景

`F2026051901` 已将新建 Project 从浏览器弹窗改为配置页面，但页面仍挂在项目对话工作区内。项目配置是新建 Project 的完整表单，不属于当前 conversation 的消息流；继续复用对话主容器会让配置状态与消息区、composer、workspace 侧栏的显示关系不清晰。

## 目标

1. 将新建 Project 配置页切换为独立的 `project-config` primary view。
2. 配置页与项目对话工作区互斥显示，不复用 conversation 消息区的主内容容器。
3. 点击配置页“取消”时退出独立配置视图，恢复 `projects` primary view，避免留下空白配置面板。
4. 通过 UI 入口和布局测试固化独立配置视图、取消路径和项目侧栏恢复语义。

## 非目标

1. 不改变 `POST /projects` 的 stage/role 配置协议。
2. 不改变已创建 Project 的配置编辑能力，本 Feature 仍不实现既有 Project 编辑。
3. 不改变 Feature、Stage、Conversation 的运行时状态流转。

## 设计

应用主壳新增 `project-config-panel`，并在 primary view 状态中加入 `project-config`。点击 Workspace Tree 的“新建”后，前端初始化项目配置草稿，清空当前项目选择状态，并调用 primary view 切换逻辑只显示配置面板。

配置页仍由 `createProjectConfigController()` 管理表单草稿、渲染和提交；应用层只负责进入、退出和提交后的视图状态。取消动作不只清空配置页 DOM，而是通过 `cancelProjectConfig()` 清空草稿并切回 `projects` primary view，保证左侧 workspace tree 和主项目工作区一起恢复。

## 生效路径

1. `src/web/primary-view.js` 注册并应用 `project-config` primary view。
2. `src/web/ui-shell.js` 提供独立的 `project-config-panel` 和 `project-config-page` 挂载点。
3. `src/web/app.js` 管理进入配置页、取消配置页、提交后回到项目工作区的状态切换。
4. `src/web/styles.css` 提供独立配置视图容器和长表单滚动布局。
5. `tests/web/ui-entrypoint-test.ts` 固化配置页入口、取消路径和不再使用浏览器 prompt 的入口契约。
6. `tests/web/workspace-layout-test.ts` 固化配置面板位于项目工作区外、拥有独立滚动容器和桌面表单布局。

## 改动范围

1. `src/web/app.js`
2. `src/web/primary-view.js`
3. `src/web/styles.css`
4. `src/web/ui-shell.js`
5. `tests/web/ui-entrypoint-test.ts`
6. `tests/web/workspace-layout-test.ts`
7. `docs/features/20260519/F2026051905-project-config-independent-view.md`

## 验证

1. `npm test -- tests/web/ui-entrypoint-test.ts tests/web/workspace-layout-test.ts`
2. `npm test -- tests/web/ui-entrypoint-test.ts tests/web/workspace-layout-test.ts tests/web/primary-view-test.ts`
3. commit hook 自动执行 `npm run test`，全量编译后测试通过。

## 风险与决策记录

1. 独立配置视图会在进入新建 Project 时清空当前项目、Feature、Stage 和 Conversation 选择状态；这是为了让配置页不伪装成某个已有 Project 的 conversation 内容。
2. 取消动作必须恢复 primary view，而不是只清空配置页内容；否则 `project-config` 面板会保持激活但无内容，形成空白主区域。
3. 本 PR 不应修改已合入的 `F2026051901` 历史 feature 文档。当前独立视图变化由本文件记录。

## 范围变更记录

1. Review 发现配置页取消路径只清空草稿但未退出 `project-config` primary view；已新增显式取消路径并补充 UI 断言。
2. Review 发现本 PR 误改已合入的 `F2026051901` 历史文档；已恢复历史文档内容，并改用当前 Feature 文档记录本 PR 范围。
3. 同步最新 `origin/main` 后发现 `F2026051904` 已被 `F2026051904-project-management-sidebar-2.md` 占用；当前文档改用下一个合规编号 `F2026051905`。
