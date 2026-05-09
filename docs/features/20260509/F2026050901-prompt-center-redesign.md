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

## 非目标

1. 不改变 prompt registry 的加载、匹配或渲染语义。
2. 不新增 prompt 文档或调整 `.meta/prompts/` 的规则内容。
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

## 验证

1. 已运行 `npm run lint`，通过。
2. 已运行 `npm run build`，通过。
3. 已检查页面入口与 DOM 结构：Prompt Center 作为一级目录存在，Inspector Prompt Center 仍保留同一套分层组件。
4. 已检查 Project Context 节点的数据路径：`loadProjects()` 和 `renderProjects()` 会把当前 projects 同步到 Prompt Center，搜索和 target 过滤仍在当前节点内作用于 prompt 列表。

## 风险与决策记录

1. 决策：本次只重构前端信息架构，不改变 prompt 后端模型。原因是用户反馈集中在可视化组织层级，现有后端已经能提供 prompt 文档元数据。
2. 风险：当前 project 级 prompt 的“每个 project 各有一份”在运行时由上下文注入体现，prompt registry 本身不存储 project 实例副本。页面通过 Project Context 节点列出 projects 来表达实例化范围，不伪造不存在的 prompt 文档副本。

## 范围变更记录

1. 实现时补充移动端与中等屏幕 CSS 适配，避免 Prompt Center 作为一级目录后在窄屏继续沿用三栏布局造成不可读。
