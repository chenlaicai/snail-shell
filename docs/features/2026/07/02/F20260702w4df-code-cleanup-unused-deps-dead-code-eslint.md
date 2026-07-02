---
id: F20260702w4df
title: code-cleanup-unused-deps-dead-code-eslint
from_ids: [F20260701chkr]
tags: [infra, web, eslint, cleanup, dependencies, dead-code]
modules: [infra, web]
doc_kind: spec
change_type: refactor
---

# F20260702w4df [infra][web][Refactor] 代码仓健康清理 — 未使用依赖、死代码、console 日志、ESLint 层级防护

## 背景

Feature Doc [F20260701chkr] 对代码仓进行系统性健康检视，发现 10 个问题。其中 F-1（domain→app 层级违规）、F-2（infra→domain `_internal` 误引用）、F-10（domain→infra `_internal` 侵入）已有独立 issue 处理。

本 Feature 处理剩余的 4 个清理项：F-3（未使用依赖）、F-5（前端 console.*）、F-6（死代码文件）、F-9（ESLint 层级方向防护）。

## 目标

1. 移除 package.json 中 3 个未使用的依赖
2. 删除 2 个已废弃的 WebSocket 死代码文件
3. 清理前端 7 处原生 console.* 调用（删除 3 处有 perf-logger 覆盖的，保留 4 处无替代的），启用 ESLint `no-console` 规则阻止回退
4. 添加 ESLint 规则防止架构层级方向违规回退（覆盖全部 15 个 domain 模块）

## 非目标

- F-4（超大文件拆分）scope 较大，单独处理
- F-7（legacy cleanup 函数）需确认业务状态，不在本次范围
- F-8（TODO 标记）为业务待办，非代码质量问题

## 方案

### Part 1: 移除未使用依赖 (F-3)

从 `package.json` 移除以下 3 个依赖：

| 依赖 | 原因 |
|------|------|
| `express` | 已完全迁移到 Hono，源码零引用 |
| `@types/express` | 无 express 代码，类型声明无用 |
| `@larksuiteoapi/node-sdk` | Feishu 传输层使用原生 `fetch()`，源码零引用 |

**验证**：`npm run check`（lint + tsc + build）通过。

### Part 2: 删除死代码文件 (F-6)

删除以下 2 个文件：

| 文件 | 行数 | 说明 |
|------|------|------|
| `src/infra/http/workspace-websocket.ts` | 87 | `@deprecated`，已被 `unified-websocket.ts` 替代，main.ts 零引用 |
| `src/infra/http/stage-websocket.ts` | 122 | `@deprecated`，已被 `unified-websocket.ts` 替代，main.ts 零引用 |

两个文件互相引用但无外部消费者。`unified-websocket.ts` 通过 `createUnifiedWebSocketBridge` 提供统一的 WebSocket 桥接。

**验证**：`grep -r "workspace-websocket\|stage-websocket" src/` 返回零结果（仅 `unified-websocket.ts` 内部不引用这两个文件）。

### Part 3: 前端 console.* 清理 (F-5)

7 处前端代码使用原生 `console.*`，创建轻量前端日志工具 `src/web/lib/logger.ts` 统一替换。

**新增文件**：`src/web/lib/logger.ts` — 提供 `getLogger(module)` 工厂函数，返回 `{debug, info, warn, error}` 接口。当前实现委托给 `console`，未来可扩展为批量上报。

**替换（7 处）**— 全部替换为 `getLogger()` 调用：

| 文件 | 原调用 | 替换为 |
|------|--------|--------|
| `src/web/hooks/useWebSocket.ts:359` | `console.warn("[WebSocket] 消息解析失败:", ...)` | `log.warn("消息解析失败:", ...)` |
| `src/web/hooks/useWebSocket.ts:406` | `console.log("[WebSocket] 连接关闭，...")` | `log.info("连接关闭，...")` |
| `src/web/hooks/useWorkspaceRealtime.ts:56` | `console.log("[WorkspaceWebSocket] connected", ...)` | `log.info("connected", ...)` |
| `src/web/hooks/useWorkspaceRealtime.ts:70` | `console.warn("[WorkspaceWebSocket] 消息解析失败:", ...)` | `log.warn("消息解析失败:", ...)` |
| `src/web/hooks/useWorkspaceRealtime.ts:75` | `console.warn("[WorkspaceWebSocket] disconnected, ...")` | `log.warn("disconnected, ...")` |
| `src/web/hooks/useWorkspaceRealtime.ts:83` | `console.error("[WorkspaceWebSocket] error")` | `log.error("error")` |
| `src/web/components/ChatMessage.tsx:118` | `console.warn("[StuckDetector] message #... stuck ...")` | `log.warn("message #... stuck ...")` |

