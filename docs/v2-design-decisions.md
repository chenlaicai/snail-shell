# Snail Shell V2 设计决策记录

> 本文档记录 V2 重建过程中的所有关键设计决策，包括决策背景、备选方案和最终选择。
> 后续开发应以此为基准，避免重复讨论或偏离方向。

---

## 1. 为什么重建 V2

### 背景

V1 代码仓仅 10 周历史（328 次提交），但近一周内 46% 的提交为破坏性变更。同时进行 5 个大规模重构（前端重写、数据模型重做、SOP 引擎重构、Prompt 层重组、MCP 重构），导致：

- 持久层核心文件 `store.ts` 变更 127 次，成为 god-object（656 行）
- 领域类型文件 `domain-types.ts` 变更 90 次，类型定义不稳定
- 无 migration 框架，schema 变更靠手动协调
- 类型重导出链 4 层深（`shared/types.ts` → `persistence/types.ts` → `persistence/store.ts` → `index.ts`）
- AI 辅助开发时频繁出现"哪里需要往哪里加"的问题，缺乏模块边界约束

### 决策

**保留领域模型决策，重建工程基础。** 不是推倒重来，而是"捡骨头，不捡尸体"。

---

## 2. 仓库结构

### 决策：同仓库，V1 归档到 `legacy/`

| 方案 | 优点 | 缺点 |
|------|------|------|
| 同仓库 + `legacy/` | 保留 git 历史，随时可参考旧代码 | legacy 目录占空间 |
| 新仓库 | 完全干净 | 丢失历史，切换成本高 |
| 同仓库 + `v2/` 子目录 | 物理隔离 | 路径多一层 |

**选择：同仓库 + `legacy/`。** V1 整体搬到 `legacy/`（gitignored），V2 在根目录重建。将来 V2 稳定后删除 `legacy/`。

---

## 3. 包管理：单 src/ vs Monorepo

### 决策：单 `src/` + ESLint 层间依赖规则

| 方案 | 优点 | 缺点 |
|------|------|------|
| pnpm monorepo | 物理隔离依赖方向，独立构建 | 工具链开销大，单人开发收益低 |
| 单 `src/` | 简单，改类型快，开发流畅 | 依赖方向靠纪律 |

**选择：单 `src/`。** 理由：单人开发场景下，分包的多人协作优势用不上，工具链摩擦会拖慢迭代速度。层间依赖用 ESLint `no-restricted-imports` 规则强制。

---

## 4. 技术栈选型

### 4.1 模块系统：ESM

V1 使用 CommonJS（`"type": "commonjs"`）。V2 切换到 ESM（`"type": "module"`）。

**理由：** ESM 是 Node.js 标准方向，tree-shaking 更好，与前端 Vite 生态一致。

### 4.2 HTTP 框架：Hono（替代 Express）

| 方案 | 优点 | 缺点 |
|------|------|------|
| Express 5 | 生态成熟，V1 经验 | SSE/WS 需手动拼装，类型安全弱 |
| Hono | 内置 SSE/WS，类型安全路由，性能好 | 生态较新 |

**选择：Hono。** 理由：Snail Shell 核心功能是流式 Agent 事件（SSE + WebSocket），Hono 原生支持。新项目无迁移成本。

### 4.3 ORM：Drizzle ORM（替代原生 better-sqlite3）

V1 使用原生 `better-sqlite3`，导致 656 行 god-object `ConversationStore`。

**选择：Drizzle ORM。** 理由：类型安全 schema 定义，自动 migration 生成，SQL-like API 不丢失控制力。

### 4.4 测试：Vitest 统一

V1 前端用 Vitest，后端用自定义 `scripts/run-tests.ts`。

**选择：Vitest 统一所有测试。** 一套工具链，无需维护自定义 runner。

### 4.5 TypeScript 版本：6.x + ESM

关键配置：
- `"module": "ES2022"` + `"moduleResolution": "bundler"`
- `baseUrl` 已废弃（TS 6），`paths` 使用相对路径 `"./src/*"`
- 不再使用 `"type": "commonjs"`

