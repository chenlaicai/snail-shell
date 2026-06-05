---
id: F2026060501
title: issue-data-model-refactor
from_ids: [F2026052903, F2026060407, F2026060408]
tags: [data-model, sop, evolution, refactor]
modules: [persistence, workspace-workflow, interaction-entry, evolution-center]
doc_kind: spec
---

# F2026060501 [data-model] Issue 数据模型重构

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

当前 Issue 数据模型存在五个关联问题：

1. **Workspace 默认 SOP 机制导致 Issue 创建时 SOP 选择不透明**：`workspaces.json` 中 `sop_bindings` 让 workspace 声明可用 SOP 和默认选择，系统自动兜底到默认绑定。这使得 SOP 选择对用户不可见，且 `role_snail_mapping` 由系统从 workspace binding 自动推导而非用户显式配置。实际上 SOP 自带 scope 属性（platform/workspace），不需要 workspace 去声明可用性。

2. **Stage 下允许存在多个 Conversation 污染了数据模型**：当前 schema 允许 1 stage : N conversation，但实际上每个 stage 只需要一个 conversation。多 conversation 的设计引入了不必要的复杂度（`from_conversation_ids` 数组、`createStageConversation()` 函数、`listConversationsByStage()` 查询），且与"每进入一个 stage 就是一个对话"的业务语义不符。

3. **Evolution Center 混在 workspaces.json 中**：Evolution Center 不是真正的代码工作区（没有 workspace_root、不走正常 issue 流程），但它与普通 workspace 共用 `workspaces.json` 配置，概念混淆。

4. **Evolution Center 的 SOP 从未创建**：`evolution-model.ts` 和 `evolution-prompt.ts` 硬编码了 `"development"` stage key 和 `"演进执行者"` role name，但对应的 SOP YAML 文件从未存在。

5. **`sd-<sopId>-<key>` 格式是设计残留**：stage definition ID 使用 `sd-code-delivery-design` 格式，但所有 reader 拿到后第一件事都是 parse 出 plain key `"design"` 再查找。stage 表、SopSnapshotReader、FileConfigStore 中共 27 处引用，全部是"生成 → 传递 → 解析"的无效链路。

## 目标

### D1 — 移除 sop_bindings、adopted_sop_id，默认 SOP 机制

1. 移除 workspace 配置中的 `sop_bindings`（SOP 自带 scope 属性，不需要 workspace 声明可用 SOP）
2. 移除 `issue.adopted_sop_id` 列（SOP ID 存在 `sop_snapshot.sop_id` 中，不需要冗余列）
3. 创建 Issue 时 `adopted_sop_id` 作为 API 参数用于校验 SOP 可用性，不持久化
4. `role_snail_mapping` 在创建 Issue 时由用户显式提供，覆盖所有 stage 的所有 role
5. 运行时 snail 切换通过已有的 `PATCH /issues/:issueId/role-snail` API 实现

### D2 — 1 Stage : 1 Conversation 严格约束

1. Stage 与 Conversation 改为严格 1:1 关系
2. 移除 `createStageConversation()` 函数
3. `listConversationsByStage()` 简化为 `getConversationByStage()`

### D3 — Evolution Center 独立配置文件

1. Evolution Center 从 `workspaces.json` 分离，使用独立配置文件 `config/evolution-center.json`
2. 数据仍写入同一套 workspace 缓存和 DB 表
3. 不引入通用"系统内置 workspace"机制

### D4 — 解除 Evolution Center 硬编码

1. `evolution-model.ts` 和 `evolution-prompt.ts` 中的 stage key、role name 改为从 SOP snapshot 读取
2. 创建 Evolution SOP YAML 文件

### D5 — 清理 sd-\<sopId\>-\<key\> 格式

1. `role_snail_mapping` 外层 key 使用 plain stageKey，不用 `sd-<sopId>-<key>` 格式
2. `stage` 表 `stage_definition_id` 列改为存 plain stageKey
3. `SopSnapshotReader` 接口方法从接收 `stageDefinitionId` 改为接收 `stageKey`
4. 所有调用点适配 plain key

## 非目标

1. 不引入通用的"系统内置 workspace"框架机制
2. 不改变 SOP snapshot 的存储方式（仍然是 `issue.sop_snapshot` JSON 列）
3. 不改变 `from_conversation_ids` 字段（保留，语义简化为单元素数组）

## 设计

### D1 详设：移除默认 SOP

#### 1.1 移除 sop_bindings 和 adopted_sop_id

**移除 workspace 配置中的 `sop_bindings`**：SOP 自带 scope 属性（`source: "platform"` 或 `source: "workspace"` + `workspace_id`），不需要 workspace 去声明哪些 SOP 可用。平台 SOP 天然对所有 workspace 可用，工作区 SOP 仅对所属 workspace 可用。

```json
// 旧 workspaces.json
{
  "id": "my-workspace",
  "sop_bindings": [
    { "sop_id": "code-delivery", "is_default": true, "role_bindings": {...} }
  ]
}

// 新 — sop_bindings 整个移除
{
  "id": "my-workspace",
  "module": "workspace_management",
  "name": "My Workspace",
  "summary": "...",
  "workspace_root": "{{process.cwd()}}"
}
```

