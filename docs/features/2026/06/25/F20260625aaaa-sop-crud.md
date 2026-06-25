---
id: F20260625aaaa
title: sop-crud
from_ids: []
tags: [sop, crud, yaml-cleanup]
modules: [sop, web]
doc_kind: spec
change_type: feature
---

# F20260625aaaa [sop] SOP CRUD 增删改查 + 清理 YAML 冗余字段

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

SOP 模块存在两个问题：

### 问题 1：YAML 模型偏差

SOP YAML 文件中存在 6 个 TypeScript 模型未映射的字段：

| 字段 | 所属层级 | 运行时状态 |
|------|---------|-----------|
| `first_stage` | Sop 顶层 | 未读取，代码用 `stage_definitions[0]` 替代 |
| `sequence` | StageDefinition | 未读取，代码依赖数组顺序 |
| `input_description` | StageDefinition | 未读取，未注入 agent 上下文 |
| `output_description` | StageDefinition | 未读取，未注入 agent 上下文 |
| `acceptance_focus` | StageDefinition | 未读取，未注入 agent 上下文 |
| `acceptance_checklist` | StageDefinition | 未读取，未注入 agent 上下文 |

Parser 静默丢弃这些字段，导致 YAML 中的结构化元数据在加载后消失。这些字段与 skill 文件内容高度重叠（skill 是运行时唯一真相源），形成双重真相源。

### 问题 2：只读限制

SOP 模块只能在启动时从文件系统一次性加载，UI 只能浏览不能编辑。新增 SOP 需要手动创建 YAML 文件并重启服务。

## 目标

1. 清理 YAML 中的冗余字段，消除与 skill 的双重真相源
2. SOP Center 页面支持完整的增删改查操作
3. CRUD 操作实时生效，无需重启服务

## 非目标

1. 将 YAML 中的冗余字段纳入 TypeScript 模型（经分析与 skill 高度重叠，不纳入）
2. 将 `first_stage` 纳入模型（用 `stage_definitions[0]` 替代即可）
3. SOP 表单支持 YAML 未映射字段的编辑

## 核心业务行为

| # | 场景 | 预期行为 |
|---|------|---------|
| B1 | 用户在 SOP Center 点击"+"创建 SOP | 弹出表单弹窗，填写 key/name/description/shared_skill/stages/transitions 后提交 |
| B2 | 用户在 SOP 列表 hover 点击 Edit | 弹出编辑弹窗，key 只读，其余字段可修改 |
| B3 | 用户在 SOP 列表 hover 点击 Del | 弹出确认弹窗，确认后删除 YAML 目录并刷新列表 |
| B4 | 创建/编辑/删除操作完成后 | 列表自动刷新，toast 提示成功/失败 |
| B5 | 已存在的 Issue 引用被删除的 SOP | 不受影响，`sop_snapshot` 是冻结副本 |

## 设计

### 变更 1：清理 YAML 冗余字段

从 4 个 SOP YAML 文件中移除模型未映射的字段。清理后 YAML 只保留 TypeScript 模型已有的字段：`name`, `description`, `shared_skill`, `stage_definitions`（含 `key`, `title`, `description`, `roles`）, `transitions`（含 `from`, `to`, `guard`）。

### 变更 2：领域层 CRUD

**SopPort** 新增 3 个方法：
- `create(sop: Sop): Sop`
- `update(key: string, patch: Partial<Omit<Sop, 'key' | 'scope'>>): Sop`
- `remove(key: string): void`

**FileSopRepository** 实现 write-through 模式：
- `create`: 校验 key 唯一性 → `ensureDir` → `writeFile` 写 YAML → 更新内存缓存
- `update`: 校验存在性 → 合并 patch → 重写 YAML → 更新缓存（支持 platform 和 workspace 两种来源）
- `remove`: 校验存在性 → `deleteDir` 删除目录 → 从缓存移除
- `serializeSop`: 将 Sop 对象序列化为 YAML 字符串，只输出非空/非默认值

### 变更 3：API 端点

