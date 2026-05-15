# F2026051506 Role 与 Snail Den 分离

## 背景

上一轮重构（F2026051502）将项目配置数据收束到数据库，但 `.meta/snails.json`、`.meta/stages.json`、`.meta/artifacts.json` 仍然存在。更关键的是，`stage_role_definition.snail_id` 存储的是 snail 名称（如 "Implementation Snail"），而非 snail den 的 template ID。这导致两个概念混为一谈：

- **角色（Role）** = 项目/阶段的参与者身份，携带 persona 元数据（描述、能力期望、工作规则、偏好产物类型）。
- **Snail** = snail den 中的运行时模板（runtime + model），由角色引用。

类比：snail 从 den 出来，在项目管理体系中担任研发者、检视者等角色。角色是职责，snail 是执行者。

此外，`SnailName` 类型是硬编码的 union（`"Owner Snail" | "Product Snail" | ...`），与 `StageType` 已改为 `string` 的做法不一致，新增角色需要改代码。

## 目标

1. 删除 `.meta/snails.json`、`.meta/stages.json`、`.meta/artifacts.json`，只保留 `.meta/project-config-seed.json`。
2. `stage_role_definition` 表承载角色的完整 persona 元数据，新增 `name`、`snail_template_id`、`description`、`capability_expectations`、`preferred_artifact_types` 字段。
3. `SnailName` 类型从硬编码 union 改为 `string`。
4. `SnailRegistry` 从 DB 加载，不再读取 `.meta` 文件；新增 `getSnailTemplateId(roleName)` 方法用于查找关联的 snail den template。
5. 消费方通过 `snailRegistry.getSnailTemplateId()` → `snailDen.getSnailRuntime()` 链路获取运行时，不再从角色定义直接读取 runtime。

## 非目标

- 不引入数据迁移兼容策略——直接保留最终 schema 版本。
- 不改变 snail den 的 template 管理机制。
- 不改变知识治理模块的合成角色定义结构（仅适配新字段名）。

## 设计

### 数据模型

**`stage_role_definition` 表新增列：**

| 新列 | 类型 | 说明 |
|------|------|------|
| `snail_template_id` TEXT | 引用 snail den template ID | 替代原 `snail_id` 的运行时含义 |
| `name` TEXT NOT NULL DEFAULT '' | 角色显示名 | 用于 conversation/message 路由 |
| `description` TEXT NOT NULL DEFAULT '' | 角色描述 | 原 snails.json 的 description |
| `capability_expectations` TEXT NOT NULL DEFAULT '[]' | 能力期望 JSON | 原 snails.json |
| `preferred_artifact_types` TEXT NOT NULL DEFAULT '[]' | 偏好产物类型 JSON | 原 snails.json |

原 `snail_id` 列保留但废弃。

**种子文件格式（`.meta/project-config-seed.json`）：**

```json
{
  "id": "snail-shell-development-implementation",
  "name": "研发者",
  "snail_template_id": "opencode-default",
  "is_primary": true,
  "description": "负责需求讨论、设计取舍、实现、自检、提交 PR，并处理检视意见。",
  "capability_expectations": ["需求澄清", "设计取舍", "实现", "自检", "PR 交付", "检视意见处理"],
  "working_rules": ["需求不清时先和用户讨论并收敛", "..."],
  "preferred_artifact_types": ["pull_request_record", "..."]
}
```

### SnailRegistry 重构

- 构造函数改为接收 `RoleDefinitionStore`（即 `ConversationStore`），从 DB 的 `stage_role_definition` 加载。
- 不再读取 `.meta/snails.json`。
- 新增 `reloadFromStore()` 方法，用于新建项目后刷新缓存。
- 新增 `getSnailTemplateId(roleName)` 方法，返回关联的 snail den template ID。
- `RoleDefinition` 类型 = `StageRoleDefinition`（包含所有 persona 字段）。

### 运行时解析链路变更

旧链路：`SnailDefinition.runtime` → 直接获取 runtime。
新链路：`snailRegistry.getSnailTemplateId(roleName)` → `snailDen.getSnailRuntime(templateId)` → 获取 runtime。

