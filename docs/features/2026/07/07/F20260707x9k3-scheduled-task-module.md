---
id: F20260707x9k3
title: scheduled-task-module
from_ids: []
tags: [scheduler, automation, frontend, issue-template]
modules: [domain, app, infra, web]
doc_kind: spec
---

# F20260707x9k3 定时任务模块（Issue 母体方案）

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景 [required]

Snail Shell 每天有 10-20 个 PR 合入 main 分支，代码量变化巨大。PR 由 LLM agent 生成，代码质量存在概率性波动——这是 LLM 模型的本质，无法通过单次 PR 检视完全消除。当前系统只有 PR 级别的质量门禁（git hooks + CI + 交叉检视），缺乏跨 PR 的、周期性的自动化检查机制。

需要一套定时任务机制，使系统能够按时间间隔自动触发检查任务，并通过 Web UI 让用户管理这些任务。

## 目标 [required]

构建基于 Issue 母体（IssueTemplate）的定时任务调度模块：

**核心概念**：
- **IssueTemplate（母体）**：独立实体，本质上是"Issue 数据模型 + 调度属性"。存储 SOP 快照（sop_snapshot）+ snail 分配计划 + cron 调度表达式。母体不参与 Stage 流转，是纯配置模板 + 调度触发源。
- **子实例**：调度器按 cron 表达式周期性从母体 fork 出的普通 Issue，拥有完整的 Stage 生命周期。子实例通过 `issue_template_children` 关联表与母体建立关系。

**后端**：
- IssueTemplate 独立数据表，存储 SOP 快照（sop_snapshot）、snail_assignment_plan（JSON）、cron 表达式
- 调度器通过 `setInterval` 每 60 秒 tick，用 cron-parser 计算下次触发时间，满足则从母体创建子实例
- 子实例继承母体的 sop_snapshot 和 snail_assignment_plan，不受母体后续修改影响
- 服务器重启后 catch-up 补执行

**前端**：
- `/issue-templates` 独立路由，与 `/issues` 完全分离
- Master-detail 布局（与 SOP Center 一致）
- 创建/编辑对话框含 SOP 选择 + snail 分配计划配置
- 详情面板展示母体信息 + 已生成的子实例列表

## 非目标 [required]

- **具体任务类型实现**：不创建代码质量检查等具体 SOP/skill，只构建通用调度框架
- **commit 计数触发**：不支持按合入次数触发，仅支持 cron 时间调度
- **分布式调度**：不支持多实例协调，调度器为单进程内运行
- **自动修复**：调度器只做触发和报告，不自动修改代码
- **事件驱动触发**：不支持 webhook 或消息队列触发
- **任务依赖链**：不支持任务之间的依赖关系（DAG）
- **母体参与 Stage 流转**：母体是纯模板，不创建 Stage，不经历 design/development/review 等阶段

## 核心业务行为 [required]

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当服务器重启且存在错失的调度时 | 调度器应立即评估所有活跃母体，对 cron 表达式计算的下次触发时间已过的母体补执行 | tests/issue-template/scheduler.test.ts |
| B2 | 当母体 cron 表达式到达触发时间时 | 调度器应从母体 fork 一个子实例（普通 Issue），子实例拥有完整的 Stage 生命周期 | tests/issue-template/scheduler.test.ts |
| B3 | 当母体调度触发但创建子实例失败时 | 应记录失败日志（status=failed, error），不更新 last_spawned_at（允许下次 tick 重试），连续失败 3 次后停止重试并标记母体为 error 状态，不影响其他母体的调度 | tests/issue-template/scheduler.test.ts |
| B4 | 当新创建一个母体时 | 首次调度等待 cron 表达式的下次触发时间（last_spawned_at = created_at），不会创建即触发 | tests/issue-template/scheduler.test.ts |
| B5 | 当用户在前端创建母体时 | 应打开表单对话框，选择 SOP、配置 snail 分配计划、设置 cron 表达式后提交，母体出现在列表中 | 手动验证 |
| B6 | 当用户在前端编辑母体时 | 应打开预填表单对话框，修改后保存。变更对下一次调度生效，已创建的子实例不受影响 | 手动验证 |
| B7 | 当用户禁用母体时 | 母体停止调度（enabled=false），已创建的子实例不受影响，继续独立存在 | 手动验证 |
| B8 | 当用户查看母体详情时 | 应显示母体配置信息 + 已生成的所有子实例列表（含子实例状态、创建时间、链接） | 手动验证 |
| B9 | 当查询母体列表时 | 应返回所有母体及其最近一次调度状态（从 execution 表取最新一条） | tests/issue-template/repo.test.ts |
| B10 | 当创建或更新母体时 cron_expression 为空或格式非法 | 应拒绝操作，返回错误（使用 cron-parser 验证） | tests/issue-template/scheduler.test.ts |
| B11 | 当母体的 snail_assignment_plan 与 sop_snapshot 中的角色不匹配时 | 应拒绝创建/更新，返回验证错误（复用 Issue 的 validateSnailAssignmentPlan 逻辑，对 sop_snapshot 验证） | tests/issue-template/repo.test.ts |
| B12 | 当子实例被创建时 | 子实例的 sop_snapshot 和 snail_assignment_plan 应从母体直接继承（非重新查找 SOP），且创建后不受母体后续修改影响 | tests/issue-template/scheduler.test.ts |

