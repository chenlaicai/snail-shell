# F2026051404 Prompt Center 提升为一级目录

## 背景

Prompt Center 当前隐藏在 Inspector 抽屉中，以 target 平铺列表为主，使用者难以直观看出系统提示词由哪些层级组成。用户要求把 Prompt Center 作为一级目录，并展示系统提示词的完整组织结构。

## 目标

1. 将 Prompt Center 从 Inspector 入口提升为左侧一级目录入口（与项目管理、知识中心、Snail Den 平级）。
2. 主页面左侧按 `.meta/prompts/` 的实际目录结构展示 Base 层 / Scenario 层树形结构。
3. 右侧显示选中 prompt 的详情（元数据、匹配条件、skill 引用、内容结构、原文）。
4. 支持搜索过滤（在树结构中递归匹配）。
5. 完全从 Inspector 迁移到一级目录，移除旧版 Prompt Center tab。

## 非目标

1. 不改变 prompt registry 的加载、匹配或渲染语义。
2. 不新增 prompt 文档或调整 `.meta/prompts/` 的规则内容。
3. 不改变项目、知识中心、Inspector 其他功能的业务行为。

## 设计

Prompt Center 作为一级目录后，主页面采用左侧树 + 右侧详情的两栏布局：

1. **左侧树形面板**：顶部展示统计（Prompts / Layers / Targets / Skill Refs），搜索框，下方按 `.meta/prompts/` 目录结构构建树。Base Layer 和 Scenario Layer 作为顶级分支，子目录按 `project-conversation`、`work-context`、`stage-role-playbook`、`task-runtime` 等展开。
2. **右侧详情面板**：显示选中 prompt 的 semantic_layer 分类、target、文件路径、order、匹配条件、skill 引用、内容大纲和原始 prompt 内容。
3. 完全迁移到一级目录，不再保留 Inspector 内嵌模式。

## 生效路径

本 feature 通过以下入口生效：

1. `src/web/ui-shell.js`：新增 Prompt Center 一级目录按钮和主页面容器，新增 prompts view context panel。
2. `src/web/primary-view.js`：一级目录视图切换支持 `prompts`。
3. `src/web/prompt-library.js`：新增 `createPromptCenter` 组件（树形+详情），移除旧版 `createPromptLibrary`。
4. `src/web/app.js`：将 prompt 数据注入 Prompt Center，接入视图切换和导航。
5. `src/web/styles.css`：新增 Prompt Center 页面样式。

## 改动范围

修改：

1. `src/web/ui-shell.js`
2. `src/web/primary-view.js`
3. `src/web/prompt-library.js`
4. `src/web/app.js`
5. `src/web/styles.css`

新增：

1. `docs/features/20260514/F2026051403-prompt-center-primary-view.md`

## 验证

1. 已运行 `npm run lint`，通过。
2. 已运行 `npm run build`，通过。
3. 已运行 `npm run test`，全部 35 个测试通过。
4. Prompt Center 作为一级目录存在，点击后展示树形结构+详情的两栏布局。
5. 旧版 Inspector 中的 Prompt Center tab 已移除。
6. 搜索在树结构中递归过滤，选中 prompt 后右侧显示完整详情。

## 风险与决策记录

1. 决策：不使用 `@media (max-width` 响应式断点，因为 workspace-layout-test 明确禁止此类断点。改用 `minmax(240px, 320px)` 让左侧树面板在窄屏时自然收缩。
2. 决策：完全迁移到一级目录，不再保留 Inspector 内嵌模式，简化代码结构。
3. 风险：Prompt Center 页面没有独立的 context panel 内容需求（不像 Knowledge Center 需要治理流程说明），context panel 仅展示结构概要信息。
