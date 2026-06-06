---
id: F2026060602
title: tailwind-migration
from_ids: [F2026060504]
tags: [web, css, tailwind, migration]
modules: [web]
doc_kind: spec
---

# F2026060602 [web] Tailwind 渐进迁移：消除语义 CSS 类名

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

F2026060504（API Contract Layer）删除了全部 18 个 CSS 文件（2371 行），意图全面迁移到 Tailwind utility classes。但迁移只完成了一部分——页面组件仍在使用语义类名（如 `app-shell`、`sidebar`、`primary-button`、`empty-state`），导致页面完全无样式。

当前状态：
- `src/web/styles/` 目录和 `styles.css` 已被删除
- `globals.css` 包含 Tailwind `@theme` 和 design tokens
- 组件中 30+ 个语义类名未迁移，页面无法正常渲染

关联 feature：
- F2026060504（API Contract Layer）：该 feature 的 P4.5 阶段删除了 CSS 文件，但组件迁移未完成

## 目标

完成所有语义 CSS 类名到 Tailwind utility classes 的迁移，使页面在无 CSS 文件的情况下正常渲染。

### P1 — 简单类名批量替换

- `empty-state`（12 个文件）→ Tailwind utilities
- `primary-button`（4 个文件）→ Tailwind utilities
- `secondary-button`（3 个文件）→ Tailwind utilities
- `ghost-button`（1 个文件）→ Tailwind utilities
- `danger-button`（1 个文件）→ Tailwind utilities
- `button-row`（2 个文件）→ Tailwind utilities
- `task-board-empty`（1 个文件）→ Tailwind utilities
- `msg-content`（2 个文件）→ Tailwind utilities
- `msg-markdown`（1 个文件）→ Tailwind utilities

### P2 — 组件样式迁移

- `ConversationView.tsx`：`composer`、`composer-input-stack`、`composer-hints`、`composer-actions`、`reply-banner`、`mention-suggestions` 等
- `MessageRenderer.tsx`：`permission-tool`、`permission-actions`
- `BossMentionsBanner.tsx`：`boss-mentions-banner`、`boss-mention-item`

### P3 — 布局框架迁移

- `AppShell.tsx`：`app-shell`（CSS Grid）、`sidebar`、`brand-bar`、`brand-mark`、`brand-title`、`sidebar-toggle`、`sidebar-backdrop`、`directory-switcher`、`primary-nav`、`primary-nav-button`、`sidebar-main`、`main-panel`、`context-panel`、`workspace-tree`、`tree-toolbar`、`panel-title`、`tree-card`
- `ConversationLayout.tsx`：`workspace-main`、`conv-header`、`conv-back`、`conv-title-area`、`conv-title`、`conv-breadcrumb`、`conv-stage-tabs`、`conv-conv-tabs`
- `StageActions.tsx`：`conv-stage-tabs`

## 非目标

- 不改变页面的视觉效果和交互行为
- 不引入新的 CSS 框架或依赖
- 不改变 design tokens（`globals.css` 中的 `@theme` 和 `:root` 变量保留）
- 不改变 Tailwind 版本或配置

## 设计

### 迁移策略

1. **逐组件迁移**：每次迁移一个组件，确保视觉效果不变
2. **保留 design tokens**：`globals.css` 中的 CSS 变量是 Tailwind 和组件共用的 token 源
3. **验证方式**：每迁移一个组件后，`npm run build:web` + 浏览器验证视觉效果
4. **完成标准**：页面在无 `styles.css` 的情况下正常渲染

### Design token 映射

组件中引用的 CSS 变量与 Tailwind 的对应关系：

| CSS 变量 | Tailwind 用法 |
|---|---|
| `var(--color-bg-base)` | `bg-[var(--color-bg-base)]` |
| `var(--color-text-primary)` | `text-[var(--color-text-primary)]` |
| `var(--color-border-muted)` | `border-[var(--color-border-muted)]` |
| `var(--space-md)` | `p-[var(--space-md)]` |
| `var(--font-size-sm)` | `text-[var(--font-size-sm)]` |

