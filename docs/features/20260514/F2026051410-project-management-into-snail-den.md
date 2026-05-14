# F2026051410 项目管理接入 Snail Den

## 背景

Snail Shell 的项目管理相关配置（stage 定义、snail 角色定义、artifact 定义）目前分散在 `.meta/` 目录下的多个 JSON 文件中，与 Snail Den（runtime/template 管理）是独立的模块。这导致：

1. 配置时（定义项目结构、角色、能力预期）和运行时（project/feature/stage/conversation 执行数据）边界不清晰
2. Snail 的定义（角色、能力、工作规则）和 Snail 的运行时（runtime、model）分散在不同位置
3. 新增或调整项目管理配置需要同时修改多个文件，缺乏统一入口

需要将项目管理配置接入 Snail Den，使其成为 snail 和项目管理配置的统一管理层。

## 目标

- Snail Den 成为 snail 定义和项目管理配置的统一入口，对外只暴露 snail 概念
- 明确区分配置时和运行时：
  - **配置时**：定义项目背景、目标、阶段（StageType）、阶段产物（ArtifactType）、阶段内职责角色（Role）及能力预期
  - **运行时**：承载 project、feature、stage、conversation 等执行数据
- Role 定义归属 StageType，即每个 StageType 定义该阶段需要哪些 Role
- Boss（用户）不属于 snail，不参与 snail 角色分配
- 同一 Stage 中同一 Role 可由多只 Snail 承担（如多个 Implementation Snail 并行）
- conversation 等运行数据先关联阶段内 role，再通过 role 绑定或选择具体 snail

## 非目标

- 不改变现有的 workflow 状态机逻辑（create/advance/restart），只在创建 Stage 时增加 Role 匹配步骤
- 不改变 message dispatch 和 runtime session 机制
- 不涉及 UI 层的项目管理配置界面（后续 feature 处理）

## 设计

### 配置时模型

#### 配置文件结构

将 `.meta/` 下的配置整合到 Snail Den 管理：

```
config/
  snail-den.json           # 现有：snail template 定义（runtime、model、contextWindow）
  snail-den.example.json   # 现有：配置示例

.meta/
  stages.json              # 现有：StageType 定义（保留，但调整结构）
  artifacts.json           # 现有：ArtifactType 定义（保留）
  snails.json              # 现有：Snail 角色定义（保留，但明确其归属）
```

#### StageType 定义（配置时）

每个 StageType 定义：
- `type`: StageType 标识（如 "development"、"review"）
- `order`: 阶段顺序
- `roles`: 该阶段需要的 Role 列表
  - `roleId`: Role 唯一标识
  - `name`: Role 名称（如 "研发者"、"检视者"）
  - `description`: Role 职责描述
  - `requiredCapabilities`: 该 Role 需要的能力标签
  - `preferredArtifacts`: 该 Role 偏好的产物类型
  - `workingRules`: 该 Role 的工作规则
- `formalArtifacts`: 该阶段必须产出的正式产物类型
- `acceptanceCriteria`: 阶段完成条件

#### Snail 角色定义（配置时）

`.meta/snails.json` 中的 Snail 定义保持不变，但明确：
- 每个 Snail 是一个可承担 Role 的 agent 实体
- Snail 具备的能力标签（capabilities）决定它可以承担哪些 Role
- Snail 的 runtime、model 由 Snail Den 的 template 管理

#### 绑定关系（配置时）

StageType 的 Role 与 Snail 的关系是**能力匹配**，而非硬编码绑定：
- Role 定义所需能力（requiredCapabilities）
- Snail 声明具备能力（capabilities）
- 运行时根据能力匹配为 Role 分配具体 Snail

### 运行时模型

#### Stage 运行数据

Stage 运行实例记录：
- `id`: Stage 实例 ID
- `type`: StageType（关联配置时定义）
- `feature_id`: 所属 Feature
- `status`: 运行状态（in_progress / completed / cancelled）
- `role_assignments`: Role → Snail 分配记录
  - `roleId`: 配置时定义的 Role ID
  - `assigned_snails`: 已分配的 Snail 名称列表（支持多只 Snail 承担同一 Role）

#### Conversation 运行数据

Conversation 运行实例记录：
- `stage_id`: 所属 Stage
- `role_id`: 关联的 Stage 内 Role（conversation 先关联 role，再通过 role 绑定 snail）
- `default_snail`: 默认处理 Snail
- `participating_snails`: 参与 Snail 列表
- `runtime_sessions`: Snail → RuntimeSession 绑定

### 模块职责划分

```
Snail Den (src/snail-den/)
  ├── SnailTemplate 管理（runtime、model、contextWindow）
  └── SystemAI（摘要生成、mention 提取）

Meta Loader (src/meta/)
  ├── StageType 定义加载（stages.json）
  ├── ArtifactType 定义加载（artifacts.json）
  └── Snail 角色定义加载（snails.json）

Project Workflow (src/project-workflow/)
  ├── Workflow 状态机（create/advance/restart）
  ├── Role-Snail 分配逻辑
  └── Conversation 创建与管理
```

### Role-Snail 分配流程

1. 创建 Stage 时，根据 StageType 获取所需 Role 列表
2. 对每个 Role，根据 requiredCapabilities 匹配具备能力的 Snail
3. 支持同一 Role 分配多只 Snail（如并行开发场景）
4. 创建 Conversation 时，指定关联的 roleId，系统根据分配关系选择默认 Snail

## 生效路径

