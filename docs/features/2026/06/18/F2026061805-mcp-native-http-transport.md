---
id: F2026061805
title: mcp-native-http-transport
from_ids: [F2026053101, F2026060108, F2026060201]
tags: [mcp, bugfix, transport]
modules: [acs, mcp]
doc_kind: spec
---

# F2026061805 [mcp] Claude Code MCP transport 迁移至原生 HTTP

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

Snail Shell 的 MCP Server 以 HTTP 模式运行（`http://localhost:3000/mcp/`），但 Claude Code agent 无法使用这些 MCP 工具。snail 报告"没有 MCP 来发送最终答复"。

历史脉络：
- **F2026053101**：当时 Claude Code 不支持 HTTP transport，引入 `mcp-remote` 桥接（`npx mcp-remote <url>`）
- **F2026060108**：MCP 代码清理，将 `mcp-remote` 锁定为 `mcp-remote@1`（意图避免 breaking change）
- **F2026060201**：修复 `enabledMcpjsonServers` 名字不匹配问题，`mcp-remote@1` 列为"后续优化"

当前问题：`mcp-remote@1` 版本不存在（npm 最新是 `0.1.38`），导致桥接进程启动失败。同时，Claude Code 已原生支持 HTTP transport（`{ type: "http", url }` 格式），`mcp-remote` 桥接已过时。

## 目标

1. 将 Claude Code agent 的 MCP 配置从 `mcp-remote` 桥接格式迁移至原生 HTTP transport 格式
2. 消除对 `mcp-remote` 外部依赖（npx、npm registry、网络）
3. 清理遗留的 `enabledMcpjsonServers` 白名单机制

## 非目标

- 不改变 OpenCode agent 的 MCP 配置（已使用原生格式 `{ type: "remote", url }`）
- 不改变 Codex agent 的 MCP 配置（已使用原生格式 `url = "..."`）
- 不改变 MCP Server 端的 HTTP 端点实现
- 不改变 `set_final_body` 工具的功能语义

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当 Snail Shell 启动并初始化 Claude Code agent 的 MCP 配置时 | 生成的 `.claude/mcp.json` 应使用 `{ type: "http", url }` 格式，而非 `mcp-remote` 桥接格式 | 手动验证 |
| B2 | 当 Claude Code agent 启动时 | 应能识别并加载所有 MCP Server，`claude mcp list` 显示已配置的 server | 手动验证 |
| B3 | 当 agent 调用 `set_final_body` MCP 工具时 | 应能成功调用并返回 `{ ok: true }` | 手动验证 |

## 设计

### P1 详设

#### 根因分析

`src/infra/acs/_internal/utils/mcp-config.ts` 中的 `buildMcpRemoteEntry` 函数生成 `mcp-remote@1` 桥接格式：

```typescript
// 当前（broken）
function buildMcpRemoteEntry(url: string): { command: string; args: string[] } {
  return { command: "npx", args: ["mcp-remote@1", url] };
}
```

问题：
1. `mcp-remote@1` 版本不存在
2. Claude Code 现在原生支持 HTTP transport，不需要桥接

#### 修复方案

将 `buildMcpRemoteEntry` 改为 `buildMcpHttpEntry`，返回原生 HTTP 格式：

```typescript
// 修复后
function buildMcpHttpEntry(url: string): { type: string; url: string } {
  return { type: "http", url };
}
```

#### 三个 Agent 的 MCP 配置对比

| Agent | 配置格式 | 是否使用 `mcp-remote` | 状态 |
|-------|----------|----------------------|------|
| Claude Code | `{ command: "npx", args: ["mcp-remote@1", url] }` | 是（broken） | 需修复 |
| OpenCode | `{ type: "remote", url }` | 否 | 正常 |
| Codex | `url = "..."` (TOML) | 否 | 正常 |

#### 白名单清理

`syncEnabledMcpjsonServers` 函数将 MCP server 名称写入 `.claude/settings.json` 的 `enabledMcpjsonServers` 字段。这是旧 `mcp-remote` 桥接方案的遗留机制。

验证：`claude mcp add --transport http` 不更新 `settings.json`，说明原生 HTTP 模式不需要白名单。

