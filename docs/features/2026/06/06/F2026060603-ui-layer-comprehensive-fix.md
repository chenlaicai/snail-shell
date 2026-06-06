---
id: F2026060603
title: ui-layer-comprehensive-fix
from_ids: [F2026060504, F2026060602, F2026060501]
tags: [web, react, typescript, tailwind, tanstack-query, bugfix, migration]
modules: [web]
doc_kind: spec
---

# F2026060603 [web] UI 层全面修复：Tailwind 迁移 + 类型安全 + TanStack Query

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

F2026060504（API Contract Layer）建立了类型安全的前后端契约层，F2026060602（Tailwind 迁移）规划了 CSS 类名迁移方案，但两个 feature 都留下了大量未完成的工作。用户反馈"当前的 UI 仍然还是残缺品"，要求对前端代码做全面审查和修复。

## 实施前分析

对 `src/web/` 全部 40+ 文件做了逐文件审查，发现以下 6 类问题：

### 第一类：构建阻断（9 个，应用无法启动）

| # | 文件 | 问题 | 严重度 |
|---|---|---|---|
| B1 | `AppShell.tsx` | `import from "../../types"` 解析到不存在的 `src/types` | 构建失败 |
| B2 | `WorkspaceBoard.tsx` | 同 B1 | 构建失败 |
| B3 | `WorkspaceTree.tsx` | 同 B1 | 构建失败 |
| B4 | `ConversationLayout.tsx` | 从 store 解构 `currentStage`/`currentConversation`/`setCurrentStage`/`setCurrentConversation`，但 store 只有 `wsStatus`/`composerDraft` | 运行时崩溃 |
| B5 | `ContextPanel.tsx` | 同 B4 | 运行时崩溃 |
| B6 | `StageActions.tsx` | `api("POST", "/path")` 旧签名，`api()` 当前期望 `"POST /api/path"` 单字符串 | 运行时崩溃 |
| B7 | `AppShell.tsx:113` | `!sidebar-expanded` 是减法表达式（`!sidebar - expanded`），不是逻辑取反 | 运行时 ReferenceError |
| B8 | `WorkspaceConfig.tsx:27` | `useState<Sop[]>` 但 `Sop` 类型从未导入或定义 | TypeScript 编译失败 |
| B9 | `MessageRenderer.tsx:156` | `payload.text` 对 `unknown` 类型直接属性访问 | TypeScript 编译失败 |

### 第二类：CSS 变量缺失（5 个，样式异常）

| # | 变量名 | 使用位置 | 影响 |
|---|---|---|---|
| C1 | `--color-danger-bg` | `Toast.tsx` | Toast 错误背景透明 |
| C2 | `--color-info-bg` | `Toast.tsx` | Toast 信息背景透明 |
| C3 | `--color-text-blue-muted` | `ConversationView.tsx`, `MessageRenderer.tsx` | 角色名和运行指示器文字不可见 |
| C4 | `--color-text-cyan-muted` | `ConversationView.tsx` | 运行时用量 badge 文字不可见 |
| C5 | `--color-bg-card` | `dialog.tsx` | Dialog 背景透明 |

### 第三类：未定义 CSS 类名（60+ 个，页面无样式）

`index.html` 引用了 `styles.css` 但该文件不存在。以下类名在组件中使用但无 CSS 定义：

**布局层（AppShell.tsx — 22 个类名）：**
`app-shell`, `sidebar`, `brand-bar`, `brand-mark`, `brand-title`, `sidebar-toggle`, `sidebar-backdrop`, `directory-switcher`, `directory-summary`, `directory-title`, `directory-chevron`, `primary-nav`, `primary-nav-button`, `sidebar-main`, `main-panel`, `boss-mentions-banner`, `view-related`, `workspace-tree`, `tree-toolbar`, `panel-title`, `button-row`, `tree-card`, `tree-workspace-list`, `context-panel`

**对话层（ConversationLayout.tsx — 14 个类名）：**
`task-board-empty`, `workspace-main`, `view-pane`, `is-active`, `top-workspace-state`, `conv-header`, `conv-back`, `conv-title-area`, `conv-title`, `conv-breadcrumb`, `conv-stage-tabs`, `secondary-button`, `conv-conv-tabs`, `ghost-button`

