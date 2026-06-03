---
id: I2026051506
title: Role 与 Snail Den 分离
from_ids: []
tags: [role, refactor]
modules: [project_management]
---
# I2026051506 Role 与 Snail Den 分离

## 背景

上一轮重构（I2026051502）将项目配置数据收束到数据库，但 `.meta/snails.json`、`.meta/stages.json`、`.meta/artifacts.json` 仍然存在。更关键的是，`stage_role_definition.snail_id` 存储的是 snail 名称（如 "Implementation Snail"），而非 snail den 的 template ID。这导致两个概念混为一谈：

- **角色（Role）** = 项目/阶段的参与者身份，携带 persona 元数据（描述、工作规则）。
- **Snail** = snail den 中的运行时模板（runtime + model），由角色引用。

类比：snail 从 den 出来，在项目管理体系中担任研发者、检视者等角色。角色是职责，snail 是执行者。

此外，`SnailName` 类型是硬编码的 union（`"Owner Snail" | "Product Snail" | ...`），与 `StageType` 已改为 `string` 的做法不一致，新增角色需要改代码。

## 目标

1. 删除 `.meta/snails.json`、`.meta/stages.json`、`.meta/artifacts.json`，只保留 `.meta/project-config-seed.json`。
2. `stage_role_definition` 表承载角色元数据，新增 `name`、`snail_template_id`、`description` 字段。
3. `SnailName` 类型从硬编码 union 改为 `string`。
4. `SnailRegistry` 从 DB 加载，不再读取 `.meta` 文件；新增 `getSnailTemplateId(roleName)` 方法用于查找关联的 snail den template。
5. 消费方通过 `snailRegistry.getSnailTemplateId()` → `snailDen.getSnailRuntime()` 链路获取运行时，不再从角色定义直接读取 runtime。
6. 删除 `scripts/generate-types.ts` 和 `src/meta/` 模块——`SnailName = string` 直接在 `domain-types.ts` 中定义。
7. 不引入向后兼容迁移——直接定义最终 schema。

## 非目标

- 不改变 snail den 的 template 管理机制。
- 不改变知识治理模块的合成角色定义结构（仅适配新字段名）。

## 设计

### 数据模型

**`stage_role_definition` 表最终 schema：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT PK | 唯一标识 |
| `project_id` | TEXT FK | 所属项目 |
| `stage_definition_id` | TEXT FK | 所属 stage 定义 |
| `snail_id` | TEXT | 废弃，保留用于 UNIQUE 约束 |
| `snail_template_id` TEXT | 引用 snail den template ID | 替代原 `snail_id` 的运行时含义 |
| `name` TEXT NOT NULL DEFAULT '' | 角色显示名 | 用于 conversation/message 路由 |
| `is_primary` INTEGER | 是否为主角色 | |
| `description` TEXT | 角色描述 | |
| `working_rules` TEXT | 工作规则 JSON 数组 | |

**种子文件格式（`.meta/project-config-seed.json`）：**

```json
{
  "id": "snail-shell-development-implementation",
  "name": "研发者",
  "snail_template_id": "opencode-default",
  "is_primary": true,
  "description": "负责需求讨论、设计取舍、实现、自检、提交 PR，并处理检视意见。",
  "working_rules": ["需求不清时先和用户讨论并收敛", "..."]
}
```

### SnailRegistry 重构

- 构造函数改为接收 `RoleDefinitionStore`（即 `ConversationStore`），从 DB 的 `stage_role_definition` 加载。
- 不再读取 `.meta/snails.json`。
- 新增 `reloadFromStore()` 方法，用于新建项目后刷新缓存。
- 新增 `getSnailTemplateId(roleName)` 方法，返回关联的 snail den template ID。
- `RoleDefinition` 类型 = `StageRoleDefinition`。

### 运行时解析链路变更

旧链路：`SnailDefinition.runtime` → 直接获取 runtime。
新链路：`snailRegistry.getSnailTemplateId(roleName)` → `snailDen.getSnailRuntime(templateId)` → 获取 runtime。

具体变更：
- `SnailAgentResolver.resolve()` 改为接收 `AgentRuntime` 直接参数，不再接收 `SnailDefinition`。
- `StreamingContext` 新增 `resolvedRuntime` 字段，因为 `activeSnail` 不再携带 runtime。
- `collaboration.ts` 的 `resolveRuntimeBySnail` 回调返回 `{ invokeMessage, runtime }` 对象。
- `isAgentSnail()` 改为检查 `snail_template_id` 是否存在。

### 类型生成删除

`scripts/generate-types.ts` 和 `src/meta/` 模块完全删除。`SnailName = string` 和 `StageType = string` 直接在 `src/shared/domain-types.ts` 中定义。构建脚本移除 `npm run generate-types` 步骤。

