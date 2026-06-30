---
id: F20260630mypf
title: hierarchical-sop-engine
from_ids: []
tags: [sop, orchestration, multi-agent, project-management]
modules: [sop, issue, issue-collaboration]
doc_kind: spec
---

# F20260630mypf [sop] 分层 SOP 引擎：项目级需求分解与子 issue 自治推进

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

当前 Snail Shell 的 SOP 模型是扁平的：1 Issue 绑定 1 SOP 实例，SOP 由人类在 `data/file/sops/` 中静态定义。这意味着：

1. **需求粒度由人决定**：用户必须手动将"做一个游戏"拆成多个独立 issue，每个 issue 各自走 code-delivery SOP。
2. **SOP 是预设的**：所有 SOP（code-delivery、evolution 等）由人类预先编写 YAML，agent 无法根据项目特点自行定义流程。
3. **没有父子关系**：Issue 是独立实体，子 issue 的完成状态无法向上聚合，缺少项目级的进度视图和自动调度。

用户的愿景是：输入"做一个贪吃蛇游戏"，系统自动分析、设计、拆分需求，创建子 issue 并行推进，甚至 SOP 本身也由 AI 按需创建。系统是一个有自愈能力的项目引擎，不是一个需要人工拆 issue 的看板。

## 目标

### P1 — 分层 Issue 结构 + 项目级 SOP

1. Issue 支持父子关系（`parent_issue_id`），形成树状结构
2. 新增 `project-initiation` 固定 SOP，其 decomposition stage 由 agent 拆分出子 issue
3. 子 issue 完成状态向上聚合到父 issue
4. 子 issue 之间支持依赖声明（DAG），系统自动调度就绪的子 issue

### P2 — 动态 SOP 创建

1. Agent 通过 MCP 工具（如 `create_sop`）动态定义新 SOP
2. SOP 模板片段（原子构建块）供 agent 组合，而非从零编写
3. SOP 校验层：检查必填 stage（涉及代码的 SOP 必须有 review stage）、检查 gate 覆盖度
4. 动态创建的 SOP 可被子 issue 引用，也可持续复用

### P3 — 失败自愈 + 多层递归

1. 失败自动分类：可重试（超时/格式错误）→ 自动重试；review 打回 → 自动回退；需求歧义 → 升级人工
2. 子 issue 连续失败 N 次后，系统判断回退到父 issue 的 decomposition 重新拆分
3. 支持 3-4 层递归（子 issue 自身也可以走 decomposition stage 继续拆分）
4. 分层上下文：每层 agent 只看到直接子 issue 状态，不暴露孙子 issue 细节

## 非目标

- **不做通用项目管理工具**：不替代 Jira/Linear 等外部项目管理系统，只在 Snail Shell 内部管理 AI 驱动的子 issue 生命周期
- **不做跨 workspace 的项目聚合**：分层 SOP 限于单 workspace 内
- **不做实时协作编辑**：子 issue 之间通过产出物（PR 合入后的接口、文档）解耦，不做实时代码协作
- **不做预算系统（本期）**：Token/成本预算不在本期范围内，但架构预留扩展点

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当用户创建 Issue 并指定 SOP 为 `project-initiation` 时 | 系统创建项目级 Issue，进入 intake stage，分配 PM/architect 角色 | |
| B2 | 当 decomposition stage 的 agent 产出子 issue 定义列表时 | 系统校验列表格式（title、scope、sop_key、dependencies），为每个子 issue 创建独立 Issue 记录并设置 parent_issue_id | |
| B3 | 当子 issue 之间声明了依赖关系（A depends_on B）时 | 系统构建 DAG，仅当 B 的所有依赖完成且 B 自身完成后，A 才进入可执行状态 | |
| B4 | 当依赖图存在循环依赖时 | 系统拒绝创建，返回循环依赖路径 | |
| B5 | 当所有子 issue 完成时 | 父 issue 的 monitor stage 自动检测到聚合状态为"全部完成"，推进到 integration stage | |
| B6 | 当子 issue 连续失败超过 N 次时 | 系统自动判断失败类型：需求问题 → 回退父 issue 的 decomposition；实现问题 → 回退子 issue 的 design；无法判断 → 升级人工 | |
| B7 | 当 agent 调用 create_sop 创建新 SOP 时 | 系统校验 SOP 结构（必填 stage、gate 覆盖度），通过后写入 workspace SOP 存储 | |
| B8 | 当 agent 创建的 SOP 缺少 review stage 且涉及代码变更时 | 系统拒绝创建，返回校验错误 | |
| B9 | 当子 issue 的 agent 需要进一步拆分时 | 子 issue 可以走自身的 decomposition stage 创建孙 issue，递归深度不超过 4 层 | |
| B10 | 当父 issue 的 agent 查看子 issue 状态时 | 只返回直接子 issue 的聚合状态（完成/进行中/失败/阻塞），不暴露孙 issue 细节 | |