**消息层（ConversationView.tsx — 12 个类名）：**
`msg`, `composer`, `reply-banner`, `reply-cancel`, `composer-input-stack`, `composer-hints`, `send-hint`, `mention-status`, `mention-suggestions`, `mention-suggestion`, `mention-name`, `mention-desc`, `meta`

**上下文面板（ContextPanel.tsx — 25 个类名）：**
`context-rail`, `context-card`, `repo-context-summary-header`, `context-card-title`, `repo-context-card`, `repo-context-card-inline`, `context-line`, `context-card-header`, `workspace-progress-card`, `chip`, `chip.hot`, `participant-card`, `participant-card-head`, `participant-role`, `primary-chip`, `participant-snail`, `participant-snail-select`, `deliverable-pill`, `deliverable-pill.output`, `deliverable-pill.input`, `artifact-key`, `artifact-value`, `deliverable-remove`, `artifact-input`, `artifact-key-input`, `artifact-value-input`, `artifact-add-btn`

**组件层：**
- `BossMentionsBanner.tsx`: `boss-mentions-banner.visible`, `name`, `meta`, `boss-mention-item`
- `StageSuggestionBanner.tsx`: `stage-suggestion-banner`, `suggestion-content`, `suggestion-text`, `suggestion-reason`, `suggestion-actions`, `suggestion-confirm-btn`, `suggestion-reject-btn`
- `MessageRenderer.tsx`: `message-event-stream`, `table-title`, `permission-tool`, `permission-actions`, `card-ref`, `card-ref-title`, `card-ref-summary`, `card-ref-link`
- `MermaidDiagram.tsx`: `mermaid-diagram`, `mermaid-diagram-error`
- `ConversationSource.tsx`: `context-note`
- `WorkspaceTree.tsx`: `tree-workspace-node`, `tree-workspace`, `node-header`, `node-main`, `chevron`, `node-title`, `pending-badge`

**管理页面（7 个页面共用）：**
`.nav-item` — EvolutionCenter, SopCenter, Lobby, PromptCenter, SkillCenter

### 第四类：数据获取模式不一致

13 个页面用 `useEffect` + `api()` 直接获取数据，绕过 TanStack Query 缓存。只有 `ConversationView` 正确使用了 `useQuery`。已有的 `QueryState` 组件完全未被使用。

| 页面 | 当前方式 | 应有方式 |
|---|---|---|
| EvolutionCenter | `useEffect` + `api()` | `useQuery(evolutionQueries.list())` |
| KnowledgeLibrary | `useEffect` + `api()` | `useQuery(knowledgeQueries.list())` |
| SopCenter | `useEffect` + `api()` | `useQuery(sopQueries.list())` |
| Lobby | `useEffect` + `api()` | `useQuery(lobbyQueries.sessions())` |
| PromptCenter | `useEffect` + `api()` | `useQuery(metaQueries.prompts())` |
| SkillCenter | `useEffect` + `api()` | `useQuery(metaQueries.skills())` |
| SnailDen | `useEffect` + `api()` | `useQuery(metaQueries.snailDen())` |
| McpCenter | `useEffect` + `api()` | `useQuery(metaQueries.mcps())` |
| WorkspaceBoard | `useEffect` + `api()` | 路由 loader 已 prefetch，可保留 |
| WorkspaceConfig | `useEffect` + `api()` | 路由 loader 已 prefetch，可保留 |
| AppShell | `useEffect` + `api()` | 仅加载 context panel 数据，可保留 |

### 第五类：死代码（3 个文件）

| 文件 | 行数 | 说明 |
|---|---|---|
| `sop-center-view.js` | 186 | 遗留 vanilla JS，无任何 React 组件导入 |
| `sop-detail-view.js` | 131 | 同上 |
| `sop-form-view.js` | 347 | 同上，且导入不存在的 `./message-view.js` |

### 第六类：Dialog 组件未用 Tailwind

`dialog.tsx` 使用 inline `style={{}}` 而非 Tailwind 工具类，与项目其他组件风格不一致。且引用了未定义的 `--color-bg-card` 变量，缺少 `::backdrop` 样式。

## 目标

消除上述全部 6 类问题，使前端应用在无遗留 CSS 文件的情况下正常构建、运行、渲染。

## 实施计划

### P1 — 构建阻断修复（B1-B9）

- B1-B3: `../../types` → `../types`
- B4-B5: `conversationStore` 补充 `currentStage`/`currentConversation` 及 setter
- B6: `StageActions` API 调用改为类型安全格式
- B7: `!sidebar-expanded` → `!sidebarExpanded`
- B8: `Sop` → `SopDto`（补充 import）
- B9: `payload.text` → `payloadString(payload, "text")`

