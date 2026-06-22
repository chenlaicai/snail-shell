---
id: F2026062202
title: breadcrumb-navigation-consistency
from_ids: []
tags: [ui, navigation, breadcrumb]
modules: [web]
doc_kind: spec
---

# F2026062202 [web] 面包屑导航路径格式统一化

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

当前 Workspaces 模块的面包屑导航在不同页面间格式不一致，导致用户认知负担：

- **WorkspaceDirectory（Workspaces列表页）**：只有 `Workspaces` 一级
- **IssueBoard / IssueList（Workspace内的Board/List页）**：`Workspace名称 > Board/List`，缺少"Workspaces"一级链接
- **IssueConversation（具体Issue页）**：完整的 `Workspaces > Workspace名称 > Issue标题` 三级结构

这种不一致导致用户在导航时产生认知混乱：当从Issue页回到Board页时，面包屑结构突然变化，破坏了用户的空间定位感。

**现状代码分析**：

| 页面 | 文件 | 当前面包屑结构 |
|------|------|---------------|
| WorkspaceDirectory | `src/web/pages/WorkspaceDirectory.tsx:13` | `[{ label: "Workspaces" }]` |
| IssueBoard | `src/web/pages/IssueBoard.tsx:33-36` | `[{ label: workspace.path, to: board }, { label: "Board" }]` |
| IssueList | `src/web/pages/IssueList.tsx:42-45` | `[{ label: workspace.path, to: board }, { label: "List" }]` |
| IssueConversation | `src/web/pages/IssueConversation.tsx:116-120` | `[{ label: "Workspaces", to: "/workspaces" }, { label: workspace.summary ?? workspace.path, to: board }, { label: issue.title }]` |

**补充**：WorkspaceConfig（新建 Workspace 页）已有完整根节点 `Workspaces > New`，无需修改。

## 目标

统一 Workspaces 模块内的面包屑导航格式，确保用户在任何层级都能清晰感知当前位置和完整的导航路径。

**核心原则**：
- 面包屑反映完整的导航层级，不因页面类型而省略
- Workspace 显示名称保持一致（优先使用 `summary`，无 `summary` 时使用 `path`）
- 每个层级都提供可点击的链接（当前层级除外）

## 非目标

- 不涉及 Workspaces 模块以外的页面（如 Lobby、SopCenter 等）
- 不改变现有的路由结构
- 不改变页面功能逻辑

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当用户在 Workspaces 列表页时 | 面包屑显示 `Workspaces`（一级，当前页，不可点击）**现有行为，无需修改** | |
| B2 | 当用户在某个 Workspace 的 Board 或 List 页时 | 面包屑显示 `Workspaces > Workspace名称 > Board/List`（三级完整结构，Workspaces 和 Workspace 名称可点击） | |
| B3 | 当用户在某个 Issue 对话页时 | 面包屑显示 `Workspaces > Workspace名称 > Issue标题`（三级完整结构，Workspaces 和 Workspace 名称可点击） | |
| B4 | 当 Workspace 有 summary 时 | 面包屑中 Workspace 显示 summary | |
| B5 | 当 Workspace 无 summary 时 | 面包屑中 Workspace 显示 path | |
| B6 | 当 Workspace 的 summary 为空字符串 `""` 时 | 面包屑中 Workspace 显示 path（空字符串视为"无 summary"） | |
| B7 | 当 workspace 数据加载中时 | 面包屑保持完整层级结构，workspace 名称显示为 "Loading..."（如 `Workspaces > Loading... > Board`） | |

## 设计

### 设计方案

**统一的面包屑结构**：

1. **Workspaces 列表页** (`/workspaces`)
   ```
   Workspaces
   ```

2. **Workspace 内的 Board/List 页** (`/workspaces/:workspaceId/board` 或 `/list`)
   ```
   Workspaces > [Workspace名称] > Board/List
   ```
   - "Workspaces" 链接到 `/workspaces`
   - "Workspace名称" 链接到 `/workspaces/:workspaceId/board`
   - "Board/List" 为当前页，不可点击

3. **Issue 对话页** (`/workspaces/:workspaceId/issues/:issueId`)
   ```
   Workspaces > [Workspace名称] > [Issue标题]
   ```
   - "Workspaces" 链接到 `/workspaces`
   - "Workspace名称" 链接到 `/workspaces/:workspaceId/board`
   - "Issue标题" 为当前页，不可点击

