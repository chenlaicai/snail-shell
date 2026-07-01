---
id: F20260701chkr
title: code-health-review
from_ids: []
tags: [review, architecture, code-quality]
modules: [domain, infra, app, web]
doc_kind: spec
---

# F20260701chkr [architecture] 代码仓健康检视

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

对 snail-shell 代码仓进行系统性健康检视，覆盖代码质量、代码架构、模块划分、高内聚低耦合、依赖关系、代码实现干净度和兼容性残留代码七个维度。目的是识别架构债务和技术债务，为后续改进提供依据。

## 目标

产出一份结构化的代码仓健康报告，识别所有违反架构原则、代码质量标准和干净代码实践的问题，并按严重程度分级。

## 非目标

- 不涉及功能需求变更
- 不涉及数据库 schema 变更
- 不涉及运行时行为修改

## 检视维度与结论总览

| 维度 | 结论 | 问题数 |
|------|------|--------|
| 代码架构 | **优秀**，1 处 domain→app 层级违规（链路已分析，修复方案明确） | 1 High |
| 模块划分 | **优秀**，六边形架构严格执行，15 个 domain 模块边界清晰 | 0 |
| 高内聚低耦合 | **优秀**，infra/http 通过 DI + type-only import 正确消费 domain port | 0 |
| 依赖关系 | 5 处 infra→domain `_internal` 误引用 + 3 个未使用依赖 | 1 Medium + 3 Low |
| 代码质量 | 良好，2 个超大文件需拆分 | 2 Medium |
| 代码实现干净度 | 良好，7 处 console.* 需替换 | 7 Low |
| 兼容性残留代码 | 需清理 2 个死代码文件 + 1 个 legacy 函数 | 3 Low |
| 模块封装 | 1 处 domain→infra `_internal` 侵入 + ESLint 未强制 import 方向 | 2 Low |

**撤回项**：初始报告中的"infra/http → domain port 的 18 处 type import 为层级违规"经深度链路分析确认为**架构合规**——infra/http 是纯 HTTP adapter，通过 `AppDeps` 接口接收 main.ts 注入的 domain port 实例，type-only import 仅用于 TypeScript 类型标注。

**对抗审视修正**（架构师-2，2026-07-01）：
- CollaborationInput 方法数从 17 修正为 **16**
- F-2 范围从 1 个文件扩展为 **5 个文件**（mcp-server 1 个 + workspace 4 个）
- 新增 F-9（ESLint 未强制 import 方向）和 F-10（domain→infra `_internal` 侵入）

## 设计

### 检视方法

1. 静态分析：目录结构、import 路径、文件大小
2. 依赖审计：package.json 依赖 vs 实际 import
3. 层级合规：验证 domain → infra / app → domain 的依赖方向
4. 代码扫描：any 类型、eslint-disable、console.*、@deprecated
5. 残留检查：deprecated 文件、TODO/FIXME 标记、legacy 代码

### 发现分类标准

- **High**：违反架构原则，影响系统可维护性
- **Medium**：违反代码质量标准，影响开发效率
- **Low**：不规范但不影响功能，可延后处理

---

### F-1: domain 层反向依赖 app 层 — 依赖过宽 [High]

**位置**：
- `src/domain/evolution/_internal/adapter.ts:13` — `import type { CollaborationInput } from "@app/issue-collaboration/port";`
- `src/domain/evolution/_internal/initor.ts:4` — `import type { CollaborationInput } from "@app/issue-collaboration/port";`

**链路分析**：

`CollaborationInput` 是 app 层的 16 方法编排接口（`src/app/issue-collaboration/port.ts:117-137`），其实现 `IssueCollaboration` 依赖 6 个 domain port（IssuePort, StagePort, MessagePort, SnailPort, LiteAIPort, McpMessageStore）。这是纯粹的 app 层概念。

但 `EvolutionAdapter` 只使用了 `CollaborationInput` 的 **1 个方法**——`createIssue`：

```
EvolutionAdapter.createIssue(itemId)
  → collaboration.createIssue({ workspace_path, title, summary, adopted_sop_key, snail_assignment_plan, context })
  → 返回 { issue }，仅使用 issue.id 关联回 evolution item
```

**根因**：不是类型放错了位置（`CollaborationInput` 确实属于 app 层），而是 domain 层消费了过宽的抽象。Evolution 只需要"从 evolution item 创建 issue"的能力，却依赖了整个协作引擎的 16 方法接口。

**当前缓解**：`import type`（编译时擦除）+ `main.ts` 中 Proxy 懒加载（lines 58-66），解决的是 MCP server ↔ evolution 的初始化顺序问题，与本次违规无关。