### 4.6 保留的选型

以下从 V1 直接保留，无需变更：
- React 19 + Vite 8
- Zustand + TanStack Query 5
- Tailwind CSS 4
- Zod 校验
- SQLite (better-sqlite3)

---

## 5. 架构模式：领域驱动设计（DDD）

### 核心原则

1. **每个领域模型有自己的家** — 类型跟着领域走，不堆在共享层
2. **共享内核最小化** — 不设 `types/` 目录（无真正跨所有领域的共享类型）
3. **模块通过 `api.ts` 暴露公开 API** — `_internal/` 存放内部实现
4. **依赖单向** — 上层依赖下层，反向禁止
5. **配置与数据分离** — 纯配置（llm.json、logging.json）在 `config/`，领域数据（SOP YAML、snail-den.json）在各自域内

### 为什么选 DDD

> DDD 非常适合 AI 时代。各个领域模型各自独立，模型与业务场景绑定，AI 只需理解当前所改的业务场景即可。
>
> 以前常见问题是 AI 经常在各处代码中需要啥东西就补啥东西，而不看这东西本质属于哪个领域、哪个模块、哪里有现成的。
>
> 因此，模块边界必须划分清晰、依赖关系必须清晰、数据模型必须清晰且统一一处。

---

## 6. 领域边界划分

### 6 个有界上下文

| 领域 | 目录 | 业务含义 | 拥有的实体 |
|------|------|---------|-----------|
| 项目空间 | `workspace/` | 一个项目空间 | Workspace、GuardProfile |
| 标准流程 | `sop/` | 工作流模板 | SOP、StageDefinition、Transition、Guard |
| 工作任务 | `issue/` | 一个工作任务 | Issue、Stage、GateEvidence、ChecklistItem |
| Agent 运行时 | `snail/` | Agent 模板和运行时 | SnailTemplate、RuntimeBinding、SnailRuntime、AgentEvent、AgentSession |
| 对话消息 | `conversation/` | 对话和消息 | Conversation、Message、MessageEvent、MessageDispatch、MessageContext |
| 演进治理 | `evolution/` | 演进治理 | EvolutionItem、KnowledgeEntry |

### 领域依赖关系

```
workspace ──→ sop ──→ issue ──→ conversation
                │                   ↑
                └───────────────────┘
                        │
                       snail（提供运行时能力）
```

### 命名说明

- **`snail/`** 而非 `agent/` — Snail Shell 的 Agent 模板叫 "Snail"，这是领域语言，不是技术语言
- **`issue/`** 而非 `workflow/` — Issue 是核心业务实体，Stage 是 Issue 的子实体；workflow 逻辑属于 Issue 域
- **`conversation/`** 而非 `message/` — Conversation 是协作的容器，Message 是其子实体

---

## 7. 模块内部结构

### 统一模式：`api.ts` + `types.ts` + `_internal/`

```
<module>/
  api.ts              # 🟢 公开 API — 只导出对外的方法和类型
  types.ts            # 🟢 公开类型 — 对外暴露的结构体定义
  _internal/
    *.ts              # 🔴 内部实现 — 外部禁止 import
```

### 公开 API 规则

- `api.ts` 明确列出模块对外提供什么（方法 + 类型）
- `types.ts` 定义对外暴露的结构体
- `_internal/` 存放所有内部实现
- 外部 import 只能走 `@/module/api` 或 `@/module/types`
- `_internal/` 下的文件禁止被其他模块 import（ESLint 规则强制）

### 示例：`workflow/api.ts`

```typescript
// 只导出对外的方法和类型
export { createIssue, closeIssue } from './_internal/issue-service.js';
export { transitionStage } from './_internal/stage-machine.js';
export { checkGate } from './_internal/gate-check.js';
export type { Issue, Stage, GateResult, SopSnapshot } from './types.js';
```

### 示例：外部调用

```typescript
import { createIssue, transitionStage, type SopSnapshot } from '@/issue/api';
// 清楚知道用了 issue 的哪些能力
```

---

## 8. 配置与数据分离

### 原则