## 设计 [required]

#### 整体架构

```
src/domain/issue-template/
  model.ts          — IssueTemplate 数据模型、Execution 记录
  port.ts           — IssueTemplatePort 接口
  _internal/
    adapter.ts      — 调度器核心逻辑（tick、子实例创建）
    repository.ts   — SQLite 数据访问
    initor.ts       — 依赖注入
```

> **[D1]** IssueTemplate 作为独立 domain 模块，与 issue 模块同级。正方：母体是独立领域概念（配置+调度），不参与 Stage 流转，不应混入 issue 模块内部；遵循 Ports & Adapters 模式，通过 port 接口与 issue-collaboration 交互。反方：母体和子实例都是"Issue 家族"，放在同一模块更内聚。依据：母体的核心职责是"调度触发"而非"Issue 管理"，独立模块职责更清晰；且用户明确要求"独立建表，不和活 issue 混为一谈"。

#### 数据模型

**表 `issue_template`（母体）**：

```typescript
interface IssueTemplate {
  id: string;                         // UUID
  workspace_path: string;             // 工作区路径
  title: string;                      // 母体标题（也会作为子实例标题的前缀）
  sop_key: string;                    // SOP key（传递给 createIssue() 的 adopted_sop_key）
  sop_snapshot: Sop;                  // SOP 快照（创建时深拷贝，用于 UI 展示和 plan 验证）
  snail_assignment_plan: IssueSnailAssignmentPlan;  // 角色-Snail 分配计划（JSON）
  cron_expression: string;            // cron 表达式（5 位：分 时 日 月 周），如 "0 9 * * 1" = 每周一 9:00
  enabled: boolean;                   // 调度开关
  last_spawned_at: string | null;     // 上次创建子实例的时间
  consecutive_failures: number;       // 连续失败次数，>= 3 时自动禁用
  created_at: string;
  updated_at: string;
}
```

> **[D8]** 母体存储 sop_snapshot 而非 sop_key。正方：与 Issue 模型一致，子实例创建时直接继承快照，不受 SOP 后续变更影响；快照是自包含的，不依赖外部 SOP 引用。反方：SOP 更新后母体不会自动跟随，需要用户手动更新母体。依据：用户的明确指令——"应该像当前的 issue 表一样，直接存 sop snapshot"。

> **[D9]** 使用 cron 表达式而非 interval_days。正方：支持精确时间点调度（如"每周一 9:00"），比间隔天数更灵活；cron 是业界标准调度表达式。反方：需要引入 cron-parser 依赖；用户需要了解 cron 语法。依据：用户的明确指令——"interval_days 过于粗糙了，好歹支持 cron 表达式吧"。前端提供常用预设（每天、每周一、每月一号等）降低学习成本。

**表 `issue_template_execution`（调度执行记录）**：

```typescript
interface IssueTemplateExecution {
  id: string;                         // UUID
  template_id: string;                // 关联 IssueTemplate.id
  child_issue_id: string | null;      // 创建的子实例 Issue ID（失败时为 null）
  status: "success" | "failed";
  error: string | null;               // 失败原因
  executed_at: string;                // 执行时间
}
```

