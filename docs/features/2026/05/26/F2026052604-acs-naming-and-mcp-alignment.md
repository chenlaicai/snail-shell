---
id: F2026052604
title: ACS 命名规范与 MCP 格式对齐
from_ids: [F2026052302]
tags: [agent, naming, interop]
modules: [agent]
---

# F2026052604 ACS 命名规范与 MCP 格式对齐

## 背景

### 业界的 Agent Client Protocol (ACP)

2025 年 8 月，Zed Industries 联合 Google 发布了 **Agent Client Protocol (ACP)**——一个标准化编辑器（IDE）和 AI Coding Agent 之间通信的开放协议。截止 2026 年 4 月：

- **治理**：Zed + JetBrains 共同主导，设 Transports Working Group
- **生态覆盖**：7+ 编辑器（Zed / JetBrains / Neovim / marimo 等）、8+ Agent（Gemini CLI / Claude Code / Codex CLI / Cline / OpenCode / Goose 等）
- **协议规范**：v1.0 稳定，包含初始化协商、Session 生命周期、流式输出、权限审批、MCP 集成等能力
- **SDK**：TypeScript / Rust / Python / Kotlin 四语言官方实现
- **里程碑**：Session Resume/Close/List（2026.04）、ACP Registry（2026.01）、多传输标准化（2026.04）

**结论**：业界 ACP 确实已成为主流协议。

### 与 Snail Shell ACS 的关系分析

经过深度调研，两者的定位完全不同：

| 维度 | 业界 ACP (Agent Client Protocol) | Snail Shell ACS (Agent Capability Spec) |
|---|---|---|
| **层** | 编辑器 ↔ Agent（水平互操作） | 编排系统 ↔ Agent Runtime（垂直架构解耦） |
| **角色** | Client（Editor）- Server（Agent）双向通信 | Producer（Orchestrator）- Consumer（Adapter）单向声明 |
| **解决的问题** | 任意 editor × 任意 agent 互操作 | 编排层向多 agent 注入统一能力描述 |
| **类比** | HTTP——通用传输协议 | 编译器 IR——上层生成、下层消费 |

**核心结论：两者在不同层，完全不冲突，不相关。**

业界 ACP 解决的是"标准消息通道"问题（谁给谁发什么格式的消息），Snail Shell ACS 解决的是"标准能力声明"问题（这次调用 agent 有哪些能力可用）。可以共存在同一系统中，但不可互相替换。

### 命名冲突问题

Snail Shell 内部将能力声明层命名为 "Agent Capability Protocol（ACP）"，与业界标准协议同名。这在实际沟通中造成了严重混淆——"ACP"在不同上下文指代完全不同的事物。本 feature 将内部协议更名为 **Agent Capability Spec（ACS）**，强调其定位是**规格定义**而非**通信协议**。

## 目标

1. 将内部"ACP"（Agent Capability Protocol）更名为"ACS"（Agent Capability Spec）
2. 新增 feature 文档记录业界 ACP 调研结论和命名决议
3. 实现 MCP 格式与业界标准对齐

## 非目标

- 不实现权限审批交互协议（GuardProfile ask 模式缺口——留待后续 feature）
- 不实现结构化输出类型解析（价值高但成本大，后续评估）
- 不实现 Session Resume 机制（需 Claude Code 原生支持 ACP Server）

## 设计

### 命名变更

| 旧 | 新 | 原因 |
|---|---|---|
| Agent Capability Protocol (ACP) | Agent Capability Spec (ACS) | 强调规格定义，区别于通信协议 |
| `ACP`（注释/文档中） | `ACS` | 消除名称混淆 |
| `capability-protocol-test.ts` | `capability-spec-test.ts` | 测试文件同步改名 |

目录 `src/agent/capability/`、TypeScript 类型名 `AgentCapability` / `SkillCapability` 等**保持不变**。命名冲突只存在于文档和注释中的协议冠名。

### 业界 ACP 借鉴评估

| 方向 | 价值 | 工作量 | 是否本次实现 | 原因 |
|---|---|---|---|---|
| MCP 配置格式对齐 | 中 | 小 | ✅ 本次 | 接口已预留，对齐即完成 |
| 权限审批交互协议 | 高 | 中 | ❌ 后续 | 填补 GuardProfile ask 模式缺口 |
| Session Resume | 中 | 中 | ❌ 后续 | 需 Claude Code 原生支持 |
| 结构化输出类型 | 高 | 大 | ❌ 后续 | adapter 输出解析层需改造 |
| 标准工具命名 | 低 | 小 | ❌ 不计划 | 价值有限 |

### MCP 格式对齐

业界 ACP 在 `InitializeRequest` 中传递 MCP 服务器信息：

```typescript
// 业界 ACP 格式
mcpServers?: Record<string, {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}>
```

Snail Shell 当前定义：

```typescript
// Snail Shell ACS 格式（已兼容）
export interface MCPServerCapability {
  name: string;      // 对应 Record key
  command: string;
  args: string[];
  env?: Record<string, string>;
}
```

当前定义结构已与业界兼容（数组 vs Record 是内部存储差异），无代码变更必要。在注释中标注对齐关系，builder 填充 MCP 配置时按业界标准格式输出即可。

## 改动范围

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `docs/features/2026/05/26/F2026052604-acs-naming-and-mcp-alignment.md` | 新增 | 本文档 |
| `src/agent/capability/spec.ts` | 修改 | ACS 命名 + MCP 对齐注释 |
| `src/agent/capability/builder.ts` | 修改 | ACS 命名 |
| `src/agent/guard-config.ts` | 修改 | ACS 命名 |
| `src/prompt-center/builder.ts` | 修改 | ACS 命名 |
| `src/agent/claude-code.ts` | 修改 | ACS 命名 |
| `src/agent/claude-code-stateful.ts` | 修改 | ACS 命名 |
| `src/agent/codex.ts` | 修改 | ACS 命名 |
| `tests/agent/capability-spec-test.ts` | 新增 | 原 `capability-protocol-test.ts` 复制改名+ACS 更新 |
| `tests/agent/capability-protocol-test.ts` | 删除 | 由 `capability-spec-test.ts` 替代 |
| `docs/features/2026/05/23/F2026052302-agent-capability-spec.md` | 新增 | 原 `F2026052302-agent-capability-protocol.md` 复制改名+ACS 更新 |
| `docs/features/2026/05/23/F2026052302-agent-capability-protocol.md` | 修改 | 增加命名更正说明 |
| `docs/features/2026/05/25/F2026052503-agent-guard-profile.md` | 修改 | ACP→ACS 命名 |
| `docs/features/2026/05/26/F2026052602-system-prompt-split.md` | 修改 | ACP→ACS 命名 |

## 验证

1. 类型检查：`npx tsc --noEmit` 通过
2. 全部测试通过：`npx tsx tests/agent/capability-spec-test.ts`（7/7）

## 风险与记录

- **命名冲突已消除**：ACS（Agent Capability Spec）不与业界任何标准冲突。当前 google/github 搜索均无其他组织使用 ACS 指代 agent 相关协议。
- **MCP 格式当前无下游消费方**：`mcpServers` 字段 builder 返回空数组，格式对齐是前瞻性工作。未来填充 MCP 配置时按兼容格式输出即可。
