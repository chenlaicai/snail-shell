---
id: F20260702qedh
title: layer-dependency-violations
from_ids: [F20260701chkr]
tags: [architecture, dependency, layer-violation]
modules: [domain/evolution, app/evolution, domain/snail, infra/acs, infra/http, infra/mcp-server]
doc_kind: spec
---

# F20260702qedh [architecture] 层级依赖方向治理：修复 F-1/F-2/F-10 三处违规

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

代码仓健康检视报告（issue 547）发现 10 个问题，其中 3 个属于架构层级依赖方向违规：

- **F-1 [High]**：domain/evolution 反向依赖 app 层 `CollaborationInput`（17 方法接口），实际只使用 `createIssue` 1 个方法。当前已通过 DIP（`CreateIssueFn` 窄接口注入）临时修复，但编排逻辑仍留在 domain 层，需要用 evo domain/app 拆分彻底解决。
- **F-2 [Medium]**：~~infra 层 5 处 import 穿透 domain `_internal` 边界~~ → **已解决**（PR #552）
- **F-10 [Low]**：~~domain/snail 穿透 infra `_internal` 边界~~ → **已解决**（PR #552）

F-2 和 F-10 已在 PR #552 中修复。本 Feature 的剩余 scope 是 **F-1 的架构升级**：从 DIP 临时方案改为 evo domain/app 拆分。

## 目标

1. 将 F-1 从 DIP 临时方案升级为 evo domain/app 拆分，将编排逻辑移到 app 层
2. ~~消除 infra→domain `_internal` 侵入（F-2）~~ → 已解决（PR #552）
3. ~~消除 domain→infra `_internal` 侵入（F-10）~~ → 已解决（PR #552）
4. 通过 ESLint 规则防止回退（F-9 的实现建议）

## 非目标

- 不处理 F-3（未使用依赖）— 属于开发者职责
- 不处理 F-4（超大文件拆分）— 属于开发者职责，可后续按需处理
- 不处理 F-5/F-6/F-7/F-8 — 属于低优先级代码质量问题
- 不重构 `CollaborationInput` 接口本身 — 只拆分 EvolutionAdapter 的编排职责

## 核心业务行为

| # | 场景 | 预期行为 |
|---|------|----------|
| B1 | 当 domain 层包含跨域编排逻辑时 | 将编排逻辑拆分到 app 层，domain 层只保留纯数据操作 |
| B2 | 当 code review 发现 DIP 窄接口掩盖职责错配时 | 通过 domain/app 分层拆分彻底解决，而非迭代 DIP 方案 |
| B3 | 当 app 层同模块间需要协作时 | 同层模块可直接注入完整 Port 接口，无需窄接口收窄 |
| B4 | 当代码变更引入新的跨层 import 时 | ESLint 规则自动阻断 `_internal` 跨层引用 |

## 设计

### 修复 1：F-1 — 拆分 evo domain/app

**问题**：`EvolutionAdapter.createIssue` 方法包含跨域编排逻辑（调用 `createIssueFn`、`issuePort.previewSopStages`、`snailPort.list`），这些是 app 层职责，不应留在 domain 层。DIP 方案（窄接口注入）只是掩盖了依赖方向，未解决根因。

**方案**：将 `EvolutionAdapter` 拆分为两层：
- `domain/evolution` — 纯数据操作（CRUD），只依赖 repo
- `app/evolution` — 编排逻辑（`createIssueFromItem`），调用 domain/evolution + app/issue-collaboration

**关键决策**：

| 决策 | 选项 A | 选项 B | 选择 | 理由 |
|------|--------|--------|------|------|
| 拆分策略 | DIP 窄接口注入 | domain/app 分层拆分 | 分层拆分 | 根因是编排逻辑错放，DIP 只掩盖方向未解决职责错配 |
| domain/evolution 保留哪些方法 | 仅 CRUD | CRUD + 状态校验 | CRUD + 状态校验 | 状态校验（candidate → inProgress）是数据约束，属于 domain |
| createIssueFn 归属 | 保留在 domain（DIP） | 移到 app/evolution | 移到 app | 编排逻辑天然属于 app 层 |
| snail assignment plan 归属 | 保留在 domain | 移到 app/evolution | 移到 app | 依赖 snailPort + issuePort.previewSopStages，是编排逻辑 |

