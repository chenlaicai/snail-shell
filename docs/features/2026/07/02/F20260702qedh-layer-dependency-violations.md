---
id: F20260702qedh
title: layer-dependency-violations
from_ids: [F20260701chkr]
tags: [architecture, dependency, layer-violation]
modules: [domain/evolution, domain/snail, infra/acs, infra/http, infra/mcp-server]
doc_kind: spec
---

# F20260702qedh [architecture] 层级依赖方向治理：修复 F-1/F-2/F-10 三处违规

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

代码仓健康检视报告（issue 547）发现 10 个问题，其中 3 个属于架构层级依赖方向违规：

- **F-1 [High]**：domain/evolution 反向依赖 app 层 `CollaborationInput`（17 方法接口），实际只使用 `createIssue` 1 个方法
- **F-2 [Medium]**：infra 层 5 处 import 穿透 domain `_internal` 边界，引用 Adapter 类型而非 Port 接口
- **F-10 [Low]**：domain/snail 穿透 infra `_internal` 边界，引用 `buildContextEnv` 工具函数

这三个问题共同违反了六边形架构的依赖方向原则：**外层应依赖内层的公开接口（Port），不应穿透 `_internal` 私有边界**。

## 目标

1. 消除 domain→app 反向依赖（F-1），通过收窄接口实现依赖反转
2. 消除 infra→domain `_internal` 侵入（F-2），统一使用 Port 接口
3. 消除 domain→infra `_internal` 侵入（F-10），提升函数到公共模块
4. 通过 ESLint 规则防止回退（F-9 的实现建议）

## 非目标

- 不处理 F-3（未使用依赖）— 属于开发者职责
- 不处理 F-4（超大文件拆分）— 属于开发者职责，可后续按需处理
- 不处理 F-5/F-6/F-7/F-8 — 属于低优先级代码质量问题
- 不重构 `CollaborationInput` 接口本身 — 只收窄 EvolutionAdapter 的依赖

## 核心业务行为

| # | 场景 | 预期行为 |
|---|------|----------|
| B1 | 当 domain 层需要调用 app 层功能时 | 通过在 domain 层定义的窄接口（函数类型）注入，而非依赖 app 层的宽接口 |
| B2 | 当 infra 层需要引用 domain 层类型时 | 只引用 `@domain/xxx/port` 中的 Port 接口，不引用 `_internal` 模块 |
| B3 | 当 domain 层需要引用 infra 层工具函数时 | 函数必须从 infra 的公共模块（port.ts / context-keys.ts）导出，不从 `_internal` 导入 |
| B4 | 当代码变更引入新的跨层 import 时 | ESLint 规则自动阻断 `_internal` 跨层引用 |

## 设计

### 修复 1：F-1 — EvolutionAdapter 依赖收窄

**问题**：`EvolutionAdapter` 构造函数接收 `CollaborationInput`（17 方法接口），但只调用 `createIssue` 一个方法。这导致 domain/evolution 模块反向依赖 app 层。

**方案**：在 domain/evolution 内定义窄接口 `CreateIssueFn`，注入时只传入 `createIssue` 方法。

**关键决策**：

| 决策 | 选项 A | 选项 B | 选择 | 理由 |
|------|--------|--------|------|------|
| 窄接口定义位置 | domain/evolution/port.ts | domain/evolution/model.ts | port.ts | 函数类型属于端口契约，与 `EvolutionPort` 同层 |
| 接口形式 | `type CreateIssueFn` | `interface CreateIssuePort` | type | 单方法函数类型，type 更简洁 |
| 注入方式 | main.ts 传 `.bind()` | main.ts 传 lambda | `.bind()` | 保持 `this` 上下文，更安全 |

**设计详情**：

```typescript
// src/domain/evolution/port.ts — 新增
/** 窄接口：仅注入 createIssue，避免 domain→app 反向依赖 */
export type CreateIssueFn = CollaborationInput["createIssue"];
```

> 注意：这里仍需从 `@app/issue-collaboration/port` 导入 `CollaborationInput` 用于类型提取。这是 TypeScript 的类型级引用，不会产生运行时依赖。如果需要完全消除类型级引用，可以手动复制 `createIssue` 的签名，但这会引入维护负担（签名变更时需要同步）。**选择类型提取方式**，因为：(1) 它是类型级的，不影响运行时依赖图 (2) 签名变更时 TypeScript 编译器会自动报错 (3) 避免了手动复制带来的维护风险。

**变更范围**：