**正确修复方向**：收窄依赖。在 `domain/evolution` 内定义窄接口或函数类型：

```ts
// domain/evolution 内部
type CreateIssueFromEvolution = (input: CreateIssueInput) => Promise<CreateIssueResult>;
```

`main.ts` 注入时传入 `collaboration.adapter.createIssue.bind(collaboration.adapter)` 而非整个 `collaboration.adapter`。

**禁止的修复方案**：将 `CollaborationInput` 移到 domain 层——这是一个 16 方法的编排接口，其实现依赖 6 个 domain port，它属于 app 层。

**正反论点**：
- 正方：消除唯一的 domain→app 层级违规；收窄依赖后 EvolutionAdapter 只依赖自己需要的能力，符合 ISP（接口隔离原则）；修复范围小（改 3 个文件的类型签名 + main.ts 的注入行）
- 反方：当前通过 type import 已无运行时问题；`CreateIssueInput`/`CreateIssueResult` 类型目前定义在 `app/issue-collaboration/port.ts` 中，收窄依赖前需先确认这些类型是否也应下沉到 domain 层

---

### F-2: infra 层系统性侵入 domain `_internal` [Medium]

**位置**（5 个文件）：

| 文件 | 行号 | 引用的 `_internal` 模块 | port 是否覆盖需求 |
|------|------|------------------------|-------------------|
| `src/infra/mcp-server/handler.ts` | 3 | `snail-mcp-server/_internal/adapter` | ✅ `SnailMCPServerPort` 完全覆盖 |
| `src/infra/http/app.ts` | 10 | `workspace/_internal/adapter` | ✅ `WorkspacePort` 完全覆盖（`list` + `add`） |
| `src/infra/http/routes/workspace.route.ts` | 11 | `workspace/_internal/adapter` | ✅ 同上 |
| `src/infra/http/routes/issue.route.ts` | 6 | `workspace/_internal/adapter` | ✅ 同上（仅用 `list`） |
| `src/infra/http/routes/knowledge.route.ts` | 3 | `workspace/_internal/adapter` | ✅ 同上（仅用 `list`） |

**链路分析**：

两个模块（snail-mcp-server 和 workspace）的 infra 消费者都跳过了 port 接口，直接依赖 `_internal/adapter` 的具体类型。以 workspace 为例：

- `WorkspaceAdapter` 是 `_internal/adapter.ts` 中的具体类，实现 `WorkspacePort`
- `WorkspacePort`（`port.ts`）定义了 `list()` 和 `add()` 两个方法
- 4 个 infra 文件只使用 `list()` 和 `add()`，port 接口完全覆盖需求

**根因**：这是 import 指向的系统性模式错误，不是架构设计问题。两个模块的 port 接口都已正确定义且完全覆盖 infra 的需求，但 infra 文件直接引用了 `_internal/adapter` 的具体类。

**修复**：将 5 处 `import type { XxxAdapter } from "@domain/xxx/_internal/adapter"` 改为 `import type { XxxPort } from "@domain/xxx/port"`，同步更新类型标注。`main.ts` 无需改动（adapter 实现了 port，传入兼容）。

**正反论点**：
- 正方：修复成本低（5 处 import + 类型标注），消除 `_internal` 边界侵入，符合项目架构决策第 6 条
- 反方：当前通过 type import 无运行时影响；但 ESLint 的 `_internal` 隐私规则只保护 domain→domain，不保护 infra→domain，修复后需配合 F-9（ESLint 规则补充）才能防止回退

---

### F-3: 未使用依赖 — express、@types/express、@larksuiteoapi/node-sdk [Medium]

**位置**：`package.json`

**问题**：3 个依赖声明但未被任何源码引用：
1. `express` — 已完全迁移到 Hono，零 import
2. `@types/express` — 无 express 代码需要类型
3. `@larksuiteoapi/node-sdk` — Feishu 传输层使用原生 `fetch()` 而非 SDK

**建议**：从 `package.json` 移除这 3 个依赖。

---

### F-4: 超大文件需拆分 [Medium]

**位置**：
- `src/app/issue-collaboration/collaboration.ts` — 600 行（恰好等于 app 层限制 600 行，不超标但已临界）
- `src/web/components/ChatMessage.tsx` — 596 行（ESLint web 限制 450 行，超出 146 行）
- `src/web/pages/IssueConversation.tsx` — 453 行（超出 450 行限制 3 行）

**问题**：`ChatMessage.tsx` 和 `IssueConversation.tsx` 超过 ESLint 配置的上限（web 层 450 行）。`collaboration.ts` 恰好等于 app 层限制，虽不超标但已临界。