## 设计

### P1 详设：分层 Issue 结构

#### 1.1 Issue Model 扩展

当前 `Issue` 接口需要扩展以下字段：

```
parent_issue_id: string | null      // 父 issue ID，顶层项目 issue 为 null
child_issue_ids: string[]           // 直接子 issue ID 列表
issue_type: 'project' | 'task'     // project=有子 issue 的项目级，task=叶子节点
aggregated_status: IssueAggregateStatus  // 聚合状态
```

聚合状态枚举：

```
IssueAggregateStatus:
  - 'pending'      // 尚未开始（子 issue 未创建或未就绪）
  - 'in_progress'  // 至少一个子 issue 正在进行
  - 'blocked'      // 所有可执行子 issue 已完成，但有依赖阻塞
  - 'completed'    // 所有子 issue 已完成
  - 'failed'       // 有子 issue 失败且系统无法自愈
```

状态聚合规则：
- 任一子 issue `in_progress` → 父 `in_progress`
- 所有子 issue `completed` → 父 `completed`
- 任一子 issue `failed` 且自愈失败 → 父 `failed`
- 无可执行子 issue（全被依赖阻塞）→ 父 `blocked`
- 其他 → 父 `pending`

聚合状态附带进度信息（不新增枚举值，通过附加字段实现）：

```
aggregated_progress: {
  total: number;        // 子 issue 总数
  completed: number;    // 已完成数
  in_progress: number;  // 进行中数
  failed: number;       // 失败数
  blocked: number;      // 阻塞数
}
```

父 issue 的 agent 可通过 `aggregated_progress` 判断进度（如 `completed: 8/10` 表示接近完成），无需新增 `partially_completed` 枚举值。

#### 1.2 子 Issue 依赖 DAG

子 issue 创建时可声明 `depends_on: string[]`（引用同一父 issue 下的其他子 issue ID）。

系统维护依赖图：
- 创建时校验无环（拓扑排序）
- 依赖全部完成的子 issue 自动进入可执行状态
- 依赖变更时重新计算就绪集

数据模型：

```
IssueDependency:
  issue_id: string          // 被阻塞的子 issue
  depends_on: string        // 阻塞源子 issue
  created_at: string
```

#### 1.3 项目级 SOP：project-initiation

新增固定 SOP，stage 定义：

```
intake → analysis → decomposition → monitor → integration → delivery
```

| Stage | 角色 | 产出 | Gate |
|-------|------|------|------|
| intake | PM | 需求理解文档 | intake-01: 需求摘要非空 |
| analysis | architect + PM | 技术可行性分析 + 粗粒度模块划分 | analysis-01: 模块列表已定义 |
| decomposition | architect | 子 issue 列表 + 依赖关系 + SOP 指派 | decom-01: 至少 1 个子 issue; decom-02: DAG 无环; decom-03: 每个子 issue 有 scope 和 sop_key |
| monitor | PM（监控角色） | 聚合状态跟踪、失败处理 | monitor-01: 所有子 issue 终态 |
| integration | architect + reviewer | 交付物完整性验证 | integ-01: 所有子 issue PR 已合入; integ-02: 集成验证通过 |
| delivery | PM | 项目交付报告 | delivery-01: 交付报告已生成 |

#### 1.4 Monitor Stage 推进机制

Monitor stage 不是普通的人工 stage，而是一个 **系统自动驱动的调度器**，不走 agent dispatch 路径。

**与 AutoAdvanceEngine 的关系**：Monitor stage 完全绕过 AutoAdvanceEngine。AutoAdvanceEngine 的 `evaluate` 方法通过 `stage.key` 硬编码路由（development → 单 agent gate、design/review → 对抗共识），Monitor 不产生 `StageTransitionSuggestion`，也不需要 agent 发言。Monitor 的推进逻辑由独立的 `MonitorScheduler` 组件执行。