**表 `issue_template_children`（母体-子实例关联）**：

```sql
CREATE TABLE IF NOT EXISTS issue_template_children (
  template_id TEXT NOT NULL REFERENCES issue_template(id) ON DELETE CASCADE,
  child_issue_id TEXT NOT NULL REFERENCES issue(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(template_id, child_issue_id)
);
```

> **[D7]** 使用独立关联表而非修改 issue 表。正方：零侵入 issue 表，已有数据库完全兼容（CREATE TABLE IF NOT EXISTS 对新表是正常创建）；`createIssue()` 返回后插入关联记录，时序清晰无不一致窗口。反方：多一张表，查询子实例需要 JOIN。依据：系统禁止 ALTER TABLE，修改已有表的 CREATE TABLE 定义对已有实例是 no-op，无法添加新列。

#### 调度器

调度器通过 `setInterval` 每 60 秒执行一次 `tick()`。`initIssueTemplate()` 中启动 `setInterval`，catch-up 在首次 tick 中自动完成。

1. 从数据库加载所有 `enabled=true` 的母体
2. 对每个母体，用 `cron-parser` 解析 `cron_expression`，计算下次触发时间（`nextFireTime`）
3. 如果 `nextFireTime <= now`，调用 `spawnChildIssue(template)`
4. 成功后更新 `last_spawned_at`，`consecutive_failures` 重置为 0，记录 execution（status=success）
5. 失败时不更新 `last_spawned_at`（允许下次 tick 重试），`consecutive_failures` +1，记录 execution（status=failed）
6. 连续失败 3 次后停止重试，母体标记为 error 状态（`enabled` 自动设为 false），需要用户干预后重新启用

> **[D2]** 使用 cron 表达式 + cron-parser 库。正方：支持精确时间点调度（如"每周一 9:00"），cron 是业界标准；`cron-parser` 是轻量级、无依赖的成熟库。反方：需要引入第三方依赖；用户需要了解 cron 语法。依据：用户的明确指令——"interval_days 过于粗糙了"。前端提供常用预设（每天、每周一、每月一号等）降低用户学习成本。

#### 子实例创建流程

```
spawnChildIssue(template):
  1. 调用 collaboration.createIssue({
       workspace_path: template.workspace_path,
       title: `${template.title} - ${formatDate(now)}`,
       adopted_sop_key: template.sop_key,
       sop_snapshot: template.sop_snapshot,       ← 传递母体冻结的快照
       snail_assignment_plan: template.snail_assignment_plan,
       context: { parent_template_id: template.id }
     })
  2. 插入关联记录：issue_template_children(template_id, child_issue_id, created_at)
  3. 记录 execution（status=success, child_issue_id=issue.id）
```

> **[D10]** `CreateIssueInput` 扩展：新增可选字段 `sop_snapshot?: Sop`。当传入 `sop_snapshot` 时，`IssueAdapter.createIssue()` 跳过 `sopPort.findByKey()` 查找，直接使用传入的快照（仍做 `structuredClone` 确保深拷贝）。未传入时走现有逻辑（findByKey + clone），向后完全兼容。正方：子实例真正继承母体冻结的 SOP，不受 SOP 文件后续变更影响；最小改动，不破坏现有创建流程。反方：CreateIssueInput 多一个可选字段，增加了接口复杂度。依据：S9 阻塞问题——母体存储 sop_snapshot 的核心价值就是让子实例继承冻结版本，如果不传递则存储无意义。

**关键设计**：母体存储的 `snail_assignment_plan` 格式与 `CreateIssueInput.snail_assignment_plan` 完全一致，创建子实例时直接传递，无需任何转换。母体创建时已通过 `validateSnailAssignmentPlan` 验证（对 `sop_snapshot` 验证），确保计划与 SOP 角色匹配。

> **[D3]** 母体存储完整的 snail_assignment_plan 而非"自动构建"。正方：用户在创建母体时明确指定每个角色使用哪个 snail，消除了旧方案中"统一分配第一个 snail"的妥协；配置完整性保证子实例创建时无信息缺失。反方：创建母体的表单更复杂，需要 snail 分配 UI。依据：用户的明确指令——"只有 SOP 无法创建完整 issue，还需要配置好 role > snail"，母体方案从根本上解决了这个设计裂缝。