具体变更：
- `SnailAgentResolver.resolve()` 改为接收 `AgentRuntime` 直接参数，不再接收 `SnailDefinition`。
- `StreamingContext` 新增 `resolvedRuntime` 字段，因为 `activeSnail` 不再携带 runtime。
- `collaboration.ts` 的 `resolveRuntimeBySnail` 回调返回 `{ invokeMessage, runtime }` 对象。
- `isAgentSnail()` 改为检查 `snail_template_id` 是否存在。

### 类型生成简化

`scripts/generate-types.ts` 不再读取 `.meta` 文件，只生成：
```typescript
export type SnailName = string;
export type StageType = string;
```

## 生效路径

1. DB schema 迁移：`ensureRolePersonaColumns()` 添加新列。
2. 种子文件：`.meta/project-config-seed.json` 使用新格式。
3. `SnailRegistry` 构造改为传入 store，从 DB 加载。
4. 所有消费方适配新字段和运行时解析链路。
5. 删除 `.meta/snails.json`、`.meta/stages.json`、`.meta/artifacts.json`。

## 改动范围

**删除（3 个文件）：**
1. `.meta/snails.json`
2. `.meta/stages.json`
3. `.meta/artifacts.json`

**修改（25 个源码文件 + 6 个测试文件）：**
1. `src/shared/domain-types.ts` — `StageRoleDefinition` 新增字段
2. `src/persistence/schema.ts` — DDL 加入新列
3. `src/persistence/migrations.ts` — `ensureRolePersonaColumns()`
4. `src/persistence/project-config-model.ts` — seed 逻辑适配新字段
5. `src/persistence/store.ts` — 接入迁移
6. `src/snails/registry.ts` — 从 DB 加载，新增 `getSnailTemplateId()`
7. `src/snails/index.ts` — 导出调整
8. `src/meta/generated-types.ts` — `SnailName = string`
9. `src/meta/index.ts` — 移除 `loadSnailDefinitions()`
10. `scripts/generate-types.ts` — 简化为只生成 string 类型
11. `src/main.ts` — `SnailRegistry` 构造传入 store
12. `src/agent/resolver.ts` — `resolve()` 接收 `AgentRuntime`
13. `src/agent/message-flow-logger.ts` — runtime 类型放宽
14. `src/snail-den/index.ts` — 适配 resolver 调用
15. `src/message-bus/collaboration.ts` — 运行时解析链路重构
16. `src/message-bus/message-protocol.ts` — `StreamingContext` 新增 `resolvedRuntime`
17. `src/project-workflow/manager.ts` — template 查找逻辑适配
18. `src/project-workflow/manager-types.ts` — `role_definitions` 类型适配
19. `src/project-workflow/workflow.ts` — `StageDefinitionInput` 适配新 role 字段
20. `src/prompt-center/builder.ts` — runtime 字段适配
21. `src/knowledge-center/governance-prompt.ts` — 合成 role 定义适配
22. `src/interaction-entry/api/validation.ts` — 移除硬编码 snail 名称校验
23. `src/index.ts` — 移除废弃导出
24. `.meta/project-config-seed.json` — 新格式
25. `scripts/seed-self-project.ts` — 适配新字段

**测试文件：**
26. `tests/persistence/persistence-test.ts`
27. `tests/project/collaboration-test.ts`
28. `tests/project/stage-cycle-test.ts`
29. `tests/project/repo-cleanup-test.ts`
30. `tests/project/startup-recovery-test.ts`
31. `tests/scripts/seed-self-project-test.ts`

## 验证

1. `npm run generate-types` 正确输出 `SnailName = string`。
2. `npm run lint` 0 error（27 pre-existing warnings）。
3. `npx tsc` 编译通过。
4. 35 个测试全部通过。
5. 创建 project → stage → conversation 正确设置 `participating_snails` 和 `default_snail`。
6. 消息发送 → 正确 snail 响应，通过 `getSnailTemplateId()` → `getSnailRuntime()` 获取运行时。
7. 知识治理对话正常运行，system prompt 包含治理上下文。

## 风险与决策记录

**决策 1：`snail_id` 列保留但废弃。**
原因：避免 ALTER TABLE DROP COLUMN 的兼容性问题，后续可单独清理。

**决策 2：不引入数据迁移填充。**
原因：用户明确要求"不用考虑兼容迁移，直接保留最终版本"。

**决策 3：`SnailName` 改为 `string` 而非保留 union。**
原因：与 `StageType = string` 保持一致，新增角色不需要改代码。
