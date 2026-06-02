---
id: I2026060204
title: "snail-final-response MCP server 不可用"
from_ids: [I2026052605, I2026052909, I2026060108, I2026060102]
tags: [mcp, agent-protocol, bugfix, reliability]
modules: [mcp, agent, message-bus]
---
# I2026060204 snail-final-response MCP server 不可用

## 背景

系统提示词通过 `<mcp_context>` 块以 `[HARD]` 级指令要求 agent 在回复完成前调用 `set_final_body` MCP 工具（由 `snail-final-response` MCP server 提供）。然而 agent 回复"我当前没有这个 MCP 工具可用"——指令要求与工具可用性之间存在矛盾。

该问题的直接表现：agent 知道 `set_final_body` 存在（系统提示词明确提到），但在可用工具列表中找不到它，只能跳过调用并回退到 auto-derive 逻辑。

### 历史脉络

| Issue | 问题 | 修复 |
|-------|------|------|
| I2026052605 | 初始设计 | MCP HTTP transport + `.mcp.json` auto-discovery |
| I2026052909 | CWD 不匹配导致 agent 找不到 `.mcp.json` | `--mcp-config` 显式传入 |
| I2026060102 | 注入措辞为建议性，agent 容易忽略 | 改为 `[HARD]` 级指令 |
| I2026060108 | MCP 代码散落、命名不一致 | 模块独立、两层声明、命名统一 |
| **I2026060204** | **工具仍不可用** | **本文档** |

## 目标

1. 诊断 `snail-final-response` MCP server 在运行时不可用的根因
2. 修复使 `set_final_body` 工具在所有 Snail Shell 启动的 Claude Code 会话中可靠可用
3. 消除系统提示词指令与工具可用性之间的矛盾——要么工具可用，要么不注入调用指令

## 非目标

- 不改变 `snail-final-response` MCP server 的功能语义
- 不引入新的 MCP transport 方案（保持 HTTP + mcp-remote 桥接）
- 不支持手动启动 Claude Code 时的 MCP 工具发现（仅覆盖 Snail Shell 管理的会话）

## 设计

### 根因分析

#### 调用链路

```
invokeRuntimeMessage
  → 注入 <mcp_context>（含 conversation_id + message_id + [HARD] 指令）  ← 指令路径
  → invokeMessage → agent CLI 启动
    → Claude Code 读取 .claude/settings.json
      → enabledMcpjsonServers: ["snail-final-body"]                      ← 白名单
    → Claude Code 读取 .claude/mcp.json
      → mcpServers: { "snail-final-response": ... }                      ← server 声明
    → 白名单 "snail-final-body" ≠ server key "snail-final-response"
    → Claude Code 不启用该 MCP server                                    ← 根因
    → set_final_body 不在可用工具列表中                                   ← 表现
```

指令注入（`message-protocol.ts`）和工具发现（`claude-code-stateful.ts` → settings.json + mcp.json → Claude Code MCP 加载）是**两条独立路径**，没有一致性保障。

#### 配置不一致证据

| 配置文件 | 字段 | 值 |
|----------|------|-----|
| `.claude/mcp.json` | `mcpServers` key | `"snail-final-response"` |
| `.claude/settings.json` | `enabledMcpjsonServers` | `["snail-final-body"]` |
| `.claude/settings.json` | `enableAllProjectMcpServers` | `true` |

`enableAllProjectMcpServers: true` 的语义是"允许加载 mcp.json 中声明的 server"，但 `enabledMcpjsonServers` 仍作为白名单做二次过滤。两个条件都要满足：server 必须在 mcp.json 中声明**且**在白名单中出现。

名字不匹配 → 白名单匹配失败 → Claude Code 不启用 MCP server → `set_final_body` 不在工具列表中 → agent 跳过调用。

#### 断点分析

| 断点 | 场景 | 影响 |
|------|------|------|
| **名字不匹配（根因）** | `enabledMcpjsonServers` 引用旧名 `snail-final-body`，mcp.json 使用 `snail-final-response` | Claude Code 不启用 server，工具不可用 |
| **mcp-remote 启动失败** | `npx mcp-remote@1` 网络超时或 npm registry 不可用 | 桥接进程无法启动（次要，名字修复后才触发） |
| **端口不一致** | mcp.json 写死 `localhost:3000`，server 实际监听其他端口 | 连接失败（次要） |
| **MCP server 未运行** | Snail Shell Express server 未启动 | `mcp-remote` 连接失败（次要） |

#### 根因判定

**根因：`.claude/settings.json` 中 `enabledMcpjsonServers: ["snail-final-body"]` 与 `.claude/mcp.json` 中 server key `"snail-final-response"` 名字不匹配，导致 Claude Code 不启用该 MCP server。**

这是第一道关卡。名字修复后，mcp-remote 桥接可靠性才是需要关注的第二道关卡。

**根本架构问题**：两份配置文件（settings.json 的白名单 + mcp.json 的 server 声明）由不同代码路径维护，命名变更时未同步更新，缺乏一致性保障。

### 修复方案

#### 方案 A：修复名字不匹配 + 配置生成统一

