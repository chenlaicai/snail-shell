---
id: F2026062206
title: mcp-ui-split
from_ids: []
tags: [web, mcp]
modules: [domain/mcp, domain/snail-mcp-server, web]
doc_kind: spec
---

# F2026062206 [web] MCP UI 拆分

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

后端 MCP 相关能力由两个独立的 domain 模块承载：

1. **`domain/snail-mcp-server`**：Snail Shell 自身作为 MCP Server 的运行时，注册内建 MCP Server 并处理 JSON-RPC 请求。当前注册了 4 个内建 server（snail-final-response、snail-evolution、snail-knowledge、rednote-research），每个 server 暴露一组工具。
2. **`domain/mcp`**：MCP 配置管理，声明哪些 MCP Server（含外部 Server）对 Agent 可用。配置来源包括平台级 `config/mcp.json`、workspace 级 `.snail/mcp.json`，以及从 snail-mcp-server 自动注入的内建 server。

当前前端只有一个 `/mcps` 页面（`McpCenter.tsx`），调用 `GET /api/meta/mcps` 获取两个模块合并后的扁平列表，仅展示 `name` 和 `url`，无 scope 区分、无 tool 展示、无 CRUD。UI 未反映后端的双模块架构。

## 目标

将前端 MCP UI 拆分为两个独立界面，与后端双模块对齐：

### P1 — MCP Servers 展示页 + MCP Config 展示页

- 新增 `/mcp-servers` 页面，展示 `domain/snail-mcp-server` 的内建 MCP Server 及其 tool 列表
- 改造现有 `/mcps` 路径为 `/mcp-config`，展示 `domain/mcp` 的配置列表，区分 scope 和来源
- 侧边栏 `Config` 区域的 `MCPs` 拆为 `MCP Servers` 和 `MCP Config` 两项
- `/mcps` 旧路由重定向到 `/mcp-config`

## 非目标

- MCP Config 的 CRUD 操作（增删改 workspace 级配置）
- MCP Server 的健康检查/状态监控
- MCP Server tool 的在线测试/调用功能
- inputSchema 的完整 JSON Schema 展示（仅展示 tool name + description）
- 同名冲突处理（内建 server 与用户配置同名时会产生重复条目，已知限制）

## 核心业务行为

| # | 场景 | 预期行为 |
|---|------|----------|
| B1 | 当用户访问 `/mcp-servers` 时 | 页面左侧展示所有已注册的内建 MCP Server 列表（名称 + tool 数量 badge），右侧为详情面板 |
| B2 | 当用户点击左侧列表中的某个 MCP Server 时 | 右侧详情面板展示该 server 的名称、版本、endpoint URL、tool 列表（name + description） |
| B3 | 当用户点击另一个 MCP Server 时 | 右侧详情面板切换为新选中 server 的信息 |
| B4 | 当用户访问 `/mcp-config` 时 | 页面左侧展示所有 MCP 配置项列表，右侧为详情面板 |
| B5 | 当用户点击某个配置项时 | 右侧详情面板展示名称、transport 类型、scope 标签、来源标签 |
| B6 | 当 transport 为 stdio 时 | 显示 `command` + `args` |
| B7 | 当 transport 为 HTTP 时 | 显示 `url` |
| B8 | 当配置项来源为 `builtin` 时 | 显示灰色 `builtin` 标签 |
| B9 | 当配置项来源为 `platform` 时 | 显示蓝色 `platform` 标签 |
| B10 | 当配置项来源为 `workspace` 时 | 显示绿色 `workspace` 标签及关联的 workspace 路径 |
| B11 | 当用户访问 `/mcps` 时 | 自动重定向到 `/mcp-config` |
| B12 | 当用户在侧边栏查看 Config 区域时 | 看到 `MCP Servers` 和 `MCP Config` 两个独立入口 |

## 设计

### P1 详设

#### 1. API 策略：复用现有端点，不新增 API

**MCP Servers 页面**复用现有 `GET /mcp/` 和 `GET /mcp/:serverName` 端点：

- `GET /mcp/` 返回列表数据：
  ```json
  {
    "servers": [
      {
        "name": "snail-final-response",
        "version": "1.0.0",
        "endpoint": "/mcp/snail-final-response",
        "tools": ["set_final_body"]
      }
    ]
  }
  ```
  列表只含 tool name，不含 description。前端 query 需适配 `{ servers: [...] }` 结构。

