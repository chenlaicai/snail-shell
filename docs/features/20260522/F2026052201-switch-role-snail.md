# F2026052201 切换 Role Snail

## 背景

当前 Snail Shell 中，Role 到 Snail Template 的绑定只在 `stage_role_definition.snail_template_id`（项目模板层）。Feature 创建时并未快照这份映射，运行时通过 `resolveConversationRole` 动态查 `stage_role_definition`——模板变更会意外影响已在运行中的 Feature。

同时用户存在按 Feature 手动切换某个 Role 使用的 Snail 的需求（如"检视者换成 Opus"）。当前运行时侧边栏仅以纯文本展示 `snail_template_id`，不具备切换能力。

F2026052002（agent-packaging）已将 agent 会话抽取到 `snail_agent_session` 表，session 创建时从 template 固化 `runtime`/`model`/`context_provider`。切换后创建新 session 即可生效。

## 目标

1. Feature 创建时，从项目模板快照 role→snail_template_id 映射存入 Feature 自身存储，后续模板变更不影响已创建 Feature
2. `resolveConversationRole` 改为读 Feature 自己的映射，不再动态查 `stage_role_definition`
3. 运行时侧边栏的角色卡片中，snail 展示可切换（下拉选择 Snail Den 中的模板），切换后立即更新 Feature 映射
4. 切换在当前 agent 回复结束后生效，下一次该 Role 被调用时使用新 snail（自动创建新 session）

## 非目标

- 不支持 agent 调用进行中（in-flight）的热切换；agent 回复完成后的下一条消息不受此限制
- 不修改 `stage_role_definition` 表的 schema 或 seed 逻辑
- 不处理跨 Feature 的批量切换

## 设计

### 核心思路

Feature 创建时，把各 Stage 下每个 Role 的 `snail_template_id` 从项目模板快照到 Feature 自身。此后 Feature 内 Role 使用哪个 Snail，以 Feature 自己的记录为准——模板变更不再波及已有 Feature；手动切换也只是更新 Feature 自己的记录。运行时侧边栏的参与角色卡片中原本文本展示的 snail 改为下拉选择，切换即时生效。

### 数据模型

`feature` 表新增 JSON 列：

```sql
ALTER TABLE feature ADD COLUMN role_snail_mapping TEXT NOT NULL DEFAULT '{}';
```

存储格式（外层 key 为 stage_type，内层 key 为 role_name）：

```json
{
  "development": {
    "研发者": "claude-code-stateful-dsv4"
  },
  "review": {
    "研发者": "claude-code-stateful-dsv4",
    "检视者": "opencode-default"
  }
}
```

示例：开发阶段研发者切换到 Opus 后：

```json
{
  "development": {
    "研发者": "claude-code-stateful-opus"
  },
  "review": {
    "研发者": "claude-code-stateful-dsv4",
    "检视者": "opencode-default"
  }
}
```

### Feature 创建时快照

`createFeatureWorkflow` 和 `advanceFeatureWorkflow` 在创建 stage 后、创建 conversation 前，从 `roleRegistry.listByStageType()` 获取当前阶段的角色列表，快照 `snail_template_id` 写入 `feature.role_snail_mapping`。

```
createFeatureWorkflow(projectId, title, summary):
  feature = store.createFeature(...)
  stage = createFeatureStage(projectId, feature.id, "development")
  roles = roleRegistry.listByStageType(projectId, stage.type)
  mapping = {
    [stage.type]: { role.name: role.snail_template_id for role in roles if role.snail_template_id }
  }
  store.updateFeature(feature.id, { role_snail_mapping: mapping })
  conversation = createDefaultStageConversation(...)
```

`advanceFeatureWorkflow` 推进到新阶段时，追加该 stage 的映射：

```
advanceFeatureWorkflow(featureId):
  ...
  newStage = createFeatureStage(projectId, featureId, "review")
  roles = roleRegistry.listByStageType(projectId, newStage.type)
  feature.role_snail_mapping[newStage.type] = { ... }
  store.updateFeature(featureId, { role_snail_mapping: feature.role_snail_mapping })
  ...
```

### 解析流程变更

**当前**：`resolveConversationRole` 动态查 `stage_role_definition`，模板改了就影响已有 Feature。

**变更后**：

```
resolveConversationRole(conversationId, roleName):
  roleDef = roleRegistry.getByStageDefinitionName(stage.stage_definition_id, roleName)
  feature = store.getFeature(conversation.feature_id)
  stage = store.getStage(conversation.stage_id)
  mapping = parseJSON(feature.role_snail_mapping)
  templateId = mapping[stage.type]?.[roleName]
  if templateId:
    return { ...roleDef, snail_template_id: templateId }
  return roleDef
```

下游 5 个回调（`resolveRuntimeByRole`、`resolveModelForRole`、`resolveContextWindowForRole`、`resolveTimeoutForRole`、`lookupOrCreateSnailAgentSession`）均通过此入口获取 Role，无需逐一修改。

### 运行时 UI 切换

`workspace-context.js` 中 `renderParticipant` 当前以纯文本展示 `snail_template_id`：

