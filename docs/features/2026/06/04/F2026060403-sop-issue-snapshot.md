---
id: F2026060403
title: sop-issue-snapshot
from_ids: [F2026052606, F2026053102, F2026060302]
tags: [sop, persistence, workflow, web]
modules: [persistence, workspace-workflow, interaction-entry, web]
doc_kind: spec
---

# F2026060403 [sop] Issue 级 SOP 快照与 SOP Center CRUD

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

当前 SOP 与 Issue 的关系是**纯运行时引用**：`issue.adopted_sop_id` 只存一个字符串指针，所有 SOP 配置（transitions、stage definitions、role definitions、handbook、acceptance checklist）在 issue 运行期间通过 `ConversationStore → FileConfigStore` 实时读取。

这意味着修改 SOP 模板会立即影响所有正在运行的 issue：
- 删除一条 transition 边 → 正在该路径推进的 issue 无法转移
- 删除一个 stage → 正在该 stage 的 issue 悬空
- 修改 acceptance_checklist → gate 校验规则突变
- 删除 handbook → AI 系统提示词缺失关键内容

随着 SOP Center 支持在线编辑和多 SOP 场景扩展，这个问题必须解决。

### 设计取舍：为什么选快照而非版本化或活跃检查

| 方案 | 优势 | 劣势 | 结论 |
|------|------|------|------|
| 活跃 issue 检查 | 实现简单（一个查询） | 使用越多的 SOP 越冻结，多 SOP 场景下不可用 | 不采用 |
| 版本化（版本号 + 版本表） | 概念成熟 | 破坏文件持久化模型（一个目录一个 YAML 的简洁性），引入版本号概念增加复杂度 | 不采用 |
| **Issue 级快照** | 不碰文件模型，不引入新概念，issue 自带当时 SOP 全貌 | 每 issue 存 10-50KB JSON（handbook 是大头），相比消息历史可忽略 | **采用** |

快照本质上是"内联的、无版本号的版本化"——每条 issue 隐式锁定创建时的 SOP 配置。

## 目标

### P1 — Issue 级 SOP 快照

1. Issue 创建时，将 SOP 全量配置（含 handbook）序列化为 JSON 存入 `issue.sop_snapshot`
2. Issue 运行期间（推进校验、gate 检查、AI 系统提示词构建、stage 详情查询）全部从快照读取，不再实时引用 SOP 模板
3. SOP 模板可自由编辑，新 issue 自动使用最新配置，已有 issue 不受影响
4. 不引入版本号概念，不破坏现有文件持久化模型

### P2 — SOP Center CRUD

快照机制解除了 SOP 编辑的安全约束后，SOP Center 支持完整的增删改查：

1. **列表**：展示所有 SOP（按 Platform / Workspace 分组），显示名称、key、来源、描述
2. **详情**：点击 SOP 卡片查看完整配置（stage definitions、transitions、roles、handbook）
3. **新建**：通过表单创建新的 Platform SOP（key、name、stage definitions YAML、transitions YAML）
4. **编辑**：修改已有 SOP 的全部字段（name、description、first_stage、shared_handbook、stage_definitions、transitions），回写 YAML 文件
5. **删除**：删除 SOP（移除 YAML 文件和 handbook 文件）

## 非目标

- SOP 版本管理系统（版本号、版本列表、版本切换）
- 历史 issue 数据迁移（旧 issue 不保留，DB 可重建）
- Workspace 级 SOP 的在线编辑（仅支持 Platform 级 SOP 的 CRUD）

**变更类型**: `feature`

## 设计

### P1 详设

**快照数据结构**

创建 issue 时，将 SOP 的全量配置序列化为 JSON 存入 `issue.sop_snapshot`：

```json
{
  "sop_id": "code-delivery",
  "name": "代码交付流程",
  "description": "标准软件研发交付流程",
  "first_stage": "design",
  "shared_handbook": "<markdown 内容>",
  "stage_definitions": [
    {
      "key": "design",
      "title": "需求对齐与设计",
      "sequence": 1,
      "input_description": "用户需求描述。",
      "output_description": "两位架构师交叉审视需求...",
      "acceptance_focus": ["..."],
      "acceptance_checklist": [
        { "id": "design-01", "description": "...", "required": true }
      ],
      "roles": [
        {
          "key": "designer",
          "name": "架构师",
          "description": "...",
          "is_primary": true,
          "count": 2,
          "handbook": "<markdown 内容>"
        }
      ]
    }
  ],
  "transitions": [
    { "from": "design", "to": "development", "guard": null },
    { "from": "development", "to": "review", "guard": null }
  ]
}
```

字段来源对照：

| 快照字段 | 来源 | 说明 |
|----------|------|------|
| `sop_id` | `Sop.id` | 保留原始 SOP 标识，用于溯源 |
| `name`, `description` | `Sop` | SOP 元数据 |
| `first_stage` | `Sop.first_stage` | 首个 stage key |
| `shared_handbook` | `Sop.shared_handbook` | SOP 级共享手册（已解析的 markdown） |
| `stage_definitions[]` | `SopStageDefinition` + `StageRoleDefinition` | stage 定义含内联角色定义 |
| `transitions[]` | `SopTransition` | 转移边 + guard 配置 |