- `GET /mcp/:serverName` 返回单个 server 详情：
  ```json
  {
    "name": "snail-final-response",
    "version": "1.0.0",
    "endpoint": "/mcp/snail-final-response",
    "tools": [
      { "name": "set_final_body", "description": "...", "inputSchema": { ... } }
    ]
  }
  ```
  前端在用户选中 server 时调用此端点获取 tool description。不展示 inputSchema，但字段保留（API 原生返回）。

**MCP Config 页面**复用现有 `GET /api/meta/mcps`，DTO 层增加 `source` 字段。

#### 2. `source` 字段：DTO 层装饰

在 `McpServerDto` 中新增可选字段 `source?: 'builtin' | 'platform' | 'workspace'`。

实现方式：在 `meta.route.ts` 的 handler 中对 `MCPConfig[]` 做映射时添加，不修改 `MCPConfig` 领域模型。`source` 是展示层需求，不应污染领域层。

映射规则：
- `FileMCPRepository.loadSnailMCPServerConfigs()` 注入的条目 → `'builtin'`
- 来自 `config/mcp.json` 的条目 → `'platform'`
- 来自 `.snail/mcp.json` 的条目 → `'workspace'`

#### 3. 前端页面布局

两个页面均采用**左侧列表 + 右侧详情面板**布局，与 PromptCenter、SkillCenter 保持一致。

**MCP Servers 页面（`/mcp-servers`）**：
- 左侧列表：每个 server 显示名称 + tool 数量 badge
- 右侧详情：选中后展示名称、版本、endpoint URL、tool 列表（name + description）
- 只读，无 CRUD

**MCP Config 页面（`/mcp-config`）**：
- 左侧列表：每个配置项显示名称 + source 标签（颜色区分）
- 右侧详情：选中后展示名称、transport 类型（stdio 显示 command+args，HTTP 显示 url）、scope 标签、source 标签
- transport 判断规则：`command` 存在 → stdio；`url` 存在 → HTTP；都不存在 → "无连接信息"
- 只读，P1 不做 CRUD

#### 4. 路由与导航变更

- `/mcps` → `<Navigate to="/mcp-config" replace />`（客户端重定向）
- 新增 `/mcp-servers` 路由
- 新增 `/mcp-config` 路由
- 侧边栏 `Config` 区域：`MCPs` 替换为 `MCP Servers` + `MCP Config`

#### 5. MCP Config 页面不排除内建 server

`GET /api/meta/mcps` 返回的列表中包含从 snail-mcp-server 自动注入的内建 server（scope=Platform）。不排除，因为这些配置项是 Agent 实际会使用的连接声明，展示它们有助于用户理解 Agent 的完整 MCP 环境。通过 `source: 'builtin'` 标签区分即可。

## 生效路径

- 代码：前端页面组件、路由配置、侧边栏组件、API contracts（DTO 增加 source 字段）、meta.route.ts（source 映射）
- 文档：本 feature 文档

## 设计约束摘要

- **边界**：MCP Servers 页面只读展示，不暴露运行时状态或健康检查；MCP Config 页面 P1 只读，不做 CRUD
- **关键决策**：复用 `GET /mcp/` + `GET /mcp/:serverName` 端点，不新增 API；MCP Config 页面不排除内建 server；`source` 字段在 DTO 层装饰，不修改领域模型
- **非目标约束**：不做 CRUD、不做健康检查、不做 tool 在线测试、不做 inputSchema 完整展示、不做同名冲突处理
- **语义不变量**：`GET /api/meta/mcps` 返回内容不变（新增 `source` 可选字段不破坏现有消费者）；`GET /mcp/` 和 `GET /mcp/:serverName` 不变
- **已知限制**：内建 server 与用户配置同名时会产生重复条目（后端 `FileMCPRepository` 未做去重）

<!-- [design-time] 章节结束 -->

## 改动范围

| 类型 | 文件/模块 | 说明 |
|------|-----------|------|
| 新增 | `src/web/pages/McpServers.tsx` | MCP Servers 页面（左侧列表+右侧详情） |
| 重写 | `src/web/pages/McpCenter.tsx` → `McpConfig.tsx` | MCP Config 页面（左侧列表+右侧详情） |
| 修改 | `src/web/router.tsx` | 删除 `/mcps`，新增 `/mcp-servers`、`/mcp-config`、`/mcps` 重定向 |
| 修改 | `src/web/components/Sidebar.tsx` | `MCPs` 替换为 `MCP Servers` + `MCP Config` |
| 新增 | `src/web/queries/meta.queries.ts` | 新增 mcpServers query（调用 `GET /mcp/`） |
| 修改 | `src/api-contracts/dto.ts` | `McpServerDto` 增加 `source` 字段 |
| 修改 | `src/infra/http/routes/meta.route.ts` | `/api/meta/mcps` handler 增加 source 映射 |