**移除 `issue.adopted_sop_id` 列**：snapshot 中已包含 `sop_id`，运行时从 `sop_snapshot.sop_id` 读取，不需要冗余列。

**SOP 可用性校验逻辑**（创建 issue 时）：

```typescript
// 确认 SOP 对当前 workspace 可用
const sop = deps.store.getSop(input.adoptedSopId);
if (!sop) throw new Error(`SOP not found: ${input.adoptedSopId}`);
if (sop.source === "workspace" && sop.workspace_id !== input.workspace.id) {
  throw new Error(`SOP ${input.adoptedSopId} is a workspace SOP belonging to ${sop.workspace_id}, not ${input.workspace.id}`);
}
```

#### 1.2 createIssueWorkflow 改动

函数签名新增 `roleSnailMapping` 必填参数：

```typescript
// 新签名
createIssueWorkflow(deps, {
  workspace: Workspace;
  title: string;
  summary?: string;
  adoptedSopId: string;                              // 必填，用于校验 SOP 可用性，不持久化
  roleSnailMapping: Record<string, Record<string, string>>;  // 必填（新增）
})
```

校验逻辑：

```typescript
// 旧：adoptedSopId 可选，兜底到 is_default binding
if (input.adoptedSopId) {
  resolvedSopId = input.adoptedSopId;
} else {
  const defaultSop = deps.store.getDefaultWorkspaceSop(input.workspace.id);
  resolvedSopId = defaultSop.sop_id;
}

// 新：adoptedSopId 必填，通过 SOP scope 校验可用性
if (!input.adoptedSopId) {
  throw new Error("adopted_sop_id is required");
}
const sop = deps.store.getSop(input.adoptedSopId);
if (!sop) {
  throw new Error(`SOP not found: ${input.adoptedSopId}`);
}
if (sop.source === "workspace" && sop.workspace_id !== input.workspace.id) {
  throw new Error(`SOP ${input.adoptedSopId} belongs to workspace ${sop.workspace_id}, not ${input.workspace.id}`);
}
resolvedSopId = input.adoptedSopId;
```

#### 1.3 role_snail_mapping 改为调用方显式提供

`issue.role_snail_mapping` 结构：`Record<stageKey, Record<roleKey, snailTemplateId>>`。

- 外层 key 是 `stageKey`（SOP stage 的 plain key，如 `"design"`、`"development"`）
  - **不用** `sd-<sopId>-<key>` 格式 — 该格式是早期设计残留，所有 reader 拿到后第一件事都是 parse 出 plain key 再查找，没有真正需要 full ID 的场景（详见 D5）
  - SOP snapshot 中 `stage_definitions[].key` 就是 plain key，调用方直接使用，无需拼接
  - 一个 issue 只 adopt 一个 SOP，stage key 在 issue 范围内唯一，无碰撞风险
- 内层 key 是 `roleKey`（SOP role 的 `key` 字段，如 `"designer"`、`"executor"`），**不是** `role.name`（如 `"架构师"`、`"演进执行者"`）
  - **现有代码用 `role.name` 做 key 是历史错误**（`workflow.ts:258`），本次修正为 `role.key`
- mapping 粒度是 `stage#role → snail`，Issue 创建时一次性配置
- stage 转移时**零操作** — 新 stage 激活时直接用 `role_snail_mapping[stage.type]` 读取（`stage.type` 就是 plain key）
- bounce-back 时同一个 stage key 共享同一份 mapping，符合语义

```typescript
// 旧：stage 转移时自动推导 mapping
snapshotRoleSnailMapping({ deps, reader, workspaceId, issueId, stage });

// 新：调用方在创建 issue 时传入完整 mapping，用 plain stageKey 做 key
createIssueWorkflow(deps, {
  workspace,
  title: "...",
  adoptedSopId: "code-delivery",
  roleSnailMapping: {
    "design":     { "designer": "claude-code-sonnet" },
    "development": { "developer": "claude-code-sonnet" },
    "review":      { "developer": "claude-code-sonnet", "reviewer": "claude-code-sonnet" },
    "merge":       { "merger": "claude-code-sonnet" },
  },
});
```

**删除 `snapshotRoleSnailMapping()` 函数** — 它是 per-stage-instance 推导逻辑，在 issue 级别 mapping 模型下不再需要。

#### 1.4 API 变更

```
POST /workspaces/:workspaceId/issues
  Body: {
    title: string (required),
    summary?: string,
    adopted_sop_id: string (required),    // 必填，用于校验 SOP 可用性，不持久化（SOP ID 存在 snapshot 中）
    role_snail_mapping: Record<string, Record<string, string>> (required)  // 必填
  }
```

#### 1.5 运行时 snail 切换

已有 API `PATCH /issues/:issueId/role-snail`（`issue-routes.ts:81-92`），参数需调整以匹配新的 mapping key 结构：