### P2 — CSS 变量补全 + Dialog 重写

- globals.css 补充 C1-C5 五个变量
- Dialog 组件重写为 Tailwind + backdrop

### P3 — Tailwind 全量迁移

按 F2026060602 规划，完成全部 60+ 个 CSS 类名到 Tailwind 的迁移。

### P4 — TanStack Query 迁移

8 个页面从 `useEffect` + `api()` 迁移到 `useQuery` + `queryOptions`。

### P5 — 死代码清理

删除 3 个遗留 vanilla JS 文件。

### P6 — 测试修复

更新因 CSS 类名变更而失败的测试用例。

## 验证 Checklist

### P1 — 构建阻断修复

- [x] `AppShell.tsx` 导入路径 `../../types` → `../types`
- [x] `WorkspaceBoard.tsx` 导入路径 `../../types` → `../types`
- [x] `WorkspaceTree.tsx` 导入路径 `../../types` → `../types`（注意：该文件在 `components/Sidebar/` 下，相对路径为 `../../types` → `../types` 不对，实际修正为从 `../../types` 到正确路径）
- [x] `conversationStore.ts` 新增 `CurrentStage` 和 `CurrentConversation` 接口
- [x] `conversationStore.ts` 新增 `currentStage`/`currentConversation` 状态字段
- [x] `conversationStore.ts` 新增 `setCurrentStage`/`setCurrentConversation` setter
- [x] `conversationStore.ts` 的 `clear()` 方法重置新字段
- [x] `ConversationLayout.tsx` 不再因 store 属性缺失而崩溃
- [x] `ContextPanel.tsx` 不再因 store 属性缺失而崩溃
- [x] `StageActions.tsx` advance 调用改为 `api("POST /api/issues/:issueId/advance", { params, body })`
- [x] `StageActions.tsx` bounce 调用改为 `api("POST /api/issues/:issueId/bounce-stage", { params, body })`
- [x] `StageActions.tsx` 自动触发消息改为 `api("POST /api/conversations/:conversationId/messages", { params, body })`
- [x] `AppShell.tsx` line 113 `!sidebar-expanded` → `!sidebarExpanded`
- [x] `WorkspaceConfig.tsx` `useState<Sop[]>` → `useState<SopDto[]>`
- [x] `WorkspaceConfig.tsx` import 补充 `SopDto`
- [x] `MessageRenderer.tsx` line 156 `payload.text` → `payloadString(payload, "text")`
- [x] `MessageRenderer.tsx` line 156 `payload.summary` → `payloadString(payload, "summary")`
- [x] `npx tsc --noEmit` 零错误

### P2 — CSS 变量补全 + Dialog 重写

- [x] `globals.css` 新增 `--color-danger-bg: rgba(248, 113, 113, 0.12)`
- [x] `globals.css` 新增 `--color-info-bg: rgba(108, 141, 250, 0.12)`
- [x] `globals.css` 新增 `--color-text-blue-muted: rgba(96, 165, 250, 0.7)`
- [x] `globals.css` 新增 `--color-text-cyan-muted: rgba(52, 211, 153, 0.7)`
- [x] `globals.css` 新增 `--color-bg-card: #0f1218`
- [x] `dialog.tsx` 从 inline styles 重写为 Tailwind 工具类
- [x] `dialog.tsx` 添加 `backdrop:bg-black/50` 样式
- [x] `index.html` 移除 `<link rel="stylesheet" href="./styles.css">`

### P3 — Tailwind 全量迁移

