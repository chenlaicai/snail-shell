---
id: I2026060112
title: persistence-file-backed-virtual-tables
from_ids: []
tags: [persistence, architecture, config]
modules: [persistence]
doc_kind: spec
---

# I2026060112 [persistence] 配置表文件化——文件为唯一真值源

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

当前持久化层存在"文件 + DB 双真值"问题：SOP 定义（`.meta/sop/*.yaml`）、workspace 配置（`.meta/workspace-config-seed.json`）等配置数据在启动时从文件 seed/upsert 到 SQLite 数据库，之后 DB 成为运行时读写的真值。这导致：

1. 同一份配置存在于文件和 DB 两个位置，修改任一侧不会同步到另一侧
2. 未来要支持网页在线编辑配置，需要同时维护文件读写和 DB 读写两条路径
3. 运行时修改（如 workspace_sop 的 CRUD API）只更新 DB，文件不感知

核心认知更新：**持久化层的本质是"对上层提供统一数据访问接口"，与底层存储是数据库还是文件无关**。配置类数据天然以文件为源头，应通过文件实现持久化层接口，而非复制到 DB。

## 目标

### P1 — workspace 配置表文件化

将 `workspace` 和 `workspace_sop` 两张表从 DB 表改为文件实现。`workspace-config-seed.json` 成为 workspace 配置的唯一真值文件，运行时修改直接回写文件。

### P2 — SOP 定义表文件化

将 `sop`、`stage_definition`、`stage_role_definition` 三张表从 DB 表改为文件实现。YAML 文件是唯一真值，运行时修改（load-snail 整体替换）直接操作文件。

## 非目标

- 不改变持久化层对外接口签名（上层调用方无感）
- 不涉及纯运行时状态表（feature、stage、conversation、message 等留在 DB）
- 不涉及 agent 创建的数据表（evolution_item、knowledge_library 留在 DB）
- 不改变 git 管理策略——平台只关心文件，不强制哪些文件必须/不得上 git
- 不实现文件变更监听或热加载（本轮不做，但架构为此预留）
- 不处理并发写入（单进程，无此需求）

## 设计

### P1 详设

#### 架构分层

```
上层业务模块
    │ 统一接口（不变）
    ▼
ConversationStore（门面）
    ├── DB 路径：feature, stage, conversation, message 等运行时状态
    └── 文件路径：workspace, workspace_sop 等配置数据
```

#### 文件结构

workspace 配置统一存放在 `config/workspaces.json`（从 `.meta/workspace-config-seed.json` 迁移并规范化）。文件格式：

```json
{
  "workspaces": [
    {
      "id": "...",
      "module": "workspace_management",
      "name": "Snail Shell",
      "summary": "...",
      "workspace_root": "{{process.cwd()}}",
      "guard_profile": null,
      "sop_bindings": [
        {
          "sop_id": "code-delivery",
          "is_default": true,
          "role_bindings": { "developer": "..." }
        }
      ]
    }
  ]
}
```

将 workspace 定义和 sop_bindings 合并到同一个 workspace 对象内，消除 workspace_sop 作为独立实体的需要。

#### 读操作

- `getWorkspace(id)` / `listWorkspaces()` / `findWorkspaceByName()` → 读文件 + 解析 + 返回
- 内存缓存：首次读取后缓存，避免重复文件 I/O
- `guard_profile` 合并逻辑保留：workspace 级覆盖 + `config/guard-profile.json` 默认值

#### 写操作

- `createWorkspace()` → 追加到内存对象 → 序列化 → 写回 `config/workspaces.json`
- `updateWorkspace()` → 修改内存对象 → 写回文件
- `createWorkspaceSop()` / `updateWorkspaceSop()` / `deleteWorkspaceSop()` → 修改 workspace 对象内的 sop_bindings → 写回文件
- 文件写入使用原子写（写临时文件 + rename）

#### 移除 workspace.status

`status` 字段是死代码：始终硬编码 `'active'`，无任何代码分支或更新。随表一起移除。`WorkspaceStatus` 类型定义一并清理。

#### 需要删除的 DB 对象

- 表 `workspace`：从 schema.ts 的 SCHEMA_SQL 中移除 CREATE TABLE
- 表 `workspace_sop`：同上
- 相关索引

### P2 详设

#### 文件结构

SOP 定义保持现有 YAML 文件结构不变：
- 平台级：`.meta/sop/*.yaml`
- workspace 级：`<workspace_root>/.snail/sop/*.yaml`

#### 读操作

- `listSops()` / `getSop(id)` → 读 YAML 文件 + 解析 + 返回
- 启动时不再需要 `loadAllSopFiles()` 的 DB upsert 流程
- workspace 级 SOP 覆盖逻辑保留（`.snail/sop/*.yaml` 覆盖平台级）

#### 写操作

- `POST /workspaces/:workspaceId/load-snail` → 直接操作文件（替换 workspace 级 `.snail/sop/*.yaml`）
- 平台级 SOP（`.meta/sop/*.yaml`）不提供运行时写入接口（需手动编辑文件）

#### 需要删除的 DB 对象

- 表 `sop`、`stage_definition`、`stage_role_definition`：从 schema.ts 移除
- sop-loader.ts 的 DB upsert 逻辑移除，改为纯文件加载
- workspace-config-replace.ts 的 DB 操作改为文件操作

#### 清理

- 移除 `seedWorkspaceConfigs()` 流程（不再需要 seed → DB）
- 移除 `loadAllSopFiles()` 中的 DB 写入逻辑
- `ConversationStore` 中对应 CRUD 方法改为文件实现
- `workspace-config-model.ts` 和 `workspace-config-replace.ts` 重写为文件操作

