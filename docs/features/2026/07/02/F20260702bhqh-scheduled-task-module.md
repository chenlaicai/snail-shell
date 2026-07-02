---
id: F20260702bhqh
title: scheduled-task-module
from_ids: []
tags: [scheduler, automation, frontend]
modules: [domain, app, infra, web]
doc_kind: spec
---

# F20260702bhqh 定时任务模块

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景 [required]

Snail Shell 每天有 10-20 个 PR 合入 main 分支，代码量变化巨大。PR 由 LLM agent 生成，代码质量存在概率性波动——这是 LLM 模型的本质，无法通过单次 PR 检视完全消除。当前系统只有 PR 级别的质量门禁（git hooks + CI + 交叉检视），缺乏跨 PR 的、周期性的自动化检查机制。

需要一套通用的定时任务机制，使系统能够按时间间隔自动触发检查任务，并通过 Web UI 让用户管理这些任务。

## 目标 [required]

构建完整的定时任务调度模块，包括后端调度引擎和前端管理界面：

**后端**：
- 支持时间间隔触发（每隔 N 天）
- 任务定义持久化到 SQLite，服务器重启后自动恢复
- 错失触发的 catch-up 机制（服务器停机期间的触发在重启后补执行）
- 与现有 issue-collaboration 引擎集成，触发时自动创建 Issue 并调用 agent

**前端**：
- 定时任务管理页面（master-detail 布局，与现有 SOP/Config 等页面一致）
- 创建/编辑任务的表单对话框
- 执行历史查看
- 任务启用/禁用切换

## 非目标 [required]

- **具体任务类型实现**：不创建代码质量检查等具体 SOP/skill，只构建通用调度框架
- **commit 计数触发**：不支持按合入次数触发，仅支持时间间隔
- **分布式调度**：不支持多实例协调，调度器为单进程内运行
- **自动修复**：调度器只做触发和报告，不自动修改代码
- **事件驱动触发**：不支持 webhook 或消息队列触发
- **任务依赖链**：不支持任务之间的依赖关系（DAG）
- **自定义 handler 机制**：每个任务类型通过 SOP + skill 定义行为，不实现通用 handler 注册框架

## 核心业务行为 [required]

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当服务器重启且存在错失的定时任务时 | 调度器应立即评估所有活跃任务，对距上次执行超过间隔的任务补执行 | tests/scheduled-task/scheduler.test.ts |
| B2 | 当定时任务配置了 interval_days=7 且距上次执行超过 7 天时 | 调度器应触发该任务，创建 Issue 并调用 agent | tests/scheduled-task/scheduler.test.ts |
| B3 | 当定时任务触发但创建 Issue 失败时 | 应记录失败日志（status=failed, error），更新 executed_at，不影响其他任务的调度 | tests/scheduled-task/scheduler.test.ts |
| B4 | 当新创建一个定时任务时 | 首次执行等待完整间隔（executed_at = created_at），不会创建即触发 | tests/scheduled-task/scheduler.test.ts |
| B5 | 当用户在前端创建定时任务时 | 应打开表单对话框，填写标题、SOP、interval_days 后提交，任务出现在列表中 | 手动验证 |
| B6 | 当用户在前端编辑定时任务时 | 应打开预填表单对话框，修改后保存，列表实时更新 | 手动验证 |
| B7 | 当用户切换任务启用/禁用时 | 任务状态立即更新，禁用后不再被调度器触发 | 手动验证 |
| B8 | 当用户查看任务执行历史时 | 应显示该任务的所有执行记录，包含状态、Issue 链接、执行时间 | 手动验证 |
| B9 | 当查询定时任务列表时 | 应返回所有任务定义及其最近一次执行状态（从 execution 表取最新一条） | tests/scheduled-task/repo.test.ts |
| B10 | 当创建或更新任务时 interval_days 为空或 0 | 应拒绝操作，返回错误 | tests/scheduled-task/scheduler.test.ts |

## 设计 [required]

#### 整体架构

定时任务模块遵循 Ports & Adapters 模式，作为独立 domain 模块存在：

```
src/domain/scheduled-task/
  model.ts          — 任务定义、执行记录的类型
  port.ts           — ScheduledTaskPort 接口
  _internal/
    adapter.ts      — 调度器核心逻辑（触发评估、Issue 创建）
    repository.ts   — SQLite 数据访问
    initor.ts       — 依赖注入
```

