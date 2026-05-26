---
id: F2026052606
title: sop-role-domain-model
from_ids: [F2026052303, F2026052502, F2026052503, F2026052602]
tags: [sop, role, domain-model, project-root, prompt-center]
modules: [runtime]
doc_kind: spec
---

# F2026052606 [runtime] SOP 池与角色域模型重构 + Project 工作目录绑定

## 背景

Snail Shell 自举系统把「平台运行时」与「被开发的项目」物理坍缩在同一个 `process.cwd()`。当前域模型存在两个核心问题：

**1. Runtime 与 Project 未分离**：`project` 表无 `project_root`；agent 子进程全部 `cwd: process.cwd()`（`codex.ts`、`claude-code-stateful.ts`）；prompt/skill 从 `process.cwd()/.meta/` 全局加载，无 project 参数。

**2. SOP/Role 域模型不清晰**：

| 问题 | 现状 | 影响 |
|------|------|------|
| SOP 无独立实体 | stage 直接挂 `project_stage_definition.project_id` | 无法表达多 project 共用同一套 SOP |
| Role 不是独立概念 | `stage_role_definition` 混合"角色是谁"和"参与哪个 stage" | 同一"研发者"在 development/review 各存一行，handbook 和 rules 重复 |
| 角色→手册硬编码 | F-01 frame 写死 `{{#when:roles=研发者}}{{prompt:S-03}}` | 新增角色必须改 frame 模板 |
| 角色→agent 绑定散落 | `snail_template_id` 在 stage_role_definition 上 | 无 project 级默认、无 feature 级快照的级联关系 |
| Project→SOP 隐式关联 | `defaultSopForProject` 硬编码 module→key 映射 | 一 project 多 SOP 的场景走不通 |

## 目标

### P1 — 工作目录绑定 + 消除 system\_self

`project` 增加 `project_root TEXT NOT NULL`；删除 `system_self` kind。所有项目统一为"外部项目"模式。

- `project_root` 必须是绝对路径，不允许 NULL。
- 删除 `ProjectKind.system_self`：`kind` 字段移除（或仅保留业务分类，不影响运行时逻辑）。
- 校验：project 加载时检查路径存在且可读，否则报可诊断错误（含 project_id 和路径）。
- 创建 project 时工作目录可由用户选择；用户不选时系统自动创建默认空目录并写入 `project_root`。
- 默认目录约定：`~/SnailShell/projects/<project-id>/`。目录已存在时复用，不清空、不覆盖已有文件。
- 前端新增目录入口：创建 project 时可选择目录、手动输入路径，或使用默认目录。Mac 优先支持原生目录选择。
- Seed bootstrap：平台自身项目（如 snail-shell）seed 时 `project_root` 写入 `process.cwd()`（绝对路径落库）。

### P2 — SOP 池 + 角色域模型重构

建立 SOP→Role→Stage 三层域模型，替代当前 project\_stage\_definition + stage\_role\_definition 扁平结构：

1. `sop` 独立池：支持 global（平台预置）和 project（自建/clone）两种 scope。
2. `role_definition` 提升为 SOP 级独立实体：身份、手册、基线规则只定义一次。
3. `stage_role` 瘦 join 表：声明"谁参与哪个 stage"，不重复角色定义。
4. `project_sop` 显式关联：project 采用了哪些 SOP + 角色→agent 绑定。
5. `feature.adopted_sop_id` 直接 FK：feature 从 project 的 SOP 池中选择。
6. F-01 frame 动态手册注入：从 `role_definition.handbook_prompt_ref` 读取，去掉硬编码。

## 非目标

- SOP gate schema / 状态机外化（stage 转移条件配置化）。
- SOP.md 文件格式 / .md 解析器。
- 统一 transition API（advanceStage 三入口统一）。
- UI 改动（SOP 选择、project 设置页等 UI），但 P1 包含创建 project 时的目录选择器（Mac 优先）。
- SOP 继承/覆盖（近全局微定制走 clone，drift 是已知 trade-off）。

## 设计

### 域模型总览

```
snail-den (config/snail-den.json, 不入 DB)
  └─ { template_id → runtime, model, contextWindow }

sop                                         ← 流程定义
  ├── role_definition[]                     ← SOP 级独立角色
  └── stage_definition[]                    ← 阶段定义（原 project_stage_definition）
        └── stage_role[]                    ← 瘦 join：谁参与哪一步

project_sop                                 ← Project 采用了哪些 SOP + 角色→agent 绑定

feature
  ├── adopted_sop_id (FK→sop)              ← 选自 project_sop 池
  └── role_snail_mapping (快照)             ← 创建时从 project_sop.role_bindings 冻结
```

### P1 详设 — project\_root + 消除 system\_self

#### project 表变更

