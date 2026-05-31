---
id: F2026053102
title: workspace-snail-directory
from_ids: []
tags: []
modules: [workspace-management, persistence]
doc_kind: spec
---

# F2026053102 [workspace-management] Workspace 元数据目录 + 加载机制

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

当前 Snail Shell 的 workspace 配置（SOP、role、stage 等）存储在数据库中，通过 `.meta/workspace-config-seed.json` 初始化。这种机制存在以下问题：

1. **不可共享**：数据库是本地的，无法通过 git 与团队成员共享 workspace 配置
2. **真相源模糊**：初始化后，数据库和 seed.json 可能产生分歧，不确定哪个是真相
3. **不直观**：用户无法直接在文件系统中查看和编辑 workspace 配置

用户期望的机制类似于 Claude 的 `.claude` 目录：每个 workspace 有一个 `.snail` 目录，存放项目级配置，通过 git 共享，打开 workspace 目录时自动加载。

## 目标

实现 workspace 元数据目录机制，使 `.snail` 目录成为 workspace 配置的唯一真相源：

### P1 — `.snail` 目录结构与加载

1. 定义 `.snail` 目录结构，包含 SOP、skill、workspace 元数据等配置
2. 实现从 `.snail` 目录读取配置的解析器
3. 实现将配置加载到数据库的机制（数据库作为运行时缓存）
4. 加载时全量覆盖数据库缓存

### P2 — Workspace 创建与切换

1. 在界面上支持选择目录作为 workspace
2. 选择目录后自动检测并加载 `.snail` 目录
3. 支持在界面上创建新的 workspace（含 `.snail` 目录初始化）

## 非目标

1. **不迁移全局配置**：Snail Den template、全局 SOP 等平台级配置不放入 `.snail`
2. **不共享 feature 实例**：feature、stage、conversation 等运行时数据是本地化的，不通过 `.snail` 共享
3. **不自动同步**：不实现 `.snail` 目录变更的实时监听或自动重载，用户需手动刷新
4. **不保留数据库独立数据**：数据库完全从 `.snail` 加载，不保留任何数据库独有的配置

## 设计

### P1 详设

#### `.snail` 目录结构

```
.snail/
  workspace.json              # workspace 元数据（name、summary 等）
  sop/
    code-delivery.json        # SOP 定义文件
    research-workflow.json
  skill/
    literature-review/        # workspace 级 skill
      manifest.json
      scripts/
    data-analysis/
      manifest.json
      scripts/
```

#### `workspace.json` 格式

```json
{
  "name": "Research Workspace",
  "summary": "论文研究和学习工作空间",
  "default_sop_key": "research-workflow"
}
```

#### SOP JSON 格式

每个 SOP 一个文件，格式与现有 `workspace-config-seed.json` 中的 SOP 定义一致：

```json
{
  "key": "research-workflow",
  "name": "研究工作流",
  "description": "论文研究的标准流程",
  "role_definitions": [
    {
      "key": "researcher",
      "name": "研究者",
      "description": "负责文献调研、实验设计和论文撰写",
      "working_rules": ["先做文献综述再设计方案", "实验数据必须可复现"]
    }
  ],
  "stage_definitions": [
    {
      "key": "literature-review",
      "title": "文献综述",
      "sequence": 1,
      "input_description": "研究主题和关键词",
      "output_description": "文献综述报告",
      "acceptance_focus": ["覆盖核心文献", "识别研究空白"],
      "roles": [
        { "role_key": "researcher", "is_primary": true }
      ]
    }
  ]
}
```

#### 加载流程

```
用户选择目录 → 检测 .snail/ → 解析 workspace.json → 解析 sop/*.json → 解析 skill/ → 全量写入数据库
```

1. **检测**：检查目录下是否存在 `.snail/` 目录
2. **解析**：读取并验证所有配置文件
3. **加载**：
   - 删除数据库中该 workspace 的旧配置（workspace_sop、sop、role_definition、stage_definition）
   - 插入新配置
   - 更新 workspace 表的元数据

#### 数据库角色重新定位

数据库表的职责变化：
- `workspace`：存储 workspace 基本信息 + workspace_root（从 `.snail` 加载）
- `sop`、`role_definition`、`stage_definition`：纯缓存，从 `.snail` 加载
- `workspace_sop`：纯缓存，从 `.snail` 加载
- `feature`、`stage`、`conversation`、`message`：本地运行时数据，不共享

### P2 详设

#### Workspace 创建流程

1. 用户在界面上输入目录路径或选择目录
2. 如果目录下不存在 `.snail/`，提示用户是否初始化
3. 初始化时创建 `.snail/workspace.json` 和默认 SOP
4. 加载配置到数据库

#### Workspace 切换流程

1. 用户在界面上选择已有的 workspace
2. 系统重新从 `.snail` 目录加载配置（全量覆盖数据库缓存）
3. 刷新界面显示

## 生效路径

1. **代码**：`src/workspace-workflow/` 中的加载逻辑
2. **代码**：`src/persistence/` 中的数据库操作
3. **配置**：`.snail/` 目录结构和文件格式
4. **测试**：加载逻辑的单元测试

<!-- [design-time] 章节结束 -->

## 改动范围

1. `src/workspace-workflow/snail-loader.ts`（新增）：`.snail` 目录解析和加载逻辑
2. `src/workspace-workflow/manager.ts`：添加 `loadWorkspaceFromSnail` 和 `hasSnailConfig` 方法
3. `src/workspace-workflow/index.ts`：导出 snail-loader 模块
4. `src/persistence/workspace-config-model.ts`：导出 `replaceWorkspaceConfigs` 函数
5. `src/persistence/workspace-config-replace.ts`（新增）：全量替换配置的实现
6. `src/persistence/store.ts`：添加 `replaceWorkspaceConfigs` 方法
7. `src/interaction-entry/api/server.ts`：添加 `/workspaces/:workspaceId/load-snail` API 端点
8. `src/web/workspace-tree-view.js`：添加"刷新配置"按钮
9. `src/web/app.js`：添加 `reloadSnailConfig` 处理函数
10. `docs/features/2026/05/31/F2026053102-workspace-snail-directory.md`：Feature 文档

## 验证

### P1

- [x] `.snail/workspace.json` 正确解析
- [x] `.snail/sop/*.json` 正确解析
- [x] 加载后数据库内容与 `.snail` 一致
- [x] 重复加载时数据库被全量替换
- [x] `.snail` 目录不存在时给出明确错误

### P2

- [x] 界面上可以选择目录作为 workspace
- [x] 点击"刷新配置"按钮后自动加载 `.snail` 配置
- [x] 创建新 workspace 时生成默认 `.snail` 结构

### 通用

- [x] 现有功能不受影响（feature 创建、stage 推进等）
- [x] TypeScript 编译通过
- [x] 所有测试通过

## 关联

- **前置**: F2026053003（project 全量重命名为 workspace）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | 数据库 schema 是否需要变更 | 不需要，现有表结构可复用，只是数据来源变化 | 2026-05-31 |
| 2 | 如何处理 `.snail` 中的 SOP 删除 | 全量覆盖：删除数据库中不在 `.snail` 中的 SOP | 2026-05-31 |
