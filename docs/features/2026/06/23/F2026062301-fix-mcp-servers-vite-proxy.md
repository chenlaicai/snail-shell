---
id: F2026062301
title: fix-mcp-servers-vite-proxy
from_ids: [F2026062206]
tags: [web, mcp, bugfix]
modules: [web]
doc_kind: spec
---

# F2026062301 [web] 修复 MCP Servers 页面 Vite 代理配置遗漏

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

PR #413（F2026062206）实现了 MCP UI 拆分，新增了 `/mcp-servers` 页面。该页面通过 `fetch("/mcp")` 直接请求 snail-mcp-server 的端点获取内建 MCP Server 列表。

但在开发环境中，Vite 开发服务器的代理配置只代理了 `/api` 和 `/issue-events`，**没有代理 `/mcp` 路径**，导致 `fetch("/mcp")` 请求被 Vite 拦截并返回 `index.html`，前端 JSON 解析失败，页面显示"加载失败：The string did not match the expected pattern."。

## 目标

修复 MCP Servers 页面在开发环境中的加载失败问题。

## 非目标

- 修改生产环境配置（生产环境通过反向代理或容器网络直接访问后端，不存在此问题）
- 修改 MCP Servers 页面的其他功能

## 核心业务行为

| # | 场景 | 预期行为 |
|---|------|----------|
| B1 | 当用户在开发环境访问 `/mcp-servers` 时 | 页面正常加载，左侧显示 4 个内建 MCP Server 列表 |
| B2 | 当用户点击某个 MCP Server 时 | 右侧详情面板正常展示 server 信息和 tool 列表 |

## 设计

### 问题根因

`src/web/vite.config.ts` 的 `server.proxy` 配置遗漏了 `/mcp` 路径：

```ts
proxy: {
  "/api": backendHttpBaseUrl,
  "/issue-events": { target: backendHttpBaseUrl, ws: true },
  // ❌ 缺少 "/mcp": backendHttpBaseUrl
}
```

### 修复方案

在 `vite.config.ts` 的 `proxy` 配置中添加 `/mcp` 代理：

```ts
proxy: {
  "/api": backendHttpBaseUrl,
  "/mcp": backendHttpBaseUrl,
  "/issue-events": { target: backendHttpBaseUrl, ws: true },
}
```

### 设计约束

- 代理配置仅影响开发环境，不影响生产构建
- `/mcp` 端点同时支持 `GET`（列表/详情）和 `POST`（JSON-RPC），Vite 代理默认支持所有 HTTP 方法
- 不需要特殊配置 WebSocket（MCP 的 JSON-RPC 走 HTTP POST）

## 生效路径

- 代码：`src/web/vite.config.ts`
- 文档：本 feature 文档

## 设计约束摘要

- **边界**：仅修改开发环境配置，不涉及生产环境
- **关键决策**：直接在现有 `proxy` 配置中添加 `/mcp` 条目，不改变代理策略
- **语义不变量**：`/mcp` 端点的行为不变，只是开发环境的请求路由修正

<!-- [design-time] 章节结束 -->

## 改动范围

| 类型 | 文件/模块 | 说明 |
|------|-----------|------|
| 修改 | `src/web/vite.config.ts` | 添加 `/mcp` 代理配置 |

## 验证

- [ ] 访问 `/mcp-servers` 左侧显示 4 个内建 server（名称 + tool 数量 badge）
- [ ] 点击 server 列表项，右侧详情面板展示名称、版本、endpoint、tool 列表
- [ ] 页面无"加载失败"错误提示

## 关联

- **前置**: F2026062206（MCP UI 拆分）
- **修复**: F2026062206 改动范围遗漏 `vite.config.ts`

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | 代理配置方式 | 直接添加 `/mcp` 条目最简单 | 应该统一所有 `/mcp/*` 路径的代理规则 | 直接添加 `/mcp` 条目 | `/mcp` 端点是根路径，Vite 代理会自动处理子路径 | 架构师-1 | 2026-06-23 |