```js
const template = participant.roleDef?.snail_template_id
  ? `<span class="participant-runtime">${escapeHtml(participant.roleDef.snail_template_id)}</span>`
  : "";
```

改为 `<select>` 下拉，模板列表从 Snail Den 获取，变更时调用 API 更新 Feature 映射：

```
PATCH /api/features/:featureId/role-snail
Body: { stage_type: "development", role_name: "研发者", snail_template_id: "claude-code-stateful-opus" }
```

### Session 自动切换

`lookupOrCreateSnailAgentSession` 增加不匹配检测：已有 session 的 `runtime`/`model` 与当前 effective template 不同时，自动创建新 session。新 session 的 `external_session_id` 为 null，stateful runtime 会冷启动。旧 session 保留在 DB 中，`ORDER BY created_at DESC` 自然被新 session 取代。

```
lookupOrCreateSnailAgentSession(conversationId, roleName, role):
  existing = getCurrentSnailAgentSession(conversationId, roleName)
  if existing:
    template = snailDen.getTemplate(role.snail_template_id)
    if existing.runtime == template.runtime AND existing.model == template.model:
      return existing
  return createSnailAgentSession(...)
```

### 边界情况

| 场景 | 处理 |
|---|---|
| 切换引用的 template_id 在 SnailDen 中不存在 | 创建 session 时 `snailDen.getTemplate()` 返回 undefined，抛出明确错误 |
| Feature 被删除 | `role_snail_mapping` 随 feature 行 CASCADE 删除 |
| 同一 Role 多次切换 | 直接覆盖 JSON 中对应 key 的值 |
| 推进阶段时项目模板新增了 Role | 新 Role 在快照时被加入 mapping |
| Knowledge Governance conversation | 不走 Feature 映射路径（硬编码 RoleDefinition） |

## 生效路径

- `src/persistence/schema.ts` — `feature` 表新增 `role_snail_mapping` 列
- `src/shared/domain-types.ts` — `Feature` 接口新增 `role_snail_mapping` 字段
- `src/persistence/store.ts` — `createFeature` 写入默认 `{}`；`updateFeature` 扩展支持该字段
- `src/project-workflow/workflow.ts` — `createFeatureWorkflow` / `advanceFeatureWorkflow` 快照映射
- `src/project-workflow/manager.ts` — `resolveConversationRole` 改为 feature 映射优先；session 不匹配检测；新增 `setFeatureRoleSnail` 方法
- `src/interaction-entry/api/feature-routes.ts` — 新增 `PATCH /api/features/:featureId/role-snail` 路由
- `src/web/workspace-context.js` — 参与角色卡片 snail 从纯文本改为可切换下拉
- `docs/features/20260522/F2026052201-switch-role-snail.md` — 本设计文档

## 改动范围

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `src/persistence/schema.ts` | 修改 | `feature` 表新增 `role_snail_mapping` 列 |
| `src/shared/domain-types.ts` | 修改 | `Feature` 接口新增 `role_snail_mapping: Record<string, Record<string, string>>` |
| `src/persistence/store.ts` | 修改 | `createFeature` 写入默认 `{}`；`updateFeature` 扩展支持该字段 |
| `src/project-workflow/workflow.ts` | 修改 | `createFeatureWorkflow` / `advanceFeatureWorkflow` 增加快照逻辑 |
| `src/project-workflow/manager.ts` | 修改 | `resolveConversationRole` 改为 feature 映射优先；session 不匹配检测；新增 `setFeatureRoleSnail` 方法 |
| `src/interaction-entry/api/feature-routes.ts` | 修改 | 新增 `PATCH /api/features/:featureId/role-snail` 路由 |
| `src/web/workspace-context.js` | 修改 | 参与角色卡片 snail 改为下拉选择，变更时调 API |

## 验证

1. **单元测试**：`createFeatureWorkflow` 创建后 `role_snail_mapping` 结构正确，key 为 stage_type
2. **单元测试**：`resolveConversationRole` 在 mapping 有/无该 stage+role 时的行为
3. **单元测试**：`lookupOrCreateSnailAgentSession` template 不匹配时创建新 session
4. **集成测试**：创建 Feature → 修改项目模板 → 确认 Feature 仍用快照值
5. **集成测试**：侧边栏切换 snail → 下一轮 agent 调用使用新 template
6. **手动验证**：侧边栏下拉展示 Snail Den 模板列表，选择后即时生效

## 风险与决策记录

- **决策**：存储格式为 `{stage_type: {role_name: snail_template_id}}`。因为不同 Stage 可以有同名 Role，必须用 stage_type 区分。
- **决策**：在 Feature 级别存储映射（而非 Stage 级别）。Feature 内所有 Stage 的映射存储在一起，避免多表散布。
- **决策**：侧边栏切换而非 CLI。当前 UI 已有 snail 信息展示，改为交互控件即可，无需引入新的交互方式。
- **风险**：如果 Snail Den 中删除了某个 template，而已有 Feature 映射引用了它，下次调用报错。缓解：切换时校验 template_id 存在于 Snail Den。

## 范围变更记录

（初始版本，暂无变更）