#### catch-up 机制

服务器启动时，调度器立即执行一次 `tick()`。逻辑与正常 tick 相同——cron 表达式计算的下次触发时间已过的母体会被触发。串行执行，不并发。

#### HTTP API

```
GET    /api/issue-templates              — 列表（含最近一次执行状态）
POST   /api/issue-templates              — 创建
PUT    /api/issue-templates/:id          — 更新
DELETE /api/issue-templates/:id          — 删除（硬删除 + CASCADE）
PATCH  /api/issue-templates/:id/toggle   — 切换 enabled 状态
GET    /api/issue-templates/:id/executions — 调度执行历史
GET    /api/issue-templates/:id/children  — 子实例列表（查询 issue_template_children 关联表）
```

> **[S5 结论]** API 采用全局路径（与旧 scheduled-task 方案一致）。模板是跨 workspace 的管理概念，workspace_path 在创建时通过 body 传递。列表 API 显示所有 workspace 的模板，前端可按 workspace 过滤。

**列表 API**：

```sql
SELECT t.*, e.status as last_status, e.child_issue_id as last_child_issue_id
FROM issue_template t
LEFT JOIN issue_template_execution e
  ON e.id = (
    SELECT id FROM issue_template_execution
    WHERE template_id = t.id
    ORDER BY executed_at DESC LIMIT 1
  )
ORDER BY t.created_at DESC
```

#### 前端设计

**路由**：`/issue-templates`，在 `Sidebar.tsx` 的 "Modules" 区域添加 "Issue Templates" 入口。

**页面布局**：master-detail 模式（与 SOP Center 一致）：

左侧 300px 侧边栏：
- 母体列表，每项显示：标题、启用状态 Badge、cron 摘要（如 "每周一 09:00"）
- 顶部"创建母体"按钮
- 列表项 hover 显示 Edit / Del 按钮

右侧详情区：
- 母体配置信息（SOP、snail 分配计划、cron 表达式、启用状态）
- 调度执行历史表格（时间、状态、子实例链接、错误信息）
- 子实例列表（标题、状态、创建时间、可点击跳转到 Issue 详情）

**创建/编辑对话框**：
- 标题输入
- SOP 选择（下拉，从已加载的 SOP 列表选取）
- Workspace 选择
- Snail 分配计划（选择 SOP 后，展示该 SOP 的所有 stage/role，每个 role instance 分配一个 snail）
  - 复用 `NewIssueDialog` 中的 snail 分配 UI 模式
  - 默认分配第一个可用 snail，用户可修改
- Cron 表达式（文本输入 + 常用预设下拉）
  - 预设：每天 9:00 (`0 9 * * *`)、每周一 9:00 (`0 9 * * 1`)、每月 1 号 9:00 (`0 9 1 * *`)、自定义
  - 输入时实时显示下次触发时间预览
  - 使用 cron-parser 验证格式
- 启用/禁用开关

**前端文件结构**：

```
src/web/
  pages/IssueTemplates.tsx              — 主页面组件
  components/IssueTemplateFormDialog.tsx — 创建/编辑对话框（含 snail 分配）
  components/IssueTemplateDetail.tsx    — 详情面板（含执行历史 + 子实例列表）
  queries/issue-template.queries.ts     — 查询定义
  mutations/issue-template.mutations.ts — 变更定义
  router.tsx                            — 添加路由
  components/Sidebar.tsx                — 添加导航入口
  queries/keys.ts                       — 添加 queryKeys
```

## 不兼容更新

本次变更不涉及已有表的 schema 修改。新增的 `issue_template`、`issue_template_execution`、`issue_template_children` 三张表均通过 `CREATE TABLE IF NOT EXISTS` 创建，对已有数据库实例完全兼容。

## 生效路径 [required]

