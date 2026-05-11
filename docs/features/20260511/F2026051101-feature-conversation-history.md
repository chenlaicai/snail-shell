# F2026051101 Feature 对话历史完整展示

## 背景

用户反馈点开 Feature“系统提示词优化0511”后看不到所有对话记录。数据库中该 Feature 已经历 development、review、再次 development 三个 stage，每个 stage 都有独立 conversation，但当前左侧 Feature 展开后只加载当前 stage 的 conversation，导致过往 stage 的对话从 Feature 视图中消失。

## 目标

1. 展开某个 Feature 时展示该 Feature 下所有 stage 的 conversation，保证历史讨论、检视和返工记录可追溯。
2. 保留当前 stage 语义：新建对话、阶段产物和推进动作仍归属于当前 stage。
3. 选中 Feature 时优先进入当前 stage 的默认 conversation；如果当前 stage 没有 conversation，则回退到 Feature 内最新 conversation。
4. 对实时 badge 刷新、新建对话、推进 stage、重启研发迭代后的对话列表保持一致。

## 非目标

1. 不调整数据库 schema。
2. 不改变 conversation 与 stage 的归属关系。
3. 不新增按 stage 分组展示 UI；本次只修复 Feature 下历史 conversation 不完整的问题。
4. 不处理对话正文分页、搜索或摘要生成逻辑。

## 设计

Feature 树节点是用户查找该 Feature 全部工作记录的入口，因此对话列表应使用 `/features/:featureId/conversations`，而不是 `/stages/:stageId/conversations`。当前 stage 仍用于决定默认选中的 conversation、创建 conversation 的目标 stage、加载 stage artifacts 和工作流推进。

选择 Feature 时，前端加载 Feature 全量 conversations 后，优先选中当前 stage 中排在最前的 conversation；这保持“进入当前工作阶段”的默认体验，同时不隐藏旧 stage 的记录。刷新 badge、新建 conversation、推进 stage 和重启研发迭代后都重新加载 Feature conversation 列表，避免状态数组退化成只有当前 stage 的局部视图。

## 生效路径

1. `src/web/app.js`：调整 Feature 选择、conversation 列表刷新和 stage 推进后的状态加载。
2. `src/web/project-tree-view.js`：更新空态文案，明确列表范围是当前 Feature。
3. `tests/web/feature-list-view-test.ts`：补充静态回归断言，防止恢复为 stage-only conversation 加载。

## 改动范围

1. `src/web/app.js`
2. `src/web/project-tree-view.js`
3. `tests/web/feature-list-view-test.ts`
4. `docs/features/20260511/F2026051101-feature-conversation-history.md`

## 验证

1. 运行 `npm run test -- --runInBand tests/web/feature-list-view-test.ts`。
2. 运行必要的 web 测试或完整检查，确认对话列表与现有消息同步逻辑不回归。
3. 使用当前数据库手动核对“系统提示词优化0511”存在 3 个 conversation，修复后 Feature 展开应能显示全部 3 个。

## 风险与决策记录

1. 本次不做 stage 分组展示。原因是用户当前问题是“看不到所有对话记录”，Feature 树已有 conversation 分支，先恢复完整可见性；分组涉及额外交互设计，独立处理更合适。
2. 当前 stage 的工作入口不变。新建 conversation 仍归属于当前 stage，避免用户在历史 conversation 可见后误把新工作写入旧 stage。

## 范围变更记录

暂无。