```
PATCH /issues/:issueId/role-snail
  Body: {
    stage_key: string,            // SOP stage plain key（原 stage_id 改为 stage_key）
    role_key: string,             // role key（原 role_name 改为 role_key）
    snail_template_id: string     // 新的 snail template ID
  }
```

该 API 直接修改 `issue.role_snail_mapping[stage_key][role_key]`。切换后当前正在进行的 agent session 不受影响，下一次该 role 被唤起时使用新 template。

**manager.ts `setIssueRoleSnail()` 改动**：

```typescript
// 旧：用 stage 实例 ID + role.name
const updated = { ...issue.role_snail_mapping };
if (!updated[stageId]) updated[stageId] = {};
updated[stageId][roleName] = snailTemplateId;
// 校验：roles.some((r) => r.name === roleName)

// 新：用 stageKey + roleKey
const updated = { ...issue.role_snail_mapping };
if (!updated[stageKey]) updated[stageKey] = {};
updated[stageKey][roleKey] = snailTemplateId;
// 校验：reader.collectSopRoleKeys().has(roleKey)
```

#### 1.6 移除的方法和字段

**FileConfigStore 移除**：
- `getDefaultWorkspaceSop()` — 移除
- `getWorkspaceSop()` — 移除
- `listWorkspaceSops()` — 移除
- `createWorkspaceSop()` — 移除
- `updateWorkspaceSop()` — 移除
- `deleteWorkspaceSop()` — 移除
- `normalizeDefaultBindings()` — 移除

**workflow.ts 移除**：
- `snapshotRoleSnailMapping()` — 删除
- `assertRoleBindingsCoverSop()` — 移除（`sop_bindings` 已不存在）
- `createInitialWorkflow()` — 移除 `roleBindings` 参数，内部移除 `createWorkspaceSop()` 和 `roleRegistry.reloadFromStore()` 调用

**issue 表移除**：
- `adopted_sop_id` 列 — 移除（运行时从 `sop_snapshot.sop_id` 读取）

**workspaces.json 移除**：
- `sop_bindings` 字段 — 整个移除

#### 1.7 遗漏的调用点适配

以下调用点当前未传 `adoptedSopId`，依赖默认 SOP 兜底，D1 后会崩溃：

| 文件 | 行号 | 当前代码 | 改动 |
|------|------|---------|------|
| `self-workspace-seed.ts` | 33 | `createIssueWorkflow(deps, { workspace, title, summary })` | 显式传入 `adoptedSopId`（从已知的 SOP 配置获取）+ `roleSnailMapping` |
| `manager.ts` | 100 | `this.createIssue(workspaceId, "初始研发迭代", "...")` | 同上，显式传入 `adoptedSopId` + `roleSnailMapping` |

`createInitialWorkflow()`（`workflow.ts:58`）原来传 `sopId` + `roleBindings`，其中 `roleBindings` 用于创建 `sop_bindings`。`sop_bindings` 移除后，`roleBindings` 参数失去用途，一并移除：

```typescript
// 旧签名
createInitialWorkflow(deps, { name, summary, workspaceRoot, workspaceId, sopId, roleBindings })

// 新签名 — 移除 roleBindings
createInitialWorkflow(deps, { name, summary, workspaceRoot, workspaceId, sopId, roleSnailMapping })
```

函数内部移除 `createWorkspaceSop()` 调用和 `roleRegistry.reloadFromStore()`（sop_bindings 已不存在，无需 reload）。

---

### D2 详设：1 Stage : 1 Conversation

#### 2.1 Schema 约束

使用 partial index 保证 1:1，排除 `stage_id IS NULL` 的行（evolution 类型 conversation 的 stage_id 可为 NULL）：

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_stage_unique ON conversation(stage_id) WHERE stage_id IS NOT NULL;
```

同时移除 `store.ts` 中 `createConversation()` 对同一 stage_id 创建第二个 conversation 的允许行为，改为先查后写或依赖 DB 约束抛错。

#### 2.2 移除 createStageConversation

`workflow.ts` 中移除 `createStageConversation()` 函数。该函数允许在一个 stage 下创建额外的 conversation，违反 1:1 约束。

#### 2.3 查询方法简化

```typescript
// 旧
listConversationsByStage(stageId: string): Conversation[]

