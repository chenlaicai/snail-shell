# F2026060603 — Tailwind 渐进迁移：消除语义 CSS 类名

## 背景

129f2527 (API Contract Layer) 删除了全部 18 个 CSS 文件（2371 行），意图全面迁移到 Tailwind utility classes。但迁移只完成了一部分——页面组件仍在使用语义类名（如 `app-shell`、`sidebar`、`primary-button`），导致页面完全无样式。

F2026060602 恢复了 CSS 文件作为过渡方案。本 Feature 的目标是**完成 Tailwind 迁移，然后删除 CSS 文件**。

## 当前状态

- `src/web/styles/` 目录已恢复（18 个 CSS 文件）
- `src/web/styles.css` 作为入口文件，由 `index.html` 引用
- `src/web/globals.css` 包含 Tailwind `@theme` 和 design tokens
- **两套样式系统共存**：语义 CSS 类名 + Tailwind utilities

## 迁移范围

### 高优先级（布局框架）

| 文件 | 语义类名 | 说明 |
|------|----------|------|
| `AppShell.tsx` | `app-shell`, `sidebar`, `brand-bar`, `brand-mark`, `brand-title`, `sidebar-toggle`, `sidebar-backdrop`, `directory-switcher`, `directory-summary`, `directory-title`, `directory-chevron`, `primary-nav`, `primary-nav-button`, `sidebar-main`, `main-panel`, `context-panel`, `workspace-tree`, `tree-toolbar`, `panel-title`, `button-row`, `tree-card`, `empty-state` | 整个应用壳层的 grid 布局、侧栏、导航 |
| `ConversationLayout.tsx` | `task-board-empty`, `workspace-main`, `conv-header`, `conv-back`, `conv-title-area`, `conv-title`, `conv-breadcrumb`, `conv-stage-tabs`, `conv-conv-tabs` | 对话页面的头部、阶段标签、会话标签 |
| `StageActions.tsx` | `conv-stage-tabs`, `secondary-button` | 阶段操作按钮组 |

### 中优先级（组件样式）

| 文件 | 语义类名 |
|------|----------|
| `ConversationView.tsx` | `empty-state`, `ghost-button`, `msg-content`, `button-row`, `composer`, `composer-input-stack`, `composer-hints`, `composer-actions`, `reply-banner`, `reply-cancel`, `mention-suggestions`, `mention-suggestion`, `mention-name`, `mention-desc`, `send-hint`, `mention-status` |
| `MessageRenderer.tsx` | `primary-button`, `danger-button`, `permission-tool`, `permission-actions` |
| `MarkdownRenderer.tsx` | `msg-markdown` |
| `BossMentionsBanner.tsx` | `boss-mentions-banner`, `boss-mention-item`, `name`, `meta` |

### 低优先级（简单替换）

| 文件 | 语义类名 |
|------|----------|
| 12 个页面 | `empty-state` — 统一替换为 Tailwind utilities |
| `HomePage.tsx`, `NotFound.tsx`, `ErrorBoundary.tsx` | `primary-button`, `secondary-button` |
| `Lobby.tsx` | `msg-content` |

## 迁移策略

1. **逐组件迁移**：每次迁移一个组件，确保视觉效果不变
2. **保留 design tokens**：`globals.css` 中的 `@theme` 和 `:root` CSS 变量保留，它们是 Tailwind 和语义 CSS 共用的 design token 源
3. **验证方式**：每迁移一个组件后，`npm run build:web` + 浏览器验证视觉效果
4. **完成标准**：`src/web/styles/` 和 `src/web/styles.css` 可以安全删除，页面视觉效果无退化

## 注意事项

- `tokens.css` 中的 CSS 变量（`--color-bg-*`、`--space-*`、`--font-size-*` 等）被语义 CSS 和 Tailwind 共用，迁移时需确保 Tailwind utilities 引用相同的变量
- 响应式布局（`@media` 查询）需要正确迁移到 Tailwind 的 responsive 前缀（`max-[899px]:`、`max-[1199px]:`）
- `layout.css` 中的 CSS Grid 布局（`app-shell`）是最复杂的部分，建议用 Tailwind 的 arbitrary properties 或 `@apply` 处理
- 消息样式（`message.css`）包含动画和伪选择器，可能需要保留为 CSS

## 参考

- 原始 CSS 文件：`git show 129f2527^:src/web/styles/`
- Tailwind v4 文档：https://tailwindcss.com/docs
- 当前 globals.css：`src/web/globals.css`
