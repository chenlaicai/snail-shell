---
id: F20260703w2rn
---

# F20260703w2rn — infra 层消除 @app/ 依赖：适配器层独立

## 不兼容更新

**目录重组**：

- `src/infra/http/` → `src/adapter/http/`
- `src/infra/mcp-server/` → `src/adapter/mcp-server/`

**Import 路径变更**：

- `@infra/http/*` → `@adapter/http/*`
- `@infra/mcp-server/*` → `@adapter/mcp-server/*`

受影响的外部导入仅 `src/main.ts`（3 条 import）。

## 背景与动机

`npm run check` 产出 3 个 ESLint warning，均来自 `@typescript-eslint/no-restricted-imports` 规则：

| # | 文件 | 行 | 违规 import |
|---|------|-----|-------------|
| 1 | `src/infra/http/app.ts` | 13 | `import type { CollaborationInput } from "@app/issue-collaboration/port"` |
| 2 | `src/infra/http/routes/issue.route.ts` | 9 | 同上 |
| 3 | `src/infra/http/unified-websocket.ts` | 5-10 | `import type { CollaborationInput, CollaborationConsumer, WorkspaceConsumer, StageTransitionSuggestion } from "@app/issue-collaboration/port"` |

ESLint 规则（`eslint.config.mjs:96-105`）约束：**infra 层禁止依赖 app 层；adapter 通过 DI 接收 app 层实例**。

## 根因分析

### 依赖链路

```
main.ts
  └─ createApp({ collaboration: collaboration.adapter })   ← DI 注入
       └─ AppDeps.collaboration: CollaborationInput         ← 类型来自 @app/
            ├─ app.ts: CollaborationInput                   ← warning #1
            ├─ issue.route.ts: CollaborationInput           ← warning #2
            └─ unified-websocket.ts: 多个类型               ← warning #3
```

### 核心问题

`src/infra/` 混合了两种不同性质的代码：

| 子目录 | 分类 | `@app/` import | `@domain/` import |
|--------|------|---------------|-------------------|
| 根文件（7个） | 纯基础设施 | 0 | 0 |
| `acs/` | 纯基础设施 | 0 | 0 |
| **`http/`** | **适配器** | 3 | 29 |
| **`mcp-server/`** | **适配器** | 0 | 2 |

`http/` 和 `mcp-server/` 是**入站适配器**（接收外部 HTTP/WebSocket 请求，委派给 domain/app port），不是基础设施。放在 `infra/` 下是层级语义混淆，导致 ESLint 规则误报。

### `CollaborationInput` 归属分析

逐方法分析（15 个方法），14 个是跨聚合编排操作（issue+stage、message+stage、issue+cleanup 等），与现有 domain port 的单聚合模式（`IssuePort`, `StagePort`）不同。`CleanupResult` 含运维概念（`PrStatus`, `ResourceStatus`），放入 domain 会污染领域模型。

**结论**：`CollaborationInput` 是跨聚合编排接口，应留在 app 层。适配器层应独立于 infra，合法依赖 app 和 domain。

## 设计方案

### 核心思路

将入站适配器（`http/`、`mcp-server/`）从 `src/infra/` 移至 `src/adapter/`，使 `infra/` 保持纯基础设施语义。适配器层合法依赖 `@app/*` 和 `@domain/*`，3 个 warning 自然消除。

### 设计决策

| 决策 | 正面论点 | 反面论点 | 最终选择 |
|------|---------|---------|---------|
| `CollaborationInput` 放在哪 | 方法签名基于 domain 类型 | 跨聚合编排接口，不是单聚合 port | 留在 app 层 |
| 如何消除 warning | R4：调整 ESLint 规则（1 行） | R4 放宽规则，infra→app 依赖仍存在 | R5：适配器层独立（修正根因） |
| 适配器是否纳入 infra | infra = 基础设施，无业务语义 | 适配器 = 入站驱动，依赖业务类型 | 适配器独立于 infra |

### 变更清单

#### 1. 目录重组

- `src/infra/http/` → `src/adapter/http/`（9 个文件）
- `src/infra/mcp-server/` → `src/adapter/mcp-server/`（1 个文件）

#### 2. 更新 `tsconfig.json`

新增 path alias：

```json
"@adapter/*": ["src/adapter/*"]
```

#### 3. 更新 `eslint.config.mjs`

新增 `src/adapter/**/*.ts` 规则：

```js
{
  files: ["src/adapter/**/*.ts"],
  rules: {
    "@typescript-eslint/no-restricted-imports": ["warn", {
      patterns: [{
        group: ["@app/*"],
        message: "adapter 层通过 import type 获取端口类型，禁止值导入；运行时通过 DI 注入"
      }]
    }]
  }
}
```

`src/infra/**/*.ts` 规则保持不变（infra 确实不应依赖 app/domain）。

#### 4. 更新 `src/main.ts`

| 原路径 | 新路径 |
|--------|--------|
| `@infra/http/app` | `@adapter/http/app` |
| `@infra/http/unified-websocket` | `@adapter/http/unified-websocket` |
| `@infra/mcp-server/handler` | `@adapter/mcp-server/handler` |

#### 5. 更新 `src/adapter/http/` 内部引用

`@infra/logger` 等 import 保持不变（infra 仍是适配器的依赖）。

