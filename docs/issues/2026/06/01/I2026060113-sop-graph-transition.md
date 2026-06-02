---
id: I2026060113
title: sop-graph-transition
from_ids: [F2026052606, F2026060103, F2026053102]
tags: [sop, workflow, architecture]
modules: [workflow, persistence, message-bus, web]
doc_kind: spec
---

# I2026060113 [workflow] SOP 图驱动 stage 转移（O8 落地）

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

RFC #247 确定了 SOP 作为"配置化的状态机图"的方向（O8）。当前系统的 stage 转移路由硬编码在 `workflow.ts` 中的三个常量：

```typescript
const REQUIRED_STAGE_KEYS = ["design", "development", "review", "merge"];
const STAGE_ADVANCE_ROUTE = { design: "development", development: "review", review: "merge", merge: null };
const STAGE_BOUNCE_ROUTE = { development: "design", review: "design", merge: "review" };
```

这导致：
1. 任何 SOP 都必须包含 `design`/`development`/`review`/`merge` 四个 stage key（`assertSopHasRequiredStages` 强制校验）
2. 转移路径完全固定，无法配置
3. "回退"（bounce）是独立于"推进"（advance）的硬编码逻辑，路径也写死

同时，PR #68/#69 引入的"重开研发"功能（后在 SOP v2 中改名为 `bounceFeatureWorkflow`）作为临时方案，需要在统一转移图中被替代。

## 目标

将 stage 转移从硬编码常量迁移为 SOP YAML 配置的转移图，实现：
- SOP 定义 stage 节点 + 转移边，运行时加载
- Agent 通过 message-out 协议提议转移，Runtime 校验后执行
- 删除所有硬编码 stage key 和路由常量
- 删除独立的 bounce 机制，统一为转移图中的边

## 非目标

- 不引入完整的 DAG 条件分支引擎（数据模型预留，运行时走单路径/显式指定）
- 不改 Stage Gate 机制（`acceptance_checklist` + `gate_evidence` 保留不变）
- 不改 SOP 的 stage_definition / stage_role_definition 结构
- 不改 conversation / message 存储语义
- 不改 agent runtime 适配层
- 不迁移历史数据（DB 重置）

## 设计

### 1. SOP YAML 格式扩展

在 SOP YAML 顶层新增 `first_stage` 和 `transitions`：

```yaml
name: 代码交付流程
description: 标准软件研发交付流程

first_stage: design

stage_definitions:
  - key: design
    title: 需求对齐与设计
    # ... 现有字段不变
  - key: development
    title: 研发实现
  - key: review
    title: PR 检视
  - key: merge
    title: 合入

transitions:
  - from: design
    to: development
  - from: development
    to: review
  - from: review
    to: merge
  - from: development
    to: design
    guard:
      type: requires_artifacts
      config:
        artifacts: [design_update]
  - from: review
    to: design
    guard:
      type: requires_artifacts
      config:
        artifacts: [design_update]
  - from: merge
    to: review
    guard:
      type: requires_artifacts
      config:
        artifacts: [review_reopen]
```

**transitions 字段规格：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `from` | string | 是 | 源 stage key，必须存在于 `stage_definitions` |
| `to` | string | 是 | 目标 stage key，必须存在于 `stage_definitions` |
| `guard.type` | string | 否 | 守卫类型，当前仅支持 `requires_artifacts` |
| `guard.config` | object | 否 | 守卫参数。`requires_artifacts` 时为 `{ artifacts: string[] }`，要求 `stage.output_artifacts` 中存在的 key 列表 |

**设计取舍 — 无 `type: advance | bounce`**：转移图中每条边是平等的。"前进"还是"后退"是 agent 的语义判断，不是边的结构属性。Agent 可以沿任意有效边提议转移，Runtime 只校验边是否存在 + guard 是否满足。

**evolution.yaml**：单 stage SOP，`first_stage: development`，无 `transitions`（推进即完成）。

### 2. 数据库 Schema 变更

#### 2.1 `sop` 表新增 `first_stage`

```sql
ALTER TABLE sop ADD COLUMN first_stage TEXT;
```

#### 2.2 新增 `sop_transition` 表

```sql
CREATE TABLE IF NOT EXISTS sop_transition (
  id TEXT PRIMARY KEY,
  sop_id TEXT NOT NULL,
  from_stage_key TEXT NOT NULL,
  to_stage_key TEXT NOT NULL,
  guard_type TEXT,                -- 守卫类型：requires_artifacts
  guard_config TEXT,              -- JSON: { description?, artifacts? }
  FOREIGN KEY (sop_id) REFERENCES sop(id) ON DELETE CASCADE,
  UNIQUE(sop_id, from_stage_key, to_stage_key)
);
CREATE INDEX IF NOT EXISTS idx_sop_transition_lookup
  ON sop_transition(sop_id, from_stage_key);
```