- **代码**：`src/domain/issue-template/` 模块（model、port、adapter、repository、initor）
- **数据库**：`issue_template`、`issue_template_execution`、`issue_template_children` 三张表（CREATE TABLE IF NOT EXISTS），不修改已有表
- **HTTP API**：`src/adapter/http/routes/issue-template.route.ts`
- **前端**：`src/web/pages/IssueTemplates.tsx` + 相关组件
- **主入口**：`src/main.ts` 的 `initModules()` 中添加 `initIssueTemplate()`
- **导航**：`src/web/components/Sidebar.tsx` 添加 "Issue Templates" 入口

## 设计约束摘要 [required]

### 硬约束（违反即 bug）
- 创建/更新母体时，`cron_expression` 必须是有效的 cron 表达式（使用 cron-parser 验证），否则拒绝操作
- 创建/更新母体时，`snail_assignment_plan` 必须通过 `validateSnailAssignmentPlan` 验证
- 删除母体为硬删除，execution 记录通过 ON DELETE CASCADE 一并清除
- 调度器为单进程运行，不支持多实例协调
- 错失触发必须在重启后补执行（catch-up）
- 子实例创建使用现有 `collaboration.createIssue()`，不得绕过
- 数据库 schema 只允许 CREATE TABLE IF NOT EXISTS，禁止 ALTER TABLE
- 母体不创建 Stage，不参与 Stage 流转
- 子实例创建时继承母体的 sop_snapshot 和 snail_assignment_plan，后续母体修改不影响已创建的子实例
- 母体连续失败 3 次后自动禁用（consecutive_failures >= 3 → enabled=false），需要用户干预后重新启用
- 子实例关联通过 `issue_template_children` 关联表，不修改 issue 表

### 设计取舍（不得自行推翻）
- D1：IssueTemplate 作为独立 domain 模块，与 issue 模块同级
- D2：使用 cron 表达式 + cron-parser 库
- D3：母体存储完整 snail_assignment_plan，不做自动构建
- D10：扩展 CreateIssueInput 支持传入 sop_snapshot，子实例继承母体冻结的 SOP
- 前端使用 master-detail 布局，与现有 SOP Center 等页面保持一致
- 母体是纯模板，不参与 Stage 流转（用户明确指令）
- 禁用母体 = 停止调度 + 保留子实例（用户明确指令）

### 语义不变量（实现中必须保持为真）
- 每次调度必须记录 execution（无论成功或失败）
- 子实例是普通 Issue，拥有完整的 Stage 生命周期
- 子实例的 `sop_snapshot` 和 `snail_assignment_plan` 创建后不可变（继承自母体的快照）
- 母体的 `snail_assignment_plan` 格式与 `CreateIssueInput.snail_assignment_plan` 完全一致
- 母体标题作为子实例标题的前缀（格式：`{母体标题} - {日期}`）

### 非目标（不得扩展）
- 不实现具体的任务类型（代码质量检查等）
- 不实现 commit 计数触发
- 不实现分布式调度
- 不实现自动修复
- 不实现事件驱动触发
- 不实现任务依赖链
- 母体不参与 Stage 流转

<!-- [design-time] 章节结束 -->

## 改动范围 [required]

| 文件/模块 | 变更类型 | 说明 |
|-----------|----------|------|
| `src/domain/issue-template/model.ts` | 新增 | IssueTemplate、Execution 数据模型 |
| `src/domain/issue-template/port.ts` | 新增 | IssueTemplatePort 接口 |
| `src/domain/issue-template/_internal/adapter.ts` | 新增 | 调度器核心逻辑（tick、子实例创建） |
| `src/domain/issue-template/_internal/repository.ts` | 新增 | SQLite 数据访问 |
| `src/domain/issue-template/_internal/initor.ts` | 新增 | 依赖注入 |
| `src/domain/issue/model.ts` | 修改 | CreateIssueInput 新增可选 `sop_snapshot` 字段 |
| `src/domain/issue/_internal/adapter.ts` | 修改 | createIssue 支持 sop_snapshot 传入时跳过 findByKey |
| `src/main.ts` | 修改 | 添加 initIssueTemplate() |
| `src/adapter/http/routes/issue-template.route.ts` | 新增 | HTTP API 路由 |
| `src/adapter/http/app.ts` | 修改 | 注册路由 |
| `src/web/pages/IssueTemplates.tsx` | 新增 | 主页面组件 |
| `src/web/components/IssueTemplateFormDialog.tsx` | 新增 | 创建/编辑对话框（含 snail 分配） |
| `src/web/components/IssueTemplateDetail.tsx` | 新增 | 详情面板 |
| `src/web/queries/issue-template.queries.ts` | 新增 | 查询定义 |
| `src/web/mutations/issue-template.mutations.ts` | 新增 | 变更定义 |
| `src/web/router.tsx` | 修改 | 添加路由 |
| `src/web/components/Sidebar.tsx` | 修改 | 添加导航入口 |
| `src/web/queries/keys.ts` | 修改 | 添加 queryKeys |
| `tests/issue-template/` | 新增 | 测试文件 |