- 配置：`.meta/stages.json`（StageType 定义，包含 Role）
- 配置：`.meta/snails.json`（Snail 角色定义，包含能力标签）
- 配置：`.meta/artifacts.json`（ArtifactType 定义）
- 配置：`config/snail-den.json`（Snail Template 定义，runtime/model）
- 代码：`src/meta/index.ts`（配置加载函数）
- 代码：`src/shared/domain-types.ts`（领域类型定义）
- 代码：`src/project-workflow/workflow.ts`（workflow 状态机，集成 Role 分配）
- 代码：`src/project-workflow/manager.ts`（项目管理器，协调 Role-Snail 匹配）
- 代码：`src/main.ts`（服务启动入口，各组件初始化日志）
- 代码：`src/persistence/store.ts`（数据库初始化，schema 创建和迁移日志）
- 代码：`src/snail-den/index.ts`（Snail Den 模板加载日志）

## 改动范围

### 启动日志增强

服务启动流程中的每个关键步骤都需要打印清晰的启动日志，包括：
- 数据库目录创建、数据库打开、pragma 设置
- Schema 初始化（表数量、索引数量）
- 每个迁移步骤（新增列时打印）
- LLM 配置加载
- Agent 初始化（每个 agent 注册）
- Snail Registry 创建（snail 数量和名称）
- Snail Den 模板加载
- Self-project 种子数据
- Startup recovery 结果
- HTTP server 和 Feishu channel 启动

### 配置文件

- `.meta/stages.json`：调整结构，为每个 StageType 添加 roles 定义
- `.meta/snails.json`：明确 capabilities 语义，用于 Role 匹配

### 类型定义

- `src/shared/domain-types.ts`：
  - 新增 `StageRole` 接口（roleId、name、description、requiredCapabilities、preferredArtifacts、workingRules）
  - 扩展 `StageTypeDefinition` 接口，添加 roles 字段
  - 新增 `RoleAssignment` 接口（roleId、assigned_snails）
  - 扩展 `Stage` 接口，添加 role_assignments 字段
  - 扩展 `Conversation` 接口，添加 role_id 字段

### 配置加载

- `src/meta/index.ts`：更新 `loadStageDefinitions()` 返回包含 roles 的 StageType 定义
- `src/meta/generated-types.ts`：重新生成类型（StageType、Role 相关类型）

### 工作流

- `src/project-workflow/workflow.ts`：
  - `createInitialWorkflow()` / `createFeatureWorkflow()`：创建 Stage 时初始化 role_assignments
  - Role-Snail 匹配逻辑
- `src/project-workflow/manager.ts`：
  - 扩展 Conversation 创建逻辑，支持 role_id 关联
  - 添加 Role 分配查询接口

### 持久化

- `src/persistence/schema.ts`：stage 表添加 role_assignments 列，conversation 表添加 role_id 列
- `src/persistence/store.ts`：添加 role_assignments 和 role_id 相关 CRUD 操作

## 验证

- 构建通过（npm run build）
- Lint 通过（npm run lint）
- 测试通过（npm run test）
- 配置加载：`.meta/stages.json` 中的 roles 定义正确加载
- Role 匹配：根据 capabilities 正确匹配 Role 和 Snail
- Stage 创建：role_assignments 正确初始化
- Conversation 创建：正确关联 role_id

## 风险与决策记录

### 决策 1：Role 定义归属 StageType

Role 是阶段内的职责定义，不同 StageType 的 Role 可能完全不同（如 development 阶段的"研发者"和 review 阶段的"检视者"）。因此 Role 定义放在 StageType 配置中，而非独立配置文件。

### 决策 2：Boss 不属于 snail

Boss 是用户角色，不参与 agent 运行时的角色分配。Boss 的通知/交互通过 message_dispatch 中的 "Boss Snail" 实现，但这只是消息路由机制，不表示 Boss 是 snail 角色体系的一部分。

### 决策 3：运行时 role_assignments 存储

Stage 的 role_assignments 需要持久化，以支持：
- 查询当前 Stage 的 Role-Snail 分配状态
- 新增 Snail 承担已有 Role（并行场景）
- Conversation 创建时确定默认 Snail

初步方案：在 stage 表中添加 `role_assignments` JSON 字段，存储 `{roleId: string, assignedSnails: SnailName[]}[]`。

### 决策 4：Role ID 命名规范

Role ID 使用 kebab-case 英文标识（如 "developer"、"reviewer"、"product-owner"），与 StageType 和 ArtifactType 的命名风格保持一致。

### 决策 5：Role-Snail 分配机制

采用"系统自动匹配 + 用户可覆盖"模式：
- 系统根据 Snail 的 capabilities 与 Role 的 requiredCapabilities 自动匹配，作为默认分配
- 用户在创建 Conversation 时可以手动指定 Snail，覆盖系统默认匹配
- 同一 Role 可分配多只 Snail，支持并行场景

## 范围变更记录

### 检视修复（2026-05-14）

**变更原因**：Acceptance Snail 首轮检视发现两个问题。

**变更内容**：

1. **补充 `stage.role_assignments` 和 `conversation.role_id` 列迁移**：`src/persistence/migrations.ts` 新增 `ensureStageRoleAssignmentsColumn` 和 `ensureConversationRoleIdColumn`，在 `initSchema()` 中调用，确保既有数据库启动后自动补列。
2. **默认 stage conversation 写入 `roleId`**：`createDefaultStageConversation()` 现在从 `stage.role_assignments[0]` 取 `role_id` 写入 conversation，使主工作流路径的 role 关联生效。

**影响范围**：`src/persistence/migrations.ts`、`src/persistence/store.ts`、`src/project-workflow/workflow.ts`
