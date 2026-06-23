---
id: F2026062305
title: issue-context-mcp
from_ids: []
tags: []
modules: []
doc_kind: spec
---

# F2026062305 [workflow] Issue 级别统一上下文：MCP 方案

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

当前系统中，Stage 间的上下文传递依赖 `output_artifacts` 字段，存在以下问题：

1. **上下文断裂**：新 Stage 创建时 `output_artifacts` 为空，Agent 必须通过 `query-current-context` skill 主动查询前一 Stage 的产物
2. **链路过长**：Agent 写入上下文需经过 skill → CLI 脚本 → db-bridge → HTTP → 数据库的完整链路
3. **架构不一致**：系统已有成熟的 MCP 基础设施（4 个内置 MCP 服务器），但上下文读写却绕过了 MCP

PR426 提出了 Issue 级别统一上下文的方案，但使用 REST API + skill 方式，未利用 MCP。

## 目标

使用 MCP 方式实现 Issue 级别统一上下文，消除 Stage 间上下文断裂，与现有 MCP 架构保持一致。

### P1 — 核心 MCP 服务器

- 新增 `snail-issue-context` MCP 服务器
- 提供 `set_context` 和 `get_context` 两个工具（简化设计，移除不必要的 `delete_context`）
- Agent 通过 MCP 工具直接读写 Issue 上下文
- Key 命名由 Agent 自行决定，不强制 stage 前缀

### P2 — 集成与迁移

- System reminder 继续注入 Issue 上下文（只读视图，作为"快捷方式"）
- MCP 工具是唯一的读写入口，system reminder 只是被动推送
- 废弃 `record-issue-repo-context` skill 和 `query-current-context` skill
- 废弃 Stage 的 `output_artifacts` 字段

## 非目标

- 不改变 Stage 的拓扑结构（`from_stage_id` 保留）
- 不改变 Issue 的其他字段（`extendable_context` 保留）
- 不实现跨 Issue 的上下文共享

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当 Agent 调用 `set_context` 设置上下文时 | 系统将 key-value 写入 Issue.context，key 由 Agent 自行命名（建议 `{stage_key}.{artifact_name}` 但不强制） | |
| B2 | 当 Agent 调用 `get_context` 且不传 key 时 | 系统返回 Issue 的完整上下文 | |
| B3 | 当 Agent 调用 `get_context` 且传入 key 时 | 系统返回该 key 对应的 value | |
| B4 | 当 Agent 被调用且 Issue 有 context 时 | system reminder 包含 Issue 上下文 section（只读视图，作为"快捷方式"） | |
| B5 | 当 Agent 被调用且 Issue 的 context 为空时 | system reminder 不包含 Issue 上下文 section | |
| B6 | 当 Stage 推进时 | 新 Stage 的 Agent 自动获得 Issue 完整上下文（通过 system reminder） | |
| B7 | 当多个 Agent 并发写入同一 key 时 | 后写入覆盖先写入（last-write-wins） | |
| B8 | 当 Agent 调用旧机制 `record-issue-repo-context` 时 | 系统同时写入 `Stage.output_artifacts` 和 `Issue.context`（双写过渡期） | |

## 设计

### P1 详设：MCP 服务器

#### 服务器结构

新增 `snail-issue-context` MCP 服务器，遵循现有 MCP 服务器模式：

```
src/domain/snail-mcp-server/_internal/servers/
  snail-issue-context.ts
```

#### 工具定义

**1. set_context**

```typescript
{
  name: "set_context",
  description: "设置 Issue 级别的上下文（merge 语义）",
  inputSchema: {
    type: "object",
    properties: {
      key: { type: "string", description: "上下文 key（建议格式：{stage_key}.{artifact_name}）" },
      value: { type: "string", description: "上下文 value" }
    },
    required: ["key", "value"]
  }
}
```

**行为**：
- 直接使用 Agent 传入的 key，不强制添加 stage 前缀
- 调用 IssuePort.updateContext merge 写入
- 返回 `{ success: true, key: "xxx" }`
- **Key 命名建议**：`{stage_key}.{artifact_name}`（如 `design.feature_doc_path`），但不强制

**2. get_context**

```typescript
{
  name: "get_context",
  description: "获取 Issue 级别的上下文",
  inputSchema: {
    type: "object",
    properties: {
      key: { type: "string", description: "上下文 key（可选，不传返回全部）" }
    }
  }
}
```

