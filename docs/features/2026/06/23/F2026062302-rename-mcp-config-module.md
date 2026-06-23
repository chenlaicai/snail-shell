---
id: F2026062302
title: rename-mcp-config-module
from_ids: [F2026062301]
tags: [web, mcp, refactor]
modules: [web]
doc_kind: spec
---

# F2026062302 - 重命名 MCP 配置模块以提高清晰度

## 基本信息

- **特性编号**：F2026062302
- **创建日期**：2026-06-23
- **状态**：进行中
- **变更类型**：refactor

## 问题描述

MCP 相关的命名存在混淆：
- `domain/mcp/` 模块实际管理的是 MCP 配置（读取 mcp.json 文件），但名称没有体现这一点
- API 端点 `/api/meta/mcps` 名称模糊，不知道是 "MCP Servers" 还是 "MCP 配置"
- Query key `mcps` 和 `mcpServers` 仅差一个字母，容易混淆

## 解决方案

统一命名规范：
- 所有 "配置" 相关的：统一使用 `mcp-config`（如 `domain/mcp-config/`、`/api/meta/mcp-configs`、queryKey `mcpConfigs`）
- 所有 "Server" 相关的：保持 `mcp-server` 不变（已经清晰）

## 改动范围

| 文件 | 变更 |
|------|------|
| `src/domain/mcp/` → `src/domain/mcp-config/` | 重命名目录 |
| `src/domain/mcp-config/port.ts` | 更新内部 import 路径 |
| `src/domain/mcp-config/model.ts` | 无变化 |
| `src/domain/mcp-config/_internal/adapter.ts` | 更新内部 import 路径 |
| `src/domain/mcp-config/_internal/initor.ts` | 更新内部 import 路径 |
| `src/domain/mcp-config/_internal/repository.ts` | 更新内部 import 路径 |
| `src/infra/http/app.ts` | 更新 import 路径 |
| `src/infra/http/routes/meta.route.ts` | 更新 import 路径 + API 端点路径 |
| `src/main.ts` | 更新 import 路径 |
| `src/domain/snail/_internal/adapter.ts` | 更新 import 路径 |
| `src/domain/snail/_internal/initor.ts` | 更新 import 路径 |
| `src/api-contracts/endpoints.ts` | 更新 API 端点定义 |
| `src/web/queries/keys.ts` | 重命名 queryKey mcps → mcpConfigs |
| `src/web/queries/meta.queries.ts` | 重命名函数 mcps → mcpConfigs + 更新 API 调用 |
| `src/web/router.tsx` | 更新函数调用 |
| `src/web/pages/McpConfig.tsx` | 更新函数调用 + 变量名 mcps → mcpConfigs |
| `src/api-contracts/dto.ts` | 重命名 McpServerDto → McpConfigDto |

## 验证

- [x] TypeScript 编译通过
- [x] 所有 import 路径正确（grep 验证无遗漏）
- [ ] API 端点正常工作
- [ ] 前端页面正常加载

## 关联

- 基于 PR #420 的检视意见，统一 MCP 相关命名
