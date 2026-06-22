---
id: F2026062206
title: snail-den-crud
from_ids: []
tags: [snail, crud, ui, config-management]
modules: [snail, web, api]
doc_kind: spec
---

# F2026062206 [snail] Snail Den CRUD 能力

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

Snail Den 页面当前是纯展示页面，通过 `GET /api/snail-den` 读取 `data/file/snails.json` 中的 Snail 模板列表并以卡片网格展示。用户无法通过界面新增、修改或删除 Snail 配置，只能手动编辑 JSON 文件。

用户需要完整的展示、新增、修改、删除能力，底层持久化为文件（`data/file/snails.json`）。

## 目标

### P1 — Snail CRUD 全链路

为 Snail Den 页面补全 CRUD 能力：

1. **后端 API**：在现有 `GET /api/snail-den` 基础上，新增 `POST`、`PATCH`、`DELETE` 端点
2. **持久层**：扩展 `SnailRepository` 接口和 `FileSnailRepository` 实现，支持对 `data/file/snails.json` 的写入
3. **前端 UI**：Snail Den 页面从纯展示升级为可交互的 CRUD 界面（新增按钮、编辑表单、删除确认）

## 非目标

1. **不涉及 v1 架构**：本次只改 `src/` 新架构，不改 `v1/`
2. **不涉及 SnailInstance 管理**：运行时实例（`snail_instance` 表）不在本次范围内
3. **不涉及 agent_name 枚举校验**：`agent_name` 为自由字符串，不校验是否在 AgentRegistry 中注册。前端可做软警告提示，但不阻断提交
4. **不涉及 `/api/snails` 路由别名清理**：现有 `/api/snails` 和 `/api/snail-den` 两个路由指向同一数据源，本次不处理合并

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当用户提交创建 Snail 请求且 key 唯一、必填字段完整时 | 系统应该创建 Snail 并持久化到 `snails.json`，返回 201 和完整 Snail 对象 | |
| B2 | 当用户提交创建 Snail 请求但 key 已存在时 | 系统应该返回 409 Conflict，不修改文件 | |
| B3 | 当用户提交创建 Snail 请求但缺少必填字段（key/name/agent_name/model）或 key 格式不合法时 | 系统应该返回 400，不修改文件 | |
| B4 | 当用户提交更新 Snail 请求且目标 key 存在时 | 系统应该按请求体中的字段部分更新 Snail（key 不可修改），持久化并返回更新后的完整对象 | |
| B5 | 当用户提交更新 Snail 请求但目标 key 不存在时 | 系统应该返回 404 | |
| B6 | 当用户提交删除 Snail 请求且该 Snail 无活跃引用时 | 系统应该删除该 Snail，持久化并返回 200 | |
| B7 | 当用户提交删除 Snail 请求但该 Snail 存在活跃引用时 | 系统应该返回 409 Conflict，不删除。活跃引用的定义见"删除保护策略"章节 | |
| B8 | 当用户提交删除 Snail 请求但目标 key 不存在时 | 系统应该返回 404 | |
| B9 | 当用户访问 Snail Den 页面时 | 系统应该展示 Snail 列表，每张卡片提供编辑和删除按钮，页面顶部提供新增入口 | |
| B10 | 当 `snails.json` 文件不存在时，系统执行任何读取操作 | 系统应该视为空列表，不报错 | |
| B11 | 当用户提交更新 Snail 请求且 body 中包含 key 字段时 | 系统应该返回 400，拒绝修改 key | |
| B12 | 当用户提交更新 Snail 请求且 body 为空或只包含 key 时 | 系统应该返回 400，提示至少需要一个可修改字段 | |
| B13 | 当 `snails.json` 文件存在但 JSON 格式损坏时，系统执行任何读取操作 | 系统应该记录 error log 并视为空列表，不导致服务启动失败 | |

## 设计

### 数据模型