**Why 新表而非 JSON 字段**：转移需要按 `(sop_id, from_stage_key)` 高频查询，索引比每次解析 JSON 高效，且与 `stage_definition` 的存储模式一致。

### 3. TypeScript 类型变更

#### 3.1 新增类型（`domain-types.ts`）

```typescript
export interface TransitionGuard {
  /** 守卫类型。当前仅支持 requires_artifacts。 */
  type: "requires_artifacts";
  /** 守卫参数。requires_artifacts 时为必须存在的 artifact key 列表。 */
  config: Record<string, unknown>;
}

/** YAML 中的转移守卫配置。 */
export interface YamlTransitionGuard {
  type: "requires_artifacts";
  config?: Record<string, unknown>;
}

export interface SopTransition {
  id: string;
  sop_id: string;
  from_stage_key: string;
  to_stage_key: string;
  guard: TransitionGuard | null;
}
```

#### 3.2 `Sop` 接口新增字段

```typescript
first_stage: string | null;
```

### 4. SOP 加载层变更

#### 4.1 `sop-model.ts`

- `SopUpsertInput` 新增 `firstStage?: string | null`
- `YamlStageDefinition` 旁新增 `YamlTransitionDefinition` 类型
- `upsertSopFromYaml()` 签名扩展：新增 `transitions: YamlTransitionDefinition[]` 参数
- 新增 `insertTransitions()` 函数
- 新增 `validateTransitions()` 函数：校验 transitions 引用的 stage key 都存在，first_stage 存在
- 新增 `getSopTransitions()` / `getForwardTransitions()` 查询函数

#### 4.2 `sop-loader.ts`

- `SopYamlFile` 接口新增 `first_stage?: string` 和 `transitions?: YamlTransitionDefinition[]`
- `loadSingleSopFile()` 将 `first_stage` 写入 sop 表，`transitions` 传给 `upsertSopFromYaml()`

### 5. Workflow 层变更（核心重写）

#### 5.1 删除

- `REQUIRED_STAGE_KEYS` 常量
- `STAGE_ADVANCE_ROUTE` 常量
- `STAGE_BOUNCE_ROUTE` 常量
- `assertSopHasRequiredStages()` 函数
- `advanceFeatureWorkflow()` 函数
- `bounceFeatureWorkflow()` 函数

#### 5.2 新增 `transitionFeatureStage()`

统一的转移函数，替代 advance + bounce：

```typescript
export function transitionFeatureStage(
  deps: WorkflowDependencies,
  ctx: { workspace: Workspace; feature: Feature; activeStage: Stage; targetStageKey?: string },
): FeatureTransitionResult
```

逻辑：
1. 查询从当前 stage 出发的所有有效转移边
2. 无出边 → 终态，feature 完成
3. 有出边 → 解析目标（未指定时取唯一出边；多出边时必须显式指定）
4. 校验 guard 条件（`requires_artifacts` 检查 `stage.output_artifacts`）
5. Gate 检查（warn 但不阻塞，保留现有 `checkGateEvidence` 逻辑）
6. 完成当前 stage，创建目标 stage 实例 + conversation

#### 5.3 `createFeatureWorkflow()` 改为首 stage 读取

从 `sop.first_stage` 读取首 stage key，fallback 到 `sequence` 最小的 stage。

### 6. Agent 驱动转移

#### 6.1 设计原则：stage_transition 是副作用信号，不是消息格式

`stage_transition` 与 `blocks`/`text` 不同——它不是一种消息内容格式，而是一条**副作用指令**：agent 告诉 runtime"我要提议转移 stage"。因此：

- `stage_transition` **不进入** message-out 解析管线（`parseMessageOutPayload` 不处理它）
- `stage_transition` **不存储**为 message event（它不是对话内容）
- `stage_transition` **在 agent 消息完成后**被检测和执行（副作用时序）

这避免了"同一段 JSON 既被当作消息内容又被当作转移信号"的冲突。

#### 6.2 提议格式

agent 在输出中嵌入转移提议 JSON（与 message-out JSON 并列，独立扫描）：

```json
{
  "format": "stage_transition",
  "target_stage": "review",
  "reason": "PR 已提交，自检通过，进入检视"
}
```

#### 6.3 `collaboration.ts` — 检测与执行

在 `invokeRoleBatch` 中，`finalizeMessageLifecycle` 之后、`return` 之前：

