---
id: F20260707vrtv
title: issue-create-mcp
from_ids: []
tags: [issue-collaboration, mcp]
modules: [issue-collaboration, snail-mcp-server]
doc_kind: spec
change_type: feature
---

# F20260707vrtv Issue MCP 新增创建 Issue 能力

## 背景

用户在对话类 Issue（如 general-assistant SOP）中讨论得到洞察后，希望直接新开一个代码交付 SOP 的 Issue 来推进实现。当前系统只能通过前端 UI 创建 Issue，Agent 无法通过 MCP 工具创建新 Issue，也无法表达两个 Issue 之间的前后继承关系。

## 问题分析

### 缺失 1：无 create_issue MCP 工具

当前 Issue 创建仅通过 HTTP REST API（`POST /api/workspaces/:workspaceId/issues`）完成，由前端 `NewIssueDialog` 组件构造请求。Agent 在对话中无法创建新 Issue——用户必须手动到前端操作，打断对话流程。

### 缺失 2：无 Issue 关联机制

`Issue` 模型（`src/domain/issue/model.ts`）中没有任何关联字段。Issue 之间是扁平独立实体，无法表达"Issue B 继承自 Issue A"的关系。当用户从对话 Issue 跳转到代码交付 Issue 时，新 Issue 的 Agent 不知道前序 Issue 的存在，无法获取上下文。

### 缺失 3：依赖注入断层

`createIssue`（含完整生命周期：创建 Issue → 创建初始 Stage → 自动调用首个 Stage）是 collaboration 层的方法（`src/app/issue-collaboration/collaboration.ts:76-83`）。`IssuePort` 接口不暴露 `createIssue`，MCP 服务器只注入了 `IssuePort`，无法触发 Issue 创建的完整生命周期。

## 用户意图锚

| ID | 用户原话 | 来源 | 关键修饰语 | 架构师解读 |
|----|---------|------|-----------|-----------|
| UA-1 | "issue的mcp新增创建issue能力" | 消息 #1 | 空间：issue 的 mcp；动作：新增创建 issue 能力 | 用户需要通过 MCP 工具创建新 Issue，工具应属于 issue 相关的 MCP 服务器 |
| UA-2 | "刚才我在想一个 对话issue中讨论了记忆系统的一些洞察，然后我想新开一个 代码交付sop的issue来继续做这件事" | 消息 #1 | 时序：对话issue中讨论→新开issue继续；条件：从对话洞察到代码交付 | 用户场景：在对话类 Issue 中产生洞察后，直接在对话中创建代码交付 Issue 接续推进，不切换到前端 |
| UA-3 | "这两个issue应该也有点 前后继承关系" | 消息 #1 | 空间：两个 issue 之间；条件：前后继承 | 两个 Issue 之间应有可追溯的继承关系链接，表达"B 继承自 A"的语义。新 Issue 的 Agent 应能发现前序 Issue |

## 设计方案

### 核心原则

**Agent 可在当前 Issue 对话中创建新 Issue，并建立继承关系。** 创建动作通过 MCP 工具完成，关系通过 Issue context 存储。

### 变更 1：新增 `create_issue` MCP 工具

在 `snail-issue-context` MCP 服务器中新增 `create_issue` 工具。

**工具定义**：

```
名称：create_issue
描述：创建新 Issue。可指定前序 Issue 建立继承关系。创建后新 Issue 的首个 Stage 自动启动。
参数：
  - workspace_path: string（必填）— 工作区路径，Agent 从 SNAIL_CTX_WORKSPACE_PATH 环境变量读取后传入
  - title: string（必填）— Issue 标题
  - sop_key: string（必填）— 采用的 SOP key（如 "code-delivery"、"general-assistant"）
  - summary?: string（可选）— Issue 摘要，用于承接前序 Issue 的上下文和洞察
  - source_issue_id?: string（可选）— 前序 Issue ID，用于建立继承关系。
    传入后系统在新 Issue 的 context 中写入 source_issue_id 字段。
返回：
  - 成功：{ issue_id, issue_title, stage_id, stage_key }
  - 失败：返回错误原因（SOP 不存在、无可用 snail、source issue 不存在等）
```

← UA-1（MCP 工具创建 Issue）、UA-2（对话中直接创建）

**关键设计决策**：

