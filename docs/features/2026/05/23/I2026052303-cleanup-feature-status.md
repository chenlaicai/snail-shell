---
id: I2026052303
title: 移除 FeatureStatus 死代码：进度由 stage 流转表达
from_ids: []
tags: [refactor]
modules: [project_management]
---
# I2026052303 移除 FeatureStatus 死代码：进度由 stage 流转表达

## 背景

`FeatureStatus`（`active / in_review / waiting_merge / completed / cancelled / archived`）在当前系统中是冗余的双写字段——Feature 进度完全由 stage 的 `status` 和 `sequence` 表达，`feature.status` 不被任何调度逻辑消费。

保留这个字段导致：
- 每次 stage 流转时需要同步更新 `feature.status`，增加状态不一致风险
- 类型定义中包含不被消费的枚举，产生虚假的契约暗示
- 写保护判断依赖 `feature.status` 而非 `feature.closed_at`，语义不精确

### 任务锚

#### 本质目标

移除所有 runtime 对 `FeatureStatus` 的读写路径，让 Feature 进度完全由 stage 流转表达，用 `closed_at` 替代 `status` 做写保护判断。

#### 反目标

- 不得添加 migration 脚本——用户自行处理实际数据库升级
- 不得改变 stage 流转的业务逻辑
- 不得影响 Feature 列表、只读状态、重启判断等前端行为的正确性

#### 语义不变量

- Feature 是否 closed 由 `closed_at` 字段判断
- Feature 进度由 stage 的 `status`/`sequence` 表达
- 写保护仅依赖 `closed_at !== null`

#### 成功标准

- `FeatureStatus` 类型定义及其 import/export 全部移除
- `feature.status` 列从建表语句中彻底移除，索引重建为 `closed_at`
- 所有创建/更新 feature 的 SQL 不再含 `status` 列
- 5 个自包含 skill 脚本内嵌 schema 同步移除列和 migration 代码
- `assertFeatureWritable` 改用 `closed_at` 判断
- 所有前端 `feature.status` 判断改为 `feature.closed_at` 判断
- 测试不再用 `status` 字段构造 feature
- 全部现有测试通过

## 目标

- 移除 `FeatureStatus` 类型、`Feature.status` 字段、相关 import/export
- 建表语句中彻底删除 `feature.status` 列，索引重建为 `closed_at`
- 持久层：`createFeature` INSERT 不再含 `status` 列
- 5 个自包含 skill 脚本同步移除内嵌 schema 中的 `feature.status` 列和 migration 代码
- 工作流层：`advanceFeature`/`restartFeature` 不再写 status；`completeFeature`/`archiveFeature` 仅设 `closed_at`
- 写保护：`assertFeatureWritable` 改用 `feature.closed_at !== null`
- seed：`self-project-seed` 改用 stage 状态查活跃 feature
- 提示词：移除 `feature_status` 上下文变量
- 前端：所有 `feature.status` 判断改为 `feature.closed_at` 判断

## 非目标

- 创建 migration 脚本（用户自行处理实际数据库升级）
- 改变 Feature 流转语义
- 修改 stage 模型

## 改动范围

27 个文件，新增 193 行，删除 165 行（含 1 个新增 Feature 文档 108 行、5 个 skill 脚本同步 +23/-98，净代码删除 80 行）。

### 类型层
- `src/shared/types.ts`：删除 `FeatureStatus` 类型定义
- `src/shared/domain-types.ts`：移除 `Feature.status` 字段
- `src/shared/index.ts`：移除 `FeatureStatus` export

### 持久层
- `src/persistence/schema.ts`：`feature` 表删除 `status TEXT NOT NULL` 列定义，索引 `idx_feature_project_status` 重建为 `idx_feature_project_closed(project_id, closed_at, updated_at)`
- `src/persistence/types.ts`：移除 `StoredFeature.status`
- `src/persistence/store.ts`：`createFeature` INSERT 不再含 `status` 列和占位值
- `src/persistence/knowledge-model.ts`：`createGovernanceShell` feature INSERT 不再含 `status` 列和占位值

### Skill 脚本（自包含 schema 同步）
- 全部 5 个 skill 脚本的内嵌 `SCHEMA_SQL` 同步移除 `feature.status` 列和索引，清理 INSERT/UPDATE 语句中的 `status` 列和参数
- `record-feature-repo-context`、`set-task-anchor`：JS 级 `feature.status === "archived"` 改为 `feature.closed_at` 判断

### 工作流层
- `src/project-workflow/manager.ts`：`advanceFeature`/`completeFeature`/`archiveFeature` 不再写 status；写保护改用 `closed_at`
- `src/project-workflow/workflow.ts`：`assertFeatureWritable` 改用 `feature.closed_at !== null`
- `src/project-workflow/self-project-seed.ts`：查活跃 feature 改用 stage 状态

### 提示词
- `src/prompt-center/builder.ts`：移除 `feature_status` 上下文变量

### 前端
- `src/web/app.js`：`canRestartFeature` 改用 `closed_at`
- `src/web/feature-list-view.js`：列表项 closed 判断改用 `closed_at`
- `src/web/feature-readonly-state.js`：只读判断改用 `closed_at`
- `src/web/feature-workflow-state.js`：`canRestartFeatureDevelopment` 改用 `closed_at`
- `src/web/workspace-context.js`：活跃 feature 查找改用 stage 状态

### 测试
- `tests/project/stage-cycle-test.ts`：改用 `closed_at` 断言，匹配更新后的错误消息
- `tests/scripts/seed-self-project-test.ts`：移除 status 相关断言
- `tests/web/feature-list-view-test.ts`：改用 `closed_at`
- `tests/web/feature-workflow-state-test.ts`：改用 `closed_at` 表达测试场景，补充 closed feature 拒绝断言

## 不兼容更新

**有**：`feature.status` 列已从建表语句中完全移除。旧数据库升级时需由运维侧执行 `ALTER TABLE feature DROP COLUMN status`。所有代码路径不再读写该列。

## 验证

全部测试通过。人工验证范围：
- Feature 创建/流转/完成/归档流程
- Feature 列表渲染和只读状态
- 知识治理 feature shell 创建
