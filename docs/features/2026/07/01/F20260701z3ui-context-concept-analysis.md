---
id: F20260701z3ui
title: context概念优化
from_ids: []
tags: []
modules: []
doc_kind: spec
---

# F20260701z3ui [workflow] Context 概念优化：消除术语混淆

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

系统中 "context" 一词承载了六种不同语义，存在概念混淆风险。经过两位架构师交叉审视，识别出 3 个需要优化的真实问题（P3、P6、P7），排除了 4 个不影响 Agent 理解的问题（P1、P2、P4、P5）。

## 问题分析

### 需要优化的问题

#### P3：系统标识符与业务数据混合

**现状**：在 `collaboration.ts` 中，系统保留 key 和 Agent 写入的业务 key 被混在同一个 `context` 对象中：
```typescript
context: { [CONTEXT_KEYS.ISSUE_ID]: issue.id, ...issue.context, snail_key: assignment.snail_key }
```

**问题**：系统标识符（issue_id, stage_id）和业务数据（worktree_path, branch_name）通过同一个管道转换为环境变量，生命周期和写入者完全不同。

**影响**：概念混淆，代码组织不清晰。

#### P6：key 命名约定不一致

**现状**：
- SOP 文档中使用不带前缀的格式：`worktree_path`、`branch_name`、`pr_url`
- Feature 文档建议使用 `{stage_key}.{artifact_name}` 格式：`design.worktree_path`、`design.branch_name`
- `resolveContextValue` 函数兼容两种格式（精确匹配和带前缀匹配）

**问题**：Agent 写入时可能使用不一致的格式，导致后续读取时需要兼容处理。

**影响**：数据一致性风险，增加了 `resolveContextValue` 的复杂度。

#### P7：first-call 和 resume 路径构建 contextEnv 的方式不一致

**现状**：
- first-call 路径：通过 `buildContextEnv` 注入 `issue.context` 中的所有业务数据
- resume 路径：只注入系统标识符（`WORKSPACE_PATH`、`SNAIL_KEY`、`MESSAGE_ID`、`STAGE_ID`），不注入业务数据

**问题**：Agent 在 resume 时无法通过环境变量获取之前写入的 `worktree_path`、`branch_name` 等业务数据。

**影响**：功能不一致，Agent 在 resume 时可能丢失上下文。

### 不需要优化的问题（架构师-2 审视排除）

#### P1：MCP 工具名 `set_context` / `get_context` 语义模糊

**排除理由**：
- `set_context` 的 description 明确写了 "Issue 级别的上下文"
- Agent 通过 description 而非工具名理解功能
- 重命名需要更新 6+ 个 SOP 文档中的引用
- 改动成本远大于收益

#### P2：Issue Context 与 MessageContext 字段名冲突

**排除理由**：
- MessageContext 是内部实现细节，Agent 从不直接操作
- 两者在不同的 domain 模块中，不会混淆
- 重命名字段名影响 DTO、Repository、Adapter 多层

#### P4：system prompt 中 "context" 混用

**排除理由**：
- `<context>` 是 XML 结构化标签，不是业务术语
- Agent 通过标签层级区分，不会混淆
- 重命名标签需要 Agent 适应新格式

#### P5：方法名过于通用

**排除理由**：
- `buildContextEnv()`、`buildContextBlock()` 是内部方法
- 不影响 Agent 理解
- 重命名需要更新所有调用点

## 概念梳理

### 1. Issue Context（业务层）

**定义**：`Issue.context: Record<string, string>`（`domain/issue/model.ts`）

**用途**：存储跨 Stage 共享的指针和元数据（文件路径、分支名、PR URL、状态标记）

**读写方式**：
- **写入**：通过 MCP 工具 `set_context`（`snail-issue-context` 服务器）
- **读取**：通过 MCP 工具 `get_context` 或 system reminder 只读视图

**设计约束**：
- 禁止存放大段文本、检视计划、方案内容
- Key 命名建议：`{stage_key}.{artifact_name}`（如 `design.feature_doc_path`）
- 后写入覆盖（last-write-wins）

**相关文档**：F2026062310、F20260624d5pg

### 2. ACS Context（基础设施层）

**定义**：`InvokeOptions.contextEnv: Record<string, string>`（`infra/acs/model.ts`）

**用途**：注入到 agent 子进程的运行时上下文环境变量，包含 issue_id、stage_id、conversation_id 等

**读写方式**：
- **构建**：由编排层通过 `buildContextEnv()` 函数
- **注入**：通过 `spawn` 时的 `env` 参数注入到子进程

**环境变量 Key**：`SNAIL_CTX_*` 前缀

**设计约束**：
- 只传 ID 级别的最小信息
- 每次 spawn 独立构造 env 对象
- CLI 显式参数优先级高于 env

**相关文档**：F2026060404

### 3. MessageContext（消息层）

**定义**：`MessageContext.context: string`（`domain/message/model.ts`）

**用途**：存储消息的最终答复文本

**读写方式**：
- **写入**：通过 MCP 工具 `set_final_body`
- **读取**：通过消息查询 API

**相关文档**：无独立文档

### 4. 其他 Context 概念