**事件驱动机制**：

Monitor 通过 `CollaborationConsumer` 的回调事件驱动，而非轮询：

```
事件源：子 issue 的 stage 状态变化（completed/failed/cancelled）
  ↓
CollaborationConsumer.onMessageCompleted / onAutoAdvanced
  ↓
MonitorScheduler.evaluate(issue_id)
  ↓
  ├─ 聚合状态计算 → 更新父 issue aggregated_status
  ├─ 就绪检查 → 解除阻塞的子 issue 自动创建首个 stage
  ├─ 完成检查 → 所有子 issue 终态 → 推进到 integration
  └─ 失败检查 → 触发自愈逻辑（见 P3）
```

**完成条件评估**：`MonitorScheduler.evaluate` 检查 `child_issue_ids` 中每个子 issue 的状态：
- 所有子 issue `completed` → 自动创建 integration stage，推进父 issue
- 任一子 issue `failed` 且自愈失败 → 更新父 issue `aggregated_status = failed`，通知 PM agent
- 部分子 issue 完成、部分进行中 → 更新 `aggregated_status = in_progress`，等待
- 无可执行子 issue（全被依赖阻塞）→ `aggregated_status = blocked`

**Monitor stage 的完成**：Monitor stage 不产生 gate_evidence，其完成由 `MonitorScheduler` 直接调用 `StageRepository` 创建下一 stage 实现。AutoAdvanceEngine 不参与 Monitor 的推进判断。

#### 1.5 Decomposition Stage 推进协议

Decomposition stage 的推进采用混合式：agent 通过 MCP 工具逐步创建子 issue，最后通过 `set_final_body` 的 `stage_transition` 信号声明完成。

**子 issue 创建时序**：

```
1. Agent 进入 decomposition stage，接收 analysis stage 产出
2. Agent 通过 create_child_issue MCP 工具逐步创建子 issue（对话式探索）
   - 每次创建时声明 depends_on（可选）
   - 系统实时校验 DAG 无环
3. Agent 完成分解后，调用 set_final_body 发出 stage_transition 信号
   - gate_evidence 格式：
     decom-01: "已创建 {N} 个子 issue: {issue_id 列表}"
     decom-02: "DAG 拓扑排序通过，无环"
     decom-03: "每个子 issue 均有 scope 和 sop_key: {逐条列出}"
4. AutoAdvanceEngine 收到信号，校验 gate_evidence：
   - decom-01: 检查父 issue 的 child_issue_ids.length >= 1
   - decom-02: 检查 IssueDependency 表中无环（拓扑排序）
   - decom-03: 检查每个子 issue 的 context 中有 scope，sop_snapshot.key 非空
5. 校验通过 → 推进到 monitor stage
```

**Gate 校验扩展**：当前 `allGatesPassed` 是硬编码 switch，project-initiation 的自定义 gate（intake-01、analysis-01、decom-01..03 等）需要改为 **从 SOP 定义中动态读取 gate 列表**。具体：将 gate ID 列表从硬编码改为从 `StageDefinition` 的 `gate_ids` 字段读取（新增字段），现有 SOP 的 gate 通过配置映射保持兼容。

#### 1.6 create_child_issue 工具接口

```
输入：
  parent_issue_id: string              // 必填，父 issue ID
  title: string                        // 必填，子 issue 标题
  scope: string                        // 必填，子 issue 范围描述
  sop_key: string                      // 必填，使用的 SOP key
  depends_on?: string[]                // 可选，依赖的兄弟子 issue ID 列表
  snail_assignment_plan?: IssueSnailAssignmentPlan  // 可选，snail 分配计划
  context?: Record<string, string>     // 可选，初始上下文

输出：
  issue_id: string                     // 创建成功的子 issue ID
  validation_errors: string[]          // 校验错误（如有）

行为：
  1. 校验 parent_issue_id 有效且为 project 类型
  2. 校验递归深度未超限（当前深度 < 4）
  3. 校验 sop_key 存在（平台级或 workspace 级）
  4. 如果有 depends_on，校验引用的子 issue 属于同一父 issue，且添加后 DAG 无环
  5. 创建子 issue 记录：
     - parent_issue_id = 传入值
     - issue_type = 'task'（除非 sop_key = 'project-initiation'，则为 'project'）
     - aggregated_status = 'pending'
     - snail_assignment_plan = 传入值 || 系统默认策略（见 1.7）
     - context.scope = scope
  6. 将子 issue ID 添加到父 issue 的 child_issue_ids
  7. 子 issue 创建后保持 pending 状态，不自动启动
  8. MonitorScheduler 统一管理启动时机：当子 issue 的 depends_on 全部满足时，MonitorScheduler 自动为其创建首个 stage 并开始调度
```