1. 从 streaming session 的原始输出文本中扫描 `format: "stage_transition"` JSON
2. 若找到，调用 `transitionFeatureStage()` 执行转移
3. 失败仅 `log.warn`，不阻塞（agent 消息已完成）

**为什么扫描原始输出而非已解析的 message events**：`stage_transition` 不进入 message event 管线，只能从原始文本中提取。`parseMessageOutPayload` 会因 `format !== "blocks"` 而拒绝它——这正是期望的行为：它不该被当作消息处理。

#### 6.4 与 message bus drain 的时序关系

`invokeRoleBatch` 是 `drainMessageBus` 循环中 `invokeBatch` 回调的实现。stage transition 在 `invokeRoleBatch` 内部完成后，drain 循环继续处理当前 conversation 的剩余 dispatches。新 stage 的 conversation 是独立的，其 drain 由创建该 conversation 的调用链触发（`createFeatureWorkflow` 中的初始消息入队 → 外部 drain）。

**不需要在 drain 循环内特殊处理**：transition 创建新 conversation + 入队初始消息，但不递归 drain。新 conversation 的 drain 在下一个调用点（HTTP 请求或下一轮 collaboration）自然发生。

#### 6.5 `message-out.ts` — 无需改动

`parseMessageOutPayload` 已经拒绝 `format !== "blocks"` 的 payload。`stage_transition` 不经过此函数，无需修改 `message-out.ts`。

### 7. Manager 层适配

#### 7.1 `manager.ts`

- `advanceFeature()` 改调 `transitionFeatureStage()`（无 target，自动前进）
- `bounceFeatureStage()` 改调 `transitionFeatureStage()`（带 targetStageKey）
- 或：合并为单一 `transitionFeature()` 方法

#### 7.2 HTTP API

- `POST /features/:featureId/advance` — 保留，内部调用 `transitionFeatureStage()`。可选 body：`{ target_stage_key?: string }`（多出边时必须指定）
- `POST /features/:featureId/bounce-stage` — 保留，body 从 `{ stage_id }` 改为 `{ target_stage_key: string }`（语义从"从哪 bounce"改为"bounce 到哪"），内部调用 `transitionFeatureStage()`
- `GET /sops/:sopId` — 扩展响应，新增 `transitions` 和 `first_stage` 字段，供前端获取转移图

### 8. Web UI 变更

#### 8.1 `feature-workflow-state.js`

- `canRestartFeatureDevelopment()` 改为 `canTransitionFrom(feature, stage)` — 从 SOP 转移图判断当前 stage 是否有可用出边
- 删除 `BOUNCE_TO_DESIGN_SOURCES` / `BOUNCE_TO_REVIEW_SOURCES` 硬编码常量

#### 8.2 `workspace-context.js`

- "回退阶段" 按钮改为 "转移" 按钮，显示可用的目标 stage 列表（从 SOP 转移图读取）
- 或保留两个按钮但根据转移图动态启用/禁用

#### 8.3 `app.js`

- `bounceStage()` 改为调用统一的转移 API
- 新增 `transitionStage(targetStageKey)` 方法

### 9. SOP 提示词注入

在 `manager-collaboration.ts` 的 `buildWorkflowSystemPrompt` 中，将当前 stage 的可用转移注入系统提示词。需要修改 `PromptBuildContext`（`builder.ts`）新增 `transitions` 字段，或在 `buildWorkflowSystemPrompt` 中直接拼接到 `systemReminder`。

同时，`builder.ts` 中的 `STAGES` 常量（line 161-166）硬编码了 stage label 和 next action：

```typescript
const STAGES: Record<string, {label:string;next:string}> = {
  design: { label: "需求对齐与设计 (第 1/4 阶段)", next: "..." },
  development: { label: "研发实现 (第 2/4 阶段)", next: "..." },
  review: { label: "PR 检视 (第 3/4 阶段)", next: "..." },
  merge: { label: "合入 (第 4/4 阶段)", next: "..." },
};
```

这个常量需要改为从 SOP 配置动态读取，或至少不再假设固定的 4 阶段编号。`stage_progress_label` 和 `stage_next_action` 模板变量应从 stage_definition 或 SOP 转移图派生。

### 10. 删除"重开研发"临时功能

以下代码是 PR #68/#69 引入的"重开研发"功能（后改名为 bounce），在统一转移图中被替代：

