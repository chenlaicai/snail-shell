---
id: F2026053104
title: sop-module-isolation
from_ids: [F2026052606, F2026052701, F2026053003]
tags: [sop, module-boundary, file-persistence, workspace]
modules: [persistence, workspace-workflow]
doc_kind: spec
---

# F2026053104 [persistence] SOP 模块隔离：文件持久化 + 来源语义修正

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

当前 SOP 实现存在两个模块边界问题：

**1. SOP 归属语义错误**：`sop` 表使用 `scope` 字段（值为 `global`/`workspace`），暗示 SOP 有"作用域边界"。实际上 SOP 的生效范围不区分 workspace——任何 workspace 都可以 adopt 任何 SOP。`scope` 表达的应该是"谁创建的"（来源），不是"谁能用"（边界）。

**2. SOP 持久化位置不当**：SOP 定义内嵌在 `workspace-config-seed.json` 中，与 workspace 配置混在一起。SOP 作为独立的领域实体，应该有自己的文件级持久化位置，按来源分为平台级和 workspace 级。

**3. 代码模块边界模糊**：SOP 的 CRUD 函数全在 `workspace-config-model.ts` 里，文件名暗示 SOP 是 workspace 的配置项。SOP 应该有独立的代码模块。

## 目标

### P1 — SOP 文件持久化 + 来源语义修正

将 SOP 从 JSON seed 内嵌改为独立 YAML 文件持久化，修正 `scope` → `source` 语义。

1. 每个 SOP 一个 YAML 文件，存放在来源对应的目录下
2. `sop` 表 `scope` 字段重命名为 `source`，值从 `global`/`workspace` 改为 `platform`/`workspace`
3. 系统启动时从 YAML 文件加载 SOP 并注入数据库（以 YAML 为准，覆盖更新）
4. `workspace-config-seed.json` 移除 `sops` 数组和 `defaultSopForNewWorkspaces`，只保留 workspace 定义和 SOP 绑定引用
5. 创建 workspace 时必须显式指定 SOP，不提供 default fallback

### P2 — 代码模块边界梳理

将 SOP 相关代码从 `workspace-config-model.ts` 拆分为独立模块。

1. SOP CRUD 函数独立为 `src/persistence/sop-model.ts`
2. `workspace-config-model.ts` 只保留 workspace 配置和 workspace_sop 绑定逻辑

## 非目标

- SOP 文件格式的 UI 编辑器
- SOP 热加载（运行时文件变更自动刷新）
- SOP 版本管理/历史追踪
- SOP 继承/覆盖机制
- workspace_sop 绑定表结构变更（绑定关系不变）

## 设计

### SOP YAML 文件格式

每个 SOP 一个文件，文件名为 SOP key（如 `code-delivery.yaml`）。

```yaml
# .meta/sop/code-delivery.yaml
name: 代码交付流程
description: 标准软件研发交付流程：研发迭代 → PR 检视。

role_definitions:
  - key: developer
    name: 研发者
    description: 负责需求讨论、设计取舍、实现、自检、提交 PR，并处理检视意见。
    handbook_prompt_ref: "global:S-03"
    working_rules:
      - 需求不清时先和用户讨论并收敛
      - 完成开发后必须自检并提交 PR
      - 具体动作必须服从系统注入的当前 Stage
      - 逐条处理或理性回应检视意见

  - key: reviewer
    name: 检视者
    description: 负责对 PR 做对抗性代码检视，并在 PR 上留下可追溯评论。
    handbook_prompt_ref: "global:S-04"
    working_rules:
      - 以 PR 实际 diff 和上下文为依据
      - 发现的问题必须在 PR 上明确评论
      - 修复后必须重新做一次完整检视
      - 最终复核没有待处理问题时必须明确回复可等待用户合入

stage_definitions:
  - key: development
    title: 研发迭代
    sequence: 1
    output_description: >
      和用户讨论需求、设计与问题，完成实现、自检，并提交一个可检视的 PR。
      产物要求：记录需求结论、关键设计取舍、改动范围和验证结果；
      必须包含 PR 链接或可定位的 PR 信息；
      如果仍有风险或待用户确认事项，必须明确写出。
    acceptance_focus:
      - 需求是否已经收敛到可实现范围
      - 实现是否完成必要自检
      - PR 是否已经提交并可进入检视
    roles:
      - role_key: developer
        is_primary: true

  - key: review
    title: PR 检视
    sequence: 2
    input_description: 上一阶段产出的 PR 交付记录。
    output_description: >
      研发者主动呼叫检视者检视 PR，双方围绕评论修复和回复，直到没有待处理问题。
      产物要求：记录被检视的 PR；记录检视者结论、研发者处理结果和剩余风险；
      只有确认没有待处理检视问题后才能完成本阶段。
    acceptance_focus:
      - 检视者是否已经在 PR 上留下可追溯评论
      - 研发者是否逐条处理或理性回应评论
      - 是否已经明确可以等待用户合入
    roles:
      - role_key: developer
        is_primary: true
        working_rules_override:
          - 逐条处理或理性回应检视意见
          - 修复后通知检视者重新检视
      - role_key: reviewer
```

