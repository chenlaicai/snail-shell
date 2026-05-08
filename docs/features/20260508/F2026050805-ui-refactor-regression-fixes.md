# F2026050805 UI 重构回归修复

## 背景

首页确认版 UI 重构合入后，实际页面出现多个可用性回归：发送按钮被拉成长条、归档 Feature 不易发现、左侧目录标题过早省略、知识中心左栏不是有效目录，以及知识中心列表与详情共用滚动导致选中知识后详情和操作区域不稳定。

## 目标

1. 发送按钮恢复为紧凑按钮，不受全局按钮宽度规则影响。
2. 已归档 Feature 继续在当前 Project 目录树中以独立分组展示，且不因左侧目录宽度被挤到不可识别。
3. 左侧目录栏扩大有效阅读宽度，Feature 标题在目录树中优先展示完整信息，阶段与状态信息降级为辅助信息。
4. 知识中心左侧栏改为真实知识目录，展示知识库、待审批、当前项目知识三类条目及其简要信息。
5. 知识中心主区域保留独立详情框，详情和操作按钮在自己的滚动容器中滚动，不再跟随条目列表滚动。

## 非目标

1. 不改变后端 API、数据库 schema 或知识治理状态机。
2. 不改变 Feature 创建、归档、阶段推进或 Conversation 消息协议。
3. 不新增知识审批动作；审批、拒绝、废弃仍只绑定选中的知识详情。

## 设计

1. 将左侧主目录宽度从 326px 提升到 390px，保留右侧上下文宽度不变，让 Project、Feature、Conversation 层级标题有足够可读区域。
2. 收窄全局按钮宽度规则的影响面：通用 `button` 不再默认 `width: 100%`，只有目录、表单列表和明确需要占满容器的按钮继续设置满宽；发送按钮设置为固定紧凑宽度。
3. Feature 行改为纵向信息架构，标题占据完整行，状态、阶段和归档操作放到下一行，避免右侧状态徽章和归档按钮挤压标题。
4. 知识中心复用左侧 `workspace-tree` 作为条目目录容器，不再展示静态导航树；模式切换保留在左侧工具栏，通过目录条目展示简要信息。
5. 知识中心主面板改为只承载详情区，详情卡独立滚动；左侧知识条目目录独立滚动，避免选中条目后详情和操作按钮被列表滚动牵连。

## 生效路径

1. `src/web/ui-shell.js` 调整知识中心左侧栏与主面板结构。
2. `src/web/app.js` 将知识条目列表挂载到左侧目录，并保留详情在主面板。
3. `src/web/knowledge-center.js` 输出可作为目录使用的知识条目，并在无选中时给出详情占位。
4. `src/web/feature-list-view.js` 调整 Feature 行内容层级，保留归档分组。
5. `src/web/styles.css` 约束三栏宽度、按钮宽度、Feature 行、知识目录和详情滚动。
6. `tests/web/workspace-layout-test.ts`、`tests/web/feature-list-view-test.ts`、`tests/web/knowledge-center-test.ts` 锁定关键 UI 不变量。

## 改动范围

预计修改：

1. `src/web/ui-shell.js`
2. `src/web/app.js`
3. `src/web/knowledge-center.js`
4. `src/web/feature-list-view.js`
5. `src/web/styles.css`
6. `tests/web/workspace-layout-test.ts`
7. `tests/web/feature-list-view-test.ts`
8. `tests/web/knowledge-center-test.ts`
9. `docs/features/20260508/F2026050805-ui-refactor-regression-fixes.md`

## 验证

1. 已运行 `npm run test -- --filter web`，通过。该命令会先执行 build、lint 和 TypeScript 编译，再运行 33 个 compiled test files；本轮重点覆盖 `workspace-layout-test`、`feature-list-view-test` 和 `knowledge-center-test`。
2. 已运行 `npm run check`，通过。完整 33 个 compiled test files 全部通过。
3. `workspace-layout-test` 已覆盖发送按钮紧凑宽度、左侧目录宽度、知识中心详情独立滚动、知识条目位于左侧目录，以及移除静态知识假目录。
4. `feature-list-view-test` 已覆盖归档 Feature 仍以独立分组展示，并确认 Feature 标题拥有完整目录行。
5. `knowledge-center-test` 已覆盖知识中心左侧目录条目、详情独立滚动和真实 prompt 反哺配置说明。

## 风险与决策记录

1. 已决策：知识中心左侧栏不再保留静态“知识中心/知识库/待审批/当前项目知识”目录树，因为用户反馈该结构不是有效目录；左侧栏应直接承担条目浏览职责。
2. 已决策：知识详情滚动与列表滚动分离，优先保证选中知识后的详细信息和操作按钮稳定可达。

## 范围变更记录

1. 初始范围来自用户反馈的五类 UI 回归，均属于首页确认版 UI 重构后的可用性修复。