**存储变更**

`issue` 表新增 `sop_snapshot` 列：

```sql
ALTER TABLE issue ADD COLUMN sop_snapshot TEXT NOT NULL DEFAULT '{}';
```

- 类型：TEXT（JSON 字符串），NOT NULL
- 典型大小：10-50KB（handbook 是大头）
- 不做历史数据迁移——旧 issue 直接废弃，DB 可重建

**快照捕获时机**

在 `createIssueWorkflow` 中，创建 issue 前从 FileConfigStore 全量读取 SOP 配置，构建快照对象，随 `createIssue` 一起写入。

**读取路径分类**

Issue 运行时路径（必须改为从快照读取）：

| 场景 | 涉及模块 |
|------|---------|
| Stage 推进校验（transitions + guard） | `workflow.ts` |
| Gate 检查（acceptance_checklist） | `workflow.ts` |
| 创建新 stage（stage definition + roles） | `workflow.ts` |
| 解析首个 stage（first_stage / min sequence） | `workflow.ts` |
| 构建 AI 系统提示词（stage 元数据 + roles + handbook + shared_handbook） | `manager-collaboration.ts` |
| AI 转移建议（forward transitions） | `manager-collaboration.ts` |
| Stage 详情查询（stage definition + roles） | `manager-detail.ts` |
| Role-snail 映射校验（role definitions） | `manager.ts` |

保持实时读取（管理/非 issue 路径）：

| 场景 | 原因 |
|------|------|
| Workspace 创建时验证 SOP 存在性 | 非 issue 运行时 |
| Issue 创建时捕获快照 | 必须读实时数据 |
| SOP 管理 API（GET/POST /sops） | 展示模板最新状态 |
| 演进中心 | 使用硬编码 workspace，不走 issue 路径 |
| 角色注册表 | 全局索引，与 issue 无关 |

**FileConfigStore 缓存状态**

SOP 内存缓存（`sopCache`）已移除——SOP 读取改为按需解析 YAML 文件，消除"手动改文件不生效"和"API 编辑需双写"的问题。Workspace 内存缓存（`workspaceCache`）保留，因 workspace 管理操作频率较高且不涉及手动编辑场景。

### P2 详设

