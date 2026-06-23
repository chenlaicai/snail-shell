---
id: F2026062301
title: fix-mcp-servers-vite-proxy-and-rename
from_ids: [F2026062206]
tags: [web, mcp, bugfix, refactor]
modules: [web]
doc_kind: spec
---

# F2026062301 [web] 修复 MCP Servers 页面 Vite 代理配置遗漏 + 统一 MCP 命名

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

PR #413（F2026062206）实现了 MCP UI 拆分，新增了 `/mcp-servers` 页面。该页面通过 `fetch("/mcp")` 直接请求 snail-mcp-server 的端点获取内建 MCP Server 列表。

但在开发环境中，Vite 开发服务器的代理配置只代理了 `/api` 和 `/issue-events`，**没有代理 `/mcp` 路径**，导致 `fetch("/mcp")` 请求被 Vite 拦截并返回 `index.html`，前端 JSON 解析失败，页面显示"加载失败：The string did not match the expected pattern."。

同时，MCP 相关的命名存在混淆：
- `domain/mcp/` 模块实际管理的是 MCP 配置（读取 mcp.json 文件），但名称没有体现这一点
- API 端点 `/api/meta/mcps` 名称模糊，不知道是 "MCP Servers" 还是 "MCP 配置"
- Query key `mcps` 和 `mcpServers` 仅差一个字母，容易混淆

## 目标

1. 修复 MCP Servers 页面在开发环境中的加载失败问题
2. 统一 MCP 相关命名，消除混淆

## 非目标

- 修改生产环境配置（生产环境通过反向代理或容器网络直接访问后端，不存在此问题）
- 修改 MCP Servers 页面的其他功能

## 核心业务行为

| # | 场景 | 预期行为 |
|---|------|----------|
| B1 | 当用户在开发环境访问 `/mcp-servers` 时 | 页面正常加载，左侧显示 4 个内建 MCP Server 列表 |
| B2 | 当用户点击某个 MCP Server 时 | 右侧详情面板正常展示 server 信息和 tool 列表 |
| B3 | 当代码引用 MCP 配置相关模块时 | 命名清晰，不会与 MCP Server 混淆 |

## 设计

### 问题 1：Vite 代理配置遗漏

`src/web/vite.config.ts` 的 `server.proxy` 配置遗漏了 `/mcp` 路径：

```ts
proxy: {
  "/api": backendHttpBaseUrl,
  "/issue-events": { target: backendHttpBaseUrl, ws: true },
  // ❌ 缺少 "/mcp": backendHttpBaseUrl
}
```

**修复方案**：在 `vite.config.ts` 的 `proxy` 配置中添加 `/mcp` 代理：

```ts
proxy: {
  "/api": backendHttpBaseUrl,
  "/mcp": backendHttpBaseUrl,
  "/issue-events": { target: backendHttpBaseUrl, ws: true },
}
```

### 问题 2：MCP 命名混淆

**命名统一规则**：
- 所有 "配置" 相关的：统一使用 `mcp-config`（如 `domain/mcp-config/`、`/api/meta/mcp-configs`、queryKey `mcpConfigs`）
- 所有 "Server" 相关的：保持 `mcp-server` 不变（已经清晰）

### 设计约束

- 代理配置仅影响开发环境，不影响生产构建
- `/mcp` 端点同时支持 `GET`（列表/详情）和 `POST`（JSON-RPC），Vite 代理默认支持所有 HTTP 方法
- 不需要特殊配置 WebSocket（MCP 的 JSON-RPC 走 HTTP POST）
- 命名重构不影响运行时行为，仅影响代码可读性

## 生效路径

- 代码：`src/web/vite.config.ts`、`src/domain/mcp-config/`、多个 import 路径
- 文档：本 feature 文档

## 设计约束摘要

- **边界**：仅修改开发环境配置和代码命名，不涉及生产环境
- **关键决策**：直接在现有 `proxy` 配置中添加 `/mcp` 条目，不改变代理策略；统一使用 `mcp-config` 表示配置相关
- **语义不变量**：`/mcp` 端点的行为不变，只是开发环境的请求路由修正；MCP 配置的业务逻辑不变，只是命名更清晰

<!-- [design-time] 章节结束 -->

## 改动范围

| 类型 | 文件/模块 | 说明 |
|------|-----------|------|
| 修改 | `src/web/vite.config.ts` | 添加 `/mcp` 代理配置 |
| 重命名 | `src/domain/mcp/` → `src/domain/mcp-config/` | 重命名目录 |
| 修改 | `src/api-contracts/dto.ts` | McpServerDto → McpConfigDto |
| 修改 | `src/api-contracts/endpoints.ts` | /api/meta/mcps → /api/meta/mcp-configs |
| 修改 | `src/web/queries/keys.ts` | mcps → mcpConfigs |
| 修改 | `src/web/queries/meta.queries.ts` | mcps → mcpConfigs |
| 修改 | `src/web/router.tsx` | 更新函数调用 |
| 修改 | `src/web/pages/McpConfig.tsx` | 更新类型和变量名 |
| 修改 | `src/infra/http/app.ts` | 更新 import 路径 |
| 修改 | `src/infra/http/routes/meta.route.ts` | 更新 import 路径 + API 端点路径 |
| 修改 | `src/main.ts` | 更新 import 路径 |
| 修改 | `src/domain/snail/_internal/adapter.ts` | 更新 import 路径 |
| 修改 | `src/domain/snail/_internal/initor.ts` | 更新 import 路径 |

## 验证

- [x] 访问 `/mcp-servers` 左侧显示 4 个内建 server（名称 + tool 数量 badge）
- [x] 点击 server 列表项，右侧详情面板展示名称、版本、endpoint、tool 列表
- [x] 页面无"加载失败"错误提示
- [x] TypeScript 编译通过
- [x] 所有 import 路径正确（grep 验证无遗漏）
- [x] API 端点正常工作
- [x] 前端页面正常加载

## 关联

- **前置**: F2026062206（MCP UI 拆分）
- **修复**: F2026062206 改动范围遗漏 `vite.config.ts`
- **重构**: 基于 PR #420 检视意见，统一 MCP 相关命名

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | 代理配置方式 | 直接添加 `/mcp` 条目最简单 | 应该统一所有 `/mcp/*` 路径的代理规则 | 直接添加 `/mcp` 条目 | `/mcp` 端点是根路径，Vite 代理会自动处理子路径 | 架构师-1 | 2026-06-23 |
| D2 | 命名统一规则 | 使用 `mcp-config` 表示配置相关 | 应该保持现有命名不变 | 使用 `mcp-config` | 与前端页面路径 `/mcp-config` 保持一致 | 审查者-1 | 2026-06-23 |