| 文件 | 变更 |
|------|------|
| `src/domain/evolution/port.ts` | 新增 `CreateIssueFn` 类型 |
| `src/domain/evolution/_internal/adapter.ts` | 构造函数参数 `collaboration: CollaborationInput` → `createIssue: CreateIssueFn` |
| `src/domain/evolution/_internal/initor.ts` | 参数和实例化逻辑调整 |
| 初始化调用点（main.ts 或等效） | 注入 `collaboration.adapter.createIssue.bind(collaboration.adapter)` |

---

### 修复 2：F-2 — infra 层 Port 替换

**问题**：5 个 infra 文件通过 `import type` 引用 domain `_internal` 中的 Adapter 类型，而非公开的 Port 接口。

**方案**：统一将 `import type { XxxAdapter } from "@domain/xxx/_internal/adapter"` 替换为 `import type { XxxPort } from "@domain/xxx/port"`。

**关键事实**：
- 所有 5 处都是 `import type`（纯类型引用，无运行时影响）
- 所有 Adapter 类都 `implements` 对应的 Port 接口
- infra 层只使用了 Port 接口上定义的方法

**变更范围**：

| 文件 | 当前引用 | 替换为 |
|------|----------|--------|
| `src/infra/mcp-server/handler.ts` | `SnailMCPServerAdapter` | `SnailMCPServerPort` |
| `src/infra/http/app.ts` | `WorkspaceAdapter` | `WorkspacePort` |
| `src/infra/http/routes/workspace.route.ts` | `WorkspaceAdapter` | `WorkspacePort` |
| `src/infra/http/routes/issue.route.ts` | `WorkspaceAdapter` | `WorkspacePort` |
| `src/infra/http/routes/knowledge.route.ts` | `WorkspaceAdapter` | `WorkspacePort` |

---

### 修复 3：F-10 — buildContextEnv 提升到公共模块

**问题**：`domain/snail/_internal/adapter.ts` 从 `@infra/acs/_internal/utils/context-env` 导入 `buildContextEnv`，穿透了 infra 的 `_internal` 边界。

**方案**：将 `buildContextEnv` 从 `_internal/utils/context-env.ts` 移动到 `@infra/acs/context-keys.ts`。

**关键决策**：

| 决策 | 选项 A | 选项 B | 选项 C | 选择 | 理由 |
|------|--------|--------|--------|------|------|
| 提升目标 | port.ts | context-keys.ts | 新建公共文件 | context-keys.ts | 语义内聚：`CONTEXT_KEYS` 定义 key，`buildContextEnv` 消费 key |

**理由**：
1. `buildContextEnv` 的核心逻辑是对 `CONTEXT_KEYS` 的消费和扩展，二者语义内聚
2. `adapter.ts` 已经在导入 `CONTEXT_KEYS`，合并后只需一条 import
3. 不需要新建文件，也不污染 `port.ts` 的接口职责
4. 改动范围最小：移动函数定义 + 修改两处 import 路径

**变更范围**：

| 文件 | 变更 |
|------|------|
| `src/infra/acs/context-keys.ts` | 新增 `buildContextEnv` 函数定义 |
| `src/infra/acs/_internal/utils/context-env.ts` | 删除文件（确认无其他内部消费者） |
| `src/domain/snail/_internal/adapter.ts` | import 路径改为 `@infra/acs/context-keys` |

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
| AC-1 | `grep -r "import [^t].*@app/" src/domain/` 返回零结果（允许 type-only import，排除 `import type`） | 消除 domain→app 运行时依赖 |
| AC-2 | `grep -r "_internal/adapter" src/infra/` 返回零结果 | 消除 infra→domain _internal 侵入 |
| AC-3 | `grep -r "@infra/.*_internal" src/domain/` 返回零结果 | 消除 domain→infra _internal 侵入 |
| AC-4 | `npm run check` 通过（TypeScript 编译 + ESLint） | 确保类型正确性 |
| AC-5 | EvolutionAdapter.createIssue 功能不变 | 运行时行为无回归 |

## 不兼容更新

无。本变更仅修改 import 路径和类型注解，不改变任何运行时行为或公共 API。

## 决策记录

| # | 决策 | 正方 | 反方 | 结论 |
|---|------|------|------|------|
| D1 | F-1 窄接口是否需要完全消除类型级 app 依赖 | 类型提取更简洁，编译器保证同步 | 类型级引用仍是依赖 | 选择类型提取：类型级引用不影响运行时，且编译器自动保证同步 |
| D2 | F-10 buildContextEnv 提升到哪里 | context-keys.ts 语义内聚 | port.ts 更符合"公共 API"惯例 | 选择 context-keys.ts：语义内聚优先于惯例 |
