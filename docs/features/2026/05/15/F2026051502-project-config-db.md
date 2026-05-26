---
id: F2026051502
title: 项目配置数据收束到数据库
from_ids: []
tags: [config, schema]
modules: [project_management]
---
# F2026051502 项目配置数据收束到数据库

## 背景

项目管理模块的数据来源分散：stage 定义、artifact 定义、snail 配置等通过 `.meta` 目录下的 JSON 文件加载，项目运行时数据（project/feature/stage/conversation/message）存储在 SQLite 中。这种分离导致：

- stage 定义和 artifact 定义无法按项目独立配置，所有项目共享同一套全局定义。
- `.meta/stages.json` 中的 stage 类型是硬编码的 union type，新增 stage 类型需要改代码。
- artifact 表和 formal_artifacts 机制引入了不必要的复杂度，实际使用中 stage 的输入/输出更偏向描述性字段而非结构化产物管理。
- SnailRegistry 在构造时直接读取 `.meta/stages.json`，形成运行时循环依赖。

## 目标

将项目配置数据收束到 SQLite 数据库，分为两大模块：

1. **项目配置**：项目定义、stage 定义（含角色定义）按项目独立存储在 DB 中，支持通过种子文件初始化系统内置项目。
2. **项目运行**：现有的 project/feature/stage/conversation/message 运行时数据保持在 DB 中，schema 做相应调整。

具体目标：

- 移除全局 `STAGE_DEFINITIONS`、`STAGE_TYPES`、`STAGE_FORMAL_ARTIFACT_TYPES` 常量。
- 移除 artifact 表和相关 CRUD 方法（`createArtifact`、`setStageFormalArtifacts` 等）。
- stage 表改用 `stage_definition_id` 关联项目级 stage 定义，`type` 字段保留为 stage key 的冗余存储。
- stage 的输入/输出改为 `input_artifacts`（string[]）和 `output_artifacts`（string[]）描述性字段。
- `.meta/project-config-seed.json` 作为系统内置项目的种子文件，启动时加载到 DB。
- SnailRegistry 通过 `loadStageRoleBindings()` 注入 DB 中的角色绑定，不再直接读取 `.meta/stages.json`。
- `StageType` 从 union literal 改为 `string`，支持动态 stage 类型。
- prompt 匹配上下文移除 `repoRelated` 字段。

## 非目标

- 不引入模板复用机制——每个项目独立配置，不共享。
- 不改变消息内容块类型（`MessageArtifactCardBlock` 保留，它是消息展示格式，与 artifact 表无关）。
- 不改变知识治理模块的 `KnowledgeGovernanceArtifactType`（它是治理裁决去向类型，与项目 artifact 系统无关）。

## 设计

### 新增表

**`project_stage_definition`**：项目级 stage 定义。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 唯一标识 |
| project_id | TEXT FK | 所属项目 |
| key | TEXT | stage 标识符（如 development、review） |
| title | TEXT | 显示名称 |
| sequence | INTEGER | 排序序号 |
| input_description | TEXT | 输入要求描述 |
| output_description | TEXT | 产出要求描述 |
| acceptance_focus | TEXT | 验收要点，JSON 字符串数组 |

**`stage_role_definition`**：stage 内角色定义。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 唯一标识 |
| project_id | TEXT FK | 所属项目 |
| stage_definition_id | TEXT FK | 所属 stage 定义 |
| snail_id | TEXT | 引用的 snail 标识 |
| is_primary | INTEGER | 是否为该 stage 的主角色 |
| working_rules | TEXT | 工作规则，JSON 字符串数组 |

### 修改表

**`stage`** 表变更：
- 新增 `stage_definition_id`（TEXT FK → project_stage_definition）
- 新增 `input_artifacts`（TEXT，JSON 字符串数组）
- 新增 `output_artifacts`（TEXT，JSON 字符串数组）
- 移除 `formal_artifacts`
- 移除 `created_at`、`updated_at`

### 移除表

**`artifact`** 表完全移除。stage 的输入/输出改为描述性字段。

### 种子加载

`.meta/project-config-seed.json` 包含系统内置项目（snail-shell）的完整配置：
- 项目定义（id: snail-shell, kind: system_self）
- 2 个 stage 定义（development、review）
- 3 个角色定义（Implementation Snail × 2、Acceptance Snail × 1）

启动时通过 `store.seedProjectConfig()` 加载，已存在则跳过。

### SnailRegistry 改造

- 移除 `loadStageSnails()`（从 `.meta/stages.json` 读取）
- 新增 `loadStageRoleBindings(bindings)` 方法，接收 DB 中的角色绑定数据
- 启动时由 `main.ts` 读取 DB 角色定义并注入

### 创建项目流程

`createProject()` 新增可选参数 `stageDefinitions`，传入时自动：
1. 创建项目
2. 调用 `seedStageDefinitionsForProject()` 写入 stage 定义和角色定义
3. 从 DB 读取角色绑定并注入 SnailRegistry
4. 创建初始 feature 和 stage

### Web UI 改造

- 移除 artifact 相关的 UI 元素（创建 artifact 表单、设为正式交付按钮）
- stage 标题改为从 `stage.stage_definition.title` 获取
- stage 合约视图改为读取 `stage_definition` 和 `role_definitions`
- 移除 `/meta/stages` 和 `/meta/artifacts` API 调用

## 生效路径

1. DB schema 变更：新增 `project_stage_definition` 和 `stage_role_definition` 表，修改 `stage` 表，移除 `artifact` 表。
2. 种子文件：`.meta/project-config-seed.json` 定义系统内置项目配置。
3. 启动流程：`main.ts` 加载种子 → 注入角色绑定 → 创建系统项目。
4. 代码改造：移除 artifact 相关代码，更新所有消费方。
5. Web UI：移除 artifact 面板，更新 stage 显示逻辑。