- **纯配置**（不包含业务逻辑）→ `config/`
- **领域数据**（包含业务语义）→ 归属到对应领域模块

### 分类

| 内容 | 归属 | 理由 |
|------|------|------|
| llm.json | `config/llm.ts` | 纯配置，LLM 提供商连接参数 |
| logging.json | `config/logging.ts` | 纯配置，日志级别 |
| SOP YAML | `sop/_internal/data/` | 领域数据，SOP 定义是 workflow 的核心 |
| snail-den.json | `snail/_internal/pool.ts` | 领域数据，Agent 模板定义 |
| workspaces.json | `workspace/store.ts` | 领域数据，空间列表 |
| guard-profile.json | `workspace/` | 领域数据，权限配置 |

---

## 9. 持久层设计

### 决策：Repo 集中，类型分散

- **DB schema、连接、migration** → `db/`（集中）
- **类型定义** → 各领域模块的 `types.ts`（分散）
- **Repo** → `db/repos/`，但 import 类型从各域来

```typescript
// db/repos/issue.repo.ts
import type { Issue, Stage } from '@/issue/types';  // 类型来自 issue 域
```

### 理由

- Drizzle schema 定义和 migration 需要统一管理
- 但类型的所有权属于领域模块，不在持久层
- Repo 是"读写数据的技术实现"，不是"业务概念的定义者"

---

## 10. V2 不包含的模块

以下模块在 V1 中存在，但 V2 初期**不包含**，待核心稳定后再加：

| 模块 | 理由 |
|------|------|
| 飞书/企业微信集成 | 核心未稳定前加 IM 集成是添乱 |
| MCP server endpoint | 同理 |
| Feature Chain | V2.1 |
| Lobby (IM 会话) | V2.1 |

---

## 11. GitHub 配置

### Git Hooks

| Hook | 作用 |
|------|------|
| `commit-msg` | 强制提交信息格式：`[FYYYYMMDDNN][module][类型] 中文标题` |
| `pre-commit` | 禁止直接提交到 main |
| `pre-push` | 禁止直接 push 到 main |

### CI

- GitHub Actions：Node 22 + `npm ci` + `npm run check`
- PR 必须与 main 保持同步（merge base 检查）

### Dependabot

- 每周检查 npm 和 GitHub Actions 依赖更新

---

## 12. 目录结构总览

```
src/
├── workspace/          # 项目空间域
├── sop/                # 标准流程域
├── issue/              # 工作任务域
├── snail/              # Agent 模板与运行时域
├── conversation/       # 对话消息域
├── evolution/          # 演进治理域
├── db/                 # 持久层（schema、migration、repos）
├── server/             # API 层（Hono）
├── web/                # 前端（React）
├── config/             # 纯配置（非领域数据）
├── logger/             # 结构化日志
└── main.ts             # 入口
```

### 层间依赖规则

```
workspace ──→ sop ──→ issue ──→ conversation
                │                   ↑
                └───────────────────┘
                        │
                       snail

db          ──→ 各域 types（仅 import 类型）
server      ──→ 各域 api + db
web         ──→ server/contracts（仅 DTO 和端点类型）
config      ─→ 无依赖
logger      ─→ 无依赖
```

---

## 决策日志

| 日期 | 决策 | 状态 |
|------|------|------|
| 2026-06-08 | 同仓库 + legacy/ 归档 V1 | ✅ 已执行 |
| 2026-06-08 | 单 src/ 结构（非 monorepo） | ✅ 已确认 |
| 2026-06-08 | Hono 替代 Express | ✅ 已安装 |
| 2026-06-08 | Drizzle ORM 替代原生 better-sqlite3 | ✅ 已安装 |
| 2026-06-08 | DDD 架构 + api.ts + _internal/ 模式 | ✅ 已确认 |
| 2026-06-08 | 不设共享 types/ 目录 | ✅ 已确认 |
| 2026-06-08 | 配置与数据分离 | ✅ 已确认 |
| 2026-06-08 | V2 不含飞书/企业微信/MCP | ✅ 已确认 |