#### 1.7 子 issue 的 snail_assignment_plan 默认策略

子 issue 创建时，`snail_assignment_plan` 的来源优先级：

1. **Agent 显式指定**：decomposition agent 在 `create_child_issue` 时传入 plan → 直接使用
2. **系统默认策略**：agent 未指定时，系统为子 issue 的每个 stage 的每个 role 分配一个新的默认 snail 实例
   - 默认 snail：取 SOP 中 role 的 `skill` 字段，查找匹配的 snail key（如 `skill: "cd-development"` → `snail_key: "claude-code-stateful"`）
   - 如果找不到匹配的 snail key，使用 workspace 的默认 snail

**已知限制**：P1 阶段的默认策略可能不够灵活（如无法指定特定模型）。P2 可扩展为 agent 指定 snail 偏好规则。

#### 1.8 跨父依赖限制

当前设计中 `depends_on` 仅限引用同一父 issue 下的兄弟子 issue。这是 P1 的有意限制。

**原因**：跨父依赖（子项目 A 的 task X 依赖子项目 B 的 task Y）需要跨 issue 的依赖图，增加复杂度。P1 先验证同父依赖的核心机制，P3 多层递归时重新评估是否需要扩展。

### P2 详设：动态 SOP 创建

#### 2.1 MCP 工具：create_sop

Agent 通过 `create_sop` MCP 工具创建新 SOP：

```
输入：
  key: string                    // SOP 唯一标识
  name: string                   // 显示名称
  description: string            // 描述
  shared_skill: string | null    // 共享 skill
  stages: StageDefinitionInput[] // 阶段定义
  transitions: TransitionInput[] // 流转边

输出：
  sop_key: string                // 创建成功的 SOP key
  validation_warnings: string[]  // 校验警告（非阻断）
```

**StageDefinitionInput 中的角色与 Skill 处理**：

每个 stage 中的角色可以引用模板片段中的 skill 或自定义 skill：

```
StageDefinitionInput:
  key: string
  title: string
  description: string
  roles: RoleInput[]

RoleInput:
  key: string
  name: string
  description: string
  skill: string | { template: string }  // skill 名称 或 模板引用
  count: number
```

Skill 来源优先级：
1. **模板片段继承**：引用 `design-stage` 模板的角色自动继承 `cd-design` skill
2. **引用已有 skill**：`skill: "cd-development"` → 直接引用平台级 skill
3. **自动生成**：`skill: { auto_generate: true }` → `create_sop` 自动生成一个基础 SKILL.md，包含角色描述、prohibition、self_check 的默认模板
4. **Agent 传入内容**：`skill: { content: "..." }` → agent 提供完整的 SKILL.md 内容，`create_sop` 写入 `<workspace>/.snail/skills/<name>/SKILL.md`

**校验**：`create_sop` 在创建前检查每个角色的 skill 是否可解析（模板存在 / 已有 skill 存在 / 自动生成成功 / 内容非空）。无法解析则拒绝创建并返回错误。

#### 2.2 SOP 模板片段（原子构建块）

系统提供预定义的 stage 模板片段，agent 组合而非从零写：

```
模板片段：
  - design-stage:     roles=[architect×2], gate=[design-01, design-02, design-03]
  - development-stage: roles=[developer], gate=[dev-01..dev-06]
  - review-stage:     roles=[reviewer×2, developer], gate=[rev-01..rev-05]
  - prototype-stage:  roles=[developer], gate=[proto-01]（轻量级，无 review）
  - test-stage:       roles=[tester], gate=[test-01..test-03]
  - deploy-stage:     roles=[developer], gate=[deploy-01, deploy-02]
```