**AppShell.tsx（22 个类名）：**
- [x] `.app-shell` → `flex h-screen min-h-0 bg-[var(--color-bg-base)]`
- [x] `.sidebar` → `flex flex-col w-[var(--sidebar-width)] shrink-0 bg-[var(--color-bg-surface)] border-r ...`
- [x] `.brand-bar` → `flex items-center gap-[var(--space-sm)] p-[var(--space-md)] border-b ...`
- [x] `.brand-mark` → `w-7 h-7 rounded-[var(--radius-md)] bg-[var(--color-accent)] ...`
- [x] `.brand-title` → `text-sm font-semibold text-[var(--color-text-primary)]`
- [x] `.sidebar-toggle` → `md:hidden p-[var(--space-sm)] text-[var(--color-text-muted)]`
- [x] `.sidebar-backdrop` → `fixed inset-0 z-40 bg-black/50`
- [x] `.directory-switcher` → `flex flex-col min-h-0`
- [x] `.directory-summary` → `flex items-center justify-between px-... py-...`
- [x] `.directory-title` → `font-semibold text-[var(--color-text-secondary)]`
- [x] `.directory-chevron` → `text-[10px]`
- [x] `.primary-nav` → `flex flex-col gap-px px-[var(--space-xs)]`
- [x] `.primary-nav-button` → 条件 Tailwind 类（active: `bg-[var(--color-bg-active)] text-[var(--color-accent)]`，inactive: `text-[var(--color-text-secondary)] hover:...`）
- [x] `.sidebar-main` → `flex-1 min-h-0 overflow-auto`
- [x] `.main-panel` → `flex-1 min-w-0 flex flex-col overflow-hidden`
- [x] `.context-panel` → `w-[var(--context-panel-width)] shrink-0 bg-[var(--color-bg-surface)] border-l ...`
- [x] `.workspace-tree` → `flex flex-col min-h-0`
- [x] `.tree-toolbar` → `flex items-center justify-between px-... py-...`
- [x] `.panel-title` → `text-xs font-semibold text-[var(--color-text-muted)]`
- [x] `.button-row` →（内联在 tree-toolbar 中）
- [x] `.tree-card` → `flex-1 min-h-0 overflow-auto px-[var(--space-sm)]`
- [x] `.tree-workspace-list` →（内联在 tree-card 中）

**ConversationLayout.tsx（14 个类名）：**
- [x] `.task-board-empty` → `flex items-center justify-center h-full text-[var(--color-text-muted)] text-[13px]`
- [x] `.workspace-main` → `flex flex-col h-full min-h-0 overflow-hidden`
- [x] `.view-pane` →（合并到 workspace-main）
- [x] `.is-active` →（移除，不需要）
- [x] `.top-workspace-state` →（移除，空 div）
- [x] `.conv-header` → `flex items-center gap-[var(--space-md)] px-... py-... border-b ...`
- [x] `.conv-back` → `p-[var(--space-xs)] text-[var(--color-text-muted)] hover:text-...`
- [x] `.conv-title-area` → `flex-1 min-w-0`
- [x] `.conv-title` → `text-sm font-semibold text-[var(--color-text-primary)] truncate`
- [x] `.conv-breadcrumb` → `text-[11px] text-[var(--color-text-grey)] truncate`
- [x] `.conv-stage-tabs` → `flex gap-[var(--space-xs)] px-... py-... border-b ... overflow-x-auto`
- [x] `.secondary-button` → 条件 Tailwind 类（active: `border-[var(--color-accent)] bg-[rgba(108,141,250,0.08)] text-[var(--color-accent)]`）
- [x] `.conv-conv-tabs` → `flex gap-[var(--space-xs)] px-... py-... border-b ... overflow-x-auto`
- [x] `.ghost-button` → 条件 Tailwind 类（active: `bg-[var(--color-bg-active)] text-[var(--color-accent)]`）

**ConversationView.tsx（12 个类名）：**
- [x] `.msg` → 保留为语义标记（已有完整 Tailwind 类）
- [x] `.composer` → `border-t border-[var(--color-border-muted)] bg-[var(--color-bg-base)] p-...`
- [x] `.reply-banner` → `flex items-center justify-between mb-... px-... py-... bg-[var(--color-bg-elevated)] rounded-...`
- [x] `.reply-cancel` → `text-[var(--color-text-muted)] hover:text-... text-xs`
- [x] `.composer-input-stack` → `flex flex-col gap-[var(--space-xs)]`
- [x] `.composer-hints` → `flex items-center gap-[var(--space-md)] text-[var(--font-size-xs)] text-[var(--color-text-grey)]`
- [x] `.send-hint` → 直接文本（无额外样式）
- [x] `.mention-status` → `text-[var(--color-accent)]`
- [x] `.mention-suggestions` → `absolute bottom-full left-0 right-0 mb-1 bg-[var(--color-bg-elevated)] border ...`
- [x] `.mention-suggestion` → 条件 Tailwind 类（selected: `bg-[var(--color-bg-active)] text-[var(--color-accent)]`）
- [x] `.mention-name` → `font-semibold`
- [x] `.mention-desc` → `text-[var(--color-text-grey)] text-[var(--font-size-xs)]`
- [x] `.meta` →（移除，未使用）