保持现有 `Snail` 接口不变（`src/domain/snail/model.ts`）：

```typescript
interface Snail {
  key: string;          // 唯一标识，创建后不可修改
  name: string;         // 显示名称
  agent_name: string;   // 对应 acs agent 的 name
  model: string;        // 模型标识
  context_window?: number;
  invocation_timeout_ms?: number;
}
```

**设计决策：不新增字段**。当前模型已满足 Snail 作为"可调用 AI Agent 配置声明"的语义。`key` 作为不可变主键，`name` 作为显示名，`agent_name` + `model` 作为运行时绑定——职责清晰，无需扩展。

### 持久层设计

**扩展 `SnailRepository` 接口**（`src/domain/snail/_internal/repository.ts`）：

```typescript
export interface SnailRepository {
  // 现有
  list(): Snail[];
  findByKey(key: string): Snail | undefined;
  findInstanceById(id: string): SnailInstance | undefined;
  createInstance(instance: SnailInstance): void;
  updateInstanceSessionIds(id: string, sessionIds: string[]): void;

  // 新增
  create(snail: Snail): void;
  update(key: string, patch: Partial<Omit<Snail, 'key'>>): Snail;
  remove(key: string): void;
  countInstancesByKey(key: string): number;
}
```

**扩展 `SnailPort` 接口**（`src/domain/snail/port.ts`）：

```typescript
export interface SnailPort {
  // 现有
  list(): Snail[];
  invokeFirstCall(...): Promise<SnailInvokeResult>;
  invokeResume(...): Promise<SnailInvokeResult>;

  // 新增
  create(snail: Snail): Snail;
  update(key: string, patch: Partial<Omit<Snail, 'key'>>): Snail;
  remove(key: string): void;
}
```

**`SnailAdapter` 实现要点**（`src/domain/snail/_internal/adapter.ts`）：

- `create(snail)`：委托 `repo.create(snail)`，返回创建后的 Snail
- `update(key, patch)`：委托 `repo.update(key, patch)`
- `remove(key)`：执行删除保护检查（见下方），通过后委托 `repo.remove(key)`
- 删除保护检查在 Adapter 层组装，因为需要跨 Repository 查询：
  - `repo.countInstancesByKey(key)` → 查 `snail_instance` 表
  - 通过注入的 `IssuePort`（或直接注入 `RoleSnailAssignmentRepository`）查询 in_progress stage 引用
  - 任一检查不通过则抛出错误，路由层捕获后返回 409

**`FileSnailRepository` 实现要点**：

- `create(snail)`：校验 key 不重复 → 写入文件 → 更新内存 Map（write-through）
- `update(key, patch)`：查找 → 合并 patch（key 不可覆盖）→ 写入文件 → 更新 Map
- `remove(key)`：从 Map 移除 → 写入文件 → 确认持久化成功
- `countInstancesByKey(key)`：`SELECT COUNT(*) FROM snail_instance WHERE snail_key = ?`
- 文件不存在时初始化为空列表 `{ snails: [] }`
- 文件存在但 JSON 解析失败时：记录 error log，备份损坏文件为 `snails.json.corrupt.<timestamp>`，视为空列表

**写回策略**：每次变更后整体写回 `snails.json`。Snail 数量级小（通常 <20），整体写回简单可靠，无需增量写入。

**写入顺序**：采用 write-through 语义——先写文件，成功后再更新内存 Map。这样即使写入失败（磁盘满、权限不足），内存 Map 仍保持上一个一致状态，不会出现内存与文件不一致。

### 删除保护策略

**实现位置**：在 `SnailAdapter.remove()` 中组装检查，因为需要跨 Repository 查询。`SnailAdapter` 通过构造函数注入 `SnailRepository`（已有）和 `IssuePort`（或 `RoleSnailAssignmentRepository`），分别查询两个来源。

**检查范围**：删除前检查两个来源，任一存在引用则阻止删除：