**行为**：
- 如果传入 key，返回该 key 对应的 value
- 如果不传 key，返回 Issue 的完整 context
- 返回 `{ context: Record<string, string> }` 或 `{ value: string }`

#### 服务器注册

在 `src/domain/snail-mcp-server/_internal/initor.ts` 中注册新服务器：

```typescript
import { snailIssueContextServer } from "./servers/snail-issue-context";

// 在 initSnailMCPServers 函数中
adapter.registerServer(snailIssueContextServer);
```

#### 依赖注入

MCP 服务器需要访问 IssuePort 来读写 Issue.context。通过构造函数注入：

```typescript
export function createSnailIssueContextServer(issuePort: IssuePort): MCPServerConfig {
  return {
    name: "snail-issue-context",
    tools: [
      {
        name: "set_context",
        handler: async (params) => {
          // 实现
        }
      },
      // ...
    ]
  };
}
```

### P2 详设：集成与迁移

#### 职责边界

**MCP 工具**：唯一的读写入口
- Agent 通过 `set_context` 写入上下文
- Agent 通过 `get_context` 读取上下文
- 写入后立即生效，下次调用即可读到最新值

**System reminder**：被动推送的"快捷方式"
- 每次 Agent 调用时，system reminder 注入 Issue 上下文的只读视图
- 注入时机：Agent 被调用时，从数据库读取最新 Issue.context
- 一致性：写入后，下次 Agent 调用时 system reminder 会更新
- **不存在"写入了但还没注入"的窗口期**，因为 system reminder 每次调用都重新生成

#### System reminder 注入

在 `src/app/issue-collaboration/collaboration.ts` 的 `buildContextBlock()` 方法中：

- 保留 Issue 上下文 section 的注入
- 标注为"只读视图，Agent 应使用 MCP 工具读写"
- 移除 Stage `output_artifacts` 的注入

#### 废弃旧机制

**废弃策略**：双写过渡期 + 渐进迁移

**问题**：如果旧机制继续写入 `Stage.output_artifacts`，而 system reminder 从 `Issue.context` 读取，会导致上下文丢失。

**解决方案**：双写过渡期
1. **record-issue-repo-context skill**：修改为同时写入 `Stage.output_artifacts` 和 `Issue.context`
2. **query-current-context skill**：标记为 deprecated，保留但不再推荐使用
3. **Stage.output_artifacts**：标记为 deprecated，不再有写入方（双写期间仍有写入）
4. **IssuePort.addOutputArtifacts**：标记为 deprecated

**迁移完成标志**：
- 当所有 Agent 都升级到使用 MCP 后，可以移除双写逻辑
- 移除双写逻辑后，硬废弃旧机制

**引导机制**：
- 在 Agent 的 system prompt 中明确推荐使用 MCP 工具
- 旧机制保留但不推荐，Agent 继续调用时仍然可用（双写到两个数据源）
- 不强制删除旧代码，避免破坏现有流程

#### 数据迁移

无需数据迁移。Issue.context 字段已存在（PR426 添加），MCP 服务器直接使用该字段。

## 生效路径

- **代码**：`src/domain/snail-mcp-server/_internal/servers/snail-issue-context.ts`
- **配置**：MCP 服务器自动注册，无需额外配置
- **文档**：本 feature 文档

## 设计约束摘要

- **边界**：MCP 服务器只能读写 Issue.context，不能修改其他 Issue 字段
- **Key 命名**：由 Agent 自行决定，建议格式 `{stage_key}.{artifact_name}` 但不强制
- **语义不变量**：Issue.context 是唯一的真实来源，所有 Stage 共享同一套上下文
- **职责边界**：MCP 工具是唯一的读写入口，system reminder 是被动推送的"快捷方式"
- **并发策略**：后写入覆盖（last-write-wins），不需要乐观锁
- **兼容性**：旧机制（skill、output_artifacts）双写过渡期，保证数据一致性，渐进迁移
- **迁移完成标志**：当所有 Agent 都升级到使用 MCP 后，可以移除双写逻辑，硬废弃旧机制

<!-- [design-time] 章节结束 -->

## task_anchor

- **change_type**: feature
- **verification_commands**: 启动 Snail Shell，验证 `snail-issue-context` MCP 服务器已注册；通过 MCP 工具调用 `set_context` 和 `get_context`，验证功能正常

## 改动范围