1. **Snail 自动分配**：Agent 不需要提供 `snail_assignment_plan`。系统通过 `SnailPort.list()`（`CollaborationDeps.snailPort`，`collaboration.ts:31`）获取第一个 snail 分配给所有 role instance（`snailPort.list()[0]?.key`，与前端 `NewIssueDialog` 的 `stableSnails[0]?.key` 逻辑一致）。用户后续可在前端调整。

2. **Workspace 路径**：Agent 从 `SNAIL_CTX_WORKSPACE_PATH` 环境变量读取后作为 `workspace_path` 参数传入（与 `set_context`/`get_context`/`stage_transition` 等工具的参数模式一致）。MCP tool handler 运行在 HTTP 服务器进程中，无法通过 `process.env` 访问 agent 进程的环境变量，因此 `workspace_path` 作为显式参数传递。

3. **继承关系存储**：若提供 `source_issue_id`，系统在新 Issue 的 `context` 中写入 `source_issue_id` 字段。新 Issue 的 Agent 可通过 `get_context` 发现前序 Issue ID，进而通过 Issue 详情查看前序 Issue 的标题和摘要。

← UA-3（前后继承关系）

4. **上下文承接**：`summary` 参数是上下文承接的主要载体。创建 Agent（在前序 Issue 中）将关键洞察写入 summary，新 Issue 的 Agent 通过 Issue 详情读取 summary 获取上下文。`source_issue_id` 提供可追溯的来源链接。

### 变更 2：新增 `IssueManagementPort` 接口

```typescript
interface IssueManagementPort {
  spawnIssue(input: {
    workspace_path: string;
    title: string;
    summary?: string;
    adopted_sop_key: string;
    source_issue_id?: string;
  }): Promise<{ issue: Issue; stage: Stage }>;
}
```

> 方法名使用 `spawnIssue` 而非 `createIssue`，因为 `IssueCollaboration` 已有 `createIssue(input: CreateIssueInput)` 方法（`collaboration.ts:76`），其签名要求 `snail_assignment_plan` 且无 `source_issue_id`。TypeScript 不允许同名方法接受不兼容参数，故用 `spawnIssue` 区分。

collaboration 层实现此接口（`spawnIssue` 内部调用 `this.createIssue()`）：
1. 调用 `IssuePort.previewSopStages()` 获取 SOP 的 stage 列表和 role instances
2. 调用 `SnailPort.list()`（`CollaborationDeps.snailPort`，`collaboration.ts:31`）获取第一个 snail 的 key（`snailPort.list()[0]?.key`，与前端 `stableSnails[0]?.key` 逻辑一致）
3. 为每个 stage 的每个 role instance 分配该 snail，构造 `snail_assignment_plan`
4. 若提供 `source_issue_id`，调用 `IssuePort.findIssue()` 验证该 Issue 存在且与当前 Issue 属于同一 `workspace_path`，不一致时返回错误
5. 将 `source_issue_id` 写入 `context: { source_issue_id }`
6. 组装 `CreateIssueInput`，调用现有 `this.createIssue()` 完成完整生命周期（创建 Issue + 初始 Stage + 自动调用首个 Stage）

**注入方式**：通过 lazy proxy 注入到 MCP server（与 `StageTransitionPort` 的注入模式一致，因为 collaboration 在 MCP server 之后初始化）。

**`SnailMCPServerDeps` 新增字段**：

```typescript
interface SnailMCPServerDeps {
  // ...existing fields...
  issueManagement: IssueManagementPort;
}
```

**`snail-issue-context` 服务器工厂签名变更**：

```typescript
// 从
createSnailIssueContextServer(issuePort: IssuePort)
// 变为
createSnailIssueContextServer(issuePort: IssuePort, issueManagement: IssueManagementPort)
```

### 变更 3：继承关系的消费

新 Issue 的 Agent 在启动时，通过 system prompt 中的 Issue 上下文（只读视图）看到 `source_issue_id` 字段。Agent 可：

1. 通过 `get_context` 读取 `source_issue_id`，得知前序 Issue ID
2. 通过 Issue 详情（标题、摘要）了解前序 Issue 的主题
3. 创建时的 `summary` 已将关键上下文带入新 Issue

**注意**：当前 MCP 工具（`snail-message-history` 等）以 `SNAIL_CTX_ISSUE_ID` 为作用域，Agent 无法通过 MCP 直接读取前序 Issue 的对话消息。上下文承接依赖 `summary` 参数，不依赖跨 Issue 消息访问。

## 核心业务行为