// 新
getConversationByStage(stageId: string): Conversation | undefined
```

#### 2.4 受影响的调用点

| 文件 | 行号 | 当前调用 | 改动 |
|------|------|---------|------|
| `workflow.ts` | 185 | `listConversationsByStage(activeStage.id).map(item => item.id)` | `getConversationByStage(activeStage.id)?.id ?? null` → 单元素 |
| `manager-detail.ts` | 20 | `sumBossPendingCount(store.listConversationsByStage(stage.id), ...)` | 直接查唯一 conversation 的 dispatch |
| `manager.ts` | 331 | `listStageConversations(stageId)` 返回数组 | `getStageConversation(stageId)` 返回单个 |
| `lobby/command-executor.ts` | 69 | `listConversationsByStage(currentStage.id)` | `getConversationByStage(currentStage.id)` |
| `self-workspace-seed.ts` | 17 | `getInitialConversationByStage(stage.id)` | `getConversationByStage(stage.id)` |
| `issue-routes.ts` | 161 | `GET /stages/:stageId/conversations` 返回数组 | 返回单个对象或 null |

#### 2.5 from_conversation_ids 语义

保留 `from_conversation_ids` 字段，语义简化：

- stage 转移时，新 conversation 的 `from_conversation_ids` 包含前驱 stage 的唯一 conversation id
- 实际只存 0 或 1 个元素
- UI 层（`conversation-controller.js:78-79`）和 prompt builder（`prompt-center/builder.ts:210`）不需要改动，它们已经正确处理数组

---

### D3 详设：Evolution Center 独立配置文件

#### 3.1 新增配置文件

`config/evolution-center.json.example`：

```json
{
  "id": "evolution-center",
  "module": "evolution",
  "name": "Evolution Center",
  "summary": "Snail Shell 演进中心治理空间",
  "workspace_root": "{{process.cwd()}}",
  "guard_profile": null
}
```

#### 3.2 FileConfigStore 改动

```typescript
// 新增方法
private loadEvolutionCenter(): void {
  const filePath = path.join(this.configDir, "evolution-center.json");
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  const resolved = raw.replace(/\{\{process\.cwd\(\)\}\}/g, this.repoRoot);
  const entry: WorkspaceFileEntry = JSON.parse(resolved);
  this.workspaceCache.set(entry.id, entry);
}

// loadAll() 中调用
loadAll() {
  const platformSopCount = countSopDir(path.join(this.configDir, "sop"));
  this.loadWorkspaces();
  this.loadEvolutionCenter();  // 新增
  // ... rest unchanged
}

// saveWorkspacesFile() 中排除 evolution-center
private saveWorkspacesFile(): void {
  const fileEntries: WorkspaceFileEntry[] = [];
  for (const entry of this.workspaceCache.values()) {
    if (entry.id === "evolution-center") continue;  // 排除独立配置
    fileEntries.push({
      ...entry,
      workspace_root: entry.workspace_root === this.repoRoot ? "{{process.cwd()}}" : entry.workspace_root,
    });
  }
  // ... rest unchanged
}
```

#### 3.3 配置优先级

- `evolution-center.json` 和 `workspaces.json` 不允许定义相同 `id`
- 如果 `workspaces.json` 中存在 `id: "evolution-center"` 的条目，`loadWorkspaces()` 应跳过或报错
- `loadEvolutionCenter()` 在 `loadWorkspaces()` 之后调用，覆盖写入缓存

---

### D4 详设：解除 Evolution Center 硬编码

#### 4.1 创建 Evolution SOP YAML

`config/sop/evolution/evolution.yaml`：

```yaml
# SOP: 演进治理流程
# 来源: platform
# 文件名即 key: evolution

name: 演进治理流程
description: 演进项治理。入口校验、查重、分析、裁决和产物处理。
first_stage: development

stage_definitions:
  - key: development
    title: 演进治理
    sequence: 1
    input_description: 演进项内容。
    output_description: >
      完成演进项治理，必要时提交系统提示词、skill、文档、代码或检查器 PR，
      并回写治理去向。产物要求：演进项来源和事实被查证；
      入口校验、查重、裁决去向已回写；演进项不会绕过治理自动生效。
    acceptance_focus:
      - 演进项来源和事实被查证
      - 入口校验、查重、裁决去向已回写
      - 演进项不会绕过治理自动生效
    acceptance_checklist:
      - id: evo-01
        description: 演进项来源和事实已查证
        required: true
      - id: evo-02
        description: 裁决去向已回写
        required: true
    roles:
      - key: executor
        name: 演进执行者
        description: 负责演进项的治理对话：入口校验、查重、分析、裁决和必要产物处理。
        is_primary: true
        count: 1

# 无 transitions — 单阶段即终态
```

**关键约束**：stage key 必须为 `development`（与现有硬编码对齐，减少改动范围）。role key 为 `executor`，role name 为 `演进执行者`（与现有硬编码对齐）。

#### 4.2 buildSopSnapshot 导出与参数类型修正

`buildSopSnapshot()` 当前是 `workflow.ts` 的 module-private 函数，`evolution-model.ts` 需要调用它。需要两个改动：

1. **导出**：从 `workflow.ts` 导出，或移到共享模块（如 `sop-snapshot-builder.ts`）
2. **参数类型修正**：当前签名是 `buildSopSnapshot(deps: WorkflowDependencies, sopId: string)`，但实际只用了 `deps.store.getSop()`、`deps.store.listSopStageDefinitionsWithRoles()`、`deps.store.getSopTransitions()` — 都是 `FileConfigStore` 的方法，不依赖 `roleRegistry`。参数类型改为 `{ store: FileConfigStore }`：

```typescript
// 旧
function buildSopSnapshot(deps: WorkflowDependencies, sopId: string): SopSnapshot