**建议**：
- `collaboration.ts`：已临界，后续扩展时需拆分消息发送/接收逻辑
- `ChatMessage.tsx`：超出最多，将消息渲染子组件（代码块、工具调用卡片等）拆分为独立组件
- `IssueConversation.tsx`：轻微超标，可将 hook 逻辑提取到自定义 hook

---

### F-5: 前端 console.* 使用 [Low]

**位置**：
- `src/web/hooks/useWebSocket.ts:337` — `console.warn("[WebSocket] 消息解析失败:", ...)`
- `src/web/hooks/useWebSocket.ts:384` — `console.log("[WebSocket] 连接关闭，...ms 后重连")`
- `src/web/hooks/useWorkspaceRealtime.ts:56` — `console.log("[WorkspaceWebSocket] connected", ...)`
- `src/web/hooks/useWorkspaceRealtime.ts:70` — `console.warn("[WorkspaceWebSocket] 消息解析失败:", ...)`
- `src/web/hooks/useWorkspaceRealtime.ts:75` — `console.warn("[WorkspaceWebSocket] disconnected, reconnecting in ...ms")`
- `src/web/hooks/useWorkspaceRealtime.ts:83` — `console.error("[WorkspaceWebSocket] error")`
- `src/web/components/ChatMessage.tsx:118` — `console.warn("[StuckDetector] message #N stuck in streaming...")`

**问题**：服务端代码统一使用 pino 结构化日志，但前端 7 处使用原生 console。

**建议**：引入轻量前端日志工具（或复用 `src/web/lib/perf-logger.ts` 的模式），统一日志输出。

---

### F-6: 死代码 — 2 个 deprecated WebSocket 文件 [Low]

**位置**：
- `src/infra/http/workspace-websocket.ts` — 标记 `@deprecated`，零 import
- `src/infra/http/stage-websocket.ts` — 标记 `@deprecated`，零 import

**问题**：已被 `unified-websocket.ts` 完全替代，但文件仍保留在代码仓中。

**建议**：直接删除这两个文件。

---

### F-7: Legacy 清理函数 [Low]

**位置**：`src/infra/acs/_internal/utils/mcp-config.ts:91` — `cleanupLegacyEnabledMcpjsonServers()`

**问题**：清理旧 `mcp-remote` 桥接方案的残留配置。如果所有实例已迁移，此函数可能已无实际作用。

**建议**：确认是否仍有旧配置实例需要清理。如无，移除此函数。

---

### F-8: TODO 标记 [Low]

**位置**：
- `src/domain/workspace/port.ts:11` — `// TODO: remove 方法需要先清理 workspace 下的 skill/prompt/sop 等业务数据`

**问题**：1 处 TODO 标记表示未完成的功能。

> `src/infra/acs/model.ts:9` 的 "TODO 维度不入模型" 是设计原则描述（"只含已实现的能力，TODO 维度不入模型"），非待办标记，已排除。

**建议**：评估优先级，创建对应的 issue 跟踪或在本次检视后明确处理计划。

---

### F-9: ESLint 未强制 import 方向 [Low]

**位置**：`eslint.config.mjs`

**问题**：当前 ESLint 配置只强制了：
- `shared` 目录禁用（全局）
- domain 模块间 `_internal` 隐私墙（6 个模块）
- `main.ts` 豁免（组合根）

**缺失**：没有规则强制 `app → domain → infra` 的层级方向。任何文件可以自由导入任何层的模块。F-1（domain→app）和 F-2（infra→domain `_internal`）类型的违规只能靠人工 review 发现，无法自动拦截。

**建议**：添加 `eslint-plugin-boundaries` 或 `import/no-restricted-paths` 规则，机械地强制依赖方向。配合 F-2 修复后，可防止 `_internal` 侵入回退。

---

### F-10: domain snail 侵入 infra `_internal` [Low]

**位置**：`src/domain/snail/_internal/adapter.ts:5` — `import { buildContextEnv } from "@infra/acs/_internal/utils/context-env";`

**问题**：虽然 domain→infra 是文档化的预期方向（`app → domain → infra`），但 domain 访问 infra 的 `_internal` 实现仍然违反了模块封装。ESLint 的 `_internal` 隐私规则只保护 domain→domain，不保护 domain→infra。

**建议**：将 `buildContextEnv` 提升到 `@infra/acs/port.ts` 或 `@infra/acs/model.ts` 中导出，使 domain 通过 infra 的公开接口访问。

---

## 设计约束摘要