| ID | 场景 | 预期行为 | 追溯 |
|----|------|---------|------|
| B1 | Agent 调用 `create_issue`，传入 `title`、`sop_key`、`summary`、`source_issue_id` | 系统创建新 Issue，自动分配 snail，自动启动首个 Stage，在新 Issue context 中写入 `source_issue_id`。返回 `{ issue_id, issue_title, stage_id, stage_key }` | ← UA-1, UA-2, UA-3 |
| B2 | Agent 调用 `create_issue`，传入不存在的 `sop_key` | 系统返回错误，不创建 Issue | ← UA-1 |
| B3 | Agent 调用 `create_issue`，传入不存在的 `source_issue_id`，或 `source_issue_id` 对应的 Issue 与当前 Issue 不属于同一 `workspace_path` | 系统返回错误，不创建 Issue | ← UA-3 |
| B4 | Agent 调用 `create_issue`，传入 `workspace_path` 但不传 `source_issue_id` | 系统创建独立的 Issue，无继承关系，context 中无 `source_issue_id` | ← UA-1 |
| B5 | Agent 调用 `create_issue`，不传 `summary` | 系统创建 Issue，`summary` 为空。新 Issue 的 Agent 依赖 `source_issue_id` 追溯前序 Issue | ← UA-1 |
| B6 | 新 Issue 创建后，首个 Stage 的 Agent 启动 | Agent 在 system prompt 的 Issue 上下文中看到 `source_issue_id`（若存在），可通过 `get_context` 确认前序 Issue ID | ← UA-3 |
| B7 | Snail den 中无可用 snail | 系统返回错误，不创建 Issue | ← UA-1 |
| B8 | Agent 调用 `create_issue` 成功后，在当前 Issue 对话中向用户报告新 Issue 的 ID 和标题，确认新 Issue 已自动启动 | Agent 在当前对话中输出新 Issue 的创建结果，用户可前往新 Issue 查看 | ← UA-2 |

## 非目标

- 不引入跨 Issue 消息访问能力（`snail-message-history` 等工具仍以当前 Issue 为作用域）
- 不新增数据库表（使用现有 `context` 字段存储继承关系）
- 不支持自定义 snail 分配计划（自动分配第一个 snail，用户可在前端调整）
- 不支持多种关系类型（当前仅 "继承自" 一种）
- 不自动在前序 Issue 中记录衍生 Issue ID（单向链接，Agent 可选手动通过 `set_context` 记录）

## 关键决策记录

### 决策 1：继承关系存储方式 — Issue context vs 独立表

- **决策点**：继承关系存储在 Issue 的 `context` 字段，还是新建 `issue_link` 表？
- **正方论点（context 字段）**：无需新增数据库表；`context` 已通过 system prompt 注入给 Agent，Agent 天然可发现；与 `worktree_path`、`branch_name` 等 issue 级元数据存储方式一致
- **反方论点（独立表）**：独立表支持双向查询（前序→衍生、衍生→前序）；关系数据与上下文数据分离，关注点更清晰
- **最终决策**：使用 Issue context 字段
- **决策依据**：用户场景只需要单向链接（新 Issue 知道前序 Issue），反向查询（前序 Issue 知道衍生出哪些 Issue）未确认需求。使用 context 避免新增表的复杂度。若未来需要反向查询，可再引入独立表
- **参与者**：架构师-1、架构师-2

### 决策 2：MCP 工具位置 — 现有服务器 vs 新服务器

- **决策点**：`create_issue` 工具放在 `snail-issue-context` 服务器还是新建 `snail-issue-management` 服务器？
- **正方论点（现有服务器）**：避免为单个工具创建新服务器的样板代码；`snail-issue-context` 已有 `IssuePort` 注入，扩展成本低
- **反方论点（新服务器）**：`snail-issue-context` 的语义是"当前 Issue 的上下文管理"，创建新 Issue 是不同的关注点；混入会模糊服务器边界
- **最终决策**：放在 `snail-issue-context` 服务器
- **决策依据**：单个工具不值得新服务器。重命名会改变 MCP 工具命名空间（breaking change），服务器名称虽窄但 issue 相关操作集中一处更便于发现。若未来 issue 管理工具增多，可拆分为独立服务器
- **参与者**：架构师-1、架构师-2

### 决策 3：Snail 自动分配 vs Agent 指定

