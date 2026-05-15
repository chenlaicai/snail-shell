# F2026051410 项目管理接入 Snail Den — Role 分配机制

## 背景

Snail Shell 的项目管理相关配置（stage 定义、snail 角色定义）目前通过 `.meta/` 目录下的 JSON 文件（`stages.json`、`snails.json`）加载，项目管理模块直接读取这些文件。这导致：

1. 项目管理模块与配置文件耦合，违反"数据来源于数据库"的准则
2. Snail 的定义（身份、能力、工作规则）和 Snail 的运行时（runtime、model）分散在不同位置
3. `.meta/` 目录同时承担配置时定义和运行时引用的职责，边界不清晰

需要将 snail 定义统一到 Snail Den 管理，项目管理模块只对接数据库。

## 目标

- **Snail Den** 成为 snail 定义的唯一来源（身份 + 运行时），`config/snail-den.json` 包含完整 snail 定义
- **数据库** 是运行时数据的唯一来源：snail 定义在启动时从 Snail Den config seed 到 `snail_definition` 表
- **Stage 类型定义** 硬编码在项目管理模块的 TypeScript 代码中（属于领域模型，不是外部配置）
- **项目管理模块** 只读数据库，不触及任何配置文件
- `.meta/stages.json` 和 `.meta/snails.json` 不再存在
- Role → Snail 通过 SnailName 显式关联，不使用能力标签匹配
- Boss（用户）不属于 snail，不参与 snail 角色分配
- conversation 等运行数据先关联阶段内 role，再通过 role 绑定或选择具体 snail

## 非目标

- 不改变现有的 workflow 状态机逻辑（create/advance/restart），只在创建 Stage 时增加 Role 分配步骤
- 不改变 message dispatch 和 runtime session 机制
- 不涉及 UI 层的项目管理配置界面（后续 feature 处理）
- `.meta/artifacts.json` 保持不变（不在本次范围内）

## 设计

### 模块职责划分

```
Snail Den (src/snail-den/)
  ├── Snail 定义管理（config/snail-den.json → snail_definition 表 seed）
  ├── SnailTemplate 管理（runtime、model、contextWindow）
  └── SystemAI（摘要生成、mention 提取）

Project Workflow (src/project-workflow/)
  ├── Stage 类型定义（硬编码 TypeScript）
  ├── Workflow 状态机（create/advance/restart）
  ├── Role-Snail 显式分配逻辑
  └── Conversation 创建与管理

Persistence (src/persistence/)
  ├── snail_definition 表（snail 定义持久化）
  ├── stage 表（stage 运行实例 + role_assignments）
  └── conversation 表（conversation 运行实例 + role_id）
```

### 配置时模型

#### Snail Den 配置文件（config/snail-den.json）

Snail Den 的配置文件扩展为包含完整 snail 定义：

```json
{
  "templates": [
    { "id": "opencode-default", "name": "OpenCode + GPT-5.5", "runtime": "opencode-cli", "model": "my-geek/gpt-5.5", "contextWindow": 270000 }
  ],
  "snails": [
    {
      "name": "Implementation Snail",
      "description": "负责需求讨论、设计取舍、实现、自检、提交 PR，并处理检视意见。",
      "template": "opencode-default",
      "kind": "agent",
      "capability_expectations": ["需求澄清", "设计取舍", "实现", "自检", "PR 交付", "检视意见处理"]
    }
  ]
}
```

Snail 定义只包含身份和能力信息（name、description、template、kind、capability_expectations）。`working_rules`、`preferred_artifact_types` 等 role 级职责定义在 Stage 类型定义的 roles 中，不归入 snail 定义。

#### Stage 类型定义（硬编码 TypeScript）

Stage 类型定义硬编码在 `src/project-workflow/stage-definitions.ts` 中，属于项目管理领域模型：

```typescript
export const STAGE_DEFINITIONS: Record<StageType, StageDefinition> = {
  development: {
    order: 1,
    title: "研发迭代",
    repo_related: true,
    formal_artifact_types: ["pull_request_record"],
    roles: [
      {
        id: "developer",
        name: "研发者",
        description: "负责需求讨论、设计取舍、实现、自检、提交 PR，并处理检视意见。",
        assigned_snails: ["Implementation Snail"],
        preferred_artifact_types: ["pull_request_record", "review_completion_record"],
        working_rules: ["需求不清时先和用户讨论并收敛", "完成开发后必须自检并提交 PR"],
      },
    ],
    input: [],
    output: { summary: "...", required_artifacts: [...], artifact_requirements: [...] },
    acceptance_focus: [...],
  },
  // ...
};
```

Role 通过 `assigned_snails: SnailName[]` 直接引用 snail，不使用能力匹配。

### 运行时模型