**设计取舍**：

| 决策 | 正观 | 反面 | 结论 |
|------|------|------|------|
| 创建 logger.ts vs 直接删除 | 统一入口，未来可扩展批量上报 | 新增文件 | 选创建：7 个调用点值得统一抽象 |
| logger.ts vs 复用 perf-logger.ts | perf-logger 仅处理性能指标阈值，语义不匹配 | 两个日志工具 | 选独立：职责不同，perf-logger 是阈值过滤器，logger 是通用日志 |

### Part 4: ESLint 层级方向防护 (F-9)

当前 ESLint 只强制 6 个 domain 模块的 `_internal` 跨模块隐私墙，无规则防止 `domain → app` 或 `infra → app` 的层级方向违规。

在 `eslint.config.mjs` 中添加以下规则：

**规则 1：全局 — 禁止 domain 层 import app 层**

为 `src/domain/**/*.ts` 添加全局层级方向规则（warn 级别，待 F-1 修复后升级为 error）：

```javascript
{
  files: ["src/domain/**/*.ts"],
  rules: {
    "@typescript-eslint/no-restricted-imports": ["warn", {
      patterns: [{
        group: ["@app/*"],
        message: "domain 层禁止反向依赖 app 层；如需 app 层能力，应通过 port 注入"
      }]
    }]
  }
}
```

**规则 2：全局 — 禁止 infra 层 import app 层**

为 `src/infra/**/*.ts` 添加全局层级方向规则（warn 级别，待 F-2 修复后升级为 error）：

```javascript
{
  files: ["src/infra/**/*.ts"],
  rules: {
    "@typescript-eslint/no-restricted-imports": ["warn", {
      patterns: [{
        group: ["@app/*"],
        message: "infra 层禁止依赖 app 层；adapter 通过 DI 接收 app 层实例"
      }]
    }]
  }
}
```

