# SOP 域业务场景

## 场景清单

### S1: 列出可用 SOP

**触发**：用户打开 Issue 创建页面，需要选择一个 SOP。

**参与者**：前端、SopService

**流程**：
1. 前端调用 `SopService.listDefinitions()`
2. SopService 委托 SopRepo 读取平台级 + workspace 级 YAML 文件
3. 返回 `SopDefinition[]`（含 sop 主体、stages、transitions）

**数据流**：
```
前端 → SopService.listDefinitions() → SopRepo.listAll() → 读 YAML 文件 → SopDefinition[]
```

**备注**：纯读取，无副作用。平台 SOP 有内存缓存，workspace SOP 每次从磁盘读。

---

### S2: 查看 SOP 详情

**触发**：用户在 SOP Center 查看某个 SOP 的阶段、转移、角色详情。

**参与者**：前端、SopService

**流程**：
1. 前端调用 `SopService.getDefinition(sopId)`
2. SopService 委托 SopRepo 按 ID 查找
3. 返回完整的 `SopDefinition`

**数据流**：
```
前端 → SopService.getDefinition(sopId) → SopRepo.getById(sopId) → SopDefinition
```

---

### S3: 创建 Issue 时捕获 SOP 快照

**触发**：用户选择 SOP 并创建 Issue。

**参与者**：IssueService、SopService、SopSnapshotReader

**流程**：
1. IssueService 收到 `CreateIssueInput`（含 `sop_id`）
2. 调用 `SopService.getDefinition(sopId)` 获取当前 SOP 定义
3. 调用 `SopService.captureSnapshot(definition)` 将 SOP 定义冻结为 `SopSnapshot`
4. 将 snapshot 存入 `issue.sop_snapshot`
5. 基于 snapshot 的 `first_stage` 和 `stage_definitions` 创建初始 Stage

**数据流**：
```
IssueService.createIssue()
  → SopService.getDefinition(sopId)     → SopDefinition
  → SopService.captureSnapshot(definition) → SopSnapshot
  → IssueRepo.create(issue with snapshot)
  → IssueRepo.createStage(initial stage)
```

**关键约束**：snapshot 一旦写入不可变。后续所有运行时读取都从 snapshot 而非 live template。

---

### S4: 运行时查询快照（阶段转移、Gate 检查、角色解析）

**触发**：Stage 推进、Gate 验收、AI Prompt 构建等运行时操作需要查询 SOP 信息。

**参与者**：IssueService、SopSnapshotReader

**流程**：
1. IssueRepo 读取 `issue.sop_snapshot`，反序列化为 `SopSnapshot`
2. 构造 `SopSnapshotReader(snapshot)` 提供统一查询接口
3. 通过 reader 查询：
   - `getTransitions(fromStageKey)` — 可转移到哪些阶段
   - `validateTransition(from, to)` — 转移是否合法（含 guard 检查）
   - `getStageDefinition(stageKey)` — 阶段定义详情
   - `getRolesForStage(stageKey)` — 该阶段的角色列表（含 count 展开）
   - `getAllRoles()` — 所有角色
   - `getAcceptanceChecklist(stageKey)` — 验收检视清单

**数据流**（以推进阶段为例）：
```
IssueService.advanceStage(issueId, currentStageId)
  → IssueRepo.getById(issueId) → Issue (含 sop_snapshot JSON)
  → new SopSnapshotReader(issue.sop_snapshot)
  → reader.validateTransition(current.key, next.key) → boolean
  → reader.getStageDefinition(next.key) → StageDefinition
  → IssueRepo.createStage(next stage)
```

**关键约束**：永远不读 live template，只读 snapshot。

---

### S5: 创建/更新/删除 SOP（SOP Center CRUD）

**触发**：管理员在 SOP Center 管理 SOP 模板。

**参与者**：SopService、SopRepo（文件写入）

**流程**：

**创建**：
1. 接收 `CreateSopInput`（name, description, stages, transitions, roles）
2. 生成 YAML 文件写入 `config/sop/<key>/<key>.yaml`
3. 如果有 handbook，写入对应的 `.handbook.md` 文件
4. 清除平台缓存
5. 返回创建的 `SopDefinition`

**更新**：
1. 接收 `UpdateSopInput`（sopId, 可更新字段）
2. 读取现有 YAML，合并更新
3. 写回 YAML 文件
4. 清除平台缓存
5. 返回更新后的 `SopDefinition`

**删除**：
1. 删除 YAML 文件及关联的 handbook 文件
2. 清除平台缓存
3. 返回受影响的 workspace 列表（adopted_sop_ids 引用了该 SOP 的 workspace）

**数据流**：
```
前端 → SopService.createSop(input) → SopRepo.writeYaml() → 清缓存 → SopDefinition
前端 → SopService.updateSop(input) → SopRepo.readYaml() + writeYaml() → 清缓存 → SopDefinition
前端 → SopService.deleteSop(sopId) → SopRepo.deleteYaml() → 清缓存 → { affected_workspaces }
```

**关键约束**：CRUD 只操作 live template，不影响已创建的 Issue（它们用的是 snapshot）。

---

### S6: 角色展开（count > 1）

**触发**：运行时需要实例化某个阶段的角色，该角色定义了 `count > 1`。

**参与者**：SopSnapshotReader

**流程**：
1. 角色定义 `{ key: "reviewer", count: 2 }` 存在于 snapshot 中
2. `SopSnapshotReader.getRolesForStage("review")` 返回展开后的列表：
   - `{ key: "reviewer", ... }`
   - `{ key: "reviewer-2", ... }`
3. 展开在读取时发生，不在快照捕获时发生（保持 snapshot 紧凑）

**关键约束**：展开是纯函数，不修改 snapshot 数据。

---

## 模块边界

### SOP 域拥有的概念

| 概念 | 归属 | 说明 |
|------|------|------|
| Sop | SOP 域 | SOP 模板主体 |
| StageDefinition | SOP 域 | 阶段定义模板 |
| Transition | SOP 域 | 阶段转移定义 |
| TransitionGuard | SOP 域 | 转移守卫 |
| SopSnapshot | SOP 域 | 冻结的 SOP 副本 |
| SnapshotRoleDefinition | SOP 域 | 快照中的角色定义 |
| SopSnapshotReader | SOP 域 | 快照查询适配器 |

### SOP 域不拥有的概念

| 概念 | 归属 | 与 SOP 的关系 |
|------|------|--------------|
| Issue | issue 域 | Issue 持有 SopSnapshot |
| Stage | issue 域 | Stage 引用 StageDefinition |
| SnailTemplate | snail 域 | 通过 SnapshotRoleDefinition.snail_template_id 引用 |
| Workspace | workspace 域 | Workspace 通过 adopted_sop_ids 引用 SOP |

### 依赖方向

```
services/ (IssueService)
  → sop/api.ts (SopService)
  → sop/_internal/service.ts (SopServiceImpl)
  → db/sop.repo.ts (SopRepo, 文件实现)
```

```
services/ (IssueService)
  → sop/api.ts → SopSnapshotReader (运行时查询快照)
  → issue/repo.ts (IssueRepo, 读写 issue.sop_snapshot)
```

SOP 域是被动的——它不主动调用其他域，只被调用。