**ContextPanel.tsx（25 个类名）：**
- [x] `.context-rail` → `flex flex-col gap-[var(--space-sm)] p-[var(--space-md)]`
- [x] `.context-card` → `bg-[var(--color-bg-elevated)] rounded-[var(--radius-md)] overflow-hidden`
- [x] `.repo-context-summary-header` → `flex items-center justify-between px-... py-... border-b ...`
- [x] `.context-card-title` → `text-xs font-semibold text-[var(--color-text-primary)]`
- [x] `.repo-context-card` → `p-[var(--space-md)]`
- [x] `.repo-context-card-inline` →（合并到 repo-context-card）
- [x] `.context-line` → `flex items-center justify-between py-[var(--space-xs)] text-[var(--font-size-xs)]`
- [x] `.context-card-header` → `flex items-center justify-between px-... py-... border-b ...`
- [x] `.workspace-progress-card` →（合并到 context-card）
- [x] `.chip` → `inline-flex items-center px-[var(--space-xs)] py-px rounded-... text-[10px] font-medium`
- [x] `.chip.hot` → `bg-[rgba(108,141,250,0.12)] text-[var(--color-accent)]`
- [x] `.participant-card` → `p-[var(--space-sm)] bg-[var(--color-bg-deep)] rounded-...`
- [x] `.participant-card-head` → `flex items-center justify-between`
- [x] `.participant-role` → `flex items-center gap-[var(--space-xs)] text-... text-[var(--color-text-primary)]`
- [x] `.primary-chip` → `text-[9px] px-1 py-px rounded-[3px] bg-[rgba(108,141,250,0.12)] text-[var(--color-accent)]`
- [x] `.participant-snail` → `text-[10px] text-[var(--color-text-grey)]`
- [x] `.participant-snail-select` → `text-[10px] px-[var(--space-xs)] py-px rounded-... bg-[var(--color-bg-input)] border ...`
- [x] `.deliverable-pill` → `flex items-center gap-[var(--space-xs)] py-[var(--space-xs)] px-[var(--space-sm)] mb-... rounded-... text-[var(--font-size-xs)]`
- [x] `.deliverable-pill.output` → `bg-[rgba(108,141,250,0.06)]`
- [x] `.deliverable-pill.input` → `bg-[rgba(52,211,153,0.06)]`
- [x] `.artifact-key` → `font-semibold text-[var(--color-accent)]`
- [x] `.artifact-value` → `flex-1 text-[var(--color-text-secondary)] truncate`
- [x] `.deliverable-remove` → `text-[var(--color-text-muted)] hover:text-[var(--color-danger-text)] text-sm`
- [x] `.artifact-input` → `flex-1 min-w-0 text-[var(--font-size-xs)] px-... py-... bg-[var(--color-bg-input)] border ...`
- [x] `.artifact-key-input` →（合并到 artifact-input）
- [x] `.artifact-value-input` →（合并到 artifact-input）
- [x] `.artifact-add-btn` → `shrink-0 text-[var(--font-size-xs)] px-... py-... bg-[var(--color-accent)] text-[var(--color-background)] rounded-...`

**组件层：**
- [x] `BossMentionsBanner.tsx` — 4 个类名全部迁移到 Tailwind
- [x] `StageSuggestionBanner.tsx` — 7 个类名全部迁移到 Tailwind
- [x] `StageActions.tsx` — 2 个类名全部迁移到 Tailwind
- [x] `WorkspaceTree.tsx` — 7 个类名全部迁移到 Tailwind
- [x] `ConversationSource.tsx` — 1 个类名迁移到 Tailwind
- [x] `MessageRenderer.tsx` — 8 个类名全部迁移到 Tailwind
- [x] `MermaidDiagram.tsx` — 2 个类名全部迁移到 Tailwind

**管理页面 `.nav-item`：**
- [x] `EvolutionCenter.tsx` — `.nav-item` → 条件 Tailwind 类
- [x] `SopCenter.tsx` — `.nav-item` → 条件 Tailwind 类
- [x] `Lobby.tsx` — `.nav-item` → 条件 Tailwind 类
- [x] `PromptCenter.tsx` — `.nav-item` → 条件 Tailwind 类
- [x] `SkillCenter.tsx` — `.nav-item` → 条件 Tailwind 类

