# SOP 模块分析（v1 遗留）

> 本文档基于 `v1/` 目录下的遗留代码分析，用于指导 v2 重写。

---

## 一、业务场景

### 1.1 SOP 是什么

SOP（Standard Operating Procedure）是 Snail Shell 的**工作流模板**。定义了一个 Issue 从创建到完成要经过哪些 Stage、每个 Stage 有哪些 Role、Stage 之间如何转换、转换需要满足什么 Guard 条件。

核心设计：**模板与快照分离**。SOP YAML 是可变的模板，Issue 创建时将 SOP 完整冻结为快照存入 `issue.sop_snapshot`，运行中所有行为读快照不读模板。

### 1.2 核心业务场景

| 场景 | 说明 |
|------|------|
| **SOP 定义与管理** | 通过 YAML 文件定义 SOP，支持平台级和 workspace 级，Web 端 CRUD |
| **Issue 创建时快照冻结** | 创建 Issue 时将选定的 SOP 完整冻结为 JSON 快照，后续不受模板变更影响 |
| **Stage 生命周期管理** | Issue 按 SOP 定义的 Stage 顺序推进，每个 Stage 有输入/输出描述、验收清单、角色定义 |
| **Stage 转换与 Guard** | 支持前进、回退（bounce），转换受 TransitionGuard 约束（如 requires_artifacts） |
| **Role 与 Handbook 注入** | 每个 Stage 定义参与角色，角色的 handbook 内容注入 Agent system prompt |
| **AI 发起的 Stage 转换** | Agent 可提议 Stage 转换，需用户确认后执行 |
| **Workspace 自定义 SOP** | workspace 可定义自己的 SOP，与平台 SOP 并存 |

### 1.3 SOP 与其他模块的关系

- **Issue**：每个 Issue 持有一个 `sop_snapshot`（冻结的 SOP）和 `role_snail_mapping`（stage+role → Snail 模板 ID）
- **Stage**：Stage 引用 SOP 的 `stage_definition_id`，转换受 SOP 的 transitions 图和 Guard 规则约束
- **Conversation**：每个 Stage 创建一个默认 Conversation，角色来自 SOP snapshot 的 role 定义
- **Role**：Role 定义嵌入 SOP Stage 定义中，包含 key、name、description、handbook、is_primary、count
- **Snail Template**：`role_snail_mapping` 将 (stage_key, role_key) 映射到 Snail 模板 ID，决定 AI 运行时、模型、上下文提供者
- **Prompt Center**：builder 使用 SOP 数据构建 system prompt，注入 stage 输入/输出描述、验收焦点、handbook 内容
- **Evolution**：EvolutionModel 从 "evolution" SOP 构建自己的快照用于治理对话
- **Skill**：正交关系，SOP 不引用 Skill

---

## 二、数据模型

### 2.1 存储方式

**SOP 模板：纯文件驱动，不入库。** YAML 文件存于 `config/sop/<key>/<key>.yaml`（平台）或 `<workspace>/.snail/config/sop/<key>/`（workspace）。

**SOP 快照：存入数据库。** `issue.sop_snapshot` 列存储冻结的 JSON。

### 2.2 数据库表

**issue 表**（SOP 相关列）：
```sql
CREATE TABLE IF NOT EXISTS issue (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  task_anchor TEXT,
  sop_snapshot TEXT NOT NULL DEFAULT '{}',   -- 冻结的 SOP 快照 JSON
  role_snail_mapping TEXT NOT NULL DEFAULT '{}',  -- stage+role → Snail 模板 ID
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);
```

**stage 表**：
```sql
CREATE TABLE IF NOT EXISTS stage (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  stage_definition_id TEXT NOT NULL,  -- 引用 SOP 的 stage key（非 FK）
  type TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  status TEXT NOT NULL,
  output_artifacts TEXT NOT NULL DEFAULT '{}',
  gate_evidence TEXT,
  entered_at TEXT,
  left_at TEXT,
  FOREIGN KEY (issue_id) REFERENCES issue(id) ON DELETE CASCADE,
  UNIQUE(issue_id, sequence)
);
```