// 新
export function buildSopSnapshot(deps: { store: FileConfigStore }, sopId: string): SopSnapshot
```

`workflow.ts` 内部调用处自动适配（`ConversationStore` 包含了 `FileConfigStore` 的方法）。

#### 4.3 evolution-model.ts 改动

**关键变更**：当前 issue INSERT 缺少 `sop_snapshot` 和 `adopted_sop_id` 列，导致 `issue.sop_snapshot` 默认为 `'{}'`。D4 改为先构建 snapshot，再将其存入 issue。

```typescript
// 旧：硬编码 stage key 和 role name，issue 不存 snapshot
const stageDef = this.fileConfigStore.getStageDefinitionByKey("evolution-center", "development");
// INSERT INTO issue (id, workspace_id, title, summary, task_anchor, role_snail_mapping) VALUES (...)
// ... 硬编码 'development', '演进执行者', '["项目负责人","演进执行者"]'

// 新：从 SOP snapshot 读取，并将 snapshot 存入 issue
const snapshot = buildSopSnapshot({ store: this.fileConfigStore }, "evolution");
const reader = new SopSnapshotReader(snapshot);
const firstStageKey = snapshot.first_stage ?? reader.listSopStageDefinitions()[0].key;
const stageDef = reader.getSopStageDefinitionByKey(firstStageKey);
if (!stageDef) throw new Error(`Evolution stage definition '${firstStageKey}' not found in SOP snapshot`);

const roles = reader.listRoleDefinitionsByStage(stageDef.id);
const primaryRole = roles.find(r => r.is_primary) ?? roles[0];
const participatingRoles = JSON.stringify([HUMAN_ROLE_NAME, ...roles.map(r => r.name)]);

// issue INSERT 新增 sop_snapshot（adopted_sop_id 列已移除）
this.db.prepare(
  "INSERT INTO issue (id, workspace_id, title, summary, task_anchor, sop_snapshot, role_snail_mapping) VALUES (?, ?, ?, NULL, NULL, ?, '{}')"
).run(issueId, "evolution-center", input.title, JSON.stringify(snapshot));
```

> **D5 衔接说明**：D5 将 `SopStageDefinition.id` 从 `sd-${sopId}-${key}` 简化为直接用 `key`。因此 D5 后 `stageDef.id === stageDef.key === "development"`。此处 `reader.listRoleDefinitionsByStage(stageDef.id)` 无需修改，等价于 `reader.listRoleDefinitionsByStage("development")`。

#### 4.4 evolution-prompt.ts 改动

```typescript
// 旧：硬编码 getStageDefinitionByKey("evolution-center", "development")
const stageDefinition = input.store.getStageDefinitionByKey("evolution-center", "development");

// 新：从 issue.sop_snapshot 读取
const reader = new SopSnapshotReader(issue.sop_snapshot);
const stageDefinition = reader.getSopStageDefinitionByKey(stage.type);
```

#### 4.5 .meta/scripts/db-bridge.js 同步

`db-bridge.js:493-494` 中有同样的硬编码 SQL，需要同步修改为从 SOP 读取。

---

### D5 详设：清理 sd-\<sopId\>-\<key\> 格式

#### 背景

`sd-<sopId>-<key>` 格式（如 `sd-code-delivery-design`）是早期为"跨 SOP 全局唯一标识 stage definition"设计的。但实际运行中，每个 issue 只 adopt 一个 SOP，stage key 在 issue 范围内唯一。所有 reader 拿到 full ID 后第一件事都是 parse 出 plain key 再查找，full ID 从未被用于跨 SOP 区分。

代码中共 27 处引用该格式，全部是"生成 → 传递 → 解析出 plain key"的无效链路。

#### 5.1 stage 表

`stage_definition_id` 列改为存 plain stageKey：

```sql
-- 旧：stage_definition_id = "sd-code-delivery-design"
-- 新：stage_definition_id = "design"
```

#### 5.2 SopSnapshotReader 改动

```typescript
// 旧：接收 full ID，解析出 key
listRoleDefinitionsByStage(stageDefinitionId: string): StageRoleDefinition[] {
  const prefix = `sd-${this.snapshot.sop_id}-`;
  const key = stageDefinitionId.slice(prefix.length);
  // ...
}

// 新：直接接收 stageKey
listRoleDefinitionsByStage(stageKey: string): StageRoleDefinition[] {
  const snapshotSd = this.snapshot.stage_definitions.find((s) => s.key === stageKey);
  // ...
}
```

同理修改：
- `getStageDefinition(stageDefinitionId)` → `getStageDefinition(stageKey)`
- `toStageDefinition()` 中 `id` 字段从 `sd-${sop_id}-${sd.key}` 改为直接用 `sd.key`

#### 5.3 sop-file-utils.ts 改动

```typescript
// 旧
const sdId = `sd-${sopId}-${sd.key}`;