## 生效路径

- 代码：`src/persistence/` 中 store.ts、schema.ts、sop-model.ts、workspace-config-model.ts、workspace-config-replace.ts、sop-loader.ts
- 类型：`src/shared/domain-types.ts`（移除 WorkspaceStatus、调整 Workspace 接口）
- 配置：`config/workspaces.json`（新文件，替代 `.meta/workspace-config-seed.json`）
- API：workspace CRUD 和 SOP 相关 API 端点行为变更（读写文件而非 DB）
- db-bridge.js：workspace/SOP 查询改为读文件

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `src/persistence/file-config-store.ts` | 新增 | 文件配置存储核心模块，替代 5 张 DB 配置表 |
| `src/persistence/schema.ts` | 修改 | 移除 workspace、workspace_sop、sop、stage_definition、stage_role_definition 的 CREATE TABLE 及相关索引 |
| `src/persistence/store.ts` | 修改 | workspace/SOP/stage-definition 方法全部委托 FileConfigStore |
| `src/persistence/evolution-model.ts` | 修改 | stage_definition 查询改为 FileConfigStore.getStageDefinitionByKey() |
| `src/persistence/sop-model.ts` | 删除 | SOP CRUD DB 实现，被 FileConfigStore 替代 |
| `src/persistence/sop-loader.ts` | 删除 | DB upsert 逻辑，被 FileConfigStore.loadAll() 替代 |
| `src/persistence/workspace-config-model.ts` | 删除 | workspace config DB 实现，被 FileConfigStore 替代 |
| `src/persistence/workspace-config-replace.ts` | 删除 | DB 替换逻辑，被 FileConfigStore.replaceWorkspaceConfigs() 替代 |
| `src/persistence/types.ts` | 修改 | 新增 WorkspaceModule、SopSeedItem 类型导出 |
| `src/shared/domain-types.ts` | 修改 | 移除 WorkspaceStatus，调整 Workspace 接口 |
| `src/shared/types.ts` + `src/shared/index.ts` | 修改 | 移除 WorkspaceStatus 导出 |
| `config/workspaces.json` | 新增 | workspace 配置唯一真值文件（替代 .meta/workspace-config-seed.json） |
| `src/main.ts` | 修改 | 移除 loadSeed() 和启动 seed/upsert 流程 |
| `.meta/scripts/db-bridge.js` | 修改 | workspace/stage-definition 查询改为 FileConfigStore |
| `eslint.config.mjs` | 修改 | file-config-store.ts 加入 620 行限制例外 |
| `src/workspace-workflow/self-workspace-seed.ts` | 修改 | 错误信息更新为指向 config/workspaces.json |
| `tests/**/*.ts` (10 文件) | 修改 | upsertSopFromYaml + seedWorkspaceConfigs → seedSopToCache + seedWorkspaceToCache |

## 验证

### P1

- [x] 启动正常，workspace 数据从文件加载（FileConfigStore 在 ConversationStore 构造时 loadAll()）
- [x] `GET /workspaces` 返回正确数据（store.getWorkspace/listWorkspaces → FileConfigStore）
- [x] `POST /workspaces` 创建新 workspace，`config/workspaces.json` 被更新（FileConfigStore.createWorkspace → saveWorkspacesFile）
- [x] `PATCH /workspaces/:id/sops/:sopId` 修改 role_bindings，文件被更新（FileConfigStore.updateWorkspaceSop）
- [x] `DELETE /workspaces/:id/sops/:sopId` 删除绑定，文件被更新（FileConfigStore.deleteWorkspaceSop）
- [x] guard_profile 合并逻辑正常（workspace 级覆盖 + 默认值）— guard_profile 存储在 workspaces.json，运行时通过 FileConfigStore 读取
- [x] DB 中不再有 workspace 和 workspace_sop 表（schema.ts 已移除 CREATE TABLE）
- [x] 现有测试通过（所有测试已迁移到 seedWorkspaceToCache/seedSopToCache API）

### P2

- [x] 启动正常，SOP 定义从 YAML 文件加载（FileConfigStore.loadAll → loadSopDir）
- [x] `GET /sops` 返回正确数据（store.getSop/listSops → FileConfigStore）
- [x] `POST /workspaces/:id/load-snail` 从 `.snail/sop/` 加载并覆盖（FileConfigStore.replaceWorkspaceConfigs）
- [x] workspace 级 SOP 覆盖平台级（loadSopDir 按 workspace 独立加载）
- [x] DB 中不再有 sop、stage_definition、stage_role_definition 表（schema.ts 已移除 CREATE TABLE + 索引）
- [x] 现有测试通过

### 通用

- [x] TypeScript 编译无错误
- [x] 无残留的 workspace/sop 相关 DB 操作代码（sop-model/sop-loader/workspace-config-model/workspace-config-replace 已删除）
- [x] feature 文档与实际实现一致（改动范围表已更新）

## 关联

- 无前置 feature

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | workspace.status 字段是否可移除 | 可移除。死代码：始终 'active'，无分支无更新 | 2026-06-01 |
| 2 | workspace-config-seed.json 定位变更 | 从"启动 seed 文件"变为"唯一真值文件"，运行时写操作回写 | 2026-06-01 |
| 3 | 并发写入 | 单进程无此需求，原子写（tmp+rename）即可 | 2026-06-01 |
| 4 | git 管理策略 | 平台不强制 git 策略，只关心文件 | 2026-06-01 |
| 5 | SOP 定义运行时写入 | 平台级 SOP 不提供运行时写入（手动编辑文件）；workspace 级通过 load-snail API 写文件 | 2026-06-01 |
