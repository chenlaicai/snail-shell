---
id: I2026053102
title: sop-v2-4stage-delivery
from_ids: [I2026052606]
tags: [sop, workflow, role, stage]
modules: [workflow, persistence, prompt-center]
doc_kind: spec
---

# I2026053102 [workflow] SOP v2: 4 阶段代码交付流程

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

当前 `code-delivery` SOP 是 2 阶段线性流程（development → review），经过两个月实际使用，暴露以下问题：

1. **设计阶段缺失**：需求讨论、设计取舍和代码实现混在同一个 development 阶段，缺少独立的设计对审视环节
2. **检视者只有 1 人**：缺少检视者之间的对抗性审视，容易遗漏问题
3. **无合入把关**：CI 状态、代码最新性、特性编号等硬性检查没有独立阶段，依赖检视者顺带确认
4. **无回退机制**：review 完成即 feature 结束，无法从后续阶段打回到前序阶段

## 目标

将 `code-delivery` SOP 从 2 阶段扩展为 4 阶段，引入对抗性设计和多检视者机制：

### P1 — 4 阶段流程定义

```
design (seq=1) → development (seq=2) → review (seq=3) → merge (seq=4)
  ▲                   ▲                   │                │
  │                   │                   │    bounce      │
  └───────────────────┘                   └────────────────┘
        发现设计不足
```

4 个阶段的职责分离：

| 阶段 | key | 角色 | 产出 |
|---|---|---|---|
| 需求对齐与设计 | `design` | 2 × 设计者（designer） | Feature 文档 |
| 研发实现 | `development` | 1 × 研发者（developer） | PR |
| PR 检视 | `review` | 研发者 + 2 × 检视者（reviewer） | 检视报告 |
| 合入 | `merge` | 1 × 合入者（merger） | 合入确认或打回 |

### P2 — 角色定义

4 个角色，每个角色职责不交叉：

| 角色 key | 名称 | 参与阶段 | handbook |
|---|---|---|---|
| `designer` | 设计者 | design（primary） | 新增 |
| `developer` | 研发者 | development（primary）、review | S-03（更新） |
| `reviewer` | 检视者 | review | 新增 |
| `merger` | 合入者 | merge（primary） | 新增 |

同一角色在不同阶段通过 `stage_role.working_rules_override` 区分职责：
- `developer` 在 development 阶段：编码实现、提交 PR
- `developer` 在 review 阶段：回应检视意见、修复代码

### P3 — 打回机制

三种打回路径：

| 来源 | 目标 | 触发条件 |
|---|---|---|
| development | design | 编码时发现设计方案有不足 |
| review | design | 检视时发现设计层面的问题 |
| merge | review | 硬性条件不通过 |

打回时创建新 stage（sequence 递增），保留完整历史。

## 非目标

- SOP gate schema / 状态机外化（stage 转移条件配置化）
- SOP.md 文件格式 / .md 解析器
- 统一 transition API
- UI 改动
- 多 SOP 并存 / SOP 继承覆盖

## 设计

### 阶段一：design — 需求对齐与设计

**角色配置**：
- `designer` × 2，无 primary 之分（系统层面标记其中一个为 default responder）
- 在同一 conversation 中通过 @mention 交互

**工作流程**：
1. 用户提出需求
2. 两位设计者各自独立分析需求
3. 一方提出方案，另一方从「这个方案会出什么问题」的角度审视
4. 交替进行，直到达成共识
5. 共识不等于妥协——无法达成一致时必须升级到用户决策
6. 产出锁定的 Feature 文档（`[design-time]` 章节）

**交叉审视规则**：
- 对抗必须产生价值：不能为了反对而反对，必须指出具体风险或替代方案
- 对关键设计取舍必须有正反两面的论述记录在 Feature 文档中
- 每位设计者必须独立阅读需求背景，不得简单附和对方

**完成条件**：
- 两位设计者均明确表示设计方案可接受
- Feature 文档的 `[design-time]` 章节已锁定
- 无未解决的设计争议

### 阶段二：development — 研发实现

**角色配置**：
- `developer` × 1，primary

**工作流程**：
1. 研发者阅读锁定的 Feature 文档
2. 按设计方案编码实现
3. 自检验证
4. 提交 PR

**约束**：
- 严格按 `[design-time]` 章节实现，不得自行修改设计
- 发现设计问题时，通过问题卡片升级（打回到 design 阶段）

**完成条件**：
- PR 已提交
- 自检通过
- Feature 文档的非 `[design-time]` 章节已更新

### 阶段三：review — PR 检视

**角色配置**：
- `developer` × 1（响应者，处理检视意见）
- `reviewer` × 2（检视者，对抗性检视）
- 在同一 conversation 中参与

**工作流程**：
1. 研发者请求检视
2. 两位检视者各自独立完成检视
3. 交叉阅读对方的检视结论
4. 如果一方说「完全没问题」，另一方必须更加仔细确认是否有遗漏
5. 合并形成一份检视报告交给研发者
6. 研发者逐条处理或理性回应
7. 修复后两位检视者重新检视（复检）
8. 循环直到双方均通过

**交叉审视规则**：
- 每轮检视，两位检视者独立完成后再交叉
- 检视报告格式：问题、提出者、严重程度、研发者处理、复检结论
- 如果两位检视者结论冲突，必须讨论达成一致或升级到用户

**完成条件**：
- 两位检视者均明确表示「可等待用户合入」
- PR 评论中无未处理的检视问题

### 阶段四：merge — 合入