// 新
const sdId = sd.key;
```

#### 5.4 FileConfigStore 改动

以下方法参数类型从 `stageDefinitionId` 改为 `stageKey`，移除正则解析逻辑：
- `getSopStageDefinition(id)`
- `listSopStageRoleDefinitions(stageDefinitionId)`
- `listRoleDefinitionsByStage(stageDefinitionId)`
- `listRoleDefinitionsByStageAndWorkspace(stageDefinitionId, workspaceId)`

#### 5.5 Role Registry 改动

`rolesByStageDefinitionName` 索引 key 从 `${workspaceId}:${stageDefinitionId}:${name}` 改为 `${workspaceId}:${stageKey}:${name}`。

#### 5.6 所有调用点适配

将 `stage.stage_definition_id` 的读取点改为 `stage.type`（plain key），涉及：
- `workflow.ts`（6处）
- `manager-collaboration.ts`（4处）
- `manager-detail.ts`（2处）
- `manager.ts`（1处）
- `store.ts` 透传方法（3处）

#### 5.7 Role ID 和 Stage Definition ID 格式

`srd-${stageDefId}-${roleKey}` 格式的 role ID 随之简化为 `srd-${stageKey}-${roleKey}`。
`SopStageDefinition.id` 从 `sd-${sopId}-${key}` 简化为直接用 `key`。

Role ID 生成/解析涉及的调用点：

| 文件 | 行号 | 用途 | 改动 |
|------|------|------|------|
| `sop-snapshot-reader.ts` | 140 | `expandRole()` 生成 role ID：`srd-${stageDefinitionId}-${role.key}${suffix}` | `stageDefinitionId` 改为 `stageKey` |
| `sop-file-utils.ts` | 199 | YAML 解析时生成 role ID：`srd-${stageDefId}-${rd.key}${suffix}` | `stageDefId` 改为 `stageKey` |
| `file-config-store.ts` | 483-485 | `getRoleDefinitionByWorkspace()` 解析 role ID：正则 `/^srd-sd-(.+)-(.+)-/` | 更新正则匹配新格式；注：该方法当前无人调用（死代码），可考虑一并清理 |

---

## 改动范围

### 数据模型

- `src/persistence/schema.ts` — conversation 表新增 UNIQUE(stage_id) 索引
- `src/persistence/store.ts` — `listConversationsByStage()` → `getConversationByStage()`
- `src/persistence/file-config-store.ts` — 移除所有 workspace SOP binding 方法（`getDefaultWorkspaceSop`、`getWorkspaceSop`、`listWorkspaceSops`、`createWorkspaceSop`、`updateWorkspaceSop`、`deleteWorkspaceSop`、`normalizeDefaultBindings`）；新增 `loadEvolutionCenter()`；移除所有 `sd-` 前缀正则解析
- `src/persistence/sop-file-utils.ts` — stage definition ID 不再拼接 `sd-${sopId}-` 前缀
- `src/persistence/evolution-model.ts` — 解除硬编码，从 SOP snapshot 读取

### 工作流

- `src/workspace-workflow/workflow.ts` — `createIssueWorkflow()` 参数变更；移除 `createStageConversation()`；**删除 `snapshotRoleSnailMapping()`**；导出 `buildSopSnapshot()`
- `src/workspace-workflow/manager.ts` — `createIssue()` 透传新参数；`listStageConversations()` → `getStageConversation()`；`setIssueRoleSnail()` 参数从 `stageId`+`roleName` 改为 `stageKey`+`roleKey`，校验逻辑从 `r.name` 改为 `r.key`；`createIssue(workspaceId, title, summary)` 调用点补充 `adoptedSopId` + `roleSnailMapping`
- `src/workspace-workflow/sop-snapshot-reader.ts` — 所有方法参数从 `stageDefinitionId` 改为 `stageKey`；移除 `sd-` 前缀解析逻辑
- `src/workspace-workflow/manager-collaboration.ts` — 4 处 `stage.stage_definition_id` 引用改为 `stage.type`
- `src/workspace-workflow/self-workspace-seed.ts` — `getInitialConversationByStage()` → `getConversationByStage()`；`createIssueWorkflow()` 调用点补充 `adoptedSopId` + `roleSnailMapping`
- `src/roles/registry.ts` — 索引 key 从 `${workspaceId}:${stageDefinitionId}:${name}` 改为 `${workspaceId}:${stageKey}:${name}`

### API

- `src/interaction-entry/api/issue-routes.ts` — `POST /workspaces/:workspaceId/issues` 请求体新增 `adopted_sop_id` + `role_snail_mapping` 必填；`GET /stages/:stageId/conversations` 返回单个；`PATCH /issues/:issueId/role-snail` 参数 `stage_id` → `stage_key`、`role_name` → `role_key`
- `src/interaction-entry/api/server.ts` — `createConversation` 中移除创建额外 conversation 的能力（1:1 约束）

### Evolution Center

- `src/evolution-center/evolution-prompt.ts` — 解除硬编码
- `src/evolution-center/evolution-service.ts` — 如有硬编码需同步修改

### 配置文件

- `config/evolution-center.json.example` — 新增
- `config/sop/evolution/evolution.yaml` — 新增
- `config/workspaces.json.example` — 移除 `sop_bindings` 字段（含 `is_default`、`role_bindings`）

### Web 前端

- `src/web/workspace-context.js` — 如有对 `is_default` 的引用需移除
- `src/web/conversation-controller.js:78-79` — `from_conversation_ids` 处理逻辑不变（已正确处理数组）
- `src/web/app.js` — 如有对 `listStageConversations` 的调用需适配

### 测试

- `tests/workspace/stage-cycle-test.ts` — 适配 `from_conversation_ids` 单元素语义
- `tests/workspace/collaboration-test.ts` — 适配 1:1 约束
- `tests/persistence/persistence-test.ts` — 适配 `getConversationByStage()`
- `tests/scripts/db-bridge-evolution-test.ts` — 适配解除硬编码
- `tests/web/evolution-center-test.ts` — 适配新 SOP 配置

### Prompt

- `.meta/scripts/db-bridge.js` — 解除硬编码

## 验证

### D1 验证：移除默认 SOP

- [ ] 创建 Issue 时不传 `adopted_sop_id` 返回 400 错误
- [ ] 创建 Issue 时不传 `role_snail_mapping` 返回 400 错误
- [ ] 创建 Issue 时传入 `adopted_sop_id` + `role_snail_mapping` 成功
- [ ] 创建 Issue 时传入工作区级 SOP 但 workspace 不匹配返回 400 错误
- [ ] `issue` 表无 `adopted_sop_id` 列，SOP ID 从 `sop_snapshot.sop_id` 读取
- [ ] `workspaces.json` 无 `sop_bindings` 字段
- [ ] `issue.role_snail_mapping` 使用 plain stageKey（如 `"design"`）做外层 key
- [ ] stage 转移时**不操作** `role_snail_mapping`，新 stage 直接通过 `role_snail_mapping[stage.type]` 读取
- [ ] `PATCH /issues/:issueId/role-snail` 使用 `stage_key` + `role_key` 参数可运行时切换 snail
- [ ] `role_snail_mapping` 内层 key 使用 `role.key`（英文），非 `role.name`（中文）
- [ ] `snapshotRoleSnailMapping()` 函数已删除
- [ ] `self-workspace-seed.ts` 和 `manager.ts` 中自动创建 issue 的调用点正常工作

### D2 验证：1 Stage : 1 Conversation

- [ ] 同一 stage_id 创建第二个 conversation 返回错误
- [ ] `getConversationByStage()` 返回唯一 conversation 或 undefined
- [ ] stage 转移时 `from_conversation_ids` 包含前驱 stage 的唯一 conversation id
- [ ] 所有现有测试适配 1:1 约束后通过

### D3 验证：Evolution Center 独立配置

- [ ] `config/evolution-center.json` 正确加载到 workspace 缓存
- [ ] `saveWorkspacesFile()` 不将 evolution-center 写回 `workspaces.json`
- [ ] `workspaces.json` 中不允许定义 `id: "evolution-center"` 的条目

### D4 验证：解除硬编码

- [ ] `config/sop/evolution/evolution.yaml` 创建成功
- [ ] `buildSopSnapshot()` 已从 `workflow.ts` 导出或移到共享模块
- [ ] `evolution-model.ts` issue INSERT 包含 `sop_snapshot` 列
- [ ] `evolution-model.ts` 从 SOP snapshot 读取 stage key 和 role name
- [ ] `evolution-prompt.ts` 从 `issue.sop_snapshot` 读取 stage definition（snapshot 非空）
- [ ] 创建演进项时 stage type、role name 与 SOP YAML 定义一致
- [ ] `.meta/scripts/db-bridge.js` 同步解除硬编码

### D5 验证：清理 sd-\<sopId\>-\<key\> 格式

- [ ] `stage` 表 `stage_definition_id` 列存 plain stageKey（如 `"design"`）
- [ ] `SopSnapshotReader` 所有方法接收 plain stageKey，不再解析 `sd-` 前缀
- [ ] `SopStageDefinition.id` 直接用 stageKey
- [ ] `sop-file-utils.ts` 不再拼接 `sd-${sopId}-${sd.key}`
- [ ] `FileConfigStore` 移除所有 `sd-` 前缀正则解析
- [ ] `RoleRegistry` 索引 key 使用 plain stageKey
- [ ] 所有 `stage.stage_definition_id` 引用点适配为 plain key
- [ ] 代码中不存在 `sd-\$` 或 `sd-<` 拼接逻辑

### 通用验证

- [ ] 所有测试通过
- [ ] 无 TypeScript 编译错误
- [ ] 无 ESLint 错误

## 实施顺序

```
D4 (解除硬编码 + 创建 Evolution SOP) → D3 (独立配置文件) → D1 (移除 is_default) → D2 (1:1 约束) → D5 (清理 sd- 格式)
```

- **D4 前置**：Evolution SOP 存在后 evolution-center 才能跑通
- **D3 是 D1 前置**：分离配置后才能清理默认 SOP 逻辑
- **D1 纯逻辑变更**：`role_snail_mapping` 用 plain stageKey 做 key，与 D5 的 `stage_definition_id` 列格式无关
- **D2 schema 变更**：影响面较大
- **D5 放最后**：最大改动（27 处引用），不阻塞前面的设计；且 D1-D4 不依赖 `sd-` 格式清理

## 关联

- **前置**: F2026060407 (SOP Issue 快照)、F2026052903 (Evolution Center 重构)
- **后续**: 无

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|-----------|------|------|
| 1 | sop_bindings 和 adopted_sop_id 是否保留 | 不保留。SOP 自带 scope 属性（platform/workspace），不需要 workspace 去声明可用 SOP。`sop_bindings` 整个移除，`issue.adopted_sop_id` 列移除（SOP ID 存在 snapshot 中） | 2026-06-05 |
| 2 | 1:N 还是 1:1 | 严格 1:1。不为兼容性污染设计 | 2026-06-05 |
| 3 | 是否引入通用"系统内置 workspace"机制 | 不引入，过度设计。evolution-center 独立配置文件即可 | 2026-06-05 |
| 4 | role_snail_mapping key 用什么 | 外层用 plain stageKey（如 `"design"`），内层用 roleKey。不用 `sd-<sopId>-<key>` 格式（见 #5） | 2026-06-05 |
| 5 | `sd-<sopId>-<key>` 格式是否保留 | 不保留。该格式是早期"跨 SOP 全局唯一"的设计残留，实际所有 reader 拿到后都 parse 出 plain key 再查找。stage 表、SopSnapshotReader、FileConfigStore 全部改为用 plain key | 2026-06-05 |
| 6 | Evolution SOP stage key 用什么 | 用 `development`，与现有硬编码对齐，减少改动范围 | 2026-06-05 |
| 7 | from_conversation_ids 是否移除 | 保留，语义简化为单元素数组 | 2026-06-05 |
| 8 | sop_snapshot 是否改为子表 | 不改。保持单字段 JSON blob。SOP snapshot 使用模式是"整体读取，从不部分更新"，blob 天然适合；10-50KB 在 SQLite 中不算大；如需查询内部结构可用 `json_extract()` | 2026-06-05 |

## 范围变更记录

| # | 变更 | 原因 | 日期 |
|---|------|------|------|
| 1 | `snapshotRoleSnailMapping()` 从"简化"改为"删除" | mapping 是 issue 级别配置，stage 转移零操作 | 2026-06-05 |
| 2 | PATCH API 参数 `stage_id` → `stage_key` | 匹配新的 mapping key 结构 | 2026-06-05 |
| 3 | 补充 `self-workspace-seed.ts:33` 和 `manager.ts:100` 调用点 | 第二架构师检视发现遗漏 | 2026-06-05 |
| 4 | `buildSopSnapshot()` 需导出 | D4 的 `evolution-model.ts` 需跨模块调用 | 2026-06-05 |
| 5 | UNIQUE 约束明确使用 partial index | `stage_id` 可为 NULL，需排除 NULL 行 | 2026-06-05 |
| 6 | role_snail_mapping 内层 key 从 `role.name` 改为 `role.key` | 第二架构师检视发现现有代码用 name 做 key 是历史错误；key 更稳定 | 2026-06-05 |
| 7 | `buildSopSnapshot` 参数类型从 `WorkflowDependencies` 改为 `{ store: FileConfigStore }` | 第二架构师检视发现实际不依赖 `roleRegistry`，EvolutionModel 也无法提供 | 2026-06-05 |
| 8 | 新增 D5：清理 `sd-<sopId>-<key>` 格式 | 自检发现该格式是设计残留，所有 reader 都 parse 出 plain key 再查找；纳入本次范围一并清理 | 2026-06-05 |
| 9 | mapping 外层 key 从 `stageDefinitionId` 改为 `stageKey` | 配合 D5，调用方直接用 SOP snapshot 中的 plain key，无需拼接 | 2026-06-05 |
| 10 | D5 补充 role ID (`srd-` 格式) 调用点 | 第三架构师检视：role ID 格式变更的传递链未列出 | 2026-06-05 |
| 11 | 实施顺序从 D4→D3→D5→D1→D2 改为 D4→D3→D1→D2→D5 | 第三架构师检视：D1 不依赖 D5，D5 放最后减少阻塞 | 2026-06-05 |
| 12 | D4 evolution-model.ts issue INSERT 补充 `sop_snapshot` | 第四架构师检视：原 INSERT 缺少 snapshot 列，导致 `evolution-prompt.ts` 读取时崩溃 | 2026-06-05 |
| 13 | 移除 `sop_bindings` 和 `issue.adopted_sop_id` | SOP 自带 scope 属性，不需要 workspace 去声明可用 SOP；snapshot 已含 `sop_id`，不需要冗余列 | 2026-06-05 |
| 14 | `createInitialWorkflow()` 移除 `roleBindings` 参数 | `sop_bindings` 移除后该参数失去用途；内部 `createWorkspaceSop()` 和 `roleRegistry.reloadFromStore()` 一并移除 | 2026-06-05 |