**Workspace 显示名称逻辑**：
```typescript
// || not ??: empty string should fall back to path (see D3)
wsLoading ? "Loading..." : (workspace?.summary || workspace?.path || workspaceId || "")
```

### 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | Workspace 显示名称使用 summary 还是 path？ | summary 更友好，是用户为 workspace 设置的人类可读描述 | path 是创建时必填的标识符，更稳定 | 优先使用 summary，无 summary 时降级到 path | 用户体验优先，summary 更能帮助用户识别 workspace | 架构师-1 | 2026-06-22 |
| D2 | IssueBoard/IssueList 是否需要添加 "Workspaces" 一级？ | 保持与 IssueConversation 一致，用户可快速返回 workspace 列表 | 增加面包屑长度，可能略显冗余 | 统一添加 "Workspaces" 一级 | 一致性优先，且提供了快速导航到顶层的便利 | 架构师-1, 架构师-2 | 2026-06-22 |
| D3 | 降级运算符使用 `??` 还是 `\|\|`？ | `\|\|` 能正确处理空字符串降级（`""` 视为无 summary） | `??` 只处理 `null/undefined`，空字符串不会降级 | 使用 `\|\|` | `summary` 允许为空字符串，需确保空字符串也降级到 `path` | 架构师-1, 架构师-2 | 2026-06-22 |
| D4 | 面包屑逻辑是每个页面独立维护还是提取到路由层自动注入？ | 当前方案简单直接，修改范围小（3 文件） | 每个页面独立维护有长期维护风险，新增页面可能再次遗漏根节点 | 采用每个页面独立维护的简单方案 | 修改范围小（3 文件），提取成本高于收益；未来若新增更多 workspace 子页面，可再评估 | 架构师-1, 架构师-2 | 2026-06-22 |

## 生效路径

- TopBar 组件保持不变（`src/web/components/TopBar.tsx`），由各页面传入统一格式的 breadcrumbs 数组
- 页面文件：`src/web/pages/IssueBoard.tsx`、`src/web/pages/IssueList.tsx`、`src/web/pages/IssueConversation.tsx`

## 设计约束摘要

- **边界**：只修改 Workspaces 模块内的面包屑逻辑，不影响其他模块
- **关键决策**：
  - Workspace 显示名称优先使用 `summary`，无 `summary` 时使用 `path`
  - **降级逻辑必须使用 `\|\|` 而非 `??`**：`summary` 允许为空字符串，`??` 不会将空字符串降级到 `path`
  - IssueBoard 和 IssueList 需要添加 "Workspaces" 一级链接
- **语义不变量**：
  - 面包屑必须反映完整的导航层级
  - 当前页面在面包屑中不可点击
  - 非当前页面必须提供可点击链接
- **已知约束**：
  - Workspace 名称链接始终指向 Board 页（`/workspaces/:workspaceId/board`），不记忆用户上次的视图选择

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 改动内容 |
|------|----------|
| `src/web/pages/IssueBoard.tsx` | 修改面包屑配置，添加 "Workspaces" 一级 |
| `src/web/pages/IssueList.tsx` | 修改面包屑配置，添加 "Workspaces" 一级 |
| `src/web/pages/IssueConversation.tsx` | 统一 Workspace 显示名称逻辑 |

## 验证

- [ ] 在 Workspaces 列页面包屑显示为 `Workspaces`
- [ ] 在任意 Workspace 的 Board 页，面包屑显示为 `Workspaces > [Workspace名称] > Board`
- [ ] 在任意 Workspace 的 List 页，面包屑显示为 `Workspaces > [Workspace名称] > List`
- [ ] 在 Issue 对话页，面包屑显示为 `Workspaces > [Workspace名称] > [Issue标题]`
- [ ] 点击面包屑中的 "Workspaces" 能正确跳转到 `/workspaces`
- [ ] 点击面包屑中的 Workspace 名称能正确跳转到对应 workspace 的 board 页
- [ ] 当 Workspace 有 summary 时，面包屑显示 summary
- [ ] 当 Workspace 无 summary 时，面包屑显示 path
- [ ] 当 Workspace 的 summary 为空字符串 `""` 时，面包屑显示 path
- [ ] 当 workspace 数据加载中时，面包屑保持完整层级结构，workspace 名称显示为 "Loading..."

## 关联

无

## 关键决策记录

见设计章节中的决策记录表格。