将 `enabledMcpjsonServers` 中的 `snail-final-body` 改为 `snail-final-response`（与 mcp.json 一致）。同时确保 `ensureMcpServers` 生成 mcp.json 时同步更新 settings.json 的白名单，避免再次出现不一致。

- 优点：直接修复根因；统一生成逻辑防止复发
- 缺点：需要改动两处配置 + 一处代码

#### 方案 B：仅修复配置文件

只改 settings.json 中的名字，不改代码生成逻辑。

- 优点：改动最小
- 缺点：下次 mcp.json server key 变更时可能再次不一致

#### 方案 C：A + 端口动态化 + 注入前验证

在方案 A 基础上，增加端口动态化（mcp.json 硬编码 3000 → 实际端口）和注入前 MCP 可达性验证。

- 优点：全面解决所有断点
- 缺点：改动范围大

### 设计取舍

| 取舍 | 正面 | 反面 |
|------|------|------|
| 修复名字 → 生成逻辑统一 | 从根源防止不一致复发 | 需要改动 mcp-config 生成逻辑 |
| 保持 mcp-remote 桥接 | 符合 Claude Code stdio-only 限制 | 引入外部依赖（npx、npm registry、网络） |
| 端口动态化 | 修复端口硬编码风险 | 需要从 main.ts 传递端口 |
| 注入前验证 | 消除指令与工具矛盾状态 | 增加 agent 启动延迟 |

**决策：先修名字不匹配（方案 A），端口动态化和注入验证作为后续优化（可纳入方案 C 分阶段实施）。**

理由：名字不匹配是确定性根因，修复成本低且立竿见影；端口和 mcp-remote 可靠性是运行时问题，需要更多验证。

## 生效路径

- `.claude/settings.local.json` — `enabledMcpjsonServers` 名字修正（实际运行时文件，gitignored）
- `.claude/mcp.json` — server key 确认（当前 `snail-final-response` 为正确值）
- `src/agent/mcp-config.ts` — `writeClaudeMcpConfig` 写入 mcp.json 后同步生成 `.claude/settings.json` 白名单（防复发）

## 实现发现

| # | 发现 | 处理 |
|---|------|------|
| 1 | Issue 文档引用 `.claude/settings.json`，但实际含 `enabledMcpjsonServers` 的文件是 `.claude/settings.local.json` | 直接修复 `settings.local.json` 中的名字；代码防复发写入 `settings.json`（项目级配置） |
| 2 | `settings.local.json` 是旧版 guard-config 生成的遗留文件（`bypassPermissions` 模式下权限部分已失效），但 `enabledMcpjsonServers` 仍被 Claude Code 读取 | 修复名字即可，无需重构此文件 |
| 3 | `enabledMcpjsonServers` 在代码库中无任何程序化生成——完全手动维护 | `ensureMcpServers` 新增 `syncEnabledMcpjsonServers` 自动同步 |

## 改动范围

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `.claude/settings.local.json` | 修改 | `enabledMcpjsonServers: ["snail-final-body"]` → `["snail-final-response"]`（运行时修复） |
| `src/agent/mcp-config.ts` | 修改 | `writeClaudeMcpConfig` 写入 mcp.json 后调用 `syncEnabledMcpjsonServers` 同步 `.claude/settings.json` |
| `tests/agent/mcp-config-test.ts` | 新增 | 3 个测试覆盖 settings.json 同步：新建、多 server、保留已有字段 |

## 验证

### P1 — 名字修复

- [x] `.claude/settings.local.json` 中 `enabledMcpjsonServers` 与 `.claude/mcp.json` 中 server key 一致
- [ ] Claude Code 启动后 `set_final_body` 出现在可用工具列表中
- [ ] agent 能成功调用 `set_final_body`

### P2 — 配置生成统一（防复发）

- [x] `ensureMcpServers` 写入 mcp.json 后同步更新 `.claude/settings.json` 的 `enabledMcpjsonServers`
- [x] 新建 workspace 时两处配置自动保持一致（代码层面已保障）

### 通用

- [x] TypeScript 编译通过
- [x] 现有测试通过（45 个测试文件全部通过）
- [x] mcp-config 测试通过（含 3 个新增用例）

## 关联

- **前置**: I2026052605（MCP 最终正文初始设计）
- **前置**: I2026052909（MCP 配置发现修复）
- **前置**: I2026060108（MCP 机制重构）
- **相关**: I2026060102（set_final_body 注入指令强化）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|-----------|------|------|
| 1 | 根因是名字不匹配还是 mcp-remote 桥接失败 | 名字不匹配是第一道关卡（确定性根因）；mcp-remote 可靠性是第二道（运行时问题） | 2026-06-02 |
| 2 | mcp-remote 桥接方案的可靠性 | 当前无替代方案（Claude Code 仅支持 stdio MCP），接受此依赖；名字修复后才需要关注 | 2026-06-02 |
| 3 | 修复范围 | 先修名字不匹配（方案 A），端口动态化和注入验证作为后续优化 | 2026-06-02 |
| 4 | settings.local.json vs settings.json | 实际含 `enabledMcpjsonServers` 的文件是 `settings.local.json`（遗留），代码防复发写入 `settings.json`（项目级） | 2026-06-02 |
