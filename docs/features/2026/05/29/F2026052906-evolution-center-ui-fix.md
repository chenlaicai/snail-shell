---
id: F2026052906
title: evolution-center-ui-fix
from_ids: [F2026052903]
tags: [evolution, bugfix, ui]
modules: [evolution, web]
doc_kind: spec
---

# F2026052906 [evolution][web] 演进中心 UI 层改名补全

## 背景

PR #299 (F2026052903) 完成了知识中心→演进中心的数据层和路由层重构，但遗漏了 UI 层：

1. **启动阻断**：`src/web/evolution-center.js` 未纳入 commit，导致 `app.js` 的 `import` 失败，服务无法启动
2. **一级目录未改名**：导航按钮仍显示"知识中心"，DOM 元素 ID、CSS 类名仍使用 `knowledge-` 前缀

## 改动范围

### 页面文件

- `src/web/evolution-center.js`（新增 — 原 PR 遗漏）

### UI 层改名

- `src/web/ui-shell.js` — 导航按钮文本 "知识中心"→"演进中心"，所有 DOM 元素 ID 和 `data-view-*` 属性中 `knowledge`→`evolution`
- `src/web/primary-view.js` — `PRIMARY_VIEWS` Set 和 `applyPrimaryView` 中 `knowledge`→`evolution`
- `src/web/components/workspace-tree.js` — 顶部状态栏 "知识中心"→"演进中心"
- `src/web/app.js` — 所有 `$knowledge*` 变量名→`$evolution*`，`switchPrimaryView` 中视图名 `"knowledge"`→`"evolution"`

### CSS 改名

- `src/web/styles/components/knowledge.css` → `src/web/styles/components/evolution.css`，所有类名 `knowledge-`→`evolution-`
- `src/web/styles/layout.css` — `.knowledge-panel.is-active`→`.evolution-panel.is-active`，`data-primary-view="knowledge"`→`"evolution"`
- `src/web/styles.css` — import 路径更新

### 测试修复

- `tests/web/primary-view-test.ts` — mock 元素名 `navKnowledge`→`navEvolution`，`knowledgePanel`→`evolutionPanel`
- `tests/project/collaboration-test.ts` — 内置项目 `"knowledge-center"`→`"evolution-center"`

## 验证

- [x] TypeScript 编译通过（`npx tsc --noEmit`）
- [x] 全部 43 个测试通过（`npm test`）
- [x] 无残留 `knowledge-` CSS 类名或 `"knowledge"` 视图 ID 在 Web 前端代码中

## 关联

- **前置**: F2026052903

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | Knowledge Library 相关测试是否需要改名 | 不需要，Knowledge Library 是独立保留的功能，不受演进中心改名影响 | 2026-05-29 |
