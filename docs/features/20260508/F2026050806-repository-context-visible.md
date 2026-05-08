# F2026050806 仓库上下文直接展示

## 背景

当前 Feature 的仓库上下文包含分支、worktree 和 PR 三项基本信息，但页面只把它们放在 Inspector 的 Stage 面板中。用户在日常推进 Feature 时需要直接看到这些信息，避免为了确认仓库状态反复打开抽屉。

## 目标

1. 在项目主界面的右侧上下文栏直接展示 Feature 分支、Worktree 和 PR 三项信息。
2. 未选择 Feature 或字段未记录时，页面仍明确展示“未记录”，不隐藏字段。
3. 保留现有 Inspector 中的仓库上下文记录入口，避免破坏既有编辑流程。
4. 用测试锁定仓库上下文不再只藏在 Inspector 抽屉中。

## 非目标

1. 不改变仓库上下文字段的数据结构、API 或持久化 schema。
2. 不改变 feature 完成后的仓库资源安全清理规则。
3. 不新增移动端布局适配；当前桌面三栏工作区规则保持不变。

## 设计

1. 在项目视图右侧 `context-rail` 增加 `Repository Context` 卡片，位置靠前，和 Stage、Participants、Deliverables 同属可持续可见的上下文信息。
2. 复用现有 `renderRepoContextCard` 和 `featureRepoContextFields`，确保右侧直显卡片与 Inspector 中的记录内容、空态文案和只读状态一致。
3. 右侧卡片提供“记录”按钮，通过现有 Inspector Stage 面板打开编辑入口；真正写入仍走原 `repo-context-edit-btn` 与 PATCH 流程，避免出现两套编辑路径。

## 生效路径

1. `src/web/ui-shell.js` 在项目右侧上下文栏新增仓库上下文卡片容器。
2. `src/web/app.js` 同步渲染右侧直显卡片和 Inspector 内仓库上下文卡片。
3. `src/web/repo-context-view.js` 支持用于上下文栏的紧凑头部和操作按钮。
4. `src/web/styles.css` 调整仓库上下文卡片行内布局，使长 worktree/PR 可换行展示。
5. `tests/web/workspace-layout-test.ts` 锁定仓库上下文卡片直接位于右侧上下文栏，并保留 Inspector 编辑入口。
6. `tests/web/feature-workflow-state-test.ts` 继续覆盖三项字段读取与空态判断。

## 改动范围

预计修改：

1. `src/web/ui-shell.js`
2. `src/web/app.js`
3. `src/web/repo-context-view.js`
4. `src/web/styles.css`
5. `tests/web/workspace-layout-test.ts`
6. `docs/features/20260508/F2026050806-repository-context-visible.md`

## 验证

已执行：

1. 首次运行 `npm run test -- --filter web` 时，worktree 尚未安装依赖，`generate-types` 阶段因 `tsx: command not found` 失败。
2. 已在隔离 worktree 内运行 `npm install` 安装依赖。
3. 再次运行 `npm run test -- --filter web`，通过。该命令完成 generate-types、lint、TypeScript 编译、dist 构建，并运行 33 个 compiled test files；其中 `workspace-layout-test` 覆盖仓库上下文右侧直显、Inspector 编辑入口保留和三项字段空态直显。

## 风险与决策记录

1. 已决策：三项仓库上下文属于 Feature 推进的基本信息，应在右侧上下文栏直显；Inspector 只继续承担记录与管理入口，不再作为唯一可见位置。
2. 风险：worktree 和 PR 可能较长。处理方式是在卡片值区域保留 `overflow-wrap: anywhere`，优先完整展示而非裁剪。

## 范围变更记录

1. 初始范围来自用户明确要求“REPOSITORY CONTEXT 的三项内容直接在页面看到，不要藏起来”。