### 响应式布局

`layout.css` 中的 `@media` 查询需要迁移到 Tailwind 的 responsive 前缀：

| 断点 | CSS | Tailwind |
|---|---|---|
| <= 899px | `@media (max-width: 899px)` | `max-[899px]:` |
| <= 1199px | `@media (max-width: 1199px)` | `max-[1199px]:` |

### 设计决策

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|---|---|---|---|---|---|---|
| D1 | 是否保留 CSS 文件作为过渡 | CSS 文件可以让页面立即恢复正常，降低迁移风险 | 保留 CSS 文件意味着两套样式系统共存，增加维护成本 | 不保留，直接完成 Tailwind 迁移 | 用户明确要求不回退到旧方案；CSS 文件是 F2026060504 故意删除的 | 用户 | 2026-06-06 |
| D2 | 迁移顺序 | 先做简单的批量替换（empty-state、button），再做复杂布局 | 先做布局框架（AppShell），因为它是页面骨架 | 先简单后复杂 | 简单替换风险低，可以快速验证 Tailwind 工作正常 | 用户 | 2026-06-06 |

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `src/web/layouts/AppShell.tsx` | 修改 | 22 个语义类名迁移到 Tailwind utilities |
| `src/web/pages/ConversationLayout.tsx` | 修改 | 9 个语义类名迁移到 Tailwind utilities |
| `src/web/pages/ConversationView.tsx` | 修改 | 4 个语义类名 + composer 相关类名迁移 |
| `src/web/components/StageActions.tsx` | 修改 | 2 个语义类名迁移 |
| `src/web/components/BossMentionsBanner.tsx` | 修改 | 2 个语义类名迁移 |
| `src/web/components/MessageRenderer.tsx` | 修改 | 2 个语义类名迁移 |
| `src/web/components/MarkdownRenderer.tsx` | 修改 | 1 个语义类名迁移 |
| `src/web/pages/*.tsx`（12 个文件） | 修改 | `empty-state` 类名迁移 |
| `src/web/pages/HomePage.tsx` | 修改 | `primary-button`、`secondary-button` 迁移 |
| `src/web/pages/NotFound.tsx` | 修改 | `primary-button` 迁移 |
| `src/web/components/ErrorBoundary.tsx` | 修改 | `primary-button` 迁移 |

## 验证

### P1

- [ ] 所有 `empty-state` 引用已替换为 Tailwind utilities
- [ ] 所有 `primary-button`/`secondary-button`/`ghost-button`/`danger-button` 引用已替换
- [ ] `button-row`、`task-board-empty`、`msg-content`、`msg-markdown` 已替换
- [ ] `npm run build:web` 通过
- [ ] 浏览器验证：按钮样式、空状态提示正常显示

### P2

- [ ] `ConversationView.tsx` 的 composer 样式已迁移
- [ ] `MessageRenderer.tsx` 的 permission 样式已迁移
- [ ] `BossMentionsBanner.tsx` 的 banner 样式已迁移
- [ ] 浏览器验证：消息输入框、权限请求、Boss 提及横幅正常显示

### P3

- [ ] `AppShell.tsx` 的 grid 布局已迁移（含响应式断点）
- [ ] `ConversationLayout.tsx` 的对话页面布局已迁移
- [ ] `StageActions.tsx` 的阶段操作按钮已迁移
- [ ] 浏览器验证：侧栏、导航、主面板、上下文面板正常显示
- [ ] 浏览器验证：响应式布局（窄屏侧栏折叠、上下文面板隐藏）正常工作

### 通用

- [ ] `npm run build` 通过（lint + tsc + build-dist + build:web）
- [ ] 所有测试通过
- [ ] 页面视觉效果与迁移前一致

## 关联

- **前置**: F2026060504（API Contract Layer）— 该 feature 的 P4.5 删除了 CSS 文件，本 feature 完成其未完成的迁移
- **相关**: F2026060501（CSS 迁移 P4.5）— 该阶段删除了 9 个 CSS 文件并迁移了部分组件，本 feature 完成剩余迁移