## 验证

### P1

- [ ] 访问 `/mcp-servers` 左侧显示 4 个内建 server（名称 + tool 数量 badge）
- [ ] 点击 server 列表项，右侧详情面板展示名称、版本、endpoint、tool 列表（name + description）
- [ ] 访问 `/mcp-config` 左侧显示所有配置项（名称 + source 标签）
- [ ] 点击配置项，右侧详情面板展示 transport 类型、scope 标签、source 标签
- [ ] `source` 标签颜色区分：builtin 灰色、platform 蓝色、workspace 绿色
- [ ] 侧边栏 Config 区域显示 `MCP Servers` 和 `MCP Config` 两个入口
- [ ] 访问 `/mcps` 自动重定向到 `/mcp-config`

## 关联

- **前置**: F2026060108（MCP 模块重构，建立了双模块架构）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | MCP Config 页面是否排除内建 server | 排除可避免信息重复，Config 页面只关注用户配置 | 内建 server 的配置声明也是 Agent 使用的一部分，排除会导致用户看不到完整 MCP 环境 | 不排除，内建 server 在 Config 页面也展示，通过 `source` 标签区分 | 用户需要看到 Agent 的完整 MCP 环境，两个页面职责不同（Servers 展示能力，Config 展示声明） | 架构师-1, 架构师-2 | 2026-06-22 |
| D2 | MCP Servers 页面 tool 展示粒度 | 展示完整 inputSchema 便于开发者理解 tool 接口 | inputSchema 可能很长，影响页面可读性；开发者如需详情可直接查看源码或 /mcp/:name 端点 | 只展示 name + description，不展示 inputSchema | P1 聚焦于让用户了解有哪些 tool 可用，而非接口详情 | 架构师-1, 架构师-2 | 2026-06-22 |
| D3 | 路由路径命名 | /mcp-servers 和 /mcp-config 语义清晰 | 与现有 /mcps 路径不兼容，需要处理旧路径 | 使用 /mcp-servers 和 /mcp-config，/mcps 重定向到 /mcp-config | 命名准确反映后端双模块职责，重定向保持向后兼容 | 架构师-1, 架构师-2 | 2026-06-22 |
| D4 | API 策略：新增 vs 复用 | 新增 API 可以统一数据格式 | 后端已有 `GET /mcp/` + `GET /mcp/:serverName`，数据完全一致，新增造成重复维护 | 复用现有 `/mcp/` 端点，不新增 API | 避免 API 重复建设，现有端点已满足需求 | 架构师-1, 架构师-2 | 2026-06-22 |
| D5 | 页面布局 | 卡片网格布局简洁 | Config 区域的 PromptCenter、SkillCenter 都用左侧列表+右侧详情面板，卡片布局不一致 | 采用左侧列表+右侧详情面板布局 | 与 Config 区域其他页面保持一致的交互模式 | 架构师-1, 架构师-2 | 2026-06-22 |
| D6 | `source` 字段实现层级 | 在 MCPConfig 领域模型上添加 source 字段，数据自描述 | source 是展示层需求，领域模型不应为 UI 而变更 | DTO 层装饰，不修改领域模型 | 展示层需求与领域模型分离 | 架构师-1, 架构师-2 | 2026-06-22 |
| D7 | MCP Servers 侧边栏区域归属 | 放在 Config 区域，MCP 相关入口集中 | MCP Servers 是只读能力展示，不是"配置"，语义不精确 | 放在 Config 区域 | 用户找 MCP 相关功能时会先看 Config 区域，降低发现成本 | 架构师-1, 架构师-2 | 2026-06-22 |
| D8 | transport 类型判断逻辑 | command 和 url 可能同时存在，需要明确优先级 | 实际场景中不会两者兼有 | command 优先于 url；command → stdio，url → HTTP，都不存在 → "无连接信息" | stdio 需要 command 启动进程，是更具体的配置方式 | 架构师-1, 架构师-2 | 2026-06-22 |
