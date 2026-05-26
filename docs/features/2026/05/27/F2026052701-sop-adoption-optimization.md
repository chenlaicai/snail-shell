---
id: F2026052701
title: sop-adoption-optimization
from_ids: [F2026052606]
tags: [sop, project-workflow, domain-model]
modules: [project_management]
doc_kind: spec
---

# F2026052701 [project_management] SOP 采用机制优化：关联替代 clone + 默认配置 + ID 规范化

## 背景

F2026052606 建立了 SOP 池 → project_sop 绑定 → feature 采用的三层域模型。但当前创建项目的代码路径绕过了绑定层：

`createInitialWorkflow`（workflow.ts:52-83）→ `seedStageDefinitionsForProject`（project-config-model.ts:109-122）**总是创建一个新的 project-scoped SOP 副本**（`sop-project-${projectId}`），即使用户想用跟全局完全一样的 SOP。

这导致三个问题：

1. **强制 clone**（#272）：创建项目时没有入口说"我要用全局 SOP X"，只能走 `seedStageDefinitionsForProject` 新建副本。每建一个项目就多一份 SOP 副本，drift 风险大。
2. **默认 SOP 无配置**（#273）：用户不指定时应自动用系统默认全局 SOP，而非硬编码。
3. **ID 不可读**（#278）：自动生成的 SOP name = `Project <UUID> SOP`，role key 用 `name.toLowerCase()` 导致中文 ID（如 `sop-project-xxx-role-研发者`）。

## 目标

改造项目创建流程的 SOP 采用入口，让数据模型的设计意图在代码路径中生效。

### P1 — 关联替代强制 clone + 系统默认 SOP

1. `createInitialWorkflow` 增加 `sopId` 参数：传入已有 SOP ID 时，直接创建 `project_sop` 绑定，不创建新 SOP。
2. 不传 `sopId` 也不传 `stageDefinitions` 时，使用系统级默认全局 SOP（从 seed 配置读取）。
3. `seedStageDefinitionsForProject` 保留，但改为"创建自定义 SOP"的显式路径——仅在传 `stageDefinitions` 时走。
4. seed 配置新增 `defaultSopForNewProjects` 字段，指定新建项目的默认全局 SOP key。

### P2 — ID 规范化

1. 自动生成的 SOP/role/stage ID 使用 ASCII kebab-case，禁止中文。
2. SOP name 使用项目名而非 UUID（如 `My Project SOP` 而非 `Project 3f8a... SOP`）。
3. role key 生成：中文名先取 `role_definition.key`（已是 ASCII），不再对 `name` 做 toLowerCase。

## 非目标

- SOP 管理 UI（#281，前端入口待建，不在本 feature）。
- Stage 流转配置化（#274，去掉硬编码 stage keys 是另一个 feature）。
- SOP 继承/覆盖机制（F2026052606 决策 #7：全局 SOP 改了不同步到 clone，drift 走手动重 clone）。
- project_sop CRUD API 改动（F2026052606 P2 已提供，本 feature 不改 API 契约）。

## 设计

### P1 详设 — 关联 + 默认 SOP

#### createInitialWorkflow 入口改造

**当前签名**（workflow.ts:52）：

```typescript
createInitialWorkflow(input: {
  module: string;
  projectName: string;
  projectRoot: string;
  stageDefinitions: StageDefinitionInput[];  // 必传，总是创建新 SOP
  // ...
})
```

**改后**：

```typescript
createInitialWorkflow(input: {
  module: string;
  projectName: string;
  projectRoot: string;
  sopId?: string;                            // 关联已有 SOP
  stageDefinitions?: StageDefinitionInput[]; // 创建自定义 SOP（可选）
  // ...
})
```

决策逻辑：

```
sopId 有值          → 直接创建 project_sop 绑定，不建新 SOP
stageDefinitions 有值 → 走 seedStageDefinitionsForProject（创建自定义 SOP）
两者都没传          → 读系统默认 SOP，创建 project_sop 绑定
两者都传            → 报错（互斥）
```

#### 系统默认 SOP 配置

seed JSON 新增顶层字段：

```json
{
  "defaultSopForNewProjects": "code-delivery",
  "sops": [...],
  "projects": [...]
}
```

`defaultSopForNewProjects` 的值是全局 SOP 的 `key`（不是 ID），因为 key 是业务语义标识。

启动时 seed 流程把该值写入一个内存常量或轻量 config 表，`createInitialWorkflow` 在"两者都没传"时读取。

解析逻辑：`key` → 查 `sop` 表 `WHERE scope = 'global' AND key = ?` → 拿到 `sop.id` → 用于 `project_sop` 绑定。

#### project_sop 绑定创建

关联路径下，`role_bindings` 从哪来？

- 如果 API 调用方传了 `roleBindings`，直接使用。
- 如果没传，从系统默认 snail-den 配置生成默认绑定（每个 role_definition.key 映射到 snail-den 中对应的默认 template）。
- 这与 seed 路径的行为一致（seed JSON 里每个 project 显式指定 role_bindings）。

### P2 详设 — ID 规范化

#### ID 生成规则