**设计详情**：

**domain/evolution（纯数据层）**：

```typescript
// src/domain/evolution/port.ts — 移除 CreateIssueFn，只保留 CRUD
export interface EvolutionPort {
  findById(id: string): EvolutionItem | undefined;
  list(filters?: EvolutionItemListFilters): EvolutionItem[];
  search(query: string, filters?: EvolutionItemListFilters): EvolutionItem[];
  create(input: CreateEvolutionItemInput): EvolutionItem;
  update(id: string, updates: UpdateEvolutionItemInput): EvolutionItem;
}
```

```typescript
// src/domain/evolution/_internal/adapter.ts — 移除 createIssue、createDefaultSnailAssignmentPlan
// 构造函数只依赖 repo，不再依赖 IssuePort/SnailPort/CreateIssueFn
export class EvolutionAdapter implements EvolutionPort {
  constructor(private repo: EvolutionRepository) {}
  findById(id) { return this.repo.findById(id); }
  list(filters?) { return this.repo.list(filters); }
  search(query, filters?) { return this.repo.search(query, filters); }
  create(input) { /* 纯数据创建 */ }
  update(id, updates) { /* 纯数据更新 */ }
}
```

**app/evolution（编排层）**：

```typescript
// src/app/evolution/port.ts — 编排端口
import type { EvolutionItem } from "@domain/evolution/model";
import type { EvolutionPort } from "@domain/evolution/port";
import type { CollaborationInput } from "@app/issue-collaboration/port";

export interface EvolutionAppPort {
  createIssueFromItem(itemId: string): Promise<EvolutionItem>;
}
```

```typescript
// src/app/evolution/_internal/adapter.ts — 编排实现
export class EvolutionAppAdapter implements EvolutionAppPort {
  constructor(
    private evolutionPort: EvolutionPort,
    private collaboration: CollaborationInput,
  ) {}

  async createIssueFromItem(itemId: string): Promise<EvolutionItem> {
    const item = this.evolutionPort.findById(itemId);
    if (!item) throw new Error(`Evolution item not found: ${itemId}`);
    if (item.status !== EvolutionStatus.Candidate) {
      throw new Error(`Cannot create issue for item in status "${item.status}", must be "candidate"`);
    }

    const { issue } = await this.collaboration.createIssue({
      workspace_path: item.workspace_id,
      title: `[Evolution] ${item.title}`,
      summary: item.content,
      adopted_sop_key: "evolution",
      snail_assignment_plan: createDefaultSnailAssignmentPlan(/* ... */),
      context: { [EVOLUTION_ITEM_ID_KEY]: item.id },
    });

    return this.evolutionPort.update(itemId, {
      status: EvolutionStatus.InProgress,
      issue_id: issue.id,
    });
  }
}
```

**组合根（main.ts）变更**：

```typescript
// 当前：initEvolution(db, issuePort, snailPort, collaboration.createIssue.bind(collaboration))
// 变为：
const evolution = initEvolution(db);                           // domain 层：纯数据
const evolutionApp = initEvolutionApp(evolution.adapter, collaboration.adapter);  // app 层：编排
```

**依赖方向**：
```
app/evolution  →  domain/evolution  (同域，内层→外层正确)
app/evolution  →  app/issue-collaboration  (同层，无跨层依赖)
domain/evolution  →  无外部依赖（纯数据）
```

**变更范围**：