| 方法 | 路径 | Body | 响应 | 错误 |
|------|------|------|------|------|
| POST | `/api/sops` | `Omit<SopDto, 'scope'>` | `SopDto` (201) | 409 已存在, 400 校验失败 |
| PATCH | `/api/sops/:sopKey` | `Partial<Omit<SopDto, 'key' | 'scope'>>` | `SopDto` | 404 未找到, 400 key/scope 不可修改 |
| DELETE | `/api/sops/:sopKey` | - | `{ ok: true }` | 404 未找到 |

路由层使用 zod 校验 body，key 格式为 `[a-zA-Z0-9_-]+`。

### 变更 4：前端 CRUD 集成

- `sop.mutations.ts`: `useCreateSop` / `useUpdateSop` / `useDeleteSop`，成功后 invalidate `queryKeys.sops.all`
- `SopFormDialog.tsx`: 嵌套表单，支持 stage_definitions（含 roles）和 transitions 的增删编辑
- `SopCenter.tsx`: 顶部"+"按钮、列表 hover Edit/Delete、详情区 Edit 按钮、删除确认弹窗

## 生效路径

1. 清理 YAML 文件后，重启服务即可看到精简后的数据
2. CRUD 操作通过 API 实时写入文件系统并更新内存缓存，无需重启

## 改动范围

| 文件 | 变更类型 |
|------|---------|
| `data/file/sops/code-delivery/code-delivery.yaml` | 修改 — 移除冗余字段 |
| `data/file/sops/code-review/code-review.yaml` | 修改 — 移除冗余字段 |
| `data/file/sops/evolution/evolution.yaml` | 修改 — 移除冗余字段 |
| `data/file/sops/general-assistant/general-assistant.yaml` | 修改 — 移除冗余字段 |
| `src/api-contracts/endpoints.ts` | 修改 — 新增 3 个端点类型 |
| `src/domain/sop/port.ts` | 修改 — 新增 create/update/remove |
| `src/domain/sop/_internal/repository.ts` | 修改 — 新增写入方法 + serializeSop |
| `src/domain/sop/_internal/adapter.ts` | 修改 — 实现新 Port 方法 |
| `src/infra/http/routes/meta.route.ts` | 修改 — 新增 registerSopRoutes |
| `src/web/mutations/sop.mutations.ts` | 新建 — 3 个 mutation hooks |
| `src/web/components/SopFormDialog.tsx` | 新建 — SOP 编辑表单弹窗 |
| `src/web/pages/SopCenter.tsx` | 修改 — 集成 CRUD 操作 |

## 验证

### 通用

- [x] TypeScript 编译通过 (`npx tsc --noEmit`)
- [x] ESLint 通过 (`npm run lint`)
- [x] 构建通过 (`npm run build`)

### 功能

- [ ] `GET /api/sops` 返回数据不含已清除字段
- [ ] `POST /api/sops` 创建新 SOP，确认 `data/file/sops/{key}/{key}.yaml` 生成
- [ ] `PATCH /api/sops/:key` 修改，确认 YAML 文件更新
- [ ] `DELETE /api/sops/:key` 删除，确认目录移除
- [ ] 重启服务确认持久化正确
- [ ] SOP Center 页面创建/编辑/删除流程正常
- [ ] NewIssueDialog 的 SOP 选择不受影响

## 关联

- **PR**: https://github.com/chenlaicai/snail-shell/pull/467

## 关键决策记录

| # | 决策点 | 最终决策 | 决策依据 |
|---|--------|---------|---------|
| D1 | YAML 中的 6 个未映射字段如何处理 | 全部从 YAML 清除，不纳入模型 | 与 skill 内容高度重叠，skill 是运行时唯一真相源，保留会形成双重真相源 |
| D2 | `first_stage` 是否纳入模型 | 不纳入，保持 `stage_definitions[0]` | 用数组第一个元素即可，没必要新增字段 |
| D3 | SOP 持久化格式 | 保持 YAML 目录结构 | 已有 4 个 SOP 文件采用此格式，YAML 适合复杂嵌套结构 |
| D4 | CRUD 模式参照 | 参照 SnailDen 的 write-through cache 模式 | 已验证的模式，一致性好 |

<!-- [design-time] 章节结束 -->