修复：移除 `syncEnabledMcpjsonServers` 调用，并在 `writeClaudeMcpConfig` 中清理已存在的 `enabledMcpjsonServers` 字段。

## 生效路径

- `src/infra/acs/_internal/utils/mcp-config.ts` — MCP 配置生成逻辑
- `.claude/mcp.json` — 由代码自动生成，修复后格式变为原生 HTTP
- `.claude/settings.json` — 代码清理后自动移除 `enabledMcpjsonServers`

## 设计约束摘要

- **边界**：仅修改 Claude Code agent 的 MCP 配置生成逻辑，不触及 OpenCode/Codex
- **关键决策**：选择原生 HTTP transport 替代 `mcp-remote` 桥接，消除外部依赖
- **非目标约束**：不改变 MCP Server 端实现，不改变 `set_final_body` 功能语义
- **语义不变量**：生成的 MCP 配置必须能被 Claude Code 正确识别和加载

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/infra/acs/_internal/utils/mcp-config.ts` | 修改 | `buildMcpRemoteEntry` → `buildMcpHttpEntry`，返回 `{ type: "http", url }`；移除 `syncEnabledMcpjsonServers` 调用；新增清理逻辑删除 settings.json 中残留的 `enabledMcpjsonServers` |
| `.claude/settings.json` | 自动清理 | 代码清理后自动移除 `enabledMcpjsonServers` |

## 验证

### P1

- [x] `grep -r "mcp-remote" src/ --include="*.ts"` 输出为 0 匹配（仅注释中提及迁移说明）
- [ ] `claude mcp list` 显示已配置的 MCP Server（手动验证）
- [ ] `curl -s http://localhost:3000/mcp/snail-final-response` 正常响应（手动验证）
- [ ] agent 能成功调用 `set_final_body` MCP 工具（手动验证）

### 通用

- [x] TypeScript 编译通过

## 关联

- **前置**: F2026053101（MCP transport 初始设计）
- **前置**: F2026060108（MCP 代码清理，引入 `mcp-remote@1`）
- **前置**: F2026060201（修复名字不匹配，`mcp-remote@1` 列为后续优化）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | 桥接 vs 原生 HTTP transport | 原生 HTTP 消除外部依赖（npx、npm registry、网络），更可靠；Claude Code 已原生支持 | 需要确认 `--mcp-config` 支持原生格式 | 选择原生 HTTP transport | 已验证 `claude mcp add --transport http` 使用 `{ type: "http", url }` 格式 | 架构师-1, 架构师-2 | 2026-06-18 |
| D2 | 函数重命名 | `buildMcpRemoteEntry` 名字已不准确，应改为 `buildMcpHttpEntry` | 无 | 重命名 | 避免后续维护者困惑 | 架构师-1, 架构师-2 | 2026-06-18 |
| D3 | v1 目录是否纳入影响范围 | v1 仍在维护（最近提交 2026-06-17），mcp-config 逻辑独立 | v1 可能已废弃 | 不纳入（用户决策） | 用户明确指示不修改 v1 目录 | 用户 | 2026-06-18 |
| D4 | 是否补测试 | `src/infra/acs/` 下无 mcp-config 测试，方案中"测试文件更新断言"无对应文件 | 改动小，可不补 | 不补（用户决策） | 用户明确指示移除测试 | 用户 | 2026-06-18 |
| D5 | `enabledMcpjsonServers` 残留处理 | 移除 `syncEnabledMcpjsonServers` 调用后，已存在的白名单字段会残留 | 残留字段不影响原生 HTTP 模式 | 代码中加清理逻辑 | 彻底清理遗留配置，避免混淆 | 架构师-1, 架构师-2 | 2026-06-18 |

## 范围变更记录

| # | 变更内容 | 原因 | 日期 |
|---|----------|------|------|
| 1 | 移除 v1 目录修改（v1/src/agent/mcp-config.ts、v1/tests/agent/mcp-config-test.ts） | 用户明确指示不修改 v1 目录 | 2026-06-18 |
| 2 | 移除测试文件（src/infra/acs/_internal/utils/mcp-config.test.ts） | 用户明确指示移除测试 | 2026-06-18 |