**规则 3：per-module 规则补充 @app/* 模式**

在现有 6 个 per-module `_internal` 隐私墙规则中，追加 `@app/*` 到 patterns 列表。确保 per-module 规则（覆盖更具体的文件路径）也包含层级方向约束。

**设计取舍**：

| 决策 | 正面 | 反面 | 结论 |
|------|------|------|------|
| warn vs error | 不阻塞构建，现有 5 处已知违规（F-1/F-2）仍在处理中 | 不如 error 严格 | 选 warn：已有违规由 F-1/F-2 issue 跟踪，修复后升级为 error |
| 仅 @app/* vs 同时限制 @infra/* | domain→infra 是已知的广泛模式（FileDataStore、getLogger 等），一次性禁止会产生大量违规 | 架构纯净 | 选仅 @app/*：聚焦 F-1 类违规，domain→infra 是独立的架构改进 |
| 补全 9 个缺失 per-module 规则 | 覆盖完整 | 每个模块需列出 14 个其他模块的 _internal，126 个 pattern 条目 | 暂不补全：现有 6 个模块的规则已覆盖主要高频模块，其余模块由全局 warn 规则兜底 |

## 修改文件

| 文件 | 变更 |
|------|------|
| `package.json` | 移除 express、@types/express、@larksuiteoapi/node-sdk |
| `src/infra/http/workspace-websocket.ts` | 删除 |
| `src/infra/http/stage-websocket.ts` | 删除 |
| `src/web/lib/logger.ts` | 新增：轻量前端结构化日志工具 |
| `src/web/hooks/useWebSocket.ts` | 2 处 console.* → getLogger("WebSocket") |
| `src/web/hooks/useWorkspaceRealtime.ts` | 4 处 console.* → getLogger("WorkspaceWebSocket") |
| `src/web/components/ChatMessage.tsx` | 1 处 console.warn → getLogger("StuckDetector") |
| `eslint.config.mjs` | ① 全局 domain 层 @app/* warn 规则 ② 全局 infra 层 @app/* warn 规则 ③ per-module 规则补充 @app/* 模式 |

## 核心业务行为

- `package.json` 移除依赖后，`npm run check` 全通过
- 删除 `workspace-websocket.ts` / `stage-websocket.ts` 后，WebSocket 功能不受影响（unified-websocket.ts 独立运行）
- 7 处前端 console.* 全部替换为 `getLogger()` 结构化日志，统一入口便于未来扩展
- ESLint 全局 warn 规则阻止 domain 层 import @app/*（待 F-1 修复后升级为 error）
- ESLint 全局 warn 规则阻止 infra 层 import @app/*（待 F-2 修复后升级为 error）
- ESLint per-module 规则阻止 6 个 domain 模块互相 import `_internal`（各模块可导入自身的 `_internal`）

## 验证

| 检查项 | 验证方式 |
|--------|----------|
| 依赖清理无破坏 | `npm run check` 全通过（lint 0 error + tsc + build:web） |
| 死代码删除无破坏 | `grep -r "workspace-websocket\|stage-websocket" src/` 零结果 |
| console.* 全部替换 | `grep -rn "console\.\(log\|warn\|error\|info\|debug\)" src/web/hooks/ src/web/components/` 零结果 |
| ESLint domain→app 规则生效 | `npx eslint src/domain/` 显示 2 个 warning（evolution 的 @app/* 引用） |
| ESLint infra→app 规则生效 | `npx eslint src/infra/` 显示 3 个 warning（http 的 @app/* 引用） |
| 测试通过 | `npm run test` 183/183 通过 |

## 交叉审视决策记录

### 架构师-2 Finding 1：_internal 模块列表错误和覆盖缺口

**原始判断**：Part 4 引用了不存在的 `@domain/mcp-server` 和 `@domain/mcp-client`，且只覆盖 8/15 个模块。

**处置**：✅ 确认接受。验证结果：
- 正确名称是 `snail-mcp-server`（非 `mcp-server`），`mcp-client` 不存在
- 15 个 domain 模块有 `_internal`，原方案只覆盖 6 个（ESLint 已有规则）+ 2 个（错误名称），缺失 9 个

**修正**：Part 4 改为覆盖全部 15 个模块，修正模块名称。

### 架构师-2 Finding 2：自引用排除机制缺失

**原始判断**：全局合并规则会阻止模块导入自己的 `_internal`。

**处置**：✅ 确认接受。当前 per-module 规则各排除自身（如 workspace 不阻止 `@domain/workspace/_internal/*`），全局合并无法表达此语义。

**修正**：保留 per-module 规则结构，不合并。9 个缺失模块的 per-module 规则暂不补全，由全局 warn 规则兜底（详见 Part 4 设计取舍表）。

### 架构师-2 Finding 3：frontend-logger 必要性存疑

**原始判断**：`getWebLogger()` 已存在，7 个调用点不值得新抽象。

**处置**：部分接受。
- ❌ `getWebLogger()` 是服务端 pino logger（写入 logs/web.log），无法在浏览器侧使用，前提不成立
- ⚠️ "7 个调用点不值得新抽象"需结合 Finding 4 重新评估

**修正**：综合 Finding 4（useWorkspaceRealtime.ts 的 4 处 console 是唯一可观测性），保留 `src/web/lib/logger.ts` 薄封装（37 行），提供模块前缀 + 未来可扩展批量上报。7 处 console 全部替换为 `getLogger()`，`eslint.config.mjs` 中为 logger.ts 配置 `no-console` 豁免。

### 架构师-2 Finding 4：useWorkspaceRealtime.ts 无 perf-logger 覆盖

**原始判断**：Feature doc 声称"perf-logger 已覆盖关键指标"只对 useWebSocket.ts 成立。useWorkspaceRealtime.ts 是独立的 workspace 级 WebSocket 连接，不使用 perf-logger，4 处 console 是唯一可观测性。

**处置**：✅ 确认接受。验证：useWebSocket.ts 导入了 `recordWsReconnect` + `recordWsDisconnect`（第 6/392/404 行），useWorkspaceRealtime.ts 零 perf-logger 引用。

**修正**：Part 3 改为分类处理 — 删除 3 处（useWebSocket.ts ×2 有 perf-logger 覆盖 + ChatMessage.tsx ×1 dev-only），保留 4 处 useWorkspaceRealtime.ts console（加 eslint-disable 注释）。