**角色配置**：
- `merger` × 1，primary

**工作流程**：
1. 合入者执行硬性条件检查
2. 全部通过 → 合入 PR
3. 任一不通过 → 在 PR 上评论具体问题 → 打回到 review 阶段

**硬性检查清单**：
1. PR 基于最新 `origin/main`（无落后 commit）
2. CI 全部通过
3. Feature 文档编号合规（`FYYYYMMDDNN` 格式，日期目录正确）
4. PR 标题和 commit 模板合规
5. 不兼容更新已在 PR 正文标注

**打回机制**：
- 打回到 review 阶段（不是 development）
- 检视者确认修复后重新进入 merge
- 打回原因记录在 PR 评论中

### 工作流状态机变更

当前 `workflow.ts` 中的硬编码逻辑需要变更：

1. `REQUIRED_STAGE_KEYS` 从 `["development", "review"]` 扩展为 `["design", "development", "review", "merge"]`
2. `advanceFeatureWorkflow` 从 if/else 改为 stage 类型驱动的路由：
   - `design` → `development`
   - `development` → `review`
   - `review` → `merge`
   - `merge` → 完成
3. 新增 `bounceFeatureWorkflow` 支持打回，替代原 `restartFeatureDevelopmentWorkflow`：
   - `merge` → `review`
   - `development` → `design`
   - `review` → `design`

### 系统提示词

| 提示词 | 变更 |
|---|---|
| S-03 研发者手册 | 更新：增加 development 和 review 两个阶段的不同工作规则 |
| 新增设计者手册 | design 阶段的交叉审视规则、Feature 文档产出流程 |
| 新增检视者手册 | review 阶段的对抗性检视规则、交叉审视机制 |
| 新增合入者手册 | merge 阶段的硬性检查清单、打回机制 |

### Skills

新增 handbook skills：
- `designer-handbook`：设计者操作流程手册
- `reviewer-handbook`：更新，覆盖双检视者场景
- `merger-handbook`：合入者操作流程手册

### 种子配置

`workspace-config-seed.json` 变更：
- `sop-code-delivery` 新增 `design` 和 `merge` 两个 stage_definition
- 新增 `designer` 和 `merger` 两个 role_definition
- `developer` 和 `reviewer` 的 working_rules 更新
- `workspace_sop.role_bindings` 新增 designer 和 merger 的绑定

## 生效路径

- `.meta/workspace-config-seed.json`：SOP、角色、阶段定义
- `src/workspace-workflow/workflow.ts`：工作流状态机
- `.meta/prompts/prompts/`：系统提示词（S-03 更新 + 新增）
- `.meta/skills/`：handbook skills

## 改动范围

- `.meta/workspace-config-seed.json` — 新增 designer/merger 角色，新增 design/merge 阶段，更新 role_bindings
- `src/workspace-workflow/workflow.ts` — 4 阶段路由表、bounce 逻辑、REQUIRED_STAGE_KEYS 扩展
- `src/workspace-workflow/manager.ts` — bounceFeatureStage 使用 bounceFeatureWorkflow 实现打回，stageId 必须为最新 stage
- `src/web/feature-workflow-state.js` — canRestartFeatureDevelopment 支持 4 阶段打回
- `src/prompt-center/builder.ts` — STAGES 映射更新为 4 阶段
- `.meta/prompts/prompts/S-03-研发者手册.md` — 设计阶段已独立，研发者严格按设计实现
- `.meta/prompts/prompts/S-04-检视者手册.md` — 新增交叉审视规则
- 新增 `.meta/prompts/prompts/S-09-设计者手册.md`
- 新增 `.meta/prompts/prompts/S-10-合入者手册.md`
- `.meta/skills/query-current-context/scripts/query-current-context.js` — 4 阶段进度映射
- `tests/workspace/stage-cycle-test.ts` — 4 阶段流程测试
- `tests/web/feature-workflow-state-test.ts` — 打回逻辑测试

## 验证

### P1 — 流程定义
- [x] seed 配置包含 4 个 stage_definition 和 4 个 role_definition
- [x] workspace 创建时能正确初始化 4 阶段 workflow（从 design 开始）
- [x] stage 推进正确：design → development → review → merge

### P2 — 打回机制
- [x] merge 打回到 review 能创建新 stage
- [x] development 打回到 design 能创建新 stage
- [x] review 打回到 design 能创建新 stage
- [x] 打回后 sequence 正确递增

### P3 — 提示词
- [x] 新增的系统提示词（S-09 设计者、S-10 合入者）已创建
- [x] S-03 更新为设计已独立
- [x] S-04 新增交叉审视规则
- [x] query-current-context 4 阶段进度映射已更新

## 关联

- **前置**: I2026052606（SOP 池与角色域模型重构 — 本 feature 建立在其三层域模型之上）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | designer 阶段两个实例如何区分 primary | 系统要求每阶段有 default responder，designer 阶段标记其中一个为 primary，但实际职责完全对称 | 2026-05-31 |
| 2 | reviewer 阶段两个实例如何区分 | 不区分，同一角色两个参与者，通过 stage_role 配置 | 2026-05-31 |
| 3 | developer 在 development 和 review 阶段是否拆为两个角色 | 不拆，同一角色通过 working_rules_override 区分职责 | 2026-05-31 |
| 4 | merge 打回到 development 还是 review | 打回到 review，检视者会重新检查硬性条件 | 2026-05-31 |
| 5 | development/review 能否打回到 design | 能，编码和检视阶段都可能发现设计不足 | 2026-05-31 |