| 概念 | 定义 | 用途 |
|------|------|------|
| Context Window | `InvokeOptions.contextWindow` | LLM 上下文窗口大小 |
| StopContext | `StopContext` 接口 | 进程停止上下文 |
| NavigationContext | `NavigationContext` 接口 | IM 导航状态 |
| Hono Context | `Context` from "hono" | HTTP 框架上下文 |

## 优化方案

### 方案 C：分离系统标识符和业务数据

**改动**：
- 在 `collaboration.ts` 中，将系统标识符和业务数据分开传递
- 系统标识符通过 `CONTEXT_KEYS` 传递，业务数据通过 `issue.context` 传递

**理由**：明确两者的生命周期和写入者不同。

**影响**：
- 需要修改 `buildContextEnv()` 函数
- 需要更新 `snail/adapter.ts` 中的调用方式

### 方案 F：统一 key 命名约定

**改动**：
- 统一使用 `{stage_key}.{artifact_name}` 格式
- 更新 SOP 文档中的示例
- 简化 `resolveContextValue` 函数（移除兼容逻辑）

**理由**：避免 Agent 写入不一致的格式，简化读取逻辑。

**影响**：
- 需要更新 SOP 文档中的示例
- 需要更新 `resolveContextValue` 函数
- 需要迁移已有的不带前缀的 key

### 方案 G：统一 first-call 和 resume 路径的 contextEnv 构建

**改动**：
- resume 路径也通过 `buildContextEnv` 注入 `issue.context` 中的业务数据
- 或者在 resume 时从数据库重新读取 `issue.context`

**理由**：确保 Agent 在 resume 时能获取完整的上下文。

**影响**：
- 需要修改 `snail/adapter.ts` 中的 `doInvokeResume` 方法
- 需要在 resume 时访问 `issuePort` 获取 `issue.context`

## 核心业务行为

| # | 场景 | 预期行为 |
|---|------|----------|
| B1 | 当 Agent 调用 `set_context` 时 | 系统将 key-value 写入 Issue.context |
| B2 | 当 Agent 调用 `get_context` 时 | 系统返回 Issue 的上下文 |
| B3 | 当 Agent 被调用（first-call）时 | 环境变量包含系统标识符和业务数据 |
| B4 | 当 Agent 被调用（resume）时 | 环境变量包含系统标识符和业务数据 |
| B5 | 当 Agent 写入 context key 时 | 使用 `{stage_key}.{artifact_name}` 格式 |

## 设计约束

- **边界清晰**：Issue Context 是业务层概念，ACS Context 是基础设施层概念
- **职责分离**：Issue Context 通过 MCP 工具读写，ACS Context 通过环境变量注入
- **命名规范**：context key 统一使用 `{stage_key}.{artifact_name}` 格式
- **路径一致**：first-call 和 resume 路径构建 contextEnv 的方式应保持一致

## 验证要点

1. 系统标识符和业务数据是否分离传递
2. context key 命名是否统一使用 `{stage_key}.{artifact_name}` 格式
3. first-call 和 resume 路径的 contextEnv 是否包含相同的业务数据
4. `resolveContextValue` 函数是否简化（移除兼容逻辑）

<!-- [design-time] 章节结束 -->

## task_anchor

- **change_type**: refactor
- **verification_commands**: 检查 context key 命名格式、first-call/resume 路径的 contextEnv 构建方式

## 改动范围

| 文件 | 变更类型 |
|------|----------|
| `src/app/issue-collaboration/collaboration.ts` | 修改（分离系统标识符和业务数据） |
| `src/app/issue-collaboration/resource-cleanup.ts` | 修改（简化 resolveContextValue） |
| `src/domain/snail/_internal/adapter.ts` | 修改（统一 contextEnv 构建） |
| `data/file/skills/cd-design/SKILL.md` | 修改（更新 key 命名示例） |
| `data/file/skills/cd-development/SKILL.md` | 修改（更新 key 命名示例） |
| `data/file/skills/cd-review/SKILL.md` | 修改（更新 key 命名示例） |

## 关联

- **相关**: F2026062310（Issue Context MCP 方案）
- **相关**: F2026060404（运行时上下文环境变量注入）
- **相关**: F20260624d5pg（Issue Context 用途边界）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | MCP 工具是否重命名 | 消除歧义 | description 已明确，改动成本高 | 不重命名 | Agent 通过 description 理解功能 | 架构师-2 | 2026-07-01 |
| D2 | MessageContext.context 是否重命名 | 消除字段名冲突 | 影响 DTO/Repository/Adapter 多层 | 不重命名 | 内部实现，Agent 不直接操作 | 架构师-2 | 2026-07-01 |
| D3 | 系统标识符和业务数据是否分离 | 明确生命周期不同 | 增加代码复杂度 | 分离 | 当前混合导致概念混淆 | 架构师-1, 架构师-2 | 2026-07-01 |
| D4 | key 命名是否统一 | 避免格式不一致 | 需要迁移已有 key | 统一 | 简化读取逻辑，避免兼容处理 | 架构师-2 | 2026-07-01 |
| D5 | first-call/resume 路径是否统一 | 确保 Agent 获取完整上下文 | resume 时需要访问 issuePort | 统一 | 功能一致性 | 架构师-2 | 2026-07-01 |

<!-- [design-time] 章节结束 -->