| 文件 | 变更 |
|------|------|
| `src/domain/evolution/port.ts` | 移除 `CreateIssueFn` 类型，移除 `createIssue` 方法 |
| `src/domain/evolution/_internal/adapter.ts` | 移除 `createIssue`、`createDefaultSnailAssignmentPlan`；构造函数移除 `issuePort`/`snailPort`/`createIssueFn` 参数 |
| `src/domain/evolution/_internal/initor.ts` | 参数简化，只接收 `db` |
| `src/app/evolution/port.ts` | 新建，定义 `EvolutionAppPort` |
| `src/app/evolution/_internal/adapter.ts` | 新建，实现 `createIssueFromItem` 编排逻辑 |
| `src/app/evolution/initor.ts` | 新建，组合 app 层依赖 |
| `src/main.ts` | `initEvolution` 参数简化；新增 `initEvolutionApp`；HTTP 路由使用 app 层 adapter |

---

### ~~修复 2：F-2 — infra 层 Port 替换~~ → 已解决（PR #552）

已解决，无需变更。

---

### ~~修复 3：F-10 — buildContextEnv 提升到公共模块~~ → 已解决（PR #552）

已解决，无需变更。

---

### 防退化：ESLint 规则建议（F-9）

**建议**（不在本 Feature 范围内，供 development 阶段参考）：

添加 `import/no-restricted-paths` 或 `eslint-plugin-boundaries` 规则，禁止：
- `src/domain/**` 从 `src/app/**` 导入
- `src/infra/**` 从 `src/domain/**/_internal/**` 导入
- `src/domain/**` 从 `src/infra/**/_internal/**` 导入

这将把 F-1/F-2/F-10 类违规从人工 review 升级为自动化阻断。

## 验收标准

| ID | 标准 | 验证命令 |
|----|------|----------|
| AC-1 | `grep -r "import [^t].*@app/" src/domain/` 返回零结果 | 消除 domain→app 运行时依赖 |
| AC-2 | ~~`grep -r "_internal/adapter" src/infra/` 返回零结果~~ | 已满足（PR #552） |
| AC-3 | ~~`grep -r "@infra/.*_internal" src/domain/` 返回零结果~~ | 已满足（PR #552） |
| AC-4 | `npm run check` 通过（TypeScript 编译 + ESLint） | 确保类型正确性 |
| AC-5 | `app/evolution` 的 `createIssueFromItem` 功能等效于原 `EvolutionAdapter.createIssue` | 运行时行为无回归 |
| AC-6 | `grep -rn "CreateIssueFn" src/` 返回零结果 | DIP 窄接口已完全移除 |
| AC-7 | `src/app/evolution/` 目录存在且包含 `port.ts`、`initor.ts`、`_internal/adapter.ts` | app 层模块结构完整 |
| AC-8 | `grep -rn "createIssueFn\|createIssue\b" src/domain/evolution/` 返回零结果 | 编排逻辑已从 domain 层移除 |

## 不兼容更新

- `EvolutionPort` 移除 `createIssue` 方法 — 该职责迁移到 `app/evolution` 的 `EvolutionAppPort.createIssueFromItem`
- HTTP 路由中原调用 `evolution.adapter.createIssue` 改为调用 `evolutionApp.adapter.createIssueFromItem`
- `CreateIssueFn` 类型删除 — 不再需要 DIP 窄接口

## 决策记录

| # | 决策 | 正方 | 反方 | 结论 |
|---|------|------|------|------|
| D1 | F-1 修复策略：DIP 窄接口 vs evo domain/app 拆分 | DIP 改动小，当前 PR 已通过 review | DIP 只掩盖依赖方向，编排逻辑仍留在 domain 层，CreateIssueFn 是 design smell | 选择拆分：根因是编排职责错放，拆分彻底解决且与现有 app/issue-collaboration 模式一致 |
| D2 | F-10 buildContextEnv 提升到哪里 | context-keys.ts 语义内聚 | port.ts 更符合"公共 API"惯例 | 选择 context-keys.ts：语义内聚优先于惯例 |
| D3 | EvolutionAppAdapter 注入完整 CollaborationInput 还是窄接口 | app 层同层模块间宽接口依赖是正常模式，与 F-1 的跨层反向依赖性质不同 | 只用 1 个方法，注入宽接口与 F-1 根因模式相似 | 选择完整 CollaborationInput：同层模块间无跨层风险，TypeScript 编译器保证类型安全，窄接口在同层是过度设计 |