1. **`snail_instance` 表**（通过 `SnailRepository.countInstancesByKey`）：
   ```sql
   SELECT COUNT(*) FROM snail_instance WHERE snail_key = ?
   ```
2. **`role_snail_assignment` 表关联 in_progress stage**（通过 `RoleSnailAssignmentRepository` 或 `IssuePort`）：
   ```sql
   SELECT COUNT(*) FROM role_snail_assignment rsa
     JOIN stage s ON rsa.stage_id = s.id
     WHERE rsa.snail_key = ?
       AND s.entered_at IS NOT NULL
       AND s.left_at IS NULL
   ```

**设计理由**：
- 只查 `snail_instance` 存在保护窗口漏洞：stage 已创建并分配了 snail_key，但 `invokeFirstCall` 尚未调用（instance 未创建），此时删除 snail 不会被阻止，后续 stage 推进时 `SnailAdapter.findSnailOrThrow` 会抛出 `Snail not found` 错误
- 只检查 `in_progress` 的 stage：已完成的 stage（`left_at IS NOT NULL`）是历史记录，不需要 snail 配置存在
- `snail_instance` 表无清理机制，一旦创建永远存在——当前阶段不引入 TTL 清理，错误消息返回实例数量让用户了解情况

**错误消息**：`Cannot delete snail 'xxx': N instance(s) and M in-progress stage(s) reference it`

### API 设计

路由统一挂载在 `meta.route.ts` 中（与现有 `GET /api/snail-den` 同文件），路径 `/api/snail-den`：

| 方法 | 路径 | Body | 响应 | 错误码 |
|------|------|------|------|--------|
| GET | `/api/snail-den` | — | `Snail[]` | — |
| POST | `/api/snail-den` | `{ key, name, agent_name, model, context_window?, invocation_timeout_ms? }` | `Snail` (201) | 400 缺字段, 409 key 重复 |
| PATCH | `/api/snail-den/:key` | `Partial<Omit<Snail, 'key'>>` | `Snail` (200) | 400 校验失败, 404 不存在 |
| DELETE | `/api/snail-den/:key` | — | `{ ok: true }` (200) | 404 不存在, 409 有活跃引用 |

**校验规则**（zod schema）：
- 创建：`key` 为必填，格式 `[a-zA-Z0-9_-]+`（URL path param 安全要求）；`name`, `agent_name`, `model` 为必填字符串（非空 trim）；`context_window` 和 `invocation_timeout_ms` 为可选非负整数
- 更新：所有字段可选，但至少提供一个非 key 字段；`key` 不可出现在 body 中；`context_window` 和 `invocation_timeout_ms` 为可选非负整数
- 删除：无 body，仅 path param

**路由归属决策**：新增 CRUD 端点放在 `meta.route.ts` 中（与现有 `GET /api/snail-den` 同文件），而非独立路由文件。理由：Snail Den 的 CRUD 是对同一数据源的增删改查，与现有 GET 端点语义一致，放在一起便于维护。

**CRUD 端点路径说明**：CRUD 端点（POST/PATCH/DELETE）只暴露在 `/api/snail-den` 路径下，不暴露在 `/api/snails` 路由别名下。`/api/snails` 保持只读（仅 GET），与非目标第 4 条一致。

### 前端设计

**SnailDen 页面改造**（`src/web/pages/SnailDen.tsx`）：

1. **新增入口**：页面标题区域添加"新增 Snail"按钮
2. **卡片交互**：每张卡片右侧添加编辑（铅笔图标）和删除（垃圾桶图标）按钮
3. **编辑/创建表单**：使用 Dialog/Modal 形式，字段与 Snail 模型对齐
   - `key`、`name`、`agent_name`、`model`：text input，必填（创建时）/ 只读（编辑时 key）
   - `context_window`：number input，`min="0" step="1"`，可选，placeholder 显示默认值（如 "默认: 1000000"）
   - `invocation_timeout_ms`：number input，`min="0" step="1"`，可选，placeholder 显示默认值（如 "默认: 7200000 (2小时)"）
   - 表单校验：前端使用 zod 做客户端校验，与后端 schema 语义对齐
   - 错误提示：表单内联方式（字段下方红色文字），如 409 key 重复时在 key 字段下方显示
   - agent_name 软警告：输入框下方显示"此 agent_name 未在系统中注册，实际调用时可能失败"（仅当 agent_name 不在已知列表时）