#### 数据库表：snail_definition

启动时从 Snail Den config seed 到数据库：

| 列 | 类型 | 说明 |
|---|---|---|
| name | TEXT PK | SnailName（如 "Implementation Snail"） |
| description | TEXT | 角色描述 |
| template | TEXT | 关联的 Snail Den template ID |
| kind | TEXT | "agent" 或 "human" |
| capability_expectations | TEXT (JSON) | 能力标签数组 |

`working_rules`、`preferred_artifact_types`、`stage_affinity` 不再存储在 snail_definition 表中，它们是 role 级职责，定义在 Stage 类型定义的 roles 中。

#### Stage 运行数据

Stage 运行实例记录：
- `role_assignments`: Role → Snail 分配记录，从 stage 类型定义的 `roles[].assigned_snails` 初始化
- 创建时自动从硬编码定义读取，不需要能力匹配

#### Conversation 运行数据

- `role_id`: 关联的 Stage 内 Role
- `default_snail`: 通过 `stage.role_assignments` 中该 role 的第一个 assigned_snail 确定

### 数据流

```
启动时：
  config/snail-den.json  ──seed──>  snail_definition 表  ──read──>  SnailRegistry

运行时：
  stage-definitions.ts (硬编码)  ──>  createFeatureStage()  ──>  stage 表 (role_assignments)
  stage.role_assignments  ──>  createConversation()  ──>  conversation 表 (role_id, default_snail)
  stage-definitions.ts  ──>  getSnailsForStageType()  ──>  participatingSnails
  stage-definitions.ts  ──>  getDefaultSnailForStageType()  ──>  defaultSnail (回退)
  snail_definition 表  ──>  SnailRegistry.get()  ──>  SnailDefinition (prompt 构建等)
```

### Role-Snail 分配流程

1. 创建 Stage 时，从硬编码的 `STAGE_DEFINITIONS[type].roles` 读取 Role 列表
2. 每个 Role 的 `assigned_snails` 直接给出 SnailName 列表（显式关联）
3. 将 Role → Snail 映射写入 `stage.role_assignments`
4. 创建 Conversation 时，指定 `roleId`，从 `stage.role_assignments` 解析 `default_snail`

## 生效路径

- 配置：`config/snail-den.json`（Snail 定义 + Template 定义）
- 数据库：`snail_definition` 表（启动时 seed）
- 代码：`src/snail-den/index.ts`（Snail Den，seed snail 定义到数据库）
- 代码：`src/snails/registry.ts`（SnailRegistry，从数据库读取 snail 定义）
- 代码：`src/project-workflow/stage-definitions.ts`（Stage 类型定义，硬编码）
- 代码：`src/project-workflow/workflow.ts`（workflow 状态机，Role 分配）
- 代码：`src/project-workflow/manager.ts`（项目管理器）
- 代码：`src/shared/domain-types.ts`（领域类型定义）
- 代码：`src/persistence/schema.ts`（数据库 schema）
- 代码：`src/persistence/store.ts`（数据库 CRUD）
- 代码：`src/main.ts`（服务启动入口，初始化顺序）
- 代码：`scripts/generate-types.ts`（类型生成，从 Snail Den config 读取 snail 名称）

## 改动范围

### 新增文件

- `src/project-workflow/stage-definitions.ts`：硬编码 Stage 类型定义（StageType、StageDefinition）
- `src/persistence/snail-definition-model.ts`：snail_definition 表 CRUD

### 修改文件

- `config/snail-den.example.json`：扩展示例，包含 snail 定义
- `src/snail-den/index.ts`：启动时 seed snail 定义到数据库
- `src/snails/registry.ts`：从读 JSON 文件改为读数据库
- `src/meta/index.ts`：移除 `loadStageDefinitions()`，保留 `StageDefinition` 接口
- `src/persistence/schema.ts`：新增 `snail_definition` 表，stage 表添加 `role_assignments` 列，conversation 表添加 `role_id` 列
- `src/persistence/store.ts`：适配新数据源
- `src/project-workflow/workflow.ts`：从硬编码定义读取 Role，显式 SnailName 关联
- `src/project-workflow/manager.ts`：适配新数据源
- `src/interaction-entry/api/server.ts`：`GET /api/meta/stages` 适配
- `scripts/generate-types.ts`：从 Snail Den config 读取 snail 名称，从硬编码模块读取 stage 类型
- `src/main.ts`：调整初始化顺序（Snail Den seed → SnailRegistry → ProjectManager）

### 删除文件

- `.meta/stages.json`
- `.meta/snails.json`

### 类型定义

- `src/shared/domain-types.ts`：
  - `StageRole` 接口：roleId、name、description、assigned_snails、preferred_artifact_types、working_rules
  - `RoleAssignment` 接口：role_id、assigned_snails
  - `Stage` 接口扩展：role_assignments 字段
  - `Conversation` 接口扩展：role_id 字段