Agent 可以：
1. 直接引用模板片段（如 `stages: [design-stage, development-stage, review-stage]`）
2. 自定义 stage（提供完整的 roles 和 gate 定义）
3. 混合使用（模板 + 自定义）

#### 2.3 SOP 校验规则

| 规则 | 级别 | 说明 |
|------|------|------|
| S1 | 阻断 | SOP 必须至少有 1 个 stage |
| S2 | 阻断 | 每个 stage 必须至少有 1 个 role |
| S3 | 阻断 | transitions 中引用的 stage key 必须在 stages 中定义（同时应用于 `create_sop` 和 `FileSopRepository` 加载路径，保持一致性） |
| S4 | 阻断 | 涉及代码变更的 SOP（包含 development-stage 或 prototype-stage）必须有 review-stage |
| S5 | 阻断 | SOP 必须有且仅有一个入口 stage（无 incoming transition 的 stage） |
| S6 | 警告 | gate 覆盖度不足（某 stage 的 gate 数量 < 2） |

#### 2.4 SOP 存储

动态创建的 SOP 存储在 workspace 级目录：

```
<workspace>/.snail/sops/<sop-key>.yaml
```

与平台级 SOP（`data/file/sops/`）分离，workspace SOP 优先级更高。

### P3 详设：失败自愈 + 多层递归

#### 3.1 失败分类与自动处理

| 失败类型 | 判定条件 | 自动处理 |
|----------|----------|----------|
| 可重试失败 | agent 超时、网络中断、LLM 输出格式错误 | 自动重试，上限 3 次 |
| review 打回 | 审查者发现问题，stage 回退到 development | 自动回退，开发者修复 |
| 实现方案失败 | 子 issue 连续 3 次在 development→review 循环中被打回 | 回退到该子 issue 的 design stage |
| 需求拆分失败 | 子 issue 连续 3 次在 design stage 无法收敛 | 回退到父 issue 的 decomposition stage，触发重新拆分 |
| 依赖冲突 | 两个子 issue 的产出互相矛盾 | 父 issue 的 integration stage 拒绝，自动触发相关子 issue 回退到 design stage（通过 rollback transition） |
| 需求歧义 | agent 无法从 issue 描述推断明确意图 | 升级人工 |
| 架构冲突 | 自动调解失败 | 升级人工 |

#### 3.2 多层递归

子 issue 可以指定 SOP 为 `project-initiation`，从而自身也成为项目级 issue，继续拆分孙 issue。

递归约束：
- 最大深度：4 层（project → sub-project → task → sub-task）
- 上下文隔离：每层 agent 只接收直接子 issue 的聚合状态
- 深度检查：创建子 issue 时检查当前深度，超过限制拒绝创建

上下文注入策略：
- 父 issue 的 decomposition agent 收到：用户原始需求 + analysis stage 产出
- 子 issue 的 design agent 收到：该子 issue 的 scope 描述 + 父 issue 的接口约束
- 孙 issue 的 development agent 收到：该孙 issue 的具体任务 + 父子 issue 的接口约束

#### 3.3 父子 Issue 生命周期管理

```
创建子 issue 时：
  1. 校验 parent_issue_id 有效
  2. 校验递归深度未超限
  3. 创建子 issue 记录，设置 parent_issue_id
  4. 将子 issue ID 添加到父 issue 的 child_issue_ids
  5. 如果有 depends_on，创建依赖关系并校验无环
  6. 无依赖或依赖已满足的子 issue，自动创建首个 stage 并开始调度

子 issue 完成时：
  1. 更新子 issue 状态为 completed
  2. 触发父 issue 的聚合状态重新计算
  3. 检查是否有其他子 issue 因此解除阻塞
  4. 如果所有子 issue 完成，推进父 issue 的 monitor stage → integration

子 issue 失败时：
  1. 更新子 issue 状态为 failed
  2. 触发自愈逻辑（见 3.1）
  3. 如果自愈失败，更新父 issue 聚合状态为 failed
  4. 通知父 issue 的 PM agent（通过消息系统）
```

## 生效路径