```sql
-- project_root: NOT NULL，所有项目必须指定工作目录
-- kind 字段移除（不再有 system_self / product_delivery 区分）
CREATE TABLE project (
  id TEXT PRIMARY KEY,
  module TEXT NOT NULL DEFAULT 'project_management',
  name TEXT NOT NULL,
  summary TEXT,
  project_root TEXT NOT NULL,   -- 绝对路径，agent cwd
  status TEXT NOT NULL,
  guard_profile TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

agent 启动 cwd 解析：直接读 `project.project_root`，无 fallback。

#### 消除 system\_self

| 变更点 | 现状 | 改后 |
|--------|------|------|
| `ProjectKind` 类型 | `"system_self" \| "product_delivery"` | 删除类型定义，移除 `kind` 字段 |
| `self-project-seed.ts` | `PROJECT_KIND = "system_self"` | seed 时 `project_root = process.cwd()`（绝对路径） |
| `server.ts` API | `kind === "system_self" ? ...` | 去掉分支，所有项目创建统一流程 |
| schema `kind` 列 | `kind TEXT NOT NULL` | 删除 |

**Why**: `system_self` 的唯一运行时语义是让 `project_root` fallback 到 `process.cwd()`。`project_root` 改为 NOT NULL 后该分支消失。删除 kind 而非保留空壳，避免"看起来有用实际无人读"的字段腐烂。如果未来需要项目分类，新开字段定义清晰语义。

#### Bootstrap 流程

平台首次启动 seed 时：
- snail-shell 项目：`project_root` = `process.cwd()`（平台代码所在目录）
- knowledge-center 项目：`project_root` = `process.cwd()`（同上，治理对话的 agent 操作同一代码库）

用户通过前端创建新项目时：
- 指定目录：写入所选绝对路径。不存在时后端创建；存在时必须是目录且可读写。
- 不指定目录：后端生成 `~/SnailShell/projects/<project-id>/`，创建目录后写入 `project_root`。目录已存在时复用，不清空。
- 默认目录在后端生成（project id 由后端产生，目录创建和权限校验须在同一可信边界内完成）。

#### 创建入口约束

- `POST /api/projects` 支持传入 `project_root`（可选）。未传时走默认目录策略。返回值必须包含最终落库路径。
- 前端创建 project 页需提供工作目录入口：Mac 优先支持原生目录选择器（通过后端 helper 获取绝对路径），不可用时降级为手动路径输入或使用默认目录。
- 具体 API schema 和前端组件设计在实现时确定，此处只约束入口能力。

#### projectRoot 分离

所有面向被开发项目的路径统一使用 `projectRoot`，平台自身的持久化和配置留在 `process.cwd()`。不引入 `runtimeConfigRoot` 中间概念。

| 用途 | 当前 | 改后 | 所在文件 |
|------|------|------|----------|
| agent spawn cwd | `process.cwd()` | `projectRoot` | codex.ts:179、stateful-cli-agent.ts:158 |
| `.claude/` guard settings | `process.cwd()/.claude/` | `projectRoot/.claude/` | guard-config.ts:276 |
| `.codex/` CODEX\_HOME | `process.cwd()/.codex/` | `projectRoot/.codex/` | codex.ts:172、guard-config.ts:348 |
| project git 操作 | `process.cwd()` | `projectRoot` | manager.ts:68（repoRoot） |
| prompt/skill overlay | 无 | `projectRoot/.snail/`（**本期不实现**，仅要求缺失/空不报错） | — |
| DB / config / .meta / logger | `process.cwd()` | **不变** | store.ts、main.ts、registry.ts 等 |

**Why**: `.claude/`、`.codex/` 是 agent 运行时读取的项目级配置（Claude Code 从自身 cwd 读 `.claude/settings.local.json`；Codex 从 `$CODEX_HOME` 读 `config.toml`）。它们的语义是"这个项目希望 agent 按什么规则工作"，应跟着项目走。`CODEX_HOME` 通过 `spawn()` env 传入，只作用于子进程，不影响用户机器上其他 Codex CLI 实例。平台自身的 DB、LLM 配置、prompt 模板等是 Snail Shell 运行时资产，不随 project 切换。

实现要求：
- `writeClaudeGuardSettings(guard, projectRoot)` 和 `writeCodexGuardConfig(guard, projectRoot)` 接受 `projectRoot` 参数
- agent spawn 的 `cwd` 使用 `projectRoot`，`CODEX_HOME` 指向 `projectRoot/.codex`
- prompt/skill 加载：本期仅平台级 `process.cwd()/.meta/`。项目级 `projectRoot/.snail/` 留后续 feature，本期只要求该目录缺失或为空时不报错

#### snail-shell 自身的 overlay 拆分验证

本 feature 不要求把所有平台 prompt/skill 移到项目 overlay，但必须证明新架构下平台目录和项目目录已经解耦：

- snail-shell seed 后的 `project_root` 是当前仓库根目录（`process.cwd()` 的绝对路径）。
- 平台 prompt/skill 仍从 `process.cwd()/.meta/` 读取。
- 项目 overlay 入口 `projectRoot/.snail/` 本期不实现 loader。目录不存在或为空时不报错（防御性兼容）。`project:` scope 的 prompt/skill 解析留后续 feature。
- snail-shell 自身项目必须能在这个拆分下创建 feature、进入 development stage、构建 system prompt，并正确解析 `global:S-03` handbook。
- 至少一个测试或手动验证覆盖 `projectRoot/.snail/` 存在但为空的情况，避免 overlay 缺失导致启动失败。

### P2 详设 — 实体定义

#### sop

```sql
CREATE TABLE sop (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,        -- 'global' | 'project'
  scope_ref TEXT,             -- project 时为 project.id；global 时 NULL
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  source_sop_id TEXT,         -- clone 来源（仅追溯，可选）
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_sop_global_key ON sop(key) WHERE scope = 'global';
CREATE UNIQUE INDEX idx_sop_project_key ON sop(scope_ref, key) WHERE scope = 'project';
```

**Why**: SOP 是流程定义的独立实体。global 存放平台预置（如 code-delivery），所有 project 可引用；project 存放项目自建或 clone。`scope_ref` 隔离不同项目的同名 SOP。`source_sop_id` 仅做 clone 追溯，不建立运行时依赖（全局 SOP 改了不自动同步到 clone）。

#### role\_definition（NEW）

```sql
CREATE TABLE role_definition (
  id TEXT PRIMARY KEY,
  sop_id TEXT NOT NULL,
  key TEXT NOT NULL,           -- 如 'developer', 'reviewer'
  name TEXT NOT NULL,          -- 显示名如 '研发者'
  description TEXT NOT NULL DEFAULT '',
  handbook_prompt_ref TEXT,    -- scope-qualified: 'global:S-03' / 'project:my-handbook'
  working_rules TEXT NOT NULL DEFAULT '[]',
  FOREIGN KEY (sop_id) REFERENCES sop(id) ON DELETE CASCADE,
  UNIQUE(sop_id, key),
  UNIQUE(sop_id, name)
);
```

**Why**: 从 `stage_role_definition` 提升为 SOP 级独立实体。核心动机：同一角色（如"研发者"）在 SOP 多个 stage 中参与，身份/手册/基线规则应只定义一次。之前每个 stage 各存一份，改一个漏改另一个就漂移。

`UNIQUE(sop_id, name)` 防止同 SOP 内出现同名角色导致 mention 路由歧义（当前路由靠显示名查 role）。

`handbook_prompt_ref` 是 scope-qualified 引用：`global:S-03` 引用平台 prompt，`project:my-handbook` 引用项目 overlay，bare key 随所属 SOP 的 scope 解析。这让 F-01 frame 不再需要硬编码角色→手册映射。**本期只实现 `global:` scope 解析**（从 `process.cwd()/.meta/prompts/` 加载）。`project:` scope 依赖 `.snail/` overlay loader，留后续 feature。字段格式预留，DB schema 不需要变。

#### stage\_definition（改自 project\_stage\_definition）

```sql
CREATE TABLE stage_definition (
  id TEXT PRIMARY KEY,
  sop_id TEXT NOT NULL,        -- 父从 project_id 改为 sop_id
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  input_description TEXT,
  output_description TEXT,
  acceptance_focus TEXT NOT NULL DEFAULT '[]',
  FOREIGN KEY (sop_id) REFERENCES sop(id) ON DELETE CASCADE,
  UNIQUE(sop_id, key),
  UNIQUE(sop_id, sequence)
);
```

**Why**: 父从 project 改为 sop，因为 stage 是 SOP 流程的组成部分。表名去掉 `project_` 前缀准确反映归属。

#### stage\_role（替代 stage\_role\_definition）

```sql
CREATE TABLE stage_role (
  id TEXT PRIMARY KEY,
  stage_definition_id TEXT NOT NULL,
  role_definition_id TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  working_rules_override TEXT,  -- JSON array，可选 stage 级覆写
  FOREIGN KEY (stage_definition_id) REFERENCES stage_definition(id) ON DELETE CASCADE,
  FOREIGN KEY (role_definition_id) REFERENCES role_definition(id) ON DELETE CASCADE,
  UNIQUE(stage_definition_id, role_definition_id)
);
```

**Why**: 瘦 join 只声明参与关系。角色身份/手册/基线规则在 `role_definition` 定义一次，stage\_role 只做绑定 + 可选 stage 级覆写（如 review stage 的研发者只需"逐条处理检视意见"）。不再有 `snail_id`/`snail_template_id`/`project_id` 等冗余字段。

#### project\_sop（NEW）

```sql
CREATE TABLE project_sop (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  sop_id TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  role_bindings TEXT NOT NULL DEFAULT '{}',  -- { [role_key]: snail_template_id }
  FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
  FOREIGN KEY (sop_id) REFERENCES sop(id) ON DELETE CASCADE,
  UNIQUE(project_id, sop_id)
);
-- 每个 project 最多一个默认 SOP
CREATE UNIQUE INDEX idx_project_sop_default ON project_sop(project_id) WHERE is_default = 1;
```

**Why**: 显式声明 project 采用了哪些 SOP，替代 `defaultSopForProject` 硬编码映射。`role_bindings` 是一级 JSON（不是旧 worktree 的四级嵌套），因为 role\_definition 在 SOP 内已唯一（`sop_id + key`）。`is_default` 标记创建 feature 时的默认选择。

**运行时管理入口**（P2 scope）：

除 seed 外，`project_sop` 需要 API 支持运行时管理：
- `POST /api/projects/:projectId/sops` — 采用一个 SOP（指定 sop_id + role_bindings）
- `PATCH /api/projects/:projectId/sops/:sopId` — 修改 role_bindings 或 is_default
- `DELETE /api/projects/:projectId/sops/:sopId` — 移除 SOP 采用（已有 feature 引用时拒绝或警告）
- `GET /api/projects/:projectId/sops` — 列出项目已采用的 SOP 及 role_bindings

UI 入口为非目标（决策 #18），但 API 入口在 P2 内完成，否则用户无法在 seed 之外管理 SOP 绑定。

#### feature 表变更

`feature` 新增 `adopted_sop_id TEXT REFERENCES sop(id)`。`role_snail_mapping` 保留，形状不变。

**role\_snail\_mapping 形状**：`Record<string, Record<string, string>>`（与现有 `domain-types.ts:106` 一致）

```
{ [stage_id]: { [role_name]: snail_template_id } }
```

填充流程：feature 创建/推进 stage 时，遍历该 stage 的 `stage_role[]` → 取 `role_definition.name` 和 `project_sop.role_bindings[role_definition.key]` → 写入 `{ [stage.id]: { [role_name]: template_id } }`。与现有 `workflow.ts:219` 的累加语义一致，只是数据来源从 `stage_role_definition.snail_template_id` 变为 `project_sop.role_bindings`。

**Why（直接 FK）**: `sop.id` 已唯一标识，scope+key 派生逻辑散在代码里增加认知负担。

**Why（role\_snail\_mapping 保留两级形状）**: 现有 `PATCH /features/:featureId/role-snail` API 和 stage 推进逻辑都依赖 `stage_id → role_name` 二级结构。一级快照会破坏多 stage 同角色不同模板的隔离语义和现有 API 契约。

**Why（快照而非实时读）**: feature 可能跑数天。中途 project 升级模型，进行中 feature 不应跟着变。快照保证生命周期内 agent 阵容稳定，也支持 feature 级覆写。

#### 不兼容变更与升级路径

本 feature 涉及不兼容 schema 变更（新表替代旧表、旧表字段移除），遵循 `store.ts` 硬规则：**不使用 ALTER TABLE，不在 initSchema() 中执行自动迁移。**

**这是 DB reset 级不兼容变更。** 不仅旧表（`project_stage_definition`、`stage_role_definition`）被替代，既有表也发生结构变化：`project` 新增 `project_root`、`feature` 新增 `adopted_sop_id`、`stage.stage_definition_id` FK 从旧 `project_stage_definition` 改指新 `stage_definition`。`CREATE TABLE IF NOT EXISTS` 对已存在的表不会追加列，因此仅移除旧表定义和 seed 重灌不够。

升级路径：
1. **开发环境**：删除整个 dev DB 文件，重新启动让 schema.ts 全量建表 + seed 灌入。这是唯一支持的升级方式。
2. schema.ts 只包含 `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`（纯新建，符合 store.ts 硬规则）。所有表定义写终态结构。
3. 旧表（`project_stage_definition`、`stage_role_definition`）定义从 schema.ts 移除。旧表在 DB 中残留不影响运行（不读不写）。
4. seed 重写后，`seedProjectConfig()` 向新表灌入数据。
5. 不提供增量迁移脚本。如果未来需要生产级迁移（如有外部用户），另开 feature 处理。

### 级联关系

```
定义层：  sop ──→ role_definition    "角色是谁、该读什么手册"
               ──→ stage_definition  "有哪些阶段"
                     ──→ stage_role  "谁参与哪一步"

绑定层：  project ──→ project_sop    "我的项目用哪些 SOP、各角色用哪个 agent"

执行层：  feature ──→ adopted_sop_id "这个 feature 用哪套 SOP"
                  ──→ role_snail_mapping "冻结的阵容快照"
                  ──→ stage[]        "实际运行的阶段实例"
```

### 提示词组装流程变化

**现在**：F-01 硬编码 `{{#when:roles=研发者}}{{prompt:S-03}}`

**改后**：

1. `feature.adopted_sop_id` → 解析 SOP
2. 当前 `stage_definition` → `stage_role[]` → `role_definition[]`
3. 取 active role 的 `handbook_prompt_ref`（如 `global:S-03`）
4. 按 scope 解析 → 获取 prompt ID（如 `S-03`）和 prompt 内容
5. builder 在 frame 渲染后追加 handbook 段落到 systemPrompt
6. 将 handbook prompt ID 显式加入 `activePromptIds` 列表

**关键约束：保留 skill\_references 收集链路。** 当前 `extractPromptReferences()` 只从 frame 静态 `{{prompt:ID}}` 收集 prompt ID，变量注入的内容不会被扫到。因此 handbook 不能走 frame 变量注入，必须走 builder 层显式追加：

```typescript
// builder.ts 伪代码
const handbookPromptId = resolveHandbookPromptId(activeRole.handbook_prompt_ref);
if (handbookPromptId) {
  // 1. 渲染 handbook 内容，追加到 systemPrompt
  const handbookContent = renderPrompt(handbookPromptId, variables);
  systemPrompt += `\n## 角色手册\n\n${handbookContent}`;
  // 2. 显式加入 activePromptIds，确保 skill_references 被收集
  activePromptIds.push(handbookPromptId);
}
```

F-01 frame 变化：删除硬编码角色手册块（`{{#when:roles=研发者}}...`、`{{#when:roles=检视者}}...`），不替换为新变量——handbook 由 builder 在 frame 渲染后追加。

### Seed 数据重构

从按 project 组织改为按 SOP + project 引用组织：

```json
{
  "sops": [{
    "sop": { "id": "code-delivery", "scope": "global", "key": "code-delivery", "name": "代码交付流程" },
    "role_definitions": [
      { "key": "developer", "name": "研发者", "handbook_prompt_ref": "global:S-03", "working_rules": [...] },
      { "key": "reviewer", "name": "检视者", "handbook_prompt_ref": "global:S-04", "working_rules": [...] }
    ],
    "stage_definitions": [
      { "key": "development", "sequence": 1, "roles": [{ "role_key": "developer", "is_primary": true }] },
      { "key": "review", "sequence": 2, "roles": [
        { "role_key": "developer", "is_primary": true, "working_rules_override": ["逐条处理检视意见"] },
        { "role_key": "reviewer" }
      ]}
    ]
  }],
  "projects": [{
    "project": { "id": "snail-shell", "name": "Snail Shell", "project_root": "{{process.cwd()}}" },
    "sops": [{ "sop_id": "code-delivery", "is_default": true,
      "role_bindings": { "developer": "claude-code-stateful-dsv4", "reviewer": "opencode-default" }
    }]
  }]
}
```

## 生效路径

- `src/persistence/schema.ts`：新表 + project/feature 字段变更
- `src/persistence/store.ts`、`project-config-model.ts`：seed 逻辑 + CRUD 适配
- `src/prompt-center/builder.ts`：handbook append + activePromptIds 显式注入
- `.meta/prompts/frames/F-01-*.md`：删除硬编码角色手册块（`{{#when:roles=研发者}}`、`{{#when:roles=检视者}}`）
- `.meta/project-config-seed.json`：按 SOP 组织重写
- `src/shared/domain-types.ts`：删除 `ProjectKind`
- `src/project-workflow/self-project-seed.ts`：seed 时写入 `project_root = process.cwd()`
- `src/interaction-entry/api/server.ts`：删除 `system_self` 分支、`POST /projects` 支持 `project_root` + 默认目录策略
- `src/agent/*`：spawn cwd 从 `project_root` 读取
- `src/agent/guard-config.ts`：写入函数接受 `projectRoot` 参数
- `src/project-workflow/manager.ts`：`repoRoot` 从 `project_root` 读取；feature 创建时 SOP 采用 + mapping 快照
- `src/interaction-entry/api/`：project_sop CRUD API（P2）
- `src/roles/registry.ts`：适配 `role_definition` + `stage_role`
- 前端：创建 project 页增加工作目录入口、删除 `kind` 展示

## 改动范围

**P1**：schema.ts（project 删 kind + 加 project_root NOT NULL）、domain-types.ts（删 ProjectKind）、store.ts / project-config-model.ts（seed + CRUD 写 project_root + 默认目录策略）、self-project-seed.ts（seed project_root）、server.ts（删 system_self 分支 + project_root API）、agent/*.ts（cwd 解析 + CODEX_HOME）、guard-config.ts（.claude/.codex 路径参数化）、manager.ts（repoRoot）、前端（目录入口 + 删 kind 展示）、全仓 `ProjectKind`/`system_self`/`product_delivery` 引用清理、测试

**P2**：schema.ts（5 张表）、store.ts（seed 重写）、project-config-model.ts（CRUD）、interaction-entry/api（project_sop CRUD API）、builder.ts（handbook append + activePromptIds）、registry.ts（handbook scope 解析）、roles/registry.ts、manager.ts（feature 创建流程）、F-01 frame（删除硬编码手册块）、seed JSON、测试

## 验证

### P1
- [ ] project_root NOT NULL：所有项目必须有工作目录，创建时校验路径存在且可读
- [ ] 创建 project 未指定目录：后端创建默认目录 `~/SnailShell/projects/<project-id>/`，已存在时复用不清空
- [ ] 创建 project 指定目录：不存在则创建；存在但不是目录或不可读写时报可诊断错误
- [ ] API 返回最终落库的 `project_root`
- [ ] project_root 指向非 cwd 目录的 project，agent 在该目录内运行
- [ ] project_root 路径不存在时报可诊断错误（含 project_id 和路径）
- [ ] system_self 已删除：代码中无 `system_self` 引用，ProjectKind 类型已移除
- [ ] seed bootstrap：snail-shell 项目 project_root 落库为 process.cwd() 绝对路径
- [ ] agent cwd 切换后，`.claude/` 和 `.codex/` 在 projectRoot 下生成，不在 process.cwd() 下
- [ ] CODEX_HOME 通过 spawn env 传入，不影响其他 Codex 实例
- [ ] 前端创建 project 时有工作目录入口（Mac 目录选择器 / 手动输入 / 默认目录）
- [ ] 前端不再展示 `project.kind`
- [ ] snail-shell 自身验证：project_root=仓库根目录，平台 `.meta/` 正常加载，空 `.snail/` 不影响 prompt 构建，可创建 feature 并进入 stage

### P2
- [ ] global SOP seed 灌入，role_definition + stage_definition + stage_role 关系正确
- [ ] project_sop 关联正确，role_bindings 映射角色到 snail template
- [ ] project_sop.is_default 唯一约束生效（同 project 不允许多个默认 SOP）
- [ ] feature 创建时 adopted_sop_id 引用正确，role_snail_mapping 按两级形状 `{ stage_id: { role_name: template_id } }` 从 role_bindings 快照
- [ ] feature 创建时未指定 SOP 且无默认 SOP → 报错
- [ ] 同一角色在 SOP 内只有一个 role_definition，通过 stage_role 参与多个 stage
- [ ] role_definition.name SOP 内唯一约束生效
- [ ] handbook_prompt_ref 动态注入：`global:S-03` 正确解析并拼入 system prompt
- [ ] handbook prompt 的 skill_references 被正确收集到 AgentCapability.skills 中
- [ ] F-01 frame 不再含硬编码角色手册块
- [ ] project_sop 修改 role_bindings 后，新 feature 用新绑定，已有 feature 不受影响
- [ ] stage_role.working_rules_override 正确覆写基线 working_rules
- [ ] PATCH /features/:featureId/role-snail API 与新数据源兼容
- [ ] project_sop CRUD API 可用：列出、采用、修改 role_bindings、移除 SOP（有 feature 引用时拒绝）
- [ ] handbook_prompt_ref 本期只解析 `global:` scope；`project:` scope ref 存在时不崩溃但不加载内容

### 通用
- [ ] 代码中无 `system_self` 引用（grep 验证）
- [ ] tsc / lint / 测试全过
- [ ] 旧表（project_stage_definition、stage_role_definition）定义从 schema.ts 移除，新表正常创建

## 关联

- **相关**: F2026052303（移除 FeatureStatus 死代码 — 进度由 stage 流转表达，本 feature 重构 stage 表结构）
- **相关**: F2026052502（运行时上下文外移为 skill — prompt builder 构建链路相关）
- **相关**: F2026052503（Guard Profile — project 表同层字段，正交；见决策 #8）
- **相关**: F2026052602（systemPrompt/systemReminder 分层 — 渲染管线正交；见决策 #9）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|-----------|------|------|
| 1 | role_definition 提升到 SOP 级是否过度设计 | 不是。当前 seed 中"研发者"在 development 和 review 各存一份完全相同的定义，只 working_rules 有微调。提升后定义一次，stage 差异走 override | 2026-05-26 |
| 2 | adopted_sop_id (直接 FK) vs scope+key (间接) | 直接 FK。sop.id 已唯一，scope+key 派生逻辑增加认知负担。seed 用稳定 id 无断裂风险 | 2026-05-26 |
| 3 | role_bindings 一级 JSON vs 四级嵌套 | 一级。role_definition 在 SOP 内已唯一（sop_id+key），不需要多层定位 | 2026-05-26 |
| 4 | SOP.md vs DB 作为真相源 | 未拍案。本 feature 沿用 seed JSON→DB。终态若改 SOP.md 驱动列为后续 | 2026-05-26 |
| 5 | table 改名 project_stage_definition → stage_definition | 改。父已从 project 变为 sop，前缀需反映归属 | 2026-05-26 |
| 6 | skill 绑定机制 | 本期沿用现有 prompt.skill_references 机制（skill 通过 handbook prompt 的 frontmatter 与角色绑定）。后续 feature 考虑在 role_definition 上增加 suggest_skills 字段，将 skill 配置从 prompt 内容迁移到 SOP 数据层 | 2026-05-26 |
| 7 | source_sop_id clone 追溯 | 可选字段，仅追溯用。全局 SOP 改了不自动同步到 clone，drift 走手动重 clone | 2026-05-26 |
| 8 | 与 F2026052503 guard_profile 冲突 | 无冲突。guard_profile 已在 project 表，本 feature 在同表加 project_root，正交 | 2026-05-26 |
| 9 | 与 F2026052602 system-prompt-split 冲突 | 无冲突。renderFrameSplit 改渲染分层，本 feature 改角色手册来源，正交 | 2026-05-26 |
| 10 | handbook 动态注入会丢失 skill_references（GPT-5.5 review） | builder 层显式追加 handbook prompt ID 到 activePromptIds，不走 frame 变量注入。保留 extractPromptReferences→collectActiveSkills 收集链路 | 2026-05-26 |
| 11 | role_snail_mapping 形状与 main 不一致（GPT-5.5 review） | 保留两级形状 `{ [stage_id]: { [role_name]: template_id } }`。与现有 API 和 workflow.ts 累加语义一致，仅改数据来源 | 2026-05-26 |
| 12 | schema 变更使用 ALTER TABLE 违反 store.ts 硬规则（GPT-5.5 review） | 不使用 ALTER TABLE。schema.ts 只写 CREATE TABLE IF NOT EXISTS，旧表定义移除但不 DROP，seed 重灌新表。升级时手动删旧 DB | 2026-05-26 |
| 13 | projectRoot 切换导致 guard/settings/hook 路径错位（GPT-5.5 review → CVO 深挖） | 去掉 runtimeConfigRoot 中间概念。`.claude/`、`.codex/` 跟随 projectRoot（agent 从 cwd 读取），平台自身 DB/config/.meta 留 process.cwd()。CODEX_HOME 通过 spawn env 隔离，不影响全局 | 2026-05-26 |
| 14 | project_sop.is_default 缺唯一约束（GPT-5.5 review） | 加 `UNIQUE(project_id) WHERE is_default = 1`。无默认 SOP 时 feature 创建须显式指定，否则报错 | 2026-05-26 |
| 15 | role_definition.name SOP 内唯一性（GPT-5.5 review） | 加 `UNIQUE(sop_id, name)`。防止同 SOP 同名角色导致 mention 路由歧义 | 2026-05-26 |
| 16 | 升级路径不够可执行，既有表缺列/FK 错位（GPT-5.5 review R2） | 明确为 DB reset 级不兼容变更。开发环境删 DB 重建是唯一支持的升级方式，不提供增量迁移 | 2026-05-26 |
| 17 | system_self 特殊路径（CVO 决策） | 删除 `system_self` kind 和 `project.kind` 字段。`project_root` 改为 NOT NULL，所有项目统一为外部项目模式。seed 时平台项目 `project_root = process.cwd()`。消除 NULL fallback 分支 | 2026-05-26 |
| 18 | 前端目录选择器（CVO 决策） | P1 scope 内。创建 project 时前端提供 Mac 原生目录选择器。SOP 选择等其他 UI 仍为非目标 | 2026-05-26 |
| 19 | 用户不选目录时的默认工作区（CVO 决策） | 后端创建 `~/SnailShell/projects/<project-id>/` 作为默认空目录并写入 project_root。目录已存在时复用，不清空、不覆盖 | 2026-05-26 |
| 20 | 目录选择入口边界（GPT-5.5 review 补充） | 浏览器无法直接获取本机绝对路径，Mac 目录选择须通过后端 helper；不可用时降级为手动输入或默认目录 | 2026-05-26 |
| 21 | snail-shell 自身 overlay 拆分验证 | 本期不迁移平台 `.meta`，但必须验证 snail-shell project_root=仓库根、平台 `.meta` 正常加载、projectRoot/.snail 缺失/为空不失败，确保平台资源和项目工作区已解耦 | 2026-05-26 |
| 22 | `.snail/` overlay 与 `project:` scope 半承诺（GPT-5.5 review R4） | 本期 `.snail/` 只做防御性兼容（缺失/空不报错），不实现 loader。`handbook_prompt_ref` 只解析 `global:` scope，`project:` scope 留后续 feature。字段格式预留，schema 不变 | 2026-05-26 |
| 23 | project_sop 缺运行时管理入口（GPT-5.5 review R4） | P2 scope 内补 CRUD API（采用/修改/移除/列出）。UI 仍为非目标，但 API 入口必须有，否则 seed 之外无法管理 SOP 绑定 | 2026-05-26 |

## 范围变更记录

- 2026-05-26：初始版本。基于 CVO 讨论全新编写，不基于旧 worktree 的 F2026052504 spec。
- 2026-05-26（GPT-5.5 design review R1，修复 5 点）：
  - handbook 注入改为 builder 层显式追加（保留 skill_references 收集链路）。
  - role_snail_mapping 保留两级形状 `{ stage_id: { role_name: template_id } }`，与 main API 契约一致。
  - 移除所有 ALTER TABLE，定义不兼容升级路径（CREATE IF NOT EXISTS + seed 重灌）。
  - P1 新增 projectRoot vs runtimeConfigRoot 显式分离，定义各路径使用场景。
  - project_sop.is_default 加 partial unique index；role_definition.name 加 SOP 内唯一约束。
- 2026-05-26（GPT-5.5 design review R2，修复 2 点）：
  - 升级路径改为"DB reset 级不兼容变更"，明确开发环境删 DB 重建是唯一支持方式。
  - 生效路径、改动范围措辞统一为"F-01 删除硬编码手册块 + builder 负责 handbook append + activePromptIds"，消除与 R1 #1 修复的术语歧义。
- 2026-05-26（CVO 决策）：
  - 去除 stage_definition.suggest_skills。本期沿用现有 prompt.skill_references 机制，skill 通过 handbook prompt 与角色绑定。
  - 后续 feature 考虑在 role_definition 上增加 suggest_skills，将 skill 配置从 prompt 迁移到 SOP 数据层。
- 2026-05-26（CVO 深挖 P1 路径分离）：
  - 去掉 `runtimeConfigRoot` 中间概念，简化为 `projectRoot` vs `process.cwd()` 二分法。
  - `.claude/`、`.codex/` 改为跟随 projectRoot（agent 从 cwd 读取这些配置）。
  - guard-config.ts 写入函数增加 `projectRoot` 参数。
  - P1 改动范围扩展：guard-config.ts、manager.ts（repoRoot）。
  - 影响面确认：28 处 `process.cwd()` 中 6 处改为 projectRoot，22 处不变。
- 2026-05-26（CVO 决策：消除 system_self）：
  - 删除 `system_self` kind，移除 `project.kind` 字段。`project_root` 改为 `TEXT NOT NULL`。
  - 所有项目统一为外部项目模式，seed 时平台项目 `project_root = process.cwd()`。
  - P1 scope 新增：前端目录选择器（Mac 优先）、domain-types.ts / self-project-seed.ts / server.ts 清理。
  - P1 schema 变更：project 表删 `kind` 列。
- 2026-05-26（CVO 决策：默认工作目录 + 入口补齐）：
  - 用户不选目录时，后端创建 `~/SnailShell/projects/<project-id>/` 默认空目录并写入 project_root。
  - 创建 project 入口补齐为：选择目录、手动输入路径、使用默认目录三种。
  - Mac 原生目录选择通过后端 helper 获取 POSIX 路径；不可用时降级。
  - 验证项补充 snail-shell 自身按新 projectRoot/overlay 拆分架构运行。
- 2026-05-26（架构师清理 GPT-5.5 越界写入）：
  - GPT-5.5 review 发现的缺口保留（入口约束、overlay 验证、kind 全仓清理）。
  - 移除 reviewer 直接定案的 API schema 细节（`use_default_project_root` 字段）、前端文件名引用（`project-config-view.js` 等）、具体 helper 端点路径。
  - 改动范围补充全仓 `ProjectKind`/`system_self` 引用清理。
- 2026-05-26（GPT-5.5 review R4，修复 2 点）：
  - `.snail/` overlay 和 `project:` scope handbook 明确降级为后续 feature。本期只做防御性兼容（缺失/空不报错），`handbook_prompt_ref` 只解析 `global:` scope。
  - P2 补 project_sop CRUD API 入口定义（采用/修改/移除/列出），确保 seed 之外可管理 SOP 绑定。