**删除项：**
- `workflow.ts`: `bounceFeatureWorkflow()` 函数
- `workflow.ts`: `STAGE_BOUNCE_ROUTE` 常量
- `manager.ts`: `bounceFeatureStage()` 方法（或改为调用 `transitionFeatureStage`）
- `feature-routes.ts`: `registerFeatureBounceRoute`（或改为调用统一转移 API）
- `feature-workflow-state.js`: `BOUNCE_TO_DESIGN_SOURCES` / `BOUNCE_TO_REVIEW_SOURCES` 常量
- `feature-workflow-state.js`: `canRestartFeatureDevelopment()` 函数（替换为 `canTransitionFrom`）

**保留项（功能等价替代）：**
- HTTP API `/features/:featureId/bounce-stage` — 保留端点，内部改调 `transitionFeatureStage`
- UI "回退阶段" 按钮 — 改为基于转移图的上下文感知按钮

## 生效路径

- SOP YAML（`.meta/sop/*.yaml` + workspace `.snail/sop/*.yaml`）：转移图定义
- `workflow.ts`：转移执行逻辑
- `sop-model.ts` / `sop-loader.ts`：转移图加载
- `collaboration.ts`：agent 转移提议检测与执行
- Web UI：转移按钮

## 改动范围

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/persistence/schema.ts` | 新增 | `sop_transition` 表 + `sop.first_stage` 列 |
| `src/shared/domain-types.ts` | 新增 | `SopTransition`、`TransitionGuard` 接口；`Sop.first_stage` |
| `src/shared/types.ts` | 修改 | re-export 新类型 |
| `src/persistence/sop-model.ts` | 重写 | `upsertSopFromYaml` 扩展 + transition CRUD + 校验 |
| `src/persistence/sop-loader.ts` | 修改 | 解析 `first_stage` + `transitions` |
| `src/persistence/store.ts` | 新增 | transition 查询方法代理 |
| `src/workspace-workflow/workflow.ts` | 重写 | 删除硬编码 + 新增 `transitionFeatureStage` + `validateGuard` |
| `src/workspace-workflow/workflow.ts` | 修改 | `createFeatureWorkflow` 首 stage 读取 |
| `src/workspace-workflow/index.ts` | 修改 | 导出替换 |
| `src/workspace-workflow/manager.ts` | 修改 | `advanceFeature` / `bounceFeatureStage` 改调统一函数 |
| `src/workspace-workflow/manager-collaboration.ts` | 修改 | 注入转移图到系统提示词 |
| `src/message-bus/collaboration.ts` | 新增 | agent 消息完成后从原始输出扫描 stage_transition 并执行转移 |
| `src/interaction-entry/api/feature-routes.ts` | 修改 | advance body 新增 `target_stage_key`；bounce body 从 `stage_id` 改为 `target_stage_key` |
| `src/interaction-entry/api/server.ts` | 修改 | `GET /sops/:sopId` 响应新增 `transitions` + `first_stage` |
| `src/prompt-center/builder.ts` | 修改 | `STAGES` 常量从硬编码改为动态读取；`PromptBuildContext` 新增 `transitions` 字段（或在 systemReminder 中注入） |
| `src/web/feature-workflow-state.js` | 重写 | `canTransitionFrom` 替代 `canRestartFeatureDevelopment` |
| `src/web/feature-readonly-state.js` | 修改 | 引用了 `canRestartFeatureDevelopment`（line 6, 22），需改为 `canTransitionFrom` |
| `src/web/workspace-context.js` | 修改 | 转移按钮改为上下文感知 |
| `src/web/app.js` | 修改 | `bounceStage` → `transitionStage`；从 SOP API 获取转移图 |
| `.meta/sop/code-delivery.yaml` | 修改 | 新增 `first_stage` + `transitions` |
| `.meta/sop/evolution.yaml` | 修改 | 新增 `first_stage` |
| `tests/workspace/stage-cycle-test.ts` | 重写 | 适配新 API |
| `tests/workspace/collaboration-test.ts` | 修改 | 新增 agent transition proposal 测试 |
| `tests/web/feature-workflow-state-test.ts` | 重写 | 8 个 `canRestartFeatureDevelopment` 测试用例改为 `canTransitionFrom` |

**不改动的文件：**
- `src/message-bus/message-out.ts`（`stage_transition` 不经过 message-out 解析管线，无需改动）
- `schema.ts` 中 stage_definition / stage_role_definition / workspace_sop 表结构
- `store.ts` 中 stage/conversation/message CRUD
- Agent runtime 适配层（`src/agent/`）
- Stage Gate 机制（`acceptance_checklist` + `gate_evidence`）
- Prompt 文档（`.meta/prompts/` 内容不变，但 `builder.ts` 的模板变量和 STAGES 常量需要改）

## 验证

### 通用

- [ ] `npm run check` 全部通过（tsc + lint + 测试）
- [ ] `code-delivery.yaml` 的 `transitions` 配置与原硬编码路由行为完全一致
- [ ] `evolution.yaml` 单 stage SOP 正常工作（推进即完成）
- [ ] DB 重置后启动正常，seed 数据正确加载

### 转移图

- [ ] 线性前进：design → development → review → merge 正常流转
- [ ] 打回路径：development → design、review → design、merge → review 正常工作
- [ ] 终态：merge 推进后 feature 完成
- [ ] guard 校验：`requires_artifacts` 缺失时拒绝转移并报错
- [ ] 多出边：未指定 target 时报错，指定后正常转移
- [ ] 首 stage：`first_stage` 配置生效，fallback 到 sequence 最小

### Agent 转移提议

- [ ] agent 输出 `stage_transition` JSON 后自动执行转移
- [ ] `stage_transition` 不被存储为 message event（不进入对话内容）
- [ ] `stage_transition` 不影响 message-out 解析管线（`parseMessageOutPayload` 行为不变）
- [ ] 无效 target_stage 时 log.warn 不阻塞
- [ ] 无转移提议时不影响正常流程
- [ ] 转移后新 conversation 的 drain 在下一个调用点自然发生（不递归 drain）

### API

- [ ] `GET /sops/:sopId` 响应包含 `transitions` 和 `first_stage`
- [ ] `POST /features/:featureId/advance` 无 body 时线性自动前进
- [ ] `POST /features/:featureId/advance` 带 `target_stage_key` 时按指定目标转移
- [ ] `POST /features/:featureId/bounce-stage` body 改为 `target_stage_key` 后正常工作

### 删除验证

- [ ] `REQUIRED_STAGE_KEYS` / `STAGE_ADVANCE_ROUTE` / `STAGE_BOUNCE_ROUTE` 不存在于源码
- [ ] `assertSopHasRequiredStages` 不存在于源码
- [ ] `bounceFeatureWorkflow` 不存在于源码
- [ ] `canRestartFeatureDevelopment` 不存在于源码
- [ ] `BOUNCE_TO_DESIGN_SOURCES` / `BOUNCE_TO_REVIEW_SOURCES` 不存在于源码
- [ ] `builder.ts` 的 `STAGES` 常量不再硬编码 4 阶段编号

### UI

- [ ] 转移按钮根据 SOP 转移图动态启用/禁用
- [ ] 推进阶段正常工作
- [ ] 回退阶段正常工作

## 关联

- **前置**: F2026052606（SOP 池与角色域模型 — 建立了 sop / stage_definition / feature.adopted_sop_id 基础）
- **前置**: F2026060103（Stage Gate — 建立了 acceptance_checklist / gate_evidence 机制）
- **前置**: F2026053102（SOP v2 4 阶段 — 建立了当前的 advance/bounce 路由和 "重开研发" 功能）
- **来源**: RFC #247 O8（SOP 图执行引擎方向）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|-----------|------|------|
| 1 | 转移图无 `type: advance/bounce` 字段 | 采纳。边是平等的，agent 语义判断方向 | 2026-06-01 |
| 2 | Agent 转移提议机制 | 采纳原始输出扫描（非 message-out 扩展）。`stage_transition` 是副作用信号不是消息格式，不进入 message-out 解析管线，避免"同一 JSON 既当消息又当信号"的冲突 | 2026-06-01 |
| 3 | 多出边时的行为：自动 vs 必须指定 | 采纳必须指定，避免歧义 | 2026-06-01 |
| 4 | bounce API 端点是否保留 | 保留端点，内部改调统一函数 | 2026-06-01 |
| 5 | `sequence` 字段是否删除 | 保留，作为 UI 排序提示；转移逻辑不依赖它 | 2026-06-01 |
| 6 | `builder.ts` STAGES 常量 | 从硬编码 4 阶段改为从 SOP 配置动态读取 | 2026-06-01 |
| 7 | bounce API body 语义 | `stage_id`（源）改为 `target_stage_key`（目标），与转移图语义一致 | 2026-06-01 |
| 8 | stage_transition 与 message-out 管线的关系 | `stage_transition` 不经过 `parseMessageOutPayload`（它拒绝 `format !== "blocks"`），不存储为 message event，从原始输出独立扫描 | 2026-06-01 |
| 9 | 转移与 drain 的时序 | transition 在 `invokeRoleBatch` 内完成，drain 循环继续处理旧 conversation 剩余 dispatches；新 conversation 的 drain 在下一个调用点自然发生，不递归 | 2026-06-01 |