集成方式：`initScheduledTask()` 在 `main.ts` 的 `initModules()` 中调用，依赖 `collaboration.adapter` 创建 Issue。

> **[D1]** 调度器放在 domain 层而非 app 层。正方：定时任务是独立领域概念，不依赖 issue-collaboration 的内部实现，只通过 port 接口交互；与 evolution 模块的集成模式一致（evolution 也在 domain 层，依赖 collaboration adapter）。反方：调度器需要调用 `collaboration.createIssue()`，存在对 app 层的依赖。依据：现有代码中 `initEvolution` 已经依赖 `collaboration.adapter`，这是一个已验证的模式。

#### 数据模型

```typescript
// model.ts

interface ScheduledTask {
  id: string;                    // UUID
  key: string;                   // 唯一标识，如 "code-quality-check"
  title: string;
  sop_key: string;               // 关联的 SOP key
  workspace_path: string;
  interval_days: number;         // 每隔 N 天触发，必须 > 0
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface ScheduledTaskExecution {
  id: string;                    // UUID
  task_id: string;               // 关联 ScheduledTask.id
  issue_id: string | null;       // 创建的 Issue ID（失败时为 null）
  status: "pending" | "success" | "failed";
  error: string | null;
  executed_at: string;
}
```

两张表，没有冗余的状态表。最近一次执行状态直接从 execution 表取最新一条。

#### 触发评估机制

调度器通过 `setInterval` 每 60 秒执行一次 `tick()`：

1. 从数据库加载所有 `enabled=true` 的任务
2. 对每个任务，查 execution 表获取最近一条记录
3. 如果无记录，用 `task.created_at` 作为基准
4. 判断：`now - last_executed_at >= task.interval_days`
5. 满足条件的任务调用 `executeTask()`

> **[D2]** 使用 `setInterval` 而非 cron 表达式库。正方：触发逻辑简单（比较时间间隔），无需 cron 的复杂表达式解析；避免引入第三方依赖；与现有 `startEventLoopMonitor()` 的模式一致。反方：不支持"每周一 9:00"等精确时间点调度。依据：用户的实际需求是"每隔一周"，间隔天数足够满足。

#### catch-up 机制

服务器启动时，调度器立即执行一次 `tick()`。如果任务距上次执行超过间隔，立即触发（串行执行，不并发）。

**执行失败语义**：
- 失败时记录 `status="failed"` + `error`，`executed_at` 正常更新
- 下次间隔到期后重新评估，条件满足则再次触发

#### snail 分配计划构建

调度器创建 Issue 时需要提供 `snail_assignment_plan`。自动构建逻辑：

1. 从 SOP 定义获取所有 stage 和 role
2. 对每个 role instance，分配第一个可用的 snail
3. 构建 `IssueSnailAssignmentPlan` 对象

```typescript
function buildDefaultSnailPlan(sop: Sop, snailKeys: string[]): IssueSnailAssignmentPlan {
  const plan: IssueSnailAssignmentPlan = {};
  for (const stageDef of sop.stage_definitions) {
    const stagePlan: StageSnailAssignmentPlan = {};
    const instances = expandRoleInstances(stageDef.roles);
    for (const instance of instances) {
      stagePlan[instance] = snailKeys[0];
    }
    plan[stageDef.key] = stagePlan;
  }
  return plan;
}
```

#### HTTP API

```
GET    /api/scheduled-tasks              — 列表（含最近一次执行状态）
POST   /api/scheduled-tasks              — 创建
PUT    /api/scheduled-tasks/:id          — 更新
DELETE /api/scheduled-tasks/:id          — 删除
GET    /api/scheduled-tasks/:id/executions — 执行历史
```

列表 API 直接查 execution 表取最新一条记录：

```sql
SELECT t.*, e.status as last_status, e.issue_id as last_issue_id
FROM scheduled_task t
LEFT JOIN scheduled_task_execution e
  ON e.id = (
    SELECT id FROM scheduled_task_execution
    WHERE task_id = t.id
    ORDER BY executed_at DESC LIMIT 1
  )
```

#### 前端设计

**路由**：`/scheduled-tasks`，在 `Sidebar.tsx` 的 "Modules" 区域添加入口。

**页面布局**：采用 master-detail 模式（与 SOP Center、Config 页面一致）：
- 左侧 280px 侧边栏：任务列表，每项显示标题、启用状态、间隔天数
- 右侧详情区：选中任务的完整信息 + 执行历史
- 顶部"创建任务"按钮