**左侧面板布局（inline styles → Tailwind）：**
- [x] `EvolutionCenter.tsx` — `width: 300` → `w-[300px] shrink-0`，`flex: 1` → `flex-1`
- [x] `SopCenter.tsx` — `width: 280` → `w-[280px] shrink-0`，`flex: 1` → `flex-1`
- [x] `Lobby.tsx` — `width: 280` → `w-[280px] shrink-0`，`flex: 1` → `flex-1`
- [x] `PromptCenter.tsx` — `width: 260` → `w-[260px] shrink-0`，`flex: 1` → `flex-1`
- [x] `SkillCenter.tsx` — `width: 260` → `w-[260px] shrink-0`，`flex: 1` → `flex-1`

### P4 — TanStack Query 迁移

- [x] `EvolutionCenter.tsx` — `useEffect` + `api()` → `useQuery(evolutionQueries.list())` + `useQueryClient().invalidateQueries()`
- [x] `KnowledgeLibrary.tsx` — `useEffect` + `api()` → `useQuery(knowledgeQueries.list({ scope }))` × 2
- [x] `SopCenter.tsx` — `useEffect` + `api()` → `useQuery(sopQueries.list())` + `useQueryClient().invalidateQueries()`
- [x] `Lobby.tsx` — `useEffect` + `api()` → `useQuery(lobbyQueries.sessions())` + `useQueryClient().invalidateQueries()`
- [x] `PromptCenter.tsx` — `useEffect` + `api()` → `useQuery(metaQueries.prompts())`
- [x] `SkillCenter.tsx` — `useEffect` + `api()` → `useQuery(metaQueries.skills())`
- [x] `SnailDen.tsx` — `useEffect` + `api()` → `useQuery(metaQueries.snailDen())`
- [x] `McpCenter.tsx` — `useEffect` + `api()` → `useQuery(metaQueries.mcps())`

### P5 — 死代码清理

- [x] 删除 `src/web/sop-center-view.js`（186 行）
- [x] 删除 `src/web/sop-detail-view.js`（131 行）
- [x] 删除 `src/web/sop-form-view.js`（347 行）

### P6 — 测试修复

- [x] `AppShell.test.tsx` — `.primary-nav-button` 选择器改为 `aria-current="page"` 断言
- [x] `AppShell.test.tsx` — `.app-shell` 选择器改为 `[data-primary-view]` 属性选择器
- [x] `ConversationLayout.test.tsx` — `.conv-title` 选择器改为 `screen.getAllByText()` 断言
- [x] `ConversationLayout.test.tsx` — `.conv-breadcrumb` 选择器改为 `screen.getByText(/workspace/)` 断言
- [x] `ConversationLayout.test.tsx` — mock 策略从 `mockResolvedValueOnce` 链改为 `mockImplementation` 按 endpoint 分发

### P7 — 检视意见修复

- [x] Item 1 类型一致性：`conversationStore` 从自定义接口改为 `Pick<StageDetailDto>`/`Pick<ConversationDto>`
- [x] Item 2 ConversationLayout 迁移：`useEffect` + `api()` → `useQuery(issueQueries.detail())` + `useQuery(sopQueries.detail())` + `useQuery(issueQueries.stageConversations())`
- [x] Item 2 新增 `issueQueries`：`detail()` 和 `stageConversations()` 添加到 `workspace.queries.ts`
- [x] Item 3 全局错误处理：`queryClient` 添加 `QueryCache.subscribe` 自动 `showToast`
- [x] Item 4 StageActions 合并：两个 select 合并为一个 select + 两个按钮（推进/转移）
- [x] Item 6 CSS 变量命名：`--color-danger-bg` → `--color-bg-danger`，`--color-info-bg` → `--color-bg-info`
- [x] Item 6 Toast 组件：inline styles 重写为 Tailwind
- [x] 测试修复：StageActions 按钮文字 "推进阶段" → "推进"，Toast 断言改为 Tailwind class

### 构建验证

- [x] `npx tsc --noEmit` — 零类型错误
- [x] `npx vite build --config src/web/vite.config.ts` — 构建成功
- [x] `npx vitest run --config src/web/vitest.config.ts` — 54 测试全部通过（11 个测试文件）
- [x] `npx eslint src/web/` — 零 lint 错误
- [x] `npm run test`（全量后端 + 前端测试）— 全部通过（39 个后端测试文件 + 11 个前端测试文件）