## 验证 [required]

### 后端
- [ ] 创建母体后，数据库中存在对应记录，snail_assignment_plan JSON 正确存储
- [ ] 修改母体后，下一次调度使用新配置，已创建的子实例不受影响
- [ ] 删除母体后，execution 记录被 CASCADE 删除，子实例（普通 Issue）不受影响
- [ ] 服务器重启后，错失的调度被补执行
- [ ] 时间触发：设置 cron 为每分钟执行（`* * * * *`），等待后自动创建子实例
- [ ] 子实例通过 issue_template_children 关联表正确关联到母体
- [ ] 子实例的 sop_snapshot 和 snail_assignment_plan 从母体直接继承（非重新查找 SOP）
- [ ] HTTP API 全部端点返回正确响应
- [ ] `npm run check` 通过（TypeScript 编译 + ESLint）
- [ ] 所有测试通过

### 前端
- [ ] 侧边栏显示 "Issue Templates" 入口，点击进入页面
- [ ] 页面加载后显示已有母体列表（master-detail 布局）
- [ ] 点击"创建母体"打开表单对话框，含 SOP 选择和 snail 分配 UI
- [ ] 选择 SOP 后，展示该 SOP 的所有 role instance，可分配 snail
- [ ] 填写完成后提交，母体出现在列表中
- [ ] 点击母体列表项，右侧显示详情、执行历史和子实例列表
- [ ] 编辑母体：打开预填对话框，修改后保存
- [ ] 删除母体：确认对话框，删除后从列表移除
- [ ] 启用/禁用切换：点击后状态立即更新
- [ ] 子实例列表：显示标题、状态、创建时间，可点击跳转

## 关联 [required]

- **相关**: F20260701vky6（auto-invoke-after-advance）— 子实例创建后需要自动调用 agent
- **替代**: F20260702bhqh v1（旧方案：独立 ScheduledTask 模块）— 被本方案取代，PR #559 已关闭

## 未实现说明 [optional]

| 原始设计要求 | 未实现原因 | 用户确认状态 | 后续处理 |
|---|---|---|---|
| 代码质量检查 SOP/skill | 用户明确指令：本次只做调度机制，不做具体任务类型 | 已确认 | 作为调度系统的首个应用单独创建 feature |
| commit 计数触发 | 用户决策：复杂度不值得，时间触发已足够 | 已确认 | 如未来需要，作为独立 feature |
| 母体参与 Stage 流转 | 用户明确指令：纯模板，不能和活 issue 混为一谈 | 已确认 | — |

## 关键决策记录 [required]

