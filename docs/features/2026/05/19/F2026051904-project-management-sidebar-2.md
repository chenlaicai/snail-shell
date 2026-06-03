---
id: F2026051904
title: 项目管理右侧栏优化2
from_ids: [F2026051903]
tags: [ui, workflow]
modules: [project_management]
---
# F2026051904 项目管理右侧栏优化2

## 背景

前一轮项目管理右侧栏优化已把 Stage、Participants、Context 和 Artifacts 从旧 Inspector 结构中迁出。检视后发现当前推进、输出产物与推进阶段仍被拆成多个平级信息块，用户在 review stage 中需要先理解“本阶段要交付什么、还缺哪些输出、什么时候推进”的闭环，再查看参与者和上下文来源。

## 目标

1. 将项目管理右侧栏重新组织为围绕当前推进闭环的单一主卡片。
2. 把输出产物与推进阶段操作放在同一闭环内，减少“产物已补齐但推进入口不明显”的理解成本。
3. 保持参与者职责、上下文来源和本阶段输入要求可见。
4. 保留 repository context 记录能力，但避免在动态右侧栏中重复创建同一 DOM id 或未绑定按钮。

## 非目标

1. 不调整 project、feature、stage、conversation 的数据模型。
2. 不改变 repository context 记录、stage 推进、重开研发和输出产物增删的业务行为。
3. 不二次改写已合入 feature 的历史文档。
4. 不扩展知识中心、Prompt Center、Skill Center 或 Snail Den 的右侧栏。

## 设计

项目管理右侧栏采用“长期仓库上下文 + 当前推进闭环”的结构：

1. 固定的 `Repository Context` 卡片保留在右侧栏顶部，并继续承载唯一的 `repo-context-edit-btn` 记录入口；该卡片在右侧栏刷新时无条件重渲染，不依赖当前推进卡是否具备完整 stage/project/feature/conversation。
2. `当前推进` 主卡片展示 stage 标题、状态、Feature、conversation，并在卡片内串联确认交付、补齐输出产物和推进阶段三个步骤。
3. 输出产物增删沿用 stage `output_artifacts` PATCH 行为；添加或删除后刷新当前右侧栏，不引入额外状态缓存。
4. 参与者继续以当前 stage role definitions 为主数据源，并用 conversation 参与者补充缺失项。
5. 上下文来源和本阶段输入要求保留在主卡片内，作为推进判断的辅助信息。

## 生效路径

本 feature 通过 `src/web/ui-shell.js`、`src/web/workspace-context.js`、`src/web/app.js`、`src/web/styles.css` 和本文档生效。

## 改动范围

1. `src/web/ui-shell.js`：将项目管理右侧栏的多个摘要 section 收敛为 repository context 和当前推进主卡片。
2. `src/web/workspace-context.js`：重写项目管理右侧栏渲染流程，渲染当前推进闭环、参与者、上下文来源和本阶段要求；移除动态卡片内重复的 `repo-context-edit-btn`，并把固定 Repository Context 卡片刷新提升到右侧栏无条件路径。
3. `src/web/app.js`：适配右侧栏元素引用，从多卡片元素改为当前推进主卡片。
4. `src/web/styles.css`：补充当前推进闭环、步骤、产物、参与者和上下文块样式。
5. `docs/issues/20260519/F2026051904-project-management-sidebar-2.md`：记录本次 feature 的目标、设计、验证和检视修复。

## 验证

1. 运行 `npm run check`，确认前端脚本和仓库检查无新增 error。
2. 检查 PR diff 中不再修改已合入的 `F2026051903` 历史文档。
3. 检查 `repo-context-edit-btn` 仅存在于固定 shell DOM 中，避免重复 id 与未绑定动态按钮。
4. 人工核对项目管理右侧栏中 repository context 记录入口、输出产物增删、推进阶段和重开研发入口仍可见。

## 风险与决策记录

已决策：repository context 记录入口保留在固定 `Repository Context` 卡片中，不再在动态“当前推进”卡片内重复展示。这样能避免 DOM id 重复，也能保持仓库级长期上下文与阶段推进闭环的语义边界。

## 范围变更记录

1. 检视发现当前 PR 改写了已合入的 `F2026051903` 历史文档；已恢复历史文档，并新增 `F2026051904` 作为当前 Feature 文档。
2. 检视发现“当前推进”卡片内新增重复 `repo-context-edit-btn` 且未绑定；已移除动态按钮，只保留固定 shell 中已绑定的记录入口。
3. 复检发现 Repository Context 刷新被放在当前推进卡完整状态路径里，缺少 stage/project/feature/conversation 时会提前返回并保留上一个 Feature 的仓库上下文；已把 Repository Context 渲染提升到右侧栏无条件刷新路径。
