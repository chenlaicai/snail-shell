---
id: I2026060103
title: sop-invocation-subject-and-gate
from_ids: []
tags: [sop, architecture, workflow]
modules: [workflow, message-bus, prompt-center, persistence]
doc_kind: spec
---

# I2026060103 [workflow] InvocationSubject 接口 + 轻量级 Stage Gate

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

当前 `resolveInvocationContext()` 在一个函数内串行执行 4 个不同层次的关注点：查 execution state、解析 role→snail→runtime、组装 capability、管理 session。下游模块（prompt builder、runtime adapter）如果需要更多上下文，必须反查整个 role→snail→runtime 链路，导致调用链紧耦合。

同时，当前 `advanceFeatureWorkflow()` 是纯手动推进——用户点击即过，没有任何产出校验。缺少 AI 自查 + 人确认的 gate 机制。

本 feature 基于对两份 SOP 重构提案（小重构方案 + 完整重构方案）的分析，取其精华（InvocationSubject 接口 + gate 概念），弃其过度设计（5 概念体系、5 Plane 命名、8 张新表）。

## 目标

### P1 — InvocationSubject 接口解耦

在调用链中引入 `InvocationSubject` 接口，将 role/runtime/capability/session 信息打包为结构化对象。下游全部从 subject 取数据，不再反查 role→snail→runtime 链路。

### P2 — 轻量级 Stage Gate

在 `stage_definition` 加 `acceptance_checklist`（验收清单），在 `stage` 加 `gate_evidence`（AI 准备的证据）。阶段结束时 AI 对照 checklist 自查，生成 evidence，用户确认后推进。

## 非目标

- 不建新表（snapshot / role_assignment / gate_definition / gate_status / capability_grant / invocation_log）
- 不改 prompt 模板语法（`{{variable}}` 保持不变）
- 不引入 actor_type / actor 概念层（单人工作室无需求）
- 不迁移历史 message/session
- 不拆 5 个独立模块（所谓 "Plane" 是调用链步骤，不是模块边界）
- 不改 session key 绑定方式
- 不把 skill 授权从 prompt 移到 SOP（留给后续 feature 验证 SOP 可定义性后）
- 不做自动化 gate 阻塞（用户始终有最终推进权）

## 设计

### P1 详设 — InvocationSubject

**接口定义**（`src/shared/domain-types.ts`）：

```typescript
export interface InvocationSubject {
  workspaceId: string;
  featureId: string;
  stageId: string;
  conversationId: string;
  role: {
    key: string;
    name: string;
    description: string;
    rules: string[];
    handbookPromptRef: string | null;
    isPrimary: boolean;
  };
  runtimeBinding: {
    templateId: string;
    runtime: string;
    model: string;
    contextProvider: "shell" | "agent";
    contextWindow?: number;
    invocationTimeoutMs?: number;
  };
  gateArtifacts?: StageGateArtifact[];
}
```

**解析函数**（`src/message-bus/collaboration.ts`）：

新增 `resolveInvocationSubject()` 函数，从现有 `CollaborationDeps` 的分散解析函数中收集信息，打包为 `InvocationSubject`。修改 `resolveInvocationContext()` 返回值附加 subject。

**下游消费迁移**：

- `buildConversationCapability()` 可直接消费 `InvocationSubject` 获取 runtime 信息
- `invokeRoleBatch()` 从 subject 取 model/contextWindow/invocationTimeoutMs，不再单独调用 `resolveModelForRole` 等

### P2 详设 — Stage Gate

**Schema 变更**（在现有表加字段，不建新表）：

- `stage_definition` 表新增 `acceptance_checklist TEXT`：JSON 数组，定义该阶段的验收清单项
- `stage` 表新增 `gate_evidence TEXT`：JSON 对象，AI 准备的逐项证据

**验收清单设计**（在 SOP YAML seed 中定义）：

每个 stage 定义增加 `acceptance_checklist` 字段。清单项结构：

```json
{ "id": "dev-01", "description": "代码已在 worktree 中完整实现", "required": true }
```

**Gate 证据结构**：

```typescript
export interface StageGateArtifact {
  checklistId: string;
  status: "passed" | "failed" | "skipped";
  evidence: string;
}

export interface StageGateEvidence {
  items: StageGateArtifact[];
  preparedAt: string;
  preparedBy: string;  // role name
}
```