| # | 决策点 | 最终决策 | 正面论点 | 反面论点 | 状态 |
|---|--------|----------|----------|----------|------|
| D1 | 架构层级 | IssueTemplate 独立 domain 模块 | 母体是独立领域概念（配置+调度），不参与 Stage 流转；用户明确要求独立建表 | 母体和子实例都是 Issue 家族，放同一模块更内聚 | 用户确认 |
| D2 | 触发机制 | cron 表达式 + cron-parser | 支持精确时间点调度，业界标准 | 需引入依赖，用户需了解 cron 语法（前端预设降低门槛） | 用户确认 |
| D3 | snail 分配存储 | 母体存储完整 plan，不做自动构建 | 消除旧方案的妥协，配置完整性保证 | 创建表单更复杂 | 用户确认 |
| D4 | 母体生命周期 | 纯模板，不参与 Stage 流转 | 概念清晰，母体≠活 Issue | 母体无法通过 Stage 流程"自我完善" | 用户确认 |
| D5 | 禁用语义 | 禁用母体 = 停止调度，保留子实例 | 子实例独立存在，用户可继续使用 | 禁用母体不会清理历史数据 | 用户确认 |
| D6 | 前端路由 | /issue-templates 独立路由 | 与 /issues 完全分离，不混淆 | 侧边栏多一个入口 | 用户确认 |
| D7 | 母体-子实例关联 | 独立关联表 issue_template_children | 零侵入 issue 表，已有数据库完全兼容 | 多一张表，查询需要 JOIN | 架构师-2 审视确认 |
| D8 | SOP 存储方式 | 存储 sop_snapshot + sop_key | 与 Issue 模型一致；快照自包含，不受 SOP 变更影响 | SOP 更新后需手动更新母体 | 用户确认 |
| D10 | 子实例 SOP 传递 | 扩展 CreateIssueInput 增加可选 sop_snapshot 字段 | 子实例真正继承母体冻结的 SOP；向后兼容现有创建流程 | CreateIssueInput 多一个可选字段 | 架构师-2 审视确认 |

## 风险与缓解 [required]

| # | 风险 | 严重程度 | 影响 | 缓解策略 | 负责方 |
|---|------|----------|------|----------|--------|
| R1 | 同时触发多个母体导致资源竞争 | 中 | agent 并发过多 | 串行执行，不并发创建子实例 | 开发者 |
| R2 | 服务器长时间停机后 catch-up 过多 | 低 | 瞬时负载高 | catch-up 串行执行 | 开发者 |
| R3 | ~~issue 表兼容性~~ | — | — | 已通过关联表方案消除（D7） | — |
| R4 | 创建母体的表单复杂度（含 snail 分配） | 低 | 用户体验 | 复用 NewIssueDialog 的 snail 分配 UI 模式 | 开发者 |
| R5 | ~~SOP 变更后母体的 snail_assignment_plan 可能失效~~ | — | — | 已通过 sop_snapshot 方案消除（D8+D10：母体和子实例都使用冻结快照） | — |

## 范围变更记录 [optional]

| 变更 | 原因 | 确认状态 |
|------|------|----------|
| 从"独立 ScheduledTask"重构为"IssueTemplate 母体" | 用户指出旧方案设计裂缝（缺 snail_assignment_plan），提出以 Issue 为主的新架构 | 用户确认 |
| 母体独立建表，不扩展现有 issue 表 | 用户明确指令：纯模板，不能和活 issue 混为一谈 | 用户确认 |
| 前端独立路由 /issue-templates | 用户明确指令：UI 上也得分离 | 用户确认 |
| 禁用语义：停止调度 + 保留子实例 | 用户决策 | 用户确认 |
| 移除 commit 计数触发 | 用户决策：复杂度不值得 | 已确认 |
| sop_key → sop_snapshot | 用户明确指令：应该像 issue 表一样存快照 | 用户确认 |
| interval_days → cron_expression | 用户明确指令：interval_days 过于粗糙 | 用户确认 |

## 旧方案总结（PR #559 已关闭）

旧方案采用独立的 `ScheduledTask` 实体 + 调度器自动构建 `snail_assignment_plan` 的模式，已通过 review（CI pass、231 测试通过、两位审查者达成共识），但因以下设计缺陷被用户否决：

1. **配置完整性不足**：`ScheduledTask` 只存 `sop_key`，缺少 `snail_assignment_plan`。执行时在 adapter 中"自动构建"——遍历 SOP 的所有 stage/role，统一分配第一个可用的 snail。这把 snail 分配决策推迟到了执行时，而不是让用户在配置时明确指定。
2. **概念模型碎片化**：引入了 `ScheduledTask` 作为独立的一等公民，与 Issue 平级，导致系统中存在 3 个独立概念（ScheduledTask、Issue、SOP），增加了理解成本。
3. **与 Issue 系统脱节**：定时任务本质上是"周期性创建 Issue"，但旧方案让 ScheduledTask 游离在 Issue 体系之外。

PR #559（21 个文件，1937 行新增）已直接关闭，代码不合入。