## 验证

- 构建通过（npm run build）
- 测试通过（npm test）
- snail_definition 表正确创建和 seed
- Stage 创建时 role_assignments 从硬编码定义正确初始化
- Conversation 创建时 role_id 和 default_snail 正确关联
- SnailRegistry 从数据库正确读取 snail 定义
- `.meta/stages.json` 和 `.meta/snails.json` 不存在

## 风险与决策记录

### 决策 1：Snail 定义归 Snail Den 管理

Snail Den 从纯 template 管理扩展为 snail 完整定义管理（身份 + 运行时）。`config/snail-den.json` 包含 snail 的身份定义（description、capabilities、working_rules）和运行时定义（templates）。这是用户-local 配置文件（gitignored），启动时 seed 到数据库。

### 决策 2：Stage 定义硬编码在项目管理模块

Stage 类型定义（development、review 的 roles、formal_artifact_types、acceptance_focus 等）是项目管理领域模型的一部分，硬编码在 `src/project-workflow/stage-definitions.ts` 中。不使用外部 JSON 配置文件。

### 决策 3：Role-Snail 显式关联

Role → Snail 通过 `SnailName` 显式关联（如 `assigned_snails: ["Implementation Snail"]`），不使用中文能力标签匹配。Stage 定义中的 Role 直接列出承担该 Role 的 SnailName 列表。

### 决策 4：数据库是运行时数据的唯一来源

项目管理模块只读数据库，不触及配置文件。Snail 定义在启动时从 Snail Den config seed 到 `snail_definition` 表。Stage 定义硬编码在代码中，不需要数据库存储。

### 决策 5：Boss 不属于 snail

Boss 是用户角色，不参与 agent 运行时的角色分配。Boss 的通知/交互通过 message_dispatch 中的 "Boss Snail" 实现，但这只是消息路由机制，不表示 Boss 是 snail 角色体系的一部分。

### 决策 6：stage_affinity 声明 snail 参与的 stage 类型

每只 snail 通过 `stage_affinity` 声明参与哪些 stage 类型及优先级，替代原 `stages.json` 中的 `snails` 数组。SnailRegistry 从 snail 定义的 stage_affinity 构建 stage → snail 映射。

## 范围变更记录

### 架构重构（2026-05-14）

**变更原因**：Acceptance Snail 检视发现原实现违反"数据来源于数据库"准则和模块边界原则。

**变更内容**：

1. **Snail 定义移入 Snail Den**：`config/snail-den.json` 扩展为包含完整 snail 定义（身份 + 运行时），启动时 seed 到 `snail_definition` 表。
2. **Stage 定义硬编码**：创建 `src/project-workflow/stage-definitions.ts`，替代 `.meta/stages.json`。
3. **删除 `.meta/stages.json` 和 `.meta/snails.json`**：项目管理模块不再触及这些文件。
4. **Role-Snail 显式关联**：移除 `findMatchingSnails()` 能力匹配逻辑，Role 通过 `assigned_snails: SnailName[]` 直接引用 snail。
5. **保留已有修复**：`role_assignments`/`role_id` 列迁移、`resolveDefaultSnailForRole()` 逻辑保留。

### 职责边界清理（2026-05-15）

**变更原因**：用户澄清 snail 定义应只包含身份和能力信息，`working_rules`、`preferred_artifact_types` 等 role 级职责不应归入 snail 定义。项目管理模块必须对接数据库，不触及配置文件。

**变更内容**：

1. **snail_definition 表精简**：移除 `working_rules`、`preferred_artifact_types`、`stage_affinity` 列，snail 定义只保留身份 + 能力。
2. **SnailRegistry 精简**：移除 `listByStageType()`、`getPrimaryForStageType()` 和 `buildStageSnailMapping()`，SnailRegistry 不再承担 stage → snail 映射职责。
3. **stage → snail 映射移到 workflow.ts**：新增 `getSnailsForStageType()` 和 `getDefaultSnailForStageType()`，直接从硬编码的 `STAGE_DEFINITIONS` 读取。
4. **prompt-center 读取 role 级配置**：`working_rules` 和 `preferred_artifact_types` 从当前 conversation 关联的 stage role 读取，不再从 snail 定义读取。
5. **UI 层展示 role**：`stage-contract-view.js` 改为展示 role 卡片（含 assigned_snails、working_rules、preferred_artifact_types）。
6. **Snail Den 配置精简**：snail 定义移除 `working_rules`、`preferred_artifact_types`、`stage_affinity` 字段。
7. **workflow 依赖精简**：`createInitialWorkflow` 等函数不再需要 `snailRegistry` 参数。