**创建/编辑对话框**：使用现有 custom modal 模式（`SopFormDialog` 风格）：
- 标题输入
- SOP 选择（下拉，从已加载的 SOP 列表选取）
- Workspace 选择
- 间隔天数（数字输入，必须 > 0）
- 启用/禁用开关

**任务列表项显示**：
- 标题
- 启用状态（Badge：`status-green` = 启用，`status-gray` = 禁用）
- 间隔摘要（如 "每 7 天"）
- 最近执行状态（Badge：`status-green` = 成功，`status-red` = 失败，`status-gray` = 未执行）

**执行历史面板**：选中任务后，详情区下方显示执行历史表格：
- 执行时间
- 状态（pending / success / failed）
- Issue 链接（可点击跳转）
- 错误信息（失败时）

**前端文件结构**：
```
src/web/
  pages/ScheduledTasks.tsx           — 主页面组件
  components/ScheduledTaskFormDialog.tsx — 创建/编辑对话框
  components/ScheduledTaskDetail.tsx — 详情面板（含执行历史）
  queries/scheduled-task.queries.ts  — 查询定义
  mutations/scheduled-task.mutations.ts — 变更定义
  router.tsx                         — 添加路由
  components/Sidebar.tsx             — 添加导航入口
  queries/keys.ts                    — 添加 queryKeys
```

## 生效路径 [required]

- **代码**：`src/domain/scheduled-task/` 模块（model、port、adapter、repository、initor）
- **数据库**：`scheduled_task` 和 `scheduled_task_execution` 表（CREATE TABLE IF NOT EXISTS）
- **HTTP API**：`src/infra/http/routes/scheduled-task.route.ts`
- **前端**：`src/web/pages/ScheduledTasks.tsx` + 相关组件
- **主入口**：`src/main.ts` 的 `initModules()` 中添加 `initScheduledTask()`
- **导航**：`src/web/components/Sidebar.tsx` 添加 "Scheduled Tasks" 入口

## 设计约束摘要 [required]

### 硬约束（违反即 bug）
- 创建/更新任务时，`interval_days` 必须 > 0，否则拒绝操作
- 删除任务为硬删除，execution 记录通过 ON DELETE CASCADE 一并清除
- 调度器为单进程运行，不支持多实例协调
- 错失触发必须在重启后补执行（catch-up）
- 创建 Issue 使用现有 `collaboration.createIssue()`，不得绕过
- 数据库 schema 只允许 CREATE TABLE IF NOT EXISTS，禁止 ALTER TABLE
- 调度器优雅停止：SIGTERM 时等待当前 tick 完成 + clearInterval + .unref()

### 设计取舍（不得自行推翻）
- D1：调度器放在 domain 层，遵循 Ports & Adapters 模式
- D2：使用 setInterval，不引入 cron 库
- 前端使用 master-detail 布局，与现有 SOP Center 等页面保持一致

### 语义不变量（实现中必须保持为真）
- 每次触发必须记录执行日志（无论成功或失败），执行意图必须在 Issue 创建前记录
- 执行记录状态机：pending → success/failed（不可回退）
- 已创建的 Issue 不可因调度器错误而被删除
- 前端列表与后端数据实时同步（TanStack Query invalidation）

### 非目标（不得扩展）
- 不实现具体的任务类型（代码质量检查等）
- 不实现 commit 计数触发
- 不实现分布式调度
- 不实现自动修复
- 不实现事件驱动触发
- 不实现任务依赖链

<!-- [design-time] 章节结束 -->

## 改动范围 [required]

| 文件/模块 | 变更类型 | 说明 |
|-----------|----------|------|
| `src/domain/scheduled-task/model.ts` | 新增 | 数据模型定义 |
| `src/domain/scheduled-task/port.ts` | 新增 | 端口接口 |
| `src/domain/scheduled-task/_internal/adapter.ts` | 新增 | 调度器核心逻辑 |
| `src/domain/scheduled-task/_internal/repository.ts` | 新增 | SQLite 数据访问 |
| `src/domain/scheduled-task/_internal/initor.ts` | 新增 | 依赖注入 |
| `src/main.ts` | 修改 | 添加 initScheduledTask() |
| `src/infra/http/routes/scheduled-task.route.ts` | 新增 | HTTP API 路由 |
| `src/infra/http/app.ts` | 修改 | 注册路由 |
| `src/web/pages/ScheduledTasks.tsx` | 新增 | 主页面组件 |
| `src/web/components/ScheduledTaskFormDialog.tsx` | 新增 | 创建/编辑对话框 |
| `src/web/components/ScheduledTaskDetail.tsx` | 新增 | 详情面板 |
| `src/web/queries/scheduled-task.queries.ts` | 新增 | 查询定义 |
| `src/web/mutations/scheduled-task.mutations.ts` | 新增 | 变更定义 |
| `src/web/router.tsx` | 修改 | 添加路由 |
| `src/web/components/Sidebar.tsx` | 修改 | 添加导航入口 |
| `src/web/queries/keys.ts` | 修改 | 添加 queryKeys |
| `tests/scheduled-task/` | 新增 | 测试文件 |

