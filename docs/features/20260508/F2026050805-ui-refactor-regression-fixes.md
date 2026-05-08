# F2026050805 UI 重构回归修复

## 背景

首页确认版 UI 重构合入后，实际页面出现多个可用性回归：发送按钮被拉成长条、归档 Feature 不易发现、左侧目录标题过早省略、知识中心左栏不是有效目录，以及知识中心列表与详情共用滚动导致选中知识后详情和操作区域不稳定。

## 目标

1. 发送按钮恢复为紧凑按钮，不受全局按钮宽度规则影响。
2. 已归档 Feature 继续在当前 Project 目录树中以独立分组展示，且不因左侧目录宽度被挤到不可识别。
3. 左侧目录栏扩大有效阅读宽度，Feature 标题在目录树中优先展示完整信息，阶段与状态信息降级为辅助信息。
4. 知识中心左侧栏改为真实知识目录，展示知识库、待审批、当前项目知识三类条目及其简要信息。
5. 知识中心主区域保留独立详情框，详情和操作按钮在自己的滚动容器中滚动，不再跟随条目列表滚动。
6. 中间项目栏顶部重复标题区必须从 DOM 和样式中移除，不能只隐藏或依赖布局绕开。
7. 左侧目录栏必须能独立滚动，长 Project/Feature 列表下方条目仍可到达。

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
6. 中间项目栏直接从消息提醒、消息流和发送区开始；原 `workspace-header` 相关 DOM 与样式删除，状态信息由左侧目录和右侧上下文栏承载。
7. 左侧栏使用固定外层网格和有界中间行：`sidebar` 自身不参与滚动，`sidebar-main` 约束目录树高度，当前 `workspace-tree` 独立 `overflow: auto`，避免内容被父级裁剪导致下方 Feature 无法打开。

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
6. 用户补充指出中间栏顶部应明确移除后，已再次运行 `npm run test -- --filter web` 两次；两次均完成 generate-types、lint、TypeScript 编译，并在无关 `dist/tests/agent/managed-process-test.js` 的 `timeout escalation should be marked forced` 断言处失败，未进入 web 测试阶段。
7. 删除中间栏顶部及残留引用后，已运行 `npm run build`，通过。
8. 针对本轮 UI 修改已单独运行编译后的目标测试：`node dist/tests/web/workspace-layout-test.js`、`node dist/tests/web/knowledge-center-test.js`、`node dist/tests/web/feature-list-view-test.js`，均通过。
9. 用户补充指出左侧目录无法下拉后，已在 `workspace-layout-test` 增加左侧目录滚动容器不变量，覆盖 `sidebar`、`sidebar-main` 和 `workspace-tree` 的高度与 overflow 边界。
10. 用户确认当前项目不支持移动端后，移除会隐藏左侧目录和右侧上下文栏的窄屏断点，并将 `workspace-layout-test` 改为禁止通过 `max-width` 断点把桌面三栏 Shell 降级为移动端单栏布局。

## 风险与决策记录

1. 已决策：知识中心左侧栏不再保留静态“知识中心/知识库/待审批/当前项目知识”目录树，因为用户反馈该结构不是有效目录；左侧栏应直接承担条目浏览职责。
2. 已决策：知识详情滚动与列表滚动分离，优先保证选中知识后的详细信息和操作按钮稳定可达。

## 范围变更记录

1. 初始范围来自用户反馈的五类 UI 回归，均属于首页确认版 UI 重构后的可用性修复。
2. 用户补充指出中间栏顶部在确认版设计中已要求移除，范围扩展为删除 `workspace-header` DOM、相关样式和重复标题节点，并补充测试防止回归。
3. 用户补充指出左侧目录栏无法下拉、无法打开下方 Feature，范围扩展为修正侧栏滚动容器边界，并补充测试防止目录树再次被父级裁剪。
4. 用户明确当前项目没有移动端，范围扩展为清理窄屏隐藏侧栏的响应式残留，避免知识中心和其他主工作区入口被移动端假设影响。
