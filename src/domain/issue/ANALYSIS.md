# Issue 创建流程分析（v1 遗留）

> 本文档基于 `v1/` 目录下的遗留代码分析，用于指导 v2 重写。

---

## 一、业务场景

### 1.1 Issue 是什么

Issue 是 Snail Shell 的**工作单元**。一个 Issue 代表一个待完成的任务，由 SOP 模板驱动，经过多个 Stage 推进，每个 Stage 有默认 Conversation 和参与角色。

核心设计：**创建即快照**。Issue 创建时将 SOP 模板完整冻结为快照存入 `issue.sop_snapshot`，后续所有行为（Stage 转换、角色解析、prompt 构建）都读快照不读模板。

### 1.2 创建 Issue 的前置条件

| 条件 | 说明 |
|------|------|
| **adopted_sop_id 必填** | 必须指定一个 SOP 模板，无默认/自动选择 |
| **role_snail_mapping 必填** | 必须提供 role → Snail 模板的映射，决定每个角色使用哪个 AI 运行时 |
| **title 必填** | Issue 标题 |
| **summary 可选** | Issue 摘要 |

---

## 二、API 层

### 2.1 端点定义

```
POST /api/workspaces/:workspaceId/issues
```

**请求体**：
```typescript
{
  title: string;                    // required
  summary?: string;                 // optional
  adopted_sop_id: string;           // required（运行时校验）
  role_snail_mapping: object;       // required（运行时校验）
}
```

**响应**（HTTP 201）：
```typescript
{
  issue: Issue;
  stage: Stage;           // 注意：实际返回原始 Stage，非 StageDetailDto
  conversation: Conversation;
}
```

### 2.2 运行时校验

```
issue-routes.ts:
  → title 必须存在且为 string → 400 "title is required"
  → adopted_sop_id 必须存在且为 string → 400 "adopted_sop_id is required"
  → role_snail_mapping 必须存在且为 object → 400 "role_snail_mapping is required"
```

**注意**：API 契约类型（endpoints.ts）中 `adopted_sop_id` 标记为 optional，且 `role_snail_mapping` 不在契约中，但运行时校验更严格。这是契约与实现的不一致。

---

## 三、核心流程

### 3.1 完整调用链

```
POST /api/workspaces/:workspaceId/issues
  → registerIssueCreationRoute (issue-routes.ts)
    → 校验 title, adopted_sop_id, role_snail_mapping
  → workspaceManager.createIssue(workspaceId, title, summary, adopted_sop_id, role_snail_mapping)
    → store.getWorkspace(workspaceId) → 校验 workspace 存在
  → createIssueWorkflow(deps, input)
```

### 3.2 createIssueWorkflow 核心编排

```
createIssueWorkflow(deps, input)
  |
  |-- 1. getSop(adoptedSopId)
  |     → 校验 SOP 存在
  |     → 若 source="workspace"，校验 source_ref === workspace.id
  |
  |-- 2. buildSopSnapshot(sopId)
  |     → getSop() → SOP 实体
  |     → listSopStageDefinitionsWithRoles() → 所有 stage + roles
  |     → getSopTransitions() → 所有转换规则
  |     → 组装 SopSnapshot 对象
  |
  |-- 3. new SopSnapshotReader(snapshot)
  |     → 创建只读访问器，校验 sop_id 存在
  |
  |-- 4. store.createIssue({id, workspaceId, title, summary, sopSnapshot, roleSnailMapping})
  |     → INSERT INTO issue
  |
  |-- 5. resolve first_stage_key
  |     → snapshot.first_stage ?? resolveFirstStageKey(reader)（取 sequence 最小的 stage）
  |
  |-- 6. createIssueStage(deps, reader, {workspace, issue, stageKey, sequence: 1})
  |     → reader.getSopStageDefinitionByKey(stageKey) → 校验 stage key 在快照中
  |     → store.createStage({id, workspaceId, issueId, stageDefinitionId, type, sequence, status: "in_progress", enteredAt})
  |
  |-- 7. createDefaultStageConversation(deps, reader, {workspace, issue, stage, fromConversationIds})
  |     → reader.listRoleDefinitionsByStage(stage.type) → 获取该 stage 的所有角色
  |     → 找 primary role（is_primary === 1）或 fallback 到第一个角色
  |     → store.createConversation({id, workspaceId, issueId, stageId, title, kind: "discussion", defaultRole, participatingRoles: [HUMAN_ROLE_NAME, ...roles], summary, fromConversationIds})
  |
  v
  return { issue, stage, conversation }
```

### 3.3 SOP 快照构建（buildSopSnapshot）

```
buildSopSnapshot(deps, sopId)
  → deps.getSop(sopId) → { id, source, source_ref, name, description, first_stage, shared_handbook }
  → deps.listSopStageDefinitionsWithRoles(sopId) → [{ key, title, sequence, input/output_description, acceptance_focus, acceptance_checklist, roles: [{ key, name, description, is_primary, count, handbook }] }]
  → deps.getSopTransitions(sopId) → [{ from, to, guard }]
  → 组装 SopSnapshot {
      sop_id, source, source_ref, name, description, first_stage, shared_handbook,
      stage_definitions: [...],
      transitions: [...]
    }
```

**关键保证**：快照创建后，SOP 模板的任何变更都不影响已创建的 Issue。