**推进逻辑变更**（`workflow.ts`）：

`advanceFeatureWorkflow()` 推进前检查 `gate_evidence`：
- 解析 evidence 中 required 项是否全部 passed
- 如有未通过的必需项，log.warn 提示但不阻塞（用户有最终决定权）

**系统提示词集成**：

在 `.meta/prompts/` 中增加 gate 自查段落，阶段即将结束时 AI 必须对照 `acceptance_checklist` 逐项自查并生成 `gate_evidence`。

## 生效路径

- `InvocationSubject` 接口：`src/shared/domain-types.ts`（类型定义）
- `resolveInvocationSubject()`：`src/message-bus/collaboration.ts`（调用链解耦）
- 下游消费：`src/prompt-center/builder.ts`、`src/workspace-workflow/manager.ts`
- Gate schema：`src/persistence/schema.ts` + `.meta/sop/code-delivery.yaml`
- Gate 逻辑：`src/workspace-workflow/workflow.ts`
- Gate 提示词：`.meta/prompts/` 相关文件

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 改动说明 |
|---|---|
| `src/shared/domain-types.ts` | 新增 `InvocationSubject`、`StageGateArtifact`、`StageGateEvidence` 类型 |
| `src/message-bus/collaboration.ts` | 新增 `resolveInvocationSubject()`；修改 `resolveInvocationContext()` 返回值附加 subject |
| `src/workspace-workflow/manager.ts` | `buildCollaborationInvokeDeps()` 中的 deps 函数改为从 subject 取数据 |
| `src/workspace-workflow/manager-collaboration.ts` | `resolveConversationRole()` 结果注入 subject |
| `src/prompt-center/builder.ts` | `buildConversationCapability()` 消费 `InvocationSubject` |
| `src/persistence/schema.ts` | `stage_definition` 加 `acceptance_checklist`，`stage` 加 `gate_evidence` |
| `src/persistence/sop-model.ts` | `YamlStageDefinition` 加 `acceptance_checklist` 字段 |
| `src/persistence/types.ts` | `SopStageDefinition` 加 `acceptance_checklist` 字段 |
| `src/persistence/store.ts` | `ConversationStore` 接口适配新字段 |
| `src/workspace-workflow/workflow.ts` | `advanceFeatureWorkflow()` 增加 gate_evidence 检查 |
| `.meta/sop/code-delivery.yaml` | 各 stage 定义补充 `acceptance_checklist` |
| `.meta/prompts/` | 系统提示词增加 gate 自查段落 |

## 验证

### P1

- [ ] `InvocationSubject` 接口定义完整，包含 role/runtimeBinding 字段
- [ ] `resolveInvocationSubject()` 从现有 deps 解析出完整 subject
- [ ] `resolveInvocationContext()` 返回值包含 subject
- [ ] 下游 `invokeRoleBatch()` 从 subject 取 model/contextWindow/timeout
- [ ] 现有 development/review 流程不受影响（subject 是附加信息，不改变现有行为）

### P2

- [ ] `stage_definition.acceptance_checklist` 字段存在且有 seed 数据
- [ ] `stage.gate_evidence` 字段存在
- [ ] `advanceFeatureWorkflow()` 检查 gate_evidence 并 log.warn 缺失必需项
- [ ] 系统提示词包含 gate 自查段落

### 通用

- [ ] TypeScript 编译无报错
- [ ] 现有测试通过
- [ ] 不兼容更新已在 feature 文档中说明

## 关联

- **分析来源**: SOP-refactor-proposal-analysis.md（同事对两份提案的分析报告）
- **参考提案**: 2026-05-27-sop-micro-refactor-proposal.md、2026-05-27-sop-full-refactor-proposal.md

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | 五概念体系是否需要 | 不需要。4 个是现有概念改名/减字段，唯一新增是 InvocationSubject | 2026-06-01 |
| 2 | 五 Plane 是否需要独立模块 | 不需要。它们是调用链步骤，不是模块边界 | 2026-06-01 |
| 3 | 八张新表是否需要 | 不需要。全部用 JSON 字段替代 | 2026-06-01 |
| 4 | Gate 是否阻塞推进 | 不阻塞。用户有最终决定权，AI 只准备证据 | 2026-06-01 |
| 5 | actor_type 是否需要 | 不需要。单人工作室无 human vs snail 区分需求 | 2026-06-01 |