### 不需要变更的文件

- `src/app/**` — 不动
- `src/domain/**` — 不动
- `src/web/**` — 不涉及
- `src/infra/**`（根文件 + `acs/`）— 不动

### 依赖方向验证

```
src/adapter/   ← 入站适配器（HTTP, websocket, mcp-server）
    │ import type from @app/    ← 允许（适配器必须知道端口类型）
    │ import from @domain/      ← 允许
    │ import from @infra/       ← 允许（infra 是基础层）
    ↓
src/app/       ← 应用服务
    ↓
src/domain/    ← 领域模型

src/infra/     ← 纯基础设施（logger, database, acs, config）
    ↓
    （无业务依赖）
```

## [design-time]

### 核心设计决策

1. **`CollaborationInput` 留在 app 层**：15 个方法中 14 个是跨聚合编排操作，不是单聚合 domain port。`CleanupResult` 含运维概念，放入 domain 会污染领域模型。
2. **适配器独立于 infra**：`http/` 和 `mcp-server/` 是入站适配器（29+3 个 @domain/@app import），不是基础设施。放在 `infra/` 下是层级语义混淆。
3. **infra ESLint 规则不修改**：infra 确实不应依赖 app/domain，规则正确。修正方式是移动适配器，而非放宽规则。

### 争议解决记录

| 轮次 | 争议点 | 提出方 | 解决方式 |
|------|--------|--------|---------|
| R1 | CollaborationInput 是否属于 domain | 架构师-2 | 逐方法分析，14/15 是跨聚合编排，不属 domain |
| R2 | import type 是否消除 warning | 架构师-1 | ESLint 未配置 allowTypeImports，import type 也触发 |
| R3 | 应绕过规则还是修正规则 | 用户 | 六边形架构中适配器必须知道端口类型，是规则缺陷 |
| R4 | 应放宽规则还是修正架构 | 用户 | infra 是基础层，适配器不应放在 infra 中 |
| R5 | 适配器层独立 | 架构师-2 + 架构师-1 | 共识：修正层级划分 |

<!-- [design-time] 章节结束 -->

## 决策历程

本方案经历了 5 轮交叉审视，从"复制类型"逐步收敛到"修正架构"：

| 轮次 | 方案 | 核心争议 | 推翻原因 |
|------|------|---------|---------|
| R1 | CollaborationInput 移入 domain port | 跨聚合编排接口不是 domain port；CleanupResult 是运维概念 | 方向错误：把非 domain 概念强行放入 domain |
| R2 | infra 本地定义所有类型（~65 行） | import type 也触发 warning，从 app import type 不消除 warning | 技术判断错误：未验证 ESLint 规则对 import type 的行为 |
| R3 | infra 复制所有类型（零 @app/ import） | 用户质疑：六边形架构中适配器必须知道端口类型，这是规则的缺陷不是代码的问题 | **根本方向错误：在绕过一个有问题的规则，而不是修正规则** |
| R4 | 调整 ESLint 规则（allowTypeImports: true） | 用户质疑：infra 是基础层，不应引入业务语义；对外暴露的模块不放到 infra | **层级划分错误：放宽规则而非修正架构** |
| R5 | 适配器层独立（`src/adapter/`） | 无 | 共识达成 |

**教训**：R1-R3 在思考"如何满足规则"，R4 在思考"规则是否合理"，R5 在思考"架构本身是否合理"。正确的分析路径应该是：先理解层级语义 → 再判断代码是否放在正确的层 → 最后调整架构。

## 核心业务行为

1. **infra 是纯基础设施层（logger、database、config），不含业务语义，不应依赖 app/domain**
2. **适配器是入站驱动层（HTTP routes、websocket），必须知道端口类型，合法依赖 app/domain**
3. **层级划分应反映代码的实际职责，而非历史目录结构**

## 验收标准

| ID | 标准 | 验证方式 |
|----|------|---------|
| S1 | `npm run check` 零 warning | `npm run check 2>&1 \| grep -c "warning"` → 0 |
| S2 | `src/infra/` 零 `@app/` 和 `@domain/` import | `grep -r "from '@app/\|from '@domain/" src/infra/` 返回空 |
| S3 | `src/adapter/` 存在且包含 http/ + mcp-server/ | `ls src/adapter/` 确认 |
| S4 | TypeScript 编译无新增错误 | `npx tsc --noEmit` 通过 |
| S5 | main.ts 导入路径正确 | `grep "@adapter/" src/main.ts` 确认 3 条 import |

## 实现指引

- **目录移动**：`git mv src/infra/http src/adapter/http` + `git mv src/infra/mcp-server src/adapter/mcp-server`
- **内部引用**：`src/adapter/http/` 内部对 `@infra/logger` 等的引用保持不变；对 `@infra/http/*` 的自引用更新为 `@adapter/http/*`
- **外部引用**：`src/main.ts` 更新 3 条 import 路径；`tests/unified-websocket.test.ts` 和 `tests/mcp-handler-not-found.test.ts` 更新引用路径
- **ESLint 配置**：新增 `src/adapter/**/*.ts` 规则块，`@app/*` 使用 `allowTypeImports: true` 允许类型导入
- **tsconfig**：新增 `@adapter/*` path alias
- **vitest.config.ts**：新增 `@adapter` resolve alias
