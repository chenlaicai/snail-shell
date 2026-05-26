---
id: F2026052203
title: Feature Context 面板修复
from_ids: []
tags: [context]
modules: [project_management]
---
# F2026052203 Feature Context 面板修复

## 背景

当前 Snail Shell 侧边栏中，Feature Context 卡片通过 `output_artifacts` 展示分支、worktree、PR 等产物信息。F2026052201（切换 Role Snail）已将"Repository Context"卡片重构为通用的 Feature Context 卡片，展示任意 key-value 输出产物对，并支持直接添加/删除。

但在实际使用中发现两个问题：

1. **数据丢失 bug**：Feature Context 侧栏添加/删除输出产物后只更新内存 state，不重新渲染卡片。连续添加两个产物时，闭包中的 `stage` 变量始终是旧版本，第二次 PATCH 会覆盖前一次产物。

2. **错误信息吞没**：`createNextStage`（推进阶段）和 `restartDevelopmentCycle`（重开研发）两个异步操作未包裹 try-catch，失败时静默崩溃，用户无任何错误提示。

## 目标

1. 修复 Feature Context 侧栏连续添加/删除产物时数据覆盖丢失的 bug
2. 为推进阶段和重开研发两个关键操作添加错误提示
3. 统一"当前推进"卡片和 Feature Context 侧栏的输出产物 UI 和代码架构
4. 确保所有产物操作在服务端持久化后重新渲染，闭包不持有过时 state

## 非目标

- 不修改后端 API 或数据库 schema
- 不修改 output_artifacts 的数据结构
- 不修改其他卡片（如项目摘要）的渲染逻辑

## 设计

### 数据丢失根因

`repo-context-view.js` 中 `renderRepoContextCard` 的 `addOutputArtifact` 和 `removeOutputArtifact` 函数使用闭包 `stage` 变量构造 PATCH 请求。首次 PATCH 后 `onUpdated(updated)` 更新了 `state.currentStage`，但闭包 `stage` 仍是旧对象引用。第二次操作从旧 `stage.output_artifacts` 构造 current，不包含前一次的结果，导致覆盖。

相比之下，`workspace-context.js` 中"当前推进"卡片的产物操作使用 `state.currentStage`（总是最新引用），并在操作成功后调用 `onRefresh()` 重新渲染整个 context rail。

### 修复方案

在 `addOutputArtifact` 和 `removeOutputArtifact` 中：
1. PATCH 成功后清除输入框（add 时）
2. 调用 `onRefresh?.()` 触发完整 context rail 重渲染（同时刷新侧栏 Feature Context 卡片和"当前推进"卡片）
3. `onRefresh` 由 `renderContextRail` 传递闭包引用，与"当前推进"卡片的产物操作使用相同机制

此方案避免侧栏卡片和推进卡片展示不一致，且与 `workspace-context.js` 版本逻辑完全对齐。

### 错误提示

`app.js` 中 `createNextStage` 和 `restartDevelopmentCycle` 包裹 try-catch，失败时展示 `showNotice` 并使用具名 `result` 变量（`let result; try { result = ...; }`），避免可选链反模式。

### 产物 UI 统一

- "当前推进"卡片和 Feature Context 侧栏的产物输入框使用统一的 CSS class：`.artifact-input`、`.artifact-key-input`、`.artifact-value-input`
- 两者均有 `datalist` 提供 `branch_name`/`worktree_path`/`pr_url` 建议
- 产物 pill 展示使用相同的 DOM 结构
- `feature-workflow-state.js` 中新增 `featureAllArtifacts` 导出，`hasFeatureRepoContext` 改为基于 `Object.keys` 判断

### 架构对齐

- `repo-context-view.js` 不再依赖 `feature-workflow-state.js` 的 `featureRepoContextFields`/`hasFeatureRepoContext`，直接内联 `getArtifactsRecord` helper
- `editRepoContext` 简化为纯兼容 stub（通知用户在卡片内直接操作）
- `workspace-context.js` 提取独立的 `upsertOutputArtifact`/`deleteOutputArtifact`/`getArtifactsRecord` 函数，与 `repo-context-view.js` 逻辑对齐

## 改动范围

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `src/web/repo-context-view.js` | 修改 | PATCH 后触发 onRefresh 完整 context rail 刷新；内联 `getArtifactsRecord`；编辑按钮移除 |
| `src/web/workspace-context.js` | 修改 | `renderContextRail` 传递 `onRefresh` 到侧栏卡片；提取产物操作函数；统一 UI |
| `src/web/app.js` | 修改 | `editRepoContext` 简化调用；`createNextStage`/`restartDevelopmentCycle` 添加 try-catch |
| `src/web/feature-workflow-state.js` | 修改 | 新增 `featureAllArtifacts`；`hasFeatureRepoContext` 改为 key count 判断 |
| `src/web/styles/components/context-panel.css` | 修改 | 新增 `.artifact-key-input` 宽度约束、`.feature-context-pills`、`.feature-context-warning` 样式 |
| `src/web/ui-shell.js` | 修改 | 侧边栏标题改为"Feature Context"；移除"记录"按钮 |
| `.meta/prompts/prompts/S-03-研发者手册.md` | 修改 | 补强 `record-feature-repo-context` 的 [HARD] 规范 |
| `.meta/skills/developer-handbook/SKILL.md` | 修改 | `record-feature-repo-context` 步骤升级为 [HARD] |

## 验证

1. **手动验证**：在 Feature Context 侧栏连续添加 `branch_name` 和 `worktree_path`，确认两者均保留
2. **手动验证**：在"当前推进"卡片连续添加产物，确认不丢失
3. **手动验证**：强制推进阶段失败（如 stage 已有同名产物），确认错误提示出现
4. **自动化测试**：`npm run lint` 和 `npm run test` 通过

## 范围变更记录

### 变更 1（检视修复：编号冲突 + 卡片同步）

- **原编号**：F2026052202
- **现编号**：F2026052203
- **原因**：`origin/main` 中 `F2026052202` 已被知识治理占用；rebase 后重命名 feature 文档

### 变更 2（检视修复：侧栏产物变更后同步刷新"当前推进"）

- **原方案**：PATCH 后用 `renderRepoContextCard({ ...input, stage: updated })` 局部重渲染侧栏卡片
- **现方案**：PATCH 后调用 `onRefresh?.()`（即 `renderContextRail`）触发完整 context rail 重渲染
- **原因**：局部重渲染只更新侧栏 Feature Context 卡片，"当前推进"卡片仍显示旧 `output_artifacts`，两区域短暂或持续不一致
- **影响**：`renderRepoContextCard` 新增 `onRefresh` 入参；`renderRepoContextSummary` 透传；`renderContextRail` 注入 `renderContextRail` 闭包