### 2.3 SOP YAML 格式

```yaml
name: string (required)
description: string (optional)
first_stage: string (optional, 起始 stage 的 key)
shared_handbook: string (optional, 可用 "@filename.md" 引用)

stage_definitions:
  - key: string (required)
    title: string (required)
    sequence: number (required)
    input_description: string (optional)
    output_description: string (optional)
    acceptance_focus: string[] (optional)
    acceptance_checklist:
      - id: string
        description: string
        required: boolean
    roles:
      - key: string (required)
        name: string (required)
        description: string (optional)
        is_primary: boolean (optional)
        count: number (optional, default 1; >1 展开为 "Name-1", "Name-2")
        handbook: string (optional, 可用 "@filename.md" 引用)

transitions:
  - from: string (stage key)
    to: string (stage key)
    guard: (optional)
      type: string (如 "requires_artifacts")
      config:
        artifacts: string[] (必需的 artifact key 列表)
```

`@` 前缀在解析时由 `resolveHandbookFileRefs()` 解析，读取 SOP 目录下的引用文件。

### 2.4 TypeScript 类型定义

**SopSnapshot**（冻结快照，存入 issue.sop_snapshot）：
```typescript
interface SopSnapshot {
  sop_id: string;
  source: "platform" | "workspace";
  source_ref: string;
  name: string;
  description: string;
  first_stage: string;
  shared_handbook: string;
  stage_definitions: SopSnapshotStageDefinition[];
  transitions: SopSnapshotTransition[];
}
```

**SopSnapshotStageDefinition**：
```typescript
interface SopSnapshotStageDefinition {
  key: string;
  title: string;
  sequence: number;
  input_description: string;
  output_description: string;
  acceptance_focus: string[];
  acceptance_checklist: StageChecklistItem[];
  roles: SopSnapshotRoleDefinition[];
}
```

**SopSnapshotRoleDefinition**：
```typescript
interface SopSnapshotRoleDefinition {
  key: string;
  name: string;
  description: string;
  is_primary: boolean;
  count: number;
  handbook: string;  // 已解析的完整内容
}
```

**SopSnapshotTransition**：
```typescript
interface SopSnapshotTransition {
  from: string;
  to: string;
  guard: TransitionGuard | null;
}
```

**TransitionGuard**：
```typescript
interface TransitionGuard {
  type: string;  // 目前仅 "requires_artifacts"
  config: Record<string, unknown>;  // { artifacts: string[] }
}
```

**Sop**（模板实体）：
```typescript
interface Sop {
  id: string;
  source: "platform" | "workspace";
  source_ref: string;
  key: string;
  name: string;
  description: string;
  first_stage: string;
  shared_handbook: string;
  created_at: string;
  updated_at: string;
}
```

**SopStageDefinition**：
```typescript
interface SopStageDefinition {
  id: string;
  sop_id: string;
  key: string;
  title: string;
  sequence: number;
  input_description: string;
  output_description: string;
  acceptance_focus: string[];
  acceptance_checklist: StageChecklistItem[];
}
```

**StageChecklistItem**：
```typescript
interface StageChecklistItem {
  id: string;
  description: string;
  required: boolean;
}
```

**StageGateEvidence**（存入 stage.gate_evidence）：
```typescript
interface StageGateEvidence {
  items: StageGateArtifact[];
  preparedAt: string;
  preparedBy: string;
}

interface StageGateArtifact {
  checklistId: string;
  status: "passed" | "failed" | "skipped";
  evidence: string;
}
```

### 2.5 平台 SOP 清单

| SOP | Stage 数 | 用途 |
|-----|---------|------|
| `code-delivery` | 4 | 代码交付流程（design → development → review → integration） |
| `general-assistant` | 1 | 知识问答（单 stage chat） |
| `evolution` | 1 | 治理对话（单 stage） |

---

## 三、核心流程

### 3.1 SOP 加载流程