**文件名即 key**：`code-delivery.yaml` → SOP key 为 `code-delivery`。

### 文件存放位置

| 来源 (source) | 目录 | 示例 |
|---|---|---|
| `platform` | `<repo-root>/.meta/sop/` | `.meta/sop/code-delivery.yaml` |
| `workspace` | `<workspace-root>/.snail/sop/` | `.snail/sop/custom-flow.yaml` |

### SOP ID 生成规则

SOP ID 由来源和 key 自动推导，不在 YAML 中声明：

- 平台级：`sop-{key}`（如 `sop-code-delivery`）
- workspace 级：`sop-{workspace_id}-{key}`（如 `sop-snail-shell-custom-flow`）

### 启动时加载流程

```
1. 扫描 .meta/sop/*.yaml → 注入 platform 级 SOP（source='platform'）
2. 扫描各 workspace 的 <workspace_root>/.snail/sop/*.yaml → 注入 workspace 级 SOP（source='workspace', scope_ref=workspace_id）
3. 加载 workspace-config-seed.json → 创建 workspace 定义 + workspace_sop 绑定
```

以 YAML 为准：以 SOP ID 为主键，已存在则用 YAML 内容覆盖更新数据库（确保文件是唯一真实来源）。

### 数据库 Schema 变更

```sql
-- sop 表：scope → source，值改为 platform/workspace
-- scope_ref 语义不变：workspace 级 SOP 指向 workspace_id，platform 级为 NULL
CREATE TABLE IF NOT EXISTS sop (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,           -- 原 scope，重命名
  source_ref TEXT,                -- 原 scope_ref，重命名
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_sop_platform_key ON sop(key) WHERE source = 'platform';
CREATE UNIQUE INDEX idx_sop_workspace_key ON sop(source_ref, key) WHERE source = 'workspace';
```

注意：`source_sop_id` 字段移除（当前无 clone 机制，该字段未被使用）。

### workspace-config-seed.json 变更

移除 `sops` 数组和 `defaultSopForNewWorkspaces`，保留 workspace 定义和绑定引用：

```json
{
  "workspaces": [
    {
      "workspace": {
        "id": "snail-shell",
        "module": "workspace_management",
        "name": "Snail Shell",
        "summary": "用于迭代 Snail Shell 自身的默认项目。",
        "workspace_root": "{{process.cwd()}}"
      },
      "sops": [
        {
          "sop_id": "sop-code-delivery",
          "is_default": true,
          "role_bindings": {
            "developer": "claude-code-opus-4-7",
            "reviewer": "codex-gpt-5-5"
          }
        }
      ]
    }
  ]
}
```

### 代码模块拆分

| 现状 | 目标 |
|---|---|
| `workspace-config-model.ts` 包含 SOP CRUD + workspace 配置 + workspace_sop 绑定 + workspace-scoped SOP 查询 | `sop-model.ts`：SOP CRUD + SOP role/stage definition CRUD + stage_role CRUD + workspace-scoped SOP 查询 |
| | `workspace-config-model.ts`：workspace_sop 绑定 CRUD + seed workspace |

## 生效路径

- SOP YAML 文件：`.meta/sop/` 和 `<workspace-root>/.snail/sop/`，版本化随仓库维护
- 数据库 schema：`src/persistence/schema.ts`，启动时 `initSchema` 执行
- SOP 加载器：`src/persistence/sop-loader.ts`，启动时由 `main.ts` 调用
- SOP CRUD：`src/persistence/sop-model.ts`
- Domain types：`src/shared/domain-types.ts`，`Sop.source` 替代 `Sop.scope`

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `.meta/sop/code-delivery.yaml` | 新增 | 平台级 SOP 文件 |
| `.meta/sop/evolution.yaml` | 新增 | 平台级 SOP 文件 |
| `.meta/workspace-config-seed.json` | 修改 | 移除 sops 数组 |
| `src/persistence/schema.ts` | 修改 | sop 表 scope→source, scope_ref→source_ref, 移除 source_sop_id; 删除 role_definition/stage_role 表, 新增 stage_role_definition 表 |
| `src/persistence/sop-model.ts` | 新增 | SOP CRUD 独立模块 + workspace-scoped SOP 查询 |
| `src/persistence/sop-loader.ts` | 新增 | 启动时 YAML 文件加载器 |
| `src/persistence/workspace-config-model.ts` | 修改 | 移除 SOP CRUD 和 workspace-scoped 查询，仅保留 workspace_sop 绑定 + seed |
| `src/persistence/store.ts` | 修改 | SOP 方法改为从 sop-model 导入; 移除 sop 级 role 方法, 新增 stage_role_definition 方法 |
| `src/shared/domain-types.ts` | 修改 | Sop 接口 scope→source, 移除 scope_ref/source_sop_id 改名; 移除 SopRoleDefinition/StageRole, StageRoleDefinition 改为 stage 级 |
| `src/workspace-workflow/manager.ts` | 修改 | SOP scope 参数改为 source |
| `src/workspace-workflow/workflow.ts` | 修改 | 适配字段重命名 |
| `src/interaction-entry/api/server.ts` | 修改 | API scope 参数改为 source |
| `src/main.ts` | 修改 | 启动流程加入 SOP 文件加载 |
| `package.json` | 修改 | 添加 yaml 依赖 |