- **代码**：
  - `src/domain/issue/model.ts`（Issue 父子关系、aggregated_progress）
  - `src/domain/sop/model.ts`（SOP 校验 S1-S6、StageDefinition.gate_ids）
  - `src/app/issue-collaboration/auto-advance.ts`（gate 动态校验、自愈逻辑）
  - `src/app/issue-collaboration/monitor-scheduler.ts`（Monitor 自动调度器）
  - `src/app/issue-collaboration/collaboration.ts`（Monitor 集成）
- **MCP 工具**：`create_sop`、`create_child_issue`（新增）、`set_final_body`（扩展 stage_transition 支持 decomposition 信号）
- **SOP YAML**：`data/file/sops/project-initiation/project-initiation.yaml`（新增固定 SOP）
- **配置**：递归深度限制（max_depth=4）、失败重试次数（max_retries=3）等参数

## 设计约束摘要

- **边界**：分层 SOP 限于单 workspace 内，不做跨 workspace 聚合；`depends_on` 仅限同父 issue 的兄弟子 issue（P1 有意限制，P3 多层递归时重新评估）
- **关键决策**：
  - Monitor stage 是系统自动驱动的调度器（`MonitorScheduler`），不走 AutoAdvanceEngine，不需要 agent 主动发言
  - SOP 动态创建必须通过校验层（S1-S6），S3 校验同时应用于 `create_sop` 和 `FileSopRepository` 加载路径
  - Gate 校验从硬编码改为从 SOP 定义动态读取（`StageDefinition.gate_ids` 字段新增）
  - 子 issue 的 `snail_assignment_plan` 优先使用 agent 指定值，未指定时系统按 skill→snail 映射自动分配
- **非目标约束**：不做预算系统、不做实时协作编辑、不做通用项目管理工具、不做跨父依赖（P1）
- **语义不变量**：子 issue 的完成状态必须准确反映到父 issue 的聚合状态；依赖 DAG 必须无环；递归深度不得超过 4 层

<!-- [design-time] 章节结束 -->

## 改动范围

| 模块 | 文件 | 变更类型 |
|------|------|----------|
| issue model | `src/domain/issue/model.ts` | 扩展 Issue 接口，新增 IssueDependency、IssueAggregateStatus、aggregated_progress |
| issue repository | `src/domain/issue/_internal/repository.ts` | 支持父子查询、依赖图存储 |
| sop model | `src/domain/sop/model.ts` | 新增 SOP 校验逻辑（S1-S6）、StageDefinition 新增 gate_ids 字段 |
| sop repository | `src/domain/sop/_internal/repository.ts` | 支持 workspace 级 SOP 读写、S3 校验同时应用于加载路径 |
| auto-advance | `src/app/issue-collaboration/auto-advance.ts` | gate 校验从硬编码改为动态读取 gate_ids、自愈逻辑 |
| collaboration | `src/app/issue-collaboration/collaboration.ts` | Monitor stage 调度器集成 |
| monitor-scheduler | `src/app/issue-collaboration/monitor-scheduler.ts` | 新增 MonitorScheduler 组件（聚合状态计算、就绪调度、完成检查） |
| MCP servers | `src/domain/snail-mcp-server/_internal/servers/` | 新增 create_sop、create_child_issue 工具 |
| SOP YAML | `data/file/sops/project-initiation/` | 新增 project-initiation SOP 定义 |
| skills | `data/file/skills/` | 新增 project-decomposition skill、project-monitor skill |

## 验证

### P1

- [ ] 创建 project-initiation Issue，验证 intake → analysis → decomposition 流程
- [ ] Agent 通过 create_child_issue 逐步创建子 issue，验证 DAG 构建和无环校验
- [ ] Agent 发出 stage_transition 信号，验证 decom-01/02/03 gate 校验通过后推进到 monitor
- [ ] MonitorScheduler 接收子 issue 完成事件，验证聚合状态自动更新
- [ ] 所有子 issue 完成后，验证 MonitorScheduler 自动推进到 integration
- [ ] 创建循环依赖，验证系统拒绝并返回循环路径
- [ ] 子 issue 未指定 snail_assignment_plan，验证系统默认策略生效
- [ ] 验证 aggregated_progress 字段随子 issue 状态变化正确更新

### P2

- [ ] Agent 调用 create_sop 创建自定义 SOP，验证校验通过
- [ ] 创建缺少 review stage 的代码 SOP，验证校验拒绝
- [ ] 使用模板片段组合 SOP，验证模板解析正确
- [ ] 子 issue 引用动态创建的 SOP，验证 SOP 实例化