4. **删除确认**：二次确认 Dialog，提示"删除后不可恢复"
5. **空列表状态**：显示引导文案"还没有 Snail，点击新增创建第一个"
6. **加载状态**：mutation hooks 返回 `isPending` 状态，操作进行中按钮显示 loading 并禁用，防止重复提交

**数据层扩展**（`src/web/queries/meta.queries.ts`）：

新增 mutation hooks：
- `useCreateSnail()` → `POST /api/snail-den`
- `useUpdateSnail()` → `PATCH /api/snail-den/:key`
- `useDeleteSnail()` → `DELETE /api/snail-den/:key`

**API 契约扩展**（`src/api-contracts/endpoints.ts`）：

```typescript
"POST /api/snail-den": EndpointDef<never, never, CreateSnailBody, SnailDenTemplateDto>;
"PATCH /api/snail-den/:key": EndpointDef<{ key: string }, never, UpdateSnailBody, SnailDenTemplateDto>;
"DELETE /api/snail-den/:key": EndpointDef<{ key: string }, never, never, { ok: true }>;
```

### 错误处理

| 场景 | HTTP 状态码 | 错误消息 |
|------|------------|----------|
| 创建时 key 重复 | 409 | `Snail with key 'xxx' already exists` |
| 创建时缺少必填字段 | 400 | 具体字段名 |
| 创建时 key 格式不合法 | 400 | `key must match pattern [a-zA-Z0-9_-]+` |
| 更新时 key 不存在 | 404 | `Snail not found: xxx` |
| 更新时 body 为空或只含 key | 400 | `At least one non-key field must be provided` |
| 更新时 body 包含 key | 400 | `key cannot be modified` |
| 删除时 key 不存在 | 404 | `Snail not found: xxx` |
| 删除时有活跃引用 | 409 | `Cannot delete snail 'xxx': N instance(s) and M in-progress stage(s) reference it` |

## 生效路径

- **代码**：`src/domain/snail/` 下的 model、repository、port、adapter
- **代码**：`src/infra/http/routes/` 下的路由文件
- **代码**：`src/api-contracts/endpoints.ts` 和 `dto.ts` 中的类型定义
- **代码**：`src/web/pages/SnailDen.tsx` 和 `src/web/queries/meta.queries.ts`
- **配置**：`data/file/snails.json` 作为 Snail 配置的唯一真值源

## 设计约束摘要