## 验证

### P1

- [ ] `.meta/sop/code-delivery.yaml` 和 `.meta/sop/evolution.yaml` 文件存在且格式正确
- [ ] 系统启动时自动加载 YAML 文件中的 SOP 到数据库
- [ ] `sop` 表使用 `source` 字段（非 `scope`），值为 `platform`/`workspace`
- [ ] 已存在的 SOP 被 YAML 内容覆盖更新（YAML 为准）
- [ ] `workspace-config-seed.json` 不再包含 `sops` 数组和 `defaultSopForNewWorkspaces`
- [ ] workspace 创建和 feature 创建流程正常工作
- [ ] API `/api/sops` 返回正确的 SOP 列表

### P2

- [ ] `sop-model.ts` 包含所有 SOP 相关 CRUD 函数和 workspace-scoped 查询
- [ ] `workspace-config-model.ts` 只包含 workspace_sop 绑定 CRUD 和 seed 逻辑
- [ ] 所有导入路径正确，无编译错误

## 关联

- **前置**: F2026052606（SOP 池与角色域模型重构 — 本次在此基础上修正模块边界）
- **前置**: F2026053003（project→workspace 重命名 — 本次沿用 workspace 命名）
- **相关**: F2026052701（SOP adoption 优化 — 本次不改变 adoption 机制）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| D1 | SOP YAML 文件格式选择 | 选用 YAML，理由：手写可读性好、支持注释、嵌套结构表达清晰 | 2026-05-31 |
| D2 | SOP ID 是否在 YAML 中声明 | 不声明，由来源 + key 自动推导，避免手动维护一致性 | 2026-05-31 |
| D3 | `source_sop_id` 字段是否保留 | 移除，当前无 clone 机制，字段未被使用 | 2026-05-31 |
| D4 | workspace-scoped SOP 查询函数归属 | 移至 sop-model.ts（查询本质是 SOP 定义数据，只是附加 workspace 绑定上下文），消除 workspace-config-model 中的模块边界模糊 | 2026-05-31 |
| D5 | SOP 加载幂等策略 | YAML 为准，启动时覆盖更新数据库（不做 skip） | 2026-05-31 |
| D6 | 是否保留 defaultSopForNewWorkspaces | 去掉，创建 workspace 时必须显式指定 SOP | 2026-05-31 |
| D7 | role_definition 是否应提升到 SOP 级 | 否。角色只在 stage 上下文中有意义——同一 role key 在不同 stage 中职责完全不同（如 developer 在 development 是执行者，在 review 是回应者）。将 role_definition 从 SOP 级移入 stage_definition 下，消除 stage_role 中间表和 working_rules_override 补丁机制 | 2026-06-01 |
| D8 | 如何表达"同一角色需要多个实例" | SOP YAML 中角色定义加 count 属性（默认 1），加载时自动展开为多个 DB 行（如 "检视者-1"、"检视者-2"）。role_bindings 支持 string（所有实例共享同一模板）或 string[]（逐实例绑定不同模板）。不引入运行时多实例抽象，展开在加载时完成 | 2026-06-01 |

## 范围变更记录

| # | 变更内容 | 原因 | 日期 |
|---|---|---|---|
| S1 | SOP YAML 文件从 2 阶段（development → review）扩展为 4 阶段（design → development → review → merge），新增 designer/merger 角色 | Rebase 到 PR #315（SOP v2: 4 阶段代码交付流程）后，workspace 绑定已引用 4 个角色，YAML 文件必须与之匹配 | 2026-06-01 |
| S2 | role_definition 从 SOP 级移入 stage_definition 级：删除 role_definition 表和 stage_role 中间表，新增 stage_role_definition 表；YAML 中 role_definitions 从顶层移入各 stage_definitions 内部；SopRoleDefinition 和 StageRole 类型移除 | 从业务场景分析，单说 role 没有意义，必须先说 stage 再说该 stage 下的 role 职责 | 2026-06-01 |
| S3 | stage_role_definition 新增 count 字段，YAML 角色定义支持 count 属性；加载时自动展开为多个实例（如 "检视者-1"、"检视者-2"）；role_bindings 支持 string 或 string[] 格式 | SOP 中描述一个 role 即可表达"需要几个"，无需手动复制角色定义 | 2026-06-01 |
