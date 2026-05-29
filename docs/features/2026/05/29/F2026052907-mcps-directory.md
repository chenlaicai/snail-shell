---
id: F2026052907
title: "[web] MCPs 一级目录：展示所有已配置 MCP server"
from_ids: [F2026052605, F2026052906]
tags: [mcp, web, ui]
modules: [web, agent]
---
# F2026052907 MCPs 一级目录：展示所有已配置 MCP server

## 背景

Snail Shell 通过 `.mcp.json` 配置 MCP server（如 `snail-final-body`），但前端没有管理界面。用户无法直观查看当前配置了哪些 MCP server、各自的 transport 类型和连接信息。

## 目标

1. 新增"MCPs"一级导航目录，与项目管理、知识中心等并列
2. 展示 `.mcp.json` 中所有已配置的 MCP server
3. 每个 MCP 显示名称、transport 类型（HTTP/stdio）、连接信息
4. 内置 MCP（`snail-final-body`）标记为"内置"

## 非目标

- 不支持在线编辑 MCP 配置（只读展示）
- 不支持运行时动态添加/删除 MCP
- 不展示 MCP tool 列表（仅展示 server 级信息）

## 设计

### 数据源

`GET /api/meta/mcps` 读取 `process.cwd()/.mcp.json`，返回 `[{ name, url?, command?, args?, env? }]`。

### UI 结构

遵循 `skill-center-view.js` 模式：左侧列表 + 右侧详情。
- 列表项显示名称 + transport 标签（HTTP/stdio）
- 详情面板显示连接信息和环境变量

### 改动范围

| 文件 | 变更 |
|------|------|
| `src/interaction-entry/api/server.ts` | 新增 `GET /meta/mcps` 端点 |
| `src/web/mcp-center-view.js` | **新建**：MCP Center 视图 |
| `src/web/styles/components/mcp-center.css` | **新建**：MCP Center 样式 |
| `src/web/styles.css` | 导入 mcp-center.css |
| `src/web/ui-shell.js` | nav 按钮 + 主面板 |
| `src/web/primary-view.js` | PRIMARY_VIEWS + applyPrimaryView |
| `src/web/app.js` | DOM 引用 + 控制器 + 事件绑定 |

## 验证

1. TypeScript 编译通过
2. ESLint 通过
3. 现有测试通过
4. 手动验证：启动 server → 点击 MCPs → 显示 snail-final-body（HTTP）