```
启动 → FileConfigStore.loadAll()
  → scanDir(config/sop/) → 找子目录中的 YAML
  → parseSopFile() → 读 YAML → 校验 name → 解析 @file handbook 引用
  → buildParsedSop() → 构建 Sop + SopStageDefinition[] + StageRoleDefinition[] + SopTransition[]
  → expandStageRoles() → count>1 的角色展开为多个
```

### 3.2 Issue 创建与快照冻结

```
createIssueWorkflow(adopted_sop_id)
  → FileConfigStore.getSop(sopId) → 读模板
  → FileConfigStore.listSopStageDefinitionsWithRoles(sopId) → 读所有 stage + roles
  → FileConfigStore.getSopTransitions(sopId) → 读转换规则
  → buildSopSnapshot() → 组装完整 SopSnapshot 对象
  → INSERT INTO issue (sop_snapshot) → JSON 写入数据库
```

### 3.3 Stage 转换流程

```
transitionIssueStage(issueId, targetStageKey?)
  → SopSnapshotReader(issue.sop_snapshot) → 从快照构建 reader
  → reader.validateTransition(from, to) → 检查边是否存在
  → checkGuard(transition.guard, stage.output_artifacts) → 校验 Guard 条件
  → checkGateEvidence(stage.gate_evidence, stage_def.acceptance_checklist) → 日志警告（不阻塞）
  → UPDATE stage SET status='completed', left_at=now
  → INSERT new stage (next stage)
  → CREATE conversation for new stage
```

### 3.4 快照消费流程

```
SopSnapshotReader（从 issue.sop_snapshot 实例化）
  → getSop() → 返回快照中的 SOP 元数据
  → listSopStageDefinitions() → 返回快照中的 stage 定义
  → getSopTransitions() → 返回快照中的转换规则
  → validateTransition(from, to) → 校验转换合法性
  → listRoleDefinitionsByStage(stageKey) → 返回该 stage 的角色定义
```

---

## 四、关键设计决策（v1）

1. **模板与快照分离** — SOP YAML 是可变模板，Issue 创建时冻结为快照，运行中只读快照
2. **文件驱动，不入库** — SOP 模板无数据库表，纯 YAML 文件，FileConfigStore 无缓存每次重读
3. **快照存入 issue.sop_snapshot** — 单字段 JSON blob，不拆子表
4. **SOP 名称全局唯一** — 平台与 workspace SOP 可并存，但 API 只能修改平台 SOP
5. **Role 嵌入 Stage 定义** — Role 不是独立实体，而是 Stage 的嵌套结构
6. **@file 引用机制** — handbook 和 shared_handbook 支持 `@filename.md` 引用 SOP 目录下的文件
7. **Guard 类型扩展** — 目前仅 `requires_artifacts`，但设计为可扩展的 type+config 模式
8. **Gate Evidence 不阻塞** — 验收清单未通过时仅日志警告，不阻止 Stage 转换
9. **原子写入** — SOP YAML 写入使用 `.tmp` + rename 模式

---

## 五、v2 重写待决问题

1. **SOP 模板是否入库？** 当前纯文件驱动，是否需要数据库支持版本管理、权限控制？
2. **快照格式是否演进？** 当前单字段 JSON blob 是否继续，还是拆为结构化子表？
3. **Guard 类型是否扩展？** 除 `requires_artifacts` 外是否需要时间、审批等 Guard 类型？
4. **Gate Evidence 是否强制阻塞？** 当前仅警告，是否需要改为硬阻塞？
5. **workspace SOP 的管理权限？** 当前 API 只能操作平台 SOP，workspace SOP 是否需要 Web 端管理？
6. **Role 是否需要独立实体化？** 当前嵌入 Stage，是否需要支持跨 Stage 的 Role 复用？
7. **SOP 模板版本管理？** 是否需要版本号、变更历史、回滚能力？
8. **AI 发起的 Stage 转换确认机制？** 当前的 StageSuggestion 流程是否需要调整？