### 3.4 第一个 Stage 创建（createIssueStage）

```
createIssueStage(deps, reader, {workspace, issue, stageKey, sequence})
  → reader.getSopStageDefinitionByKey(stageKey) → 校验存在
  → store.createStage({
      id: randomUUID(),
      workspaceId, issueId,
      stageDefinitionId: stageDef.key,  // key 即 id
      type: stageDef.key,
      sequence: 1,
      status: "in_progress",
      enteredAt: new Date().toISOString()
    })
```

### 3.5 默认 Conversation 创建（createDefaultStageConversation）

```
createDefaultStageConversation(deps, reader, {workspace, issue, stage, fromConversationIds})
  → roles = reader.listRoleDefinitionsByStage(stage.type)
  → primaryRole = roles.find(r => r.is_primary === 1) ?? roles[0]
  → 校验 primaryRole 存在
  → store.createConversation({
      id: randomUUID(),
      workspaceId, issueId, stageId,
      title: "${issue.title} . ${stage.type} #${stage.sequence}",
      kind: "discussion",
      defaultRole: primaryRole.name,
      participatingRoles: [HUMAN_ROLE_NAME, ...roles.map(r => r.name)],
      summary: "Auto-created conversation for issue ${issue.title} stage ${stage.type}",
      fromConversationIds
    })
```

**HUMAN_ROLE_NAME** = `"项目负责人"`（常量）

---

## 四、数据库记录

### 4.1 创建 Issue 时写入 3 条记录

**issue 表**：
| 字段 | 值 |
|------|-----|
| id | randomUUID() |
| workspace_id | 请求参数 |
| title | 请求参数 |
| summary | 请求参数（可空） |
| task_anchor | null |
| sop_snapshot | JSON 序列化的 SopSnapshot |
| role_snail_mapping | JSON 序列化的映射 |
| created_at / updated_at | DB 默认值 |
| closed_at | null |

**stage 表**：
| 字段 | 值 |
|------|-----|
| id | randomUUID() |
| workspace_id | 同 issue |
| issue_id | issue.id |
| stage_definition_id | stage definition key（来自快照） |
| type | stage definition key |
| sequence | 1 |
| status | "in_progress" |
| output_artifacts | "{}" |
| gate_evidence | null |
| entered_at | ISO 时间戳 |
| left_at | null |

**conversation 表**：
| 字段 | 值 |
|------|-----|
| id | randomUUID() |
| workspace_id | 同 issue |
| issue_id | issue.id |
| stage_id | stage.id |
| owner_type | "workspace_stage" |
| owner_id | stage.id |
| title | "{issue.title} . {stage.type} #{stage.sequence}" |
| kind | "discussion" |
| status | "active" |
| default_role | primary role name |
| participating_roles | ["项目负责人", ...stage role names] |
| summary | 自动生成 |
| from_conversation_ids | []（首个 stage） |

---

## 五、role_snail_mapping 机制

### 5.1 数据结构

```typescript
// 请求体中的格式（stageKey → roleKey → snailTemplateId）
{
  "design": { "developer": "template-id-1" },
  "development": { "developer": "template-id-2", "reviewer": "template-id-3" }
}
```

存储为 JSON TEXT 列在 `issue.role_snail_mapping`。

### 5.2 运行时使用

```
manager-detail.ts:
  → mapping = issue.role_snail_mapping[stage.id] ?? {}
```

**注意**：读取时用 `stage.id`（UUID）作为 key，但创建时传入的是 `stageKey`（字符串如 "design"）。这意味着初始创建时的 mapping 在读取时可能不匹配，需要通过 `setIssueRoleSnail` 后续填充。

---

## 六、关键设计决策（v1）

1. **创建即快照** — Issue 创建时冻结 SOP 模板，后续不受模板变更影响
2. **adopted_sop_id 必填** — 无默认 SOP，无自动选择
3. **role_snail_mapping 必填** — 创建时必须指定 role → AI 运行时映射
4. **自动创建 Stage + Conversation** — 创建 Issue 即创建第一个 Stage 和默认 Conversation
5. **primary role 优先** — Conversation 的 defaultRole 取 stage 定义中的 primary role
6. **HUMAN_ROLE_NAME 常量** — "项目负责人" 始终参与所有 Conversation
7. **快照读取器** — SopSnapshotReader 提供与 FileConfigStore 相同的查询接口，但只读快照

---

## 七、v2 重写待决问题

1. **role_snail_mapping 的 key 不一致** — 创建时用 stageKey，读取时用 stage.id，是否需要统一？
2. **契约与实现不一致** — endpoints.ts 中 adopted_sop_id 标记为 optional，运行时强制 required，是否修复？
3. **Stage 详情返回** — API 响应类型声明 StageDetailDto 但实际返回原始 Stage，是否修复？
4. **Workspace SOP 归属校验** — 平台 SOP 无校验，workspace SOP 校验 source_ref，是否需要更细粒度？
5. **Issue 创建后是否需要初始化 workspace 上下文？** — 当前不加载 .snail 目录
6. **快照是否需要版本号？** — 当前无版本管理，是否需要支持快照迁移？
7. **批量创建 Issue？** — 是否需要支持批量创建？
8. **Issue 模板？** — 是否需要支持 Issue 模板（预填 title/summary/mapping）？
