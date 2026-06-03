---
id: F2026052907
title: evolution-center-ui-fix-and-create
from_ids: [F2026052903]
tags: [evolution, bugfix, ui, feature]
modules: [evolution, web]
doc_kind: spec
---

# F2026052907 [evolution][web] 演进中心 UI 层改名补全 + 手动新增演进项

## 背景

PR #299 (F2026052903) 完成了知识中心→演进中心的数据层和路由层重构，但遗漏了 UI 层：

1. **启动阻断**：`src/web/evolution-center.js` 未纳入 commit，导致 `app.js` 的 `import` 失败，服务无法启动
2. **一级目录未改名**：导航按钮仍显示"知识中心"，DOM 元素 ID、CSS 类名仍使用 `knowledge-` 前缀

此外，演进中心缺少手动创建演进项的 UI 入口。后端 `POST /evolution/items` 已就绪，需要补齐前端创建功能。

## 改动范围

### 页面文件

- `src/web/evolution-center.js`（新增 — 原 PR 遗漏）

### UI 层改名

- `src/web/ui-shell.js` — 导航按钮文本 "知识中心"→"演进中心"，所有 DOM 元素 ID 和 `data-view-*` 属性中 `knowledge`→`evolution`；侧边栏新增"新增"按钮（`#new-evolution-item-btn`）
- `src/web/primary-view.js` — `PRIMARY_VIEWS` Set 和 `applyPrimaryView` 中 `knowledge`→`evolution`
- `src/web/components/workspace-tree.js` — 顶部状态栏 "知识中心"→"演进中心"
- `src/web/app.js` — 所有 `$knowledge*` 变量名→`$evolution*`，`switchPrimaryView` 中视图名 `"knowledge"`→`"evolution"`；绑定"新增"按钮事件，传入 `getProjects`

### 新增功能：手动创建演进项

- `src/web/evolution-center.js` — 新增 `startCreate()`、`submitCreate()`、`cancelCreate()`、`renderCreateForm()`、`bindCreateEvents()` 方法
  - 创建表单包含：项目下拉选择器（`<select>`，列出所有项目，默认选中当前项目）、标题输入框、内容文本域
  - 提交后调用 `POST /evolution/items`，成功后刷新列表并选中新项
- `src/web/styles/components/evolution.css` — 新增 `.evolution-create-form`、`.evolution-form-field`、`.evolution-form-actions` 样式

### CSS 改名

- `src/web/styles/components/knowledge.css` → `src/web/styles/components/evolution.css`，所有类名 `knowledge-`→`evolution-`
- `src/web/styles/layout.css` — `.knowledge-panel.is-active`→`.evolution-panel.is-active`，`data-primary-view="knowledge"`→`"evolution"`
- `src/web/styles.css` — import 路径更新

### 测试修复

- `tests/web/primary-view-test.ts` — mock 元素名 `navKnowledge`→`navEvolution`，`knowledgePanel`→`evolutionPanel`
- `tests/project/collaboration-test.ts` — 内置项目 `"knowledge-center"`→`"evolution-center"`

## 验证

- [x] TypeScript 编译通过（`npx tsc --noEmit`）
- [x] 全部测试通过（`npm test`）
- [x] 无残留 `knowledge-` CSS 类名或 `"knowledge"` 视图 ID 在 Web 前端代码中
- [x] `POST /evolution/items` 端点已由 `tests/web/evolution-center-test.ts` 覆盖（含字段校验和自动生成 Feature+Conversation）

## 关联

- **前置**: F2026052903

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | Knowledge Library 相关测试是否需要改名 | 不需要，Knowledge Library 是独立保留的功能，不受演进中心改名影响 | 2026-05-29 |
| 2 | 创建 UI 采用何种模式 | 内联轻量表单：content 需要多行编辑不适合 prompt()，但不需要复杂表单控制器 | 2026-05-29 |
| 3 | project_id 字段交互方式 | 下拉选择器（`<select>`），列出所有项目，默认选中当前项目 | 2026-05-29 |