- **决策点**：`create_issue` 是否接受 `snail_assignment_plan` 参数？
- **正方论点（自动分配）**：Agent 不知道有哪些 snail 可用，也不应关心 snail 分配；自动分配降低使用门槛；与前端默认行为一致
- **反方论点（Agent 指定）**：某些场景需要为不同角色分配不同 snail
- **最终决策**：自动分配，不接受 `snail_assignment_plan` 参数
- **决策依据**：当前系统通常只配置一个 snail，自动分配即可满足。用户可在前端调整分配。引入 `snail_assignment_plan` 参数会增加 Agent 的使用复杂度，且无已确认需求
- **参与者**：架构师-1、架构师-2

### 决策 4：`IssueManagementPort` 方法命名 — `spawnIssue` vs `createIssue`

- **决策点**：`IssueManagementPort` 的方法名用什么？
- **正方论点（`spawnIssue`）**：`IssueCollaboration` 已有 `createIssue(CreateIssueInput)`，签名要求 `snail_assignment_plan`。`IssueManagementPort` 的方法签名不兼容（无 `snail_assignment_plan`，有 `source_issue_id`），TypeScript 不允许同名方法接受不兼容参数
- **反方论点（`createIssue`）**：方法名直观
- **最终决策**：使用 `spawnIssue`
- **决策依据**：TypeScript 方法签名冲突是硬约束。`spawnIssue` 语义准确（自动分配 + 继承关系 + 完整生命周期）
- **参与者**：架构师-1（提出）、架构师-2（审视发现）

## 变更影响分析

### 后端

- **MCP 工具层**：`snail-issue-context` 服务器新增 `create_issue` 工具
- **端口层**：新增 `IssueManagementPort` 接口
- **协作层**：collaboration 实现 `IssueManagementPort.spawnIssue()`，封装 auto-assignment 和 `source_issue_id` 写入 context，内部调用 `this.createIssue()`
- **注入层**：`SnailMCPServerDeps` 新增 `issueManagement` 字段；`initor.ts` 注册时注入；`main.ts` 使用 lazy proxy（与 `StageTransitionPort` 模式一致）

### 前端

- **无直接影响**。前端不调用 MCP 工具。
- **间接影响**：新 Issue 创建后通过 WebSocket 事件通知前端刷新 Issue 列表。新 Issue 的 `context` 中包含 `source_issue_id`，前端可选择展示继承关系（本期不做）。

### 数据库

- **无变更**。使用现有 `issue.context` 字段存储 `source_issue_id`。

### 提示词/SOP

- **系统提示词**：新 Issue 的 Agent 在 system prompt 的 Issue 上下文中会看到 `source_issue_id`（如果有）。无需修改 `system-prompt-builder.ts`——context 字段已自动注入。

## 不兼容更新

无。本次变更为纯新增功能，不修改已有行为。

## [design-time]

### 设计锁定状态

- 两位架构师已通过交叉审视达成共识
- 1 个阻塞问题已解决（方法名冲突 → `spawnIssue`）
- 4 个设计缺口已全部补充（Snail 来源、workspace_path 获取、工作区校验、创建后行为）
- 无未解决争议

### 交叉审视记录

- **Phase 1（独立分析）**：架构师-1 产出草稿方案（3 个缺失分析 + `create_issue` 工具 + `IssueManagementPort` + 继承关系 via context）
- **Phase 2（交换对抗）**：架构师-2 逐项验证代码事实，提出 1 个 BLOCKING（方法名冲突）和 4 个 GAP（Snail 来源、workspace_path 获取、工作区校验、创建后行为），并验证了 6 项已确认决策
- **Phase 3（合并收敛）**：架构师-1 全部接受，更新 Feature 文档。新增决策 4（`spawnIssue` 命名）

### 质疑义务产出

**风险点**：
1. 上下文承接仅靠 `summary` 参数，Agent 无法通过 MCP 读取前序 Issue 的对话消息——若 summary 不够详尽，新 Issue 的 Agent 可能缺少关键上下文。当前设计接受此限制，因为引入跨 Issue 消息访问是更大的架构变更
2. `spawnIssue` 创建新 Issue 后首个 Stage 自动启动，与当前 Agent 并行运行。如果两个 Issue 的 Agent 操作同一 worktree 可能产生冲突——但不同 SOP 通常使用不同 worktree，冲突概率低

**遗漏场景**：
1. Agent 调用 `create_issue` 失败后（如 SOP 不存在），Agent 应在当前对话中向用户报告失败原因并建议修正——此行为属于 prompt 级约束，不单独列为行为条目

### 实现指引

无。