| 实体 | 当前 | 改后 |
|------|------|------|
| SOP ID | `sop-project-${projectId}` | `sop-${projectSlug}-${shortId}` |
| SOP name | `Project ${projectId} SOP` | `${projectName} SOP` |
| Role ID | `${sopId}-role-${name.toLowerCase().replace(/\s+/g, "-")}` | `${sopId}-role-${roleDefinition.key}` |
| Stage ID | 从 input 继承 | 不变 |
| Project SOP ID | `ps-${projectId}-${sopId}` | 不变（已是 ASCII） |

`projectSlug`：从项目名生成 kebab-case slug（中文名取拼音或用项目 ID 前 8 位）。`shortId`：UUID 前 8 位，防同名冲突。

#### roleKey 来源修正

**当前**（project-config-model.ts:132）：

```typescript
const roleKey = role.name.toLowerCase().replace(/\s+/g, "-");
// role.name = "研发者" → roleKey = "研发者" (中文！)
```

**改后**：

```typescript
const roleKey = role.key;  // role_definition.key 已是 ASCII: "developer"
```

F2026052606 引入 `role_definition` 时已为每个角色设了 ASCII `key`（developer / reviewer 等）。`seedStageDefinitionsForProject` 应该读 `key` 而非对 `name` 做转换。

## 生效路径

- `src/project-workflow/workflow.ts`：`createInitialWorkflow` 签名 + 决策逻辑
- `src/persistence/project-config-model.ts`：`seedStageDefinitionsForProject` ID 生成规范化 + roleKey 修正
- `.meta/project-config-seed.json`：新增 `defaultSopForNewProjects` 字段
- `src/persistence/store.ts`（或新增 config 模块）：读取 + 缓存系统默认 SOP 配置
- `src/interaction-entry/api/server.ts`：`POST /api/projects` 支持 `sopId` 参数

## 改动范围

**P1**：workflow.ts（createInitialWorkflow 签名 + 决策分支）、store.ts 或 config 模块（默认 SOP 读取）、server.ts（API 参数透传）、project-config-seed.json（defaultSopForNewProjects）、测试

**P2**：project-config-model.ts（ID 生成 + roleKey 修正）、测试

## 验证

### P1
- [ ] 创建项目传 `sopId`：直接关联全局 SOP，不创建新的 project-scoped SOP
- [ ] 创建项目不传 `sopId` 也不传 `stageDefinitions`：自动关联系统默认全局 SOP
- [ ] 创建项目传 `stageDefinitions`：走 seedStageDefinitionsForProject 创建自定义 SOP（现有行为不退化）
- [ ] 同时传 `sopId` 和 `stageDefinitions`：报错
- [ ] 关联路径创建的 project_sop 绑定正确，role_bindings 映射到 snail template
- [ ] feature 创建时从 project_sop 正确读取 adopted_sop_id 和 role_snail_mapping
- [ ] 默认 SOP 配置缺失时报可诊断错误
- [ ] seed 路径（snail-shell 自身项目）行为不回归

### P2
- [ ] 新创建的 SOP ID 为 ASCII kebab-case，不含中文
- [ ] SOP name 使用项目名而非 UUID
- [ ] role key 使用 role_definition.key（ASCII），不再从 name 转换
- [ ] 已有数据（seed 灌入的全局 SOP）不受影响

### 通用
- [ ] tsc / lint / 测试全过
- [ ] DB 不需要 schema 变更（纯代码路径改造）

## 关联

- **前置**: F2026052606（SOP 池 + project_sop 绑定层 + project_sop CRUD API）
- **相关**: #272（创建 project 时支持关联已有 SOP）
- **相关**: #273（支持配置 SOP 池默认 SOP）
- **相关**: #278（API 创建项目时 role/SOP ID 含中文、SOP name 拼 UUID 不可读）
- **相关**: #274（stage 流转可配置——依赖本 feature 稳定后再改流转逻辑）
- **相关**: #281（SOP 管理 UI——前端入口，依赖本 feature 的 API 改动）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|-----------|------|------|
| 1 | 默认 SOP 配置存在哪里 | 方案 A：seed JSON 新增 `defaultSopForNewProjects` 字段，启动时读入。显式配置比隐式约定更好读（CVO 拍板） | 2026-05-27 |
| 2 | sopId 和 stageDefinitions 是否互斥 | 互斥。同时传两者语义矛盾（"用已有的"和"建新的"不能同时成立），报错优于静默忽略其一 | 2026-05-27 |
| 3 | 关联路径的 role_bindings 从哪来 | API 调用方可传；不传时从 snail-den 默认配置生成。与 seed 行为一致 | 2026-05-27 |
| 4 | 是否需要 schema 变更 | 不需要。数据模型（sop / project_sop / role_definition）已完整支持关联语义，改的是代码路径 | 2026-05-27 |
| 5 | 中文项目名的 slug 生成 | 用项目 ID 前 8 位作为 slug fallback，不引入拼音库。简单可靠 | 2026-05-27 |

## 范围变更记录

- 2026-05-27：初始版本。从 F2026052606 What's Next 拆出，合并 #272 + #273 + #278。经 Design Gate 讨论确认 scope 和方案 A（默认 SOP 配置）。