## 改动范围

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `src/web/layouts/AppShell.tsx` | 修改 | 导入路径修复 + sidebar-expanded 修复 + 22 个 CSS 类名迁移到 Tailwind |
| `src/web/stores/conversationStore.ts` | 修改 | 新增 CurrentStage/CurrentConversation 接口和 4 个状态字段 |
| `src/web/components/StageActions.tsx` | 修改 | API 调用签名修复 + 2 个 CSS 类名迁移 |
| `src/web/pages/WorkspaceBoard.tsx` | 修改 | 导入路径修复 |
| `src/web/pages/WorkspaceConfig.tsx` | 修改 | Sop → SopDto 类型修复 |
| `src/web/pages/ConversationLayout.tsx` | 修改 | 14 个 CSS 类名迁移到 Tailwind |
| `src/web/pages/ConversationView.tsx` | 修改 | 12 个 CSS 类名迁移到 Tailwind |
| `src/web/components/ContextPanel.tsx` | 修改 | 25 个 CSS 类名迁移到 Tailwind |
| `src/web/components/BossMentionsBanner.tsx` | 修改 | 4 个 CSS 类名迁移到 Tailwind |
| `src/web/components/StageSuggestionBanner.tsx` | 修改 | 7 个 CSS 类名迁移到 Tailwind |
| `src/web/components/Sidebar/WorkspaceTree.tsx` | 修改 | 导入路径修复 + 7 个 CSS 类名迁移 |
| `src/web/components/ConversationSource.tsx` | 修改 | 1 个 CSS 类名迁移 |
| `src/web/components/MessageRenderer.tsx` | 修改 | unknown 类型守卫修复 + 8 个 CSS 类名迁移 |
| `src/web/components/MermaidDiagram.tsx` | 修改 | 2 个 CSS 类名迁移 |
| `src/web/components/ui/dialog.tsx` | 修改 | inline styles → Tailwind + backdrop |
| `src/web/globals.css` | 修改 | 新增 5 个 CSS 变量 |
| `src/web/index.html` | 修改 | 移除 styles.css 引用 |
| `src/web/pages/EvolutionCenter.tsx` | 修改 | TanStack Query 迁移 + .nav-item + 布局 Tailwind |
| `src/web/pages/KnowledgeLibrary.tsx` | 修改 | TanStack Query 迁移 |
| `src/web/pages/SopCenter.tsx` | 修改 | TanStack Query 迁移 + .nav-item + 布局 Tailwind |
| `src/web/pages/Lobby.tsx` | 修改 | TanStack Query 迁移 + .nav-item + 布局 Tailwind |
| `src/web/pages/PromptCenter.tsx` | 修改 | TanStack Query 迁移 + .nav-item + 布局 Tailwind |
| `src/web/pages/SkillCenter.tsx` | 修改 | TanStack Query 迁移 + .nav-item + 布局 Tailwind |
| `src/web/pages/SnailDen.tsx` | 修改 | TanStack Query 迁移 |
| `src/web/pages/McpCenter.tsx` | 修改 | TanStack Query 迁移 |
| `src/web/sop-center-view.js` | 删除 | 遗留 vanilla JS 死代码 |
| `src/web/sop-detail-view.js` | 删除 | 遗留 vanilla JS 死代码 |
| `src/web/sop-form-view.js` | 删除 | 遗留 vanilla JS 死代码 |
| `src/web/tests/AppShell.test.tsx` | 修改 | CSS 类选择器改为语义属性断言 |
| `src/web/tests/ConversationLayout.test.tsx` | 修改 | mock 策略和断言修复 |

## 统计

- 文件变更：30 个（27 修改 + 3 删除）
- 代码行数：-1024 行 / +333 行（净减少 691 行）
- 消除未定义 CSS 类名：60+ 个
- 修复构建阻断：9 个
- 补充 CSS 变量：5 个
- 迁移到 TanStack Query：8 个页面
- 删除死代码：664 行

## 关联

- **前置**: F2026060504（API Contract Layer）— 建立了类型安全的 API 层，但 UI 组件未完全适配
- **前置**: F2026060602（Tailwind 迁移规划）— 规划了迁移方案，本 feature 执行实施
- **前置**: F2026060501（UI 层 Bug 修复）— 修复了部分类型错误，本 feature 修复剩余问题