**API**

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/sops` | 列出所有 SOP（已有） |
| GET | `/api/sops/:sopId` | SOP 详情含 stages + transitions（已有） |
| POST | `/api/sops` | 创建 Platform SOP（P1 已实现） |
| PATCH | `/api/sops/:sopId` | 更新 SOP 全部字段，回写 YAML 文件 |
| DELETE | `/api/sops/:sopId` | 删除 SOP（YAML + handbook 文件） |

PATCH 请求体与 POST 一致（key 不可改，其余字段可选更新）。

DELETE 行为：
- 移除 `config/sop/<key>/<key>.yaml` 和关联的 `*.handbook.md` 文件
- 下次读取时自动生效（无缓存）
- 自动清理引用该 SOP 的 WorkspaceSop 绑定并返回受影响的 workspace 列表
- 已有 issue 不受影响（运行时数据来自快照）

**前端 SOP Center 视图**

| 区域 | 内容 |
|------|------|
| 左侧上下文面板 | SOP Center 说明 + Platform/Workspace 统计 |
| 主区域 | SOP 列表（卡片式，按来源分组） + 详情面板 + 新建/编辑表单 |

交互：
- 列表点击 → 展开详情（stage definitions、transitions、roles、handbook 内容）
- 详情区顶部 → 编辑 / 删除按钮
- 编辑 → 预填表单（与新建表单复用，key 字段只读）
- 删除 → 二次确认弹窗

### 设计约束摘要

开发者快速参考——从设计章节提取的关键边界和语义不变量：

| 约束 | 说明 |
|------|------|
| 快照是 issue 运行时的唯一 SOP 数据来源 | 12 个运行时路径必须从 `issue.sop_snapshot` 读取，禁止回退到 FileConfigStore |
| 快照包含全量 SOP 配置（含 handbook） | 不做选择性快照——删除 handbook 会断裂引用 |
| 快照在 issue 创建时一次性写入，后续不可变 | 不更新已有 issue 的快照，SOP 模板变更只影响新 issue |
| SOP key 创建后不可改 | key 是文件系统路径的一部分（`config/sop/<key>/`） |
| 删除 SOP 不级联清理 WorkspaceSop 绑定 | 已有 issue 不受影响（快照机制），workspace 管理者自行处理绑定清理 |
| 无兼容层 | `SopSnapshotReader` 是唯一读取入口，无 LiveSopReader fallback |
| 无历史迁移 | 旧 issue 直接废弃，DB 可重建 |
| FileConfigStore SOP 缓存已移除 | SOP 读取按需解析 YAML，workspace 缓存保留 |

## 生效路径

- `src/persistence/` — issue 表 schema、createIssue 方法、FileConfigStore SOP 写入/删除
- `src/workspace-workflow/` — workflow.ts、manager-collaboration.ts、manager-detail.ts、manager.ts
- `src/interaction-entry/api/server.ts` — SOP 路由（PATCH/DELETE）
- `src/web/` — SOP Center 前端视图
- 新增 `src/workspace-workflow/sop-snapshot-reader.ts` — 快照读取器

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件/模块 | 变更类型 | 说明 |
|----------|---------|------|
| `src/persistence/schema.ts` | 修改 | issue 表新增 `sop_snapshot` 列 |
| `src/persistence/store.ts` | 修改 | createIssue 接受 sopSnapshot 参数 |
| `src/workspace-workflow/sop-snapshot-reader.ts` | 新增 | 快照读取器，提供 issue 运行时全部 SOP 查询方法 |
| `src/workspace-workflow/workflow.ts` | 修改 | createIssueWorkflow 捕获快照；transitionIssueStage、checkGateEvidence、createIssueStage 等改为从快照读取 |
| `src/workspace-workflow/manager-collaboration.ts` | 修改 | buildWorkflowSystemPrompt、appendTransitionHint 改为从快照读取 |
| `src/workspace-workflow/manager-detail.ts` | 修改 | buildStageDetail 改为从快照读取 |
| `src/workspace-workflow/manager.ts` | 修改 | setIssueRoleSnail 改为从快照读取 |
| `src/persistence/file-config-store.ts` | 修改 | 新增 updatePlatformSop、deletePlatformSop 方法 |
| `src/persistence/store.ts` | 修改 | 代理 updatePlatformSop、deletePlatformSop |
| `src/workspace-workflow/manager.ts` | 修改 | 代理 updatePlatformSop、deletePlatformSop |
| `src/interaction-entry/api/server.ts` | 修改 | 新增 PATCH/DELETE /api/sops/:sopId 路由 |
| `src/web/sop-center-view.js` | 修改 | 详情区增加编辑/删除按钮，编辑表单，删除确认 |
| `src/web/ui-shell.js` | 已完成 | SOP 导航按钮、面板、上下文面板 |
| `src/web/primary-view.js` | 已完成 | 注册 sops 视图 |
| `src/web/app.js` | 已完成 | 接入 SOP Center |

## 验证

### P1

- [ ] 新建 issue 后，`issue.sop_snapshot` 包含完整 SOP 配置（transitions、stage_definitions、roles、handbook）
- [ ] 修改 SOP 模板后，已有 issue 的推进校验不受影响（仍用旧快照）
- [ ] 修改 SOP 模板后，新建 issue 使用最新配置
- [ ] 删除 SOP 模板后，已有 issue 仍可正常推进（从快照读取）
- [ ] AI 系统提示词中的 stage 元数据、角色 handbook、shared_handbook 来自快照
- [ ] Stage 详情 API 返回的数据来自快照

### P2

- [ ] SOP 列表展示所有 Platform + Workspace SOP，按来源分组
- [ ] 点击 SOP 卡片查看详情（stage definitions、transitions、roles）
- [ ] 新建 SOP 表单提交后，YAML 文件写入 `config/sop/<key>/`，列表刷新
- [ ] 编辑 SOP 后，YAML 文件更新，下次读取生效
- [ ] 删除 SOP 后，YAML + handbook 文件移除
- [ ] 删除 SOP 后，已绑定该 SOP 的 workspace 不报错（WorkspaceSop 引用变为悬空，但 issue 运行不受影响）

## 关联

- **前置**: F2026060302（SOP handbook 外提）— 快照结构依赖当前 SOP 目录布局
- **依赖**: P1（快照）是 P2（CRUD）的前提——没有快照，编辑/删除 SOP 会破坏运行中的 issue

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|-----------|------|------|
| 1 | 快照 vs 版本化 vs 活跃检查 | 选择快照：不碰文件模型，不引入新概念，issue 自带 SOP 全貌 | 2026-06-04 |
| 2 | Handbook 是否纳入快照 | 是。删除 handbook 会让实时引用断裂，且 handbook 是 SOP 的一部分 | 2026-06-04 |
| 3 | 是否做历史 issue 迁移 | 否。旧 issue 直接废弃，DB 可重建，干净利落 | 2026-06-04 |
| 4 | 是否保留兼容层（LiveSopReader） | 否。一次性做干净，无 fallback | 2026-06-04 |
| 5 | 删除 SOP 是否级联清理 WorkspaceSop 绑定 | 是。自动清理引用该 SOP 的绑定并返回受影响 workspace 列表。已有 issue 不受影响（快照机制） | 2026-06-04 |
| 6 | SOP key 是否可编辑 | 否。key 是文件系统路径的一部分（`config/sop/<key>/`），创建后不可改 | 2026-06-04 |
| 7 | FileConfigStore SOP 缓存是否保留 | 已移除。SOP 读取改为按需解析 YAML 文件，workspace 缓存保留 | 2026-06-04 |