- **边界**：只改 `src/` 新架构，不碰 `v1/`；只管 Snail 配置 CRUD，不管 SnailInstance 运行时
- **关键决策**：`key` 为不可变主键，创建后不可修改，格式 `[a-zA-Z0-9_-]+`；删除前必须检查 `snail_instance` + `role_snail_assignment`（仅 in_progress stage）；写入采用 write-through 语义；删除保护检查在 Adapter 层组装
- **非目标约束**：不校验 `agent_name` 是否在 AgentRegistry 中注册（前端可做软警告）；不合并 `/api/snails` 和 `/api/snail-den` 路由别名
- **语义不变量**：`snails.json` 是 Snail 配置的唯一真值源；所有变更必须通过 Repository 接口写入文件；内存缓存与文件必须保持一致
- **并发假设**：假设单实例单用户部署，无并发写入场景。不处理多 tab 竞态（同一用户在多个浏览器 tab 操作可能导致 Lost Update）。多实例部署时此假设将失效
- **文件损坏处理**：`snails.json` JSON 解析失败时，备份损坏文件为 `snails.json.corrupt.<timestamp>`，视为空列表继续运行

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/domain/snail/model.ts` | 不变 | Snail 接口无需修改 |
| `src/domain/snail/_internal/repository.ts` | 修改 | 扩展接口 + 实现 create/update/remove/countInstancesByKey |
| `src/domain/snail/port.ts` | 修改 | 扩展 SnailPort 接口，新增 create/update/remove 方法 |
| `src/domain/snail/_internal/adapter.ts` | 修改 | 实现新增的 port 方法 + 删除保护检查逻辑（跨 Repository 组合查询） |
| `src/infra/http/routes/meta.route.ts` | 修改 | 新增 POST/PATCH/DELETE 路由 |
| `src/api-contracts/endpoints.ts` | 修改 | 新增 endpoint 类型定义 |
| `src/api-contracts/dto.ts` | 修改 | 新增 CreateSnailBody / UpdateSnailBody 类型 |
| `src/web/pages/SnailDen.tsx` | 修改 | 从纯展示升级为 CRUD 界面 |
| `src/web/queries/meta.queries.ts` | 修改 | 新增 mutation hooks |
| `src/web/queries/keys.ts` | 不变 | queryKey 已有 `["meta", "snail-den"]` |

## 验证

### P1

- [ ] 创建 Snail：POST 请求成功后 `snails.json` 文件中出现新记录
- [ ] 重复 key 创建：返回 409，文件不变
- [ ] 缺字段创建：返回 400，文件不变
- [ ] key 格式不合法创建（如含空格、斜杠）：返回 400，文件不变
- [ ] 更新 Snail：PATCH 请求成功后文件中对应记录已更新
- [ ] 更新时 body 包含 key：返回 400
- [ ] 更新时 body 为空或只含 key：返回 400
- [ ] 更新不存在的 Snail：返回 404
- [ ] 删除 Snail：DELETE 请求成功后文件中对应记录已移除
- [ ] 删除有 snail_instance 记录的 Snail：返回 409
- [ ] 删除有 in_progress stage 引用的 Snail：返回 409
- [ ] 删除不存在的 Snail：返回 404
- [ ] 前端：新增按钮可点击，表单提交后列表刷新
- [ ] 前端：编辑按钮可点击，表单预填当前值，提交后列表刷新
- [ ] 前端：删除按钮触发确认 Dialog，确认后列表刷新
- [ ] 前端：表单校验错误以内联方式展示
- [ ] 前端：mutation 进行中按钮 loading 禁用
- [ ] 前端：空列表显示引导文案
- [ ] 文件不存在时读取：返回空列表，不报错
- [ ] 文件 JSON 格式损坏时读取：返回空列表，不报错，且生成 `snails.json.corrupt.<timestamp>` 备份文件

## 关联

- **相关**: F2026060112（配置表文件化——文件为唯一真值源，本 feature 遵循其架构约束）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|---------|---------|---------|---------|--------|------|
| D1 | 持久化方式：文件直写 vs DB 中转 | 文件直写：与 F2026060112 架构约束一致（配置文件为唯一真值源），实现简单，无需同步机制 | DB 中转：可利用事务保证一致性，支持并发写入 | 文件直写 | 架构约束明确要求配置类数据以文件为源头；Snail 数量级小（<20），无并发写入场景 | 架构师-1 | 2026-06-22 |
| D2 | key 是否可修改 | 不可修改：key 是 Snail 的稳定标识，被 `role_snail_assignment`、`snail_instance` 等引用，修改会破坏引用完整性 | 可修改：用户体验更灵活，可通过级联更新解决引用问题 | 不可修改 | 引用链路长（issue→stage→role→snail），级联更新成本高且易出错；key 作为标识符的语义等同于主键，不应变更 | 架构师-1, 架构师-2 | 2026-06-22 |
| D3 | 删除保护策略 | 阻止删除：有活跃引用时不允许删除，避免运行时找不到 snail 配置 | 允许删除但标记：软删除，运行时仍可引用，但增加复杂度 | 阻止删除 | 硬删除 + 活跃引用检查是最简单的安全策略；软删除引入状态管理复杂度，不符合当前需求 | 架构师-1, 架构师-2 | 2026-06-22 |
| D4 | 路由归属 | 放 meta.route.ts：与现有 GET 端点同源，语义一致 | 独立 snail.route.ts：职责更清晰，路由文件更小 | 放 meta.route.ts | Snail Den 的 CRUD 是对同一数据源的操作，放在一起更内聚；文件不大，无需拆分 | 架构师-1 | 2026-06-22 |
| D5 | 删除保护检查范围 | 扩大检查：查 `snail_instance` + `role_snail_assignment`（仅 in_progress stage），既防止运行时故障又不限制历史删除 | 只查 `snail_instance`：仅阻止有运行时实例的删除，实现更简单 | 扩大检查 | 架构师-2 审视发现：只查 `snail_instance` 存在保护窗口漏洞——stage 已分配 snail_key 但 instance 未创建时删除不会被阻止，后续 stage 推进会崩溃。扩大到 in_progress stage 引用可堵住此漏洞，同时不限制已完成 stage 的历史删除 | 架构师-1, 架构师-2 | 2026-06-22 |
| D6 | 写入顺序 | write-through：先写文件再更新 Map，保证文件与内存一致 | write-back：先更新 Map 再写文件，实现更简单但失败时可能不一致 | write-through | 架构师-2 审视指出：write-back 在写入失败时会导致内存已更新但文件未更新的不一致状态。write-through 语义更安全 | 架构师-1, 架构师-2 | 2026-06-22 |
| D7 | 并发安全假设 | 声明单用户单实例假设：当前部署模式下无并发写入，无需引入锁机制 | 引入文件锁：使用 `proper-lockfile` 等库保证并发安全 | 声明假设 | 当前为单用户单实例部署，并发写入概率极低；引入文件锁增加依赖和复杂度，不符合当前需求。在设计约束摘要中显式声明此假设，多实例部署时需重新评估 | 架构师-1, 架构师-2 | 2026-06-22 |
| D8 | 文件损坏时的数据丢失 | 备份损坏文件：写回前检测到解析失败时，备份为 `snails.json.corrupt.<timestamp>`，然后视为空列表。用户创建新 snail 后写回不会覆盖原始损坏数据 | 声明可接受：不备份，用户自行承担风险，实现更简单 | 备份损坏文件 | 架构师-2 审视发现：文件损坏后读取返回空列表，用户创建新 snail 写回会覆盖原数据。备份是简单的安全措施，成本低（一个文件重命名），收益高（保留原始数据供恢复） | 架构师-1, 架构师-2 | 2026-06-22 |
| D9 | `hasActiveReferences` 实现位置 | 放在 Adapter 层：`SnailAdapter` 已注入多个 Port，组合查询是 Adapter 的职责 | 放在 Repository 层：`FileSnailRepository` 需要注入 `RoleSnailAssignmentRepository`，增加耦合 | 放在 Adapter 层 | `SnailAdapter` 当前已注入 `TenetPromptPort`、`SkillPort`、`MCPPort` 等，组合多源查询是其既有模式。Repository 层不应跨域引用其他 Repository | 架构师-1, 架构师-2 | 2026-06-22 |

## 范围变更记录

| 日期 | 变更内容 | 原因 | 用户确认 |
|------|---------|------|---------|
| 2026-06-22 | 补充 SnailPort 接口变更、删除保护实现位置、key 格式约束、文件损坏备份、多 tab 竞态声明 | 架构师-2 第二轮对抗性审视发现设计遗漏 | 待确认 |