## 验证 [required]

### 后端
- [ ] 创建定时任务后，数据库中存在对应记录
- [ ] 修改定时任务后，触发条件更新生效
- [ ] 删除定时任务后，不再触发
- [ ] 服务器重启后，错失的触发被补执行
- [ ] 时间触发：设置 interval_days=0.001（约 86 秒），等待后自动创建 Issue
- [ ] HTTP API 全部端点返回正确响应
- [ ] `npm run check` 通过（TypeScript 编译 + ESLint）
- [ ] 所有测试通过

### 前端
- [ ] 侧边栏显示 "Scheduled Tasks" 入口，点击进入页面
- [ ] 页面加载后显示已有任务列表（master-detail 布局）
- [ ] 点击"创建任务"打开表单对话框
- [ ] 填写标题、选择 SOP、设置间隔天数后提交，任务出现在列表中
- [ ] 点击任务列表项，右侧显示详情和执行历史
- [ ] 编辑任务：打开预填对话框，修改后保存
- [ ] 删除任务：确认对话框，删除后从列表移除
- [ ] 启用/禁用切换：点击后状态立即更新
- [ ] 执行历史：显示状态、Issue 链接、错误信息

## 关联 [required]

- **相关**: F20260701vky6（auto-invoke-after-advance）— 定时任务创建的 Issue 需要自动调用 agent

## 未实现说明 [optional]

| 原始设计要求 | 未实现原因 | 用户确认状态 | 后续处理 |
|---|---|---|---|
| 代码质量检查 SOP/skill | 用户明确指令：本次只做调度机制，不做具体任务类型 | 已确认 | 作为调度系统的首个应用单独创建 feature |
| commit 计数触发 | 用户决策：复杂度不值得，时间触发已足够 | 已确认 | 如未来需要，作为独立 feature |
| ScheduledTaskState 冗余表 | 用户决策：直接查 execution 表即可，避免同步更新复杂性 | 已确认 | — |

## 关键决策记录 [required]

| # | 决策点 | 最终决策 | 状态 |
|---|--------|----------|------|
| D1 | 调度器架构层级 | domain 层，遵循 Ports & Adapters | 设计阶段确认 |
| D2 | 触发机制选型 | setInterval + 间隔天数 | 设计阶段确认 |
| D3 | 数据模型 | 两张表（task + execution），无冗余 state 表 | 用户简化后确认 |
| D4 | 前端布局 | master-detail 模式，与 SOP Center 等页面一致 | 用户要求确认 |

## 风险与缓解 [required]

| # | 风险 | 严重程度 | 影响 | 缓解策略 | 负责方 |
|---|------|----------|------|----------|--------|
| R1 | 同时触发多个任务导致资源竞争 | 中 | agent 并发过多 | 串行执行任务，不并发创建 Issue | 开发者 |
| R2 | 服务器长时间停机后 catch-up 过多 | 低 | 瞬时负载高 | catch-up 串行执行 | 开发者 |
| R3 | 前端 SOP 列表为空时用户体验差 | 低 | 无法创建任务 | 表单中 SOP 为空时显示引导提示 | 开发者 |

## 范围变更记录 [optional]

| 变更 | 原因 | 确认状态 |
|------|------|----------|
| 移除 P2（代码质量检查） | 用户明确指令：本次只做调度机制 | 已确认 |
| 新增前端 UI 为必选项 | 用户明确指令：必须有 UI | 已确认 |
| 移除 ScheduledTaskState 冗余表 | 用户决策：直接查 execution 表即可 | 已确认 |
| 移除 commit 计数触发 | 用户决策：复杂度不值得，时间触发已足够 | 已确认 |