### 向后兼容迁移删除

`ensureRolePersonaColumns()` 迁移函数删除。最终 schema 直接在 `schema.ts` DDL 中定义，不需要 ALTER TABLE。

## 生效路径

1. DB schema：`schema.ts` DDL 直接定义最终表结构。
2. 种子文件：`.meta/project-config-seed.json` 使用新格式。
3. `SnailRegistry` 构造改为传入 store，从 DB 加载。
4. 所有消费方适配新字段和运行时解析链路。
5. 删除 `.meta/snails.json`、`.meta/stages.json`、`.meta/artifacts.json`。
6. 删除 `scripts/generate-types.ts` 和 `src/meta/`。

## 改动范围

**删除（6 个文件）：**
1. `.meta/snails.json`
2. `.meta/stages.json`
3. `.meta/artifacts.json`
4. `scripts/generate-types.ts`
5. `src/meta/generated-types.ts`
6. `src/meta/index.ts`

**修改（28 个源码文件 + 6 个测试文件）：**
1. `src/shared/domain-types.ts` — `StageRoleDefinition` 新增字段，`SnailName`/`StageType` 直接定义
2. `src/shared/types.ts` — import 改为 `./domain-types`
3. `src/shared/message-types.ts` — `SnailName` 改为本地 type alias
4. `src/persistence/schema.ts` — DDL 定义最终表结构
5. `src/persistence/migrations.ts` — 删除 `ensureRolePersonaColumns()`
6. `src/persistence/project-config-model.ts` — seed 逻辑适配新字段
7. `src/persistence/store.ts` — 移除迁移调用
8. `src/snails/registry.ts` — 从 DB 加载，新增 `getSnailTemplateId()`
9. `src/snails/index.ts` — 导出调整
10. `src/main.ts` — `SnailRegistry` 构造传入 store
11. `src/agent/resolver.ts` — `resolve()` 接收 `AgentRuntime`
12. `src/agent/message-flow-logger.ts` — runtime 类型放宽
13. `src/snail-den/index.ts` — 适配 resolver 调用
14. `src/message-bus/collaboration.ts` — 运行时解析链路重构
15. `src/message-bus/message-protocol.ts` — `StreamingContext` 新增 `resolvedRuntime`
16. `src/project-workflow/manager.ts` — template 查找逻辑适配
17. `src/project-workflow/manager-types.ts` — `role_definitions` 类型适配
18. `src/project-workflow/workflow.ts` — `StageDefinitionInput` 适配新 role 字段
19. `src/prompt-center/builder.ts` — 移除 capability/artifact 模板变量
20. `src/knowledge-center/governance-prompt.ts` — 合成 role 定义适配
21. `src/interaction-entry/api/validation.ts` — 移除硬编码 snail 名称校验
22. `src/interaction-entry/api/server.ts` — import 改为直接引用 prompt-center/skill-center
23. `src/bin/regulation-expand.ts` — import 改为直接引用 prompt-center
24. `src/index.ts` — 移除废弃导出
25. `.meta/project-config-seed.json` — 新格式
26. `.meta/README.md` — 更新文件说明
27. `.meta/prompts/prompts/S-01-项目上下文.md` — 移除已删除的模板变量
28. `src/web/stage-contract-view.js` — 移除 capability 渲染
29. `package.json` — 移除 generate-types 脚本

**测试文件：**
30. `tests/persistence/persistence-test.ts`
31. `tests/project/collaboration-test.ts`
32. `tests/project/stage-cycle-test.ts`
33. `tests/project/repo-cleanup-test.ts`
34. `tests/project/startup-recovery-test.ts`
35. `tests/scripts/seed-self-project-test.ts`
36. `tests/meta/prompt-assets-test.ts`

## 验证

1. `npm run lint` 0 error（24 pre-existing warnings）。
2. `npx tsc` 编译通过。
3. 36 个测试全部通过。
4. 创建 project → stage → conversation 正确设置 `participating_snails` 和 `default_snail`。
5. 消息发送 → 正确 snail 响应，通过 `getSnailTemplateId()` → `getSnailRuntime()` 获取运行时。
6. 知识治理对话正常运行，system prompt 包含治理上下文。

## 风险与决策记录

**决策 1：`snail_id` 列保留但废弃。**
原因：UNIQUE 约束依赖该列，后续可单独清理。

**决策 2：删除 `generate-types` 和 `src/meta/`。**
原因：`SnailName = string` 和 `StageType = string` 没有必要通过代码生成维护。

**决策 3：删除向后兼容迁移。**
原因：用户明确要求"不用考虑兼容迁移，直接保留最终版本"。

**决策 4：移除 `capability_expectations` 和 `preferred_artifact_types`。**
原因：原始 seed 文件中不存在这两个字段，是本次重构过程中误增的。