- **边界**：检视只产出分析和建议，不修改代码
- **关键决策**：所有发现按 High/Medium/Low 分级，优先处理架构层级违规
- **非目标约束**：不涉及功能变更、不涉及数据库变更

## 改动范围

本次为纯检视，不产生代码改动。后续修复时涉及的文件：
- `src/domain/evolution/_internal/adapter.ts`、`initor.ts`、`src/main.ts`（F-1：收窄依赖）
- `src/infra/mcp-server/handler.ts`、`src/infra/http/app.ts`、`src/infra/http/routes/workspace.route.ts`、`issue.route.ts`、`knowledge.route.ts`（F-2：修正 import 指向 port）
- `package.json`（F-3：移除未使用依赖）
- `src/infra/http/workspace-websocket.ts`、`stage-websocket.ts`（F-6：删除死代码）
- `eslint.config.mjs`（F-9：添加 import 方向规则）
- `src/infra/acs/port.ts` 或 `model.ts`（F-10：导出 `buildContextEnv`）

## 验证

- [ ] F-1 修复后：`grep -r "@app/" src/domain/` 返回零结果；EvolutionAdapter 构造函数不再接收 `CollaborationInput`
- [ ] F-2 修复后：`grep -r "_internal/adapter" src/infra/` 返回零结果
- [ ] F-3 修复后：`npm ls express @larksuiteoapi/node-sdk` 报告未安装
- [ ] F-4 修复后：ESLint 文件行数检查通过
- [ ] F-6 修复后：`src/infra/http/` 下无 `@deprecated` 文件
- [ ] F-9 修复后：ESLint 能自动拦截 domain→app 和 infra→domain `_internal` 的 import
- [ ] F-10 修复后：`grep -r "@infra/.*_internal" src/domain/` 返回零结果

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | 是否在本次检视中修复所有发现 | 一次到位，不留债务 | 检视和修复应分离，避免 scope creep | 本次只产出报告，修复拆为独立 feature | 检视的目的是识别问题，修复应有独立的设计和验证 | 架构师-1 | 2026-07-01 |
| D2 | F-1 修复方案：移动类型 vs 收窄依赖 | 移动 CollaborationInput 到 domain 层，一步到位 | CollaborationInput 是 16 方法的 app 层编排接口，移到 domain 层违反六边形原则 | 收窄依赖：EvolutionAdapter 只接收 `CreateIssueFn` 函数类型 | CollaborationInput 的实现依赖 6 个 domain port，它属于 app 层；问题不是类型放错位置，而是 domain 消费了过宽的抽象 | 架构师-1 | 2026-07-01 |
| D3 | F-2 严重程度：High vs Medium | 侵入 `_internal` 边界，应为 High | port.ts 已暴露所有所需方法，修复是 import 指向改动，不是架构设计问题 | 维持 Medium | 根因是 import 指向错误，不是架构缺陷；两个模块的 port 接口都完全覆盖 infra 需求 | 架构师-1 + 架构师-2 | 2026-07-01 |
| D4 | F-2 范围：1 个文件 vs 5 个文件 | 架构师-1 初始只发现 mcp-server 1 个文件 | 架构师-2 独立扫描发现 workspace 有 4 个同类违规 | 扩展为 5 个文件 | 独立验证确认 workspace 4 个文件确实引用 `_internal/adapter`，且 `WorkspacePort` 完全覆盖需求 | 架构师-2 对抗审视 | 2026-07-01 |

## 范围变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-07-01 | 撤回初始 F-6（infra/http → domain port 的 18 处 type import） | 深度链路分析确认 infra/http 是纯 adapter，通过 AppDeps 接收 main.ts 注入的 port 实例，type-only import 是六边形架构的标准 adapter 模式 |
| 2026-07-01 | F-2 从 High 降为 Medium | port.ts 已暴露所有所需方法，修复是 import 指向改动，非架构设计问题 |
| 2026-07-01 | F-1 补充链路分析和修复方向 | 明确 CollaborationInput 是 16 方法的 app 层接口，evolution 只用 createIssue 一个方法，正确修复是收窄依赖而非移动类型 |
| 2026-07-01 | F-2 范围从 1 个文件扩展为 5 个 | 架构师-2 对抗审视发现 workspace 模块有 4 个同类 `_internal` 侵入，独立验证确认 |
| 2026-07-01 | 新增 F-9（ESLint import 方向规则） | 架构师-2 指出当前 ESLint 无规则强制层级方向，F-1/F-2 类违规只能靠人工 review |
| 2026-07-01 | 新增 F-10（domain→infra `_internal` 侵入） | 架构师-2 发现 `domain/snail` 访问 `infra/acs/_internal`，独立验证确认 |