### P3

- [ ] 子 issue agent 超时，验证自动重试
- [ ] 子 issue 连续失败 3 次，验证自动回退到 design
- [ ] 子 issue 连续失败 3 次在 design，验证回退到父 issue decomposition
- [ ] 创建 4 层递归结构，验证深度限制
- [ ] 超过 4 层时验证系统拒绝

### 通用

- [ ] `npm run check` 全量通过
- [ ] 相关单元测试覆盖 B1-B10

## 关联

- **前置**: F20260630m8ia（AutoAdvanceEngine MCP 信号通道 — set_final_body 到 evaluate 的打通）
- **相关**: F20260630advp（对抗产物协议 — 阶段对抗验证基础设施）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | Monitor stage 是自动调度还是 agent 驱动 | 自动调度：子 issue 状态变化是确定性事件，不需要 LLM 判断；减少 token 消耗；更可靠 | agent 驱动：复杂场景可能需要 agent 做判断（如部分失败时的策略选择） | 自动调度 + agent 通知：系统自动处理确定性逻辑（完成检测、依赖解锁），失败场景通过消息通知 PM agent 做决策 | 大部分场景是确定性的，只有失败场景需要智能判断；分离关注点更清晰 | 用户、架构师-1 | 2026-06-30 |
| D2 | SOP 动态创建的校验严格度 | 严格校验：防止 agent 创建不合规 SOP，保证质量 | 宽松校验：agent 可能需要灵活的 SOP，过度校验限制创造力 | 严格校验 + 警告分离：阻断性规则（S1-S5）保证结构正确，警告性规则（S6）提示但不阻断 | 结构正确性是底线（无 review stage 的代码 SOP 必然有问题），覆盖度可以逐步提升 | 用户、架构师-1 | 2026-06-30 |
| D3 | 失败自愈的默认策略 | 自动处理优先：用户明确表示不要什么都等手动做 | 保守策略：自动处理可能产生级联错误 | 分层策略：可重试错误自动重试，逻辑错误自动回退，歧义/冲突升级人工 | 用户明确指令"AI+系统能够自动处理"；分层策略在自动化和安全性之间取得平衡 | 用户、架构师-1 | 2026-06-30 |
| D4 | 分解时机：声明式 vs 对话式 | 声明式：结构化、可验证、可批量创建 | 对话式：灵活、支持探索式分解 | 混合：分解过程允许多轮对话（对话式），最终产出必须收敛到结构化子 issue 列表（声明式） | 复杂项目需要探索才能拆清楚，但最终产物必须可机器消费 | 用户、架构师-1 | 2026-06-30 |
| D5 | Monitor stage 与 AutoAdvanceEngine 的关系 | 绕过 AutoAdvanceEngine：Monitor 是确定性调度，不需要 LLM 判断 | 复用 AutoAdvanceEngine：保持统一的推进入口 | 绕过 AutoAdvanceEngine，新增 MonitorScheduler 组件：Monitor 不产生 StageTransitionSuggestion，由 MonitorScheduler 直接操作 StageRepository | Monitor 的逻辑是确定性的状态聚合，与 AutoAdvanceEngine 的"agent 信号→校验→推进"模式本质不同；强行复用会增加引擎复杂度 | 架构师-1、架构师-2 | 2026-06-30 |
| D6 | Gate 校验从硬编码改为动态读取 | 动态读取：SOP 自定义 stage 的 gate 无法预知 | 硬编码：简单、可控 | 动态读取 + 向后兼容：新增 StageDefinition.gate_ids 字段，现有 SOP 通过配置映射保持兼容 | 动态 SOP 创建要求 gate 校验必须动态化；硬编码无法覆盖用户自定义 stage | 架构师-1、架构师-2 | 2026-06-30 |
| D7 | 子 issue snail_assignment_plan 来源 | agent 指定：灵活但需要 agent 知道可用 snail | 系统默认：简单但不灵活 | 优先 agent 指定，未指定时系统按 skill→snail 映射自动分配 | 大部分场景下 agent 不需要关心 snail 分配，系统默认即可；特殊场景（如指定模型）允许 agent 覆盖 | 架构师-1、架构师-2 | 2026-06-30 |
