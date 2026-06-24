---
id: F2026062401
title: issue-ui-missing-wiring
from_ids: [F2026062309, F2026062303]
tags: [issue, close, context, ui, bugfix]
modules: [web]
doc_kind: spec
change_type: bugfix
---

# F2026062401 [web] 补全 Issue 级 UI 缺失的两处接线

## 背景

两个特性（F2026062309 关闭机制、F2026062303 上下文管理）的后端链路均已就绪，但前端各有一处未接线：

### 缺失 1：关闭按钮

F2026062309 实现了 Issue 关闭的完整后端链路和前端状态展示，但遗漏了 UI 触发入口：

- 后端 `POST /api/issues/:issueId/close` 已就绪
- 前端 `useCloseIssue` mutation hook 已定义但无组件 import
- UI 已处理"已关闭"状态（只读输入、隐藏操作栏），但用户无法触发关闭

根因：F2026062309 的 B1 写成"When 用户调用 `POST /api/issues/:issueId/close`"，把 API 调用当成了用户行为，导致文档只覆盖了后端链路，漏掉了 UI 入口。

### 缺失 2：Issue 上下文展示

F2026062303 实现了 Issue 上下文的存储、API 返回、MCP 工具读写、Agent system reminder 注入，但 PropertiesPanel 的 "Context" 区域渲染的是 `currentStage.output_artifacts`（stage 级产物），不是 `issue.context`（issue 级上下文）。

- `issue.context` 已随 API 响应返回，前端 `IssueDetailDto` 已包含 `context` 字段
- PropertiesPanel 从未读取 `issue.context`，错误地将 `output_artifacts` 标记为 "Context"

## 目标

1. 在 StageActionBar 中新增 Close Issue 按钮，让用户能在对话界面直接关闭当前 Issue
2. PropertiesPanel 的 "Context" 区域改为渲染 `issue.context`，展示 Agent 通过 MCP 工具写入的 issue 级上下文

## 非目标

- 不修改后端链路（已由 F2026062309 / F2026062303 完成）
- 不重命名 StageActionBar 组件
- 不新增独立的"用户交互流"文档段落（通过 checklist 规则解决）
- 不在 PropertiesPanel 中展示 `output_artifacts`（stage 级产物，本次修正将其从 issue 级 Context 区域移除；`output_artifacts` 的 UI 入口由 F2026062303 / `feature-stage-artifact-handoff` 分支负责补上）

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | When 用户在 Issue 对话界面点击"Close Issue"按钮 | 弹出确认对话框："确认关闭此 Issue？关闭后对话保留为只读" | 手动测试 |
| B2 | When 用户确认关闭 | 调用 `useCloseIssue`，界面自动切换为只读模式（`closed_at` 变更触发 query 重新渲染） | 手动测试 |
| B3 | When 用户取消关闭 | 确认对话框关闭，无任何操作 | 手动测试 |
| B4 | When Issue 已关闭 | StageActionBar 整体不渲染（现有逻辑 `issue.closed_at` 守卫），只读消息替代 ChatInput | 已有覆盖 |
| B5 | When 用户打开 Issue 侧边栏 | PropertiesPanel 的 "Context" 区域展示 `issue.context` 的 key-value 列表 | 手动测试 |
| B6 | When `issue.context` 为空 | "Context" 区域不渲染（与现有 Section 空值隐藏逻辑一致） | 手动测试 |

## 设计

### 1. Close 按钮位置

在 StageActionBar 中，Close Issue 按钮放在 Advance Stage 按钮右侧，用视觉分隔区分两类操作：

```
┌──────────────────────────────────────────────────────────┐
│ Stage Actions   [Select target...] [Advance] ··· [Close] │
└──────────────────────────────────────────────────────────┘
       stage 级操作（左侧）              issue 级操作（右侧）
```

- Advance 按钮：现有蓝色主色调（`bg-shell-600`）
- Close 按钮：灰色低调样式（`bg-surface-0` 边框），表示破坏性操作
- 两者之间用间距（`flex-1` 或固定间距）视觉分隔

### 2. Close 按钮可见性条件

StageActionBar 现有守卫不变：

```tsx
if (!currentStage || issue.closed_at || currentStage.status !== "in_progress") return null;
```

Close 按钮始终在 bar 内渲染（不受 `transitions.length` 影响），因为关闭是 issue 级操作，不依赖 stage 是否有出边。

### 3. Close 交互流程

1. 用户点击 "Close Issue" → `window.confirm("确认关闭此 Issue？关闭后对话保留为只读")`
2. 用户确认 → 调用 `useCloseIssue(issue.id)`
3. 成功 → `closed_at` 变更，React Query 自动重新渲染：
   - StageActionBar 消失（`issue.closed_at` 守卫）
   - ChatInput 替换为只读消息（现有逻辑）
4. 失败 → `showToast` 显示错误信息

### 4. PropertiesPanel Context 区域

将 "Context" 区域的数据源从 `currentStage.output_artifacts` 改为 `issue.context`：

- Section 标题保持 "Context"
- 渲染 `Object.entries(issue.context)` 的 key-value 列表
- 空值时不渲染整个 Section（与现有逻辑一致）
- 样式保持不变：key 用 `font-mono shell-400`，value 用 `text-text-secondary`

### 5. 流程改进：审查 checklist

在特性文档审查 checklist 中新增规则：

> 涉及用户操作的 B 条目，触发条件必须是用户可见的动作（点击、输入、选择），不能是 API 调用或系统内部事件。如果 B 条目的触发条件是"调用 XX API"或"系统 XX"，标记为 incomplete。

## 生效路径

- `src/web/components/StageActionBar.tsx` — 新增 Close Issue 按钮，引入 `useCloseIssue`，添加 confirm 交互
- `src/web/components/PropertiesPanel.tsx` — "Context" 区域数据源从 `currentStage.output_artifacts` 改为 `issue.context`
- `src/web/mutations/issue.mutations.ts` — 无需修改（`useCloseIssue` 已存在）

## 改动范围

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/web/components/StageActionBar.tsx` | 修改 | 新增 Close Issue 按钮（右侧灰色样式），引入 `useCloseIssue`，添加 confirm 对话框 |
| `src/web/components/PropertiesPanel.tsx` | 修改 | "Context" 区域数据源从 `currentStage.output_artifacts` 改为 `issue.context` |

## 验证

- [ ] Close 按钮在 StageActionBar 中可见（issue 未关闭、stage in_progress 时）
- [ ] 点击 Close 弹出确认对话框
- [ ] 确认后 Issue 关闭，界面切换为只读
- [ ] 取消后无操作
- [ ] 单阶段 SOP（无 transitions）时 Close 按钮仍可用
- [ ] Issue 已关闭时不显示 StageActionBar
- [ ] PropertiesPanel "Context" 区域展示 `issue.context` key-value 列表
- [ ] `issue.context` 为空时 "Context" 区域不渲染
- [ ] TypeScript 编译通过
- [ ] ESLint 通过
- [ ] Vite 构建通过