| 文件 | 变更类型 |
|------|----------|
| `src/domain/issue/model.ts` | 修改（添加 context 字段） |
| `src/domain/issue/port.ts` | 修改（添加 updateContext 方法） |
| `src/domain/issue/_internal/adapter.ts` | 修改（实现 updateContext 方法） |
| `src/domain/issue/_internal/repository.ts` | 修改（添加 context 字段和 updateContext 方法） |
| `src/domain/snail-mcp-server/_internal/servers/snail-issue-context.ts` | 新增 |
| `src/domain/snail-mcp-server/_internal/initor.ts` | 修改（注册新服务器） |
| `src/app/issue-collaboration/collaboration.ts` | 修改（更新 system reminder） |
| `src/main.ts` | 修改（添加 issue 依赖） |
| `data/file/skills/record-issue-repo-context/SKILL.md` | 修改（标记 deprecated） |
| `data/file/skills/query-current-context/SKILL.md` | 修改（标记 deprecated） |
| `.meta/scripts/db-bridge.js` | 新增（实现双写逻辑） |

## 验证

### P1

- [ ] 启动 Snail Shell，验证 `snail-issue-context` MCP 服务器已注册
- [ ] 通过 MCP 工具调用 `set_context`，验证 Issue.context 包含写入的 key
- [ ] 通过 MCP 工具调用 `get_context`，验证返回正确的上下文
- [ ] 并发写入同一 key，验证后写入覆盖

### P2

- [ ] 创建 Issue，进入 Stage，验证 system reminder 包含 Issue 上下文 section
- [ ] 通过 MCP 写入新值，验证下次调用时 system reminder 已更新
- [ ] 推进 Stage，验证新 Stage 的 Agent 能看到完整上下文
- [ ] 调用旧 skill `record-issue-repo-context`，验证同时写入 `Stage.output_artifacts` 和 `Issue.context`
- [ ] 验证旧 skill `query-current-context` 仍然可用但提示 deprecated

## 关联

- **相关**: F2026062303（PR426 的 REST API 方案，本 feature 是 MCP 替代方案）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | 使用 MCP vs REST API | MCP 与现有架构一致，链路短，支持主动查询 | 需要新增 MCP 服务器，有一定开发成本 | MCP 方案 | 架构一致性优先，MCP 是系统的标准交互方式 | 架构师-1 | 2026-06-23 |
| D2 | Key 命名是否强制 stage 前缀 | 便于追溯来源，避免冲突 | 与"Issue 级别共享"矛盾，某些上下文（如 worktree_path）跨 stage 共享 | 不强制，由 Agent 自行决定 | stage 前缀解决的是"业务语义归属"问题，但并非所有上下文都有 stage 归属 | 架构师-1, 架构师-2 | 2026-06-23 |
| D3 | 是否保留 system reminder 注入 | Agent 每次调用都能看到完整上下文，无需主动查询 | 增加 token 消耗 | 保留注入，作为"快捷方式" | 便利性优先，token 消耗可接受；MCP 工具是唯一读写入口，system reminder 是被动推送 | 架构师-1, 架构师-2 | 2026-06-23 |
| D4 | 是否废弃旧机制 | 减少维护成本，统一交互方式 | 可能破坏现有流程 | 软废弃 + system prompt 引导 | 向后兼容，渐进迁移；不强制删除旧代码 | 架构师-1, 架构师-2 | 2026-06-23 |
| D5 | 是否需要 delete_context 工具 | CRUD 完整性 | 使用场景不多，覆盖为空字符串即可；删除会导致 system reminder 注入不一致 | 移除 delete_context | 简化设计，避免不必要的复杂性 | 架构师-1, 架构师-2 | 2026-06-23 |
| D6 | 与 snail-issue 服务器的职责边界 | 独立服务器职责清晰 | 如果将来有 snail-issue 服务器，上下文应该放在那里 | 当前独立实现，将来可合并 | 当前没有 snail-issue 服务器，最小化改动 | 架构师-1, 架构师-2 | 2026-06-23 |
| D7 | 并发写入策略 | 乐观锁保证一致性 | 增加复杂性，Issue 上下文通常只有一个 Agent 活跃 | 后写入覆盖（last-write-wins） | 简化设计，符合实际使用场景 | 架构师-1, 架构师-2 | 2026-06-23 |
| D8 | 废弃策略：软废弃 vs 硬废弃 vs 双写过渡期 | 软废弃简单，硬废弃干净，双写过渡期平滑迁移 | 软废弃导致双数据源，硬废弃可能破坏现有流程，双写增加复杂性 | 双写过渡期 | 保证数据一致性，渐进迁移，最终收敛到 MCP | 架构师-1, 架构师-2 | 2026-06-23 |
