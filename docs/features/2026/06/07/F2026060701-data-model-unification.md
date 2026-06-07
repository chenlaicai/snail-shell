---
id: F2026060701
title: data-model-unification
from_ids:
  - F2026060504
  - F2026060505
tags:
  - data-model
  - architecture
  - refactor
  - type-safety
modules:
  - shared
  - api-contracts
  - persistence
  - workspace-workflow
  - agent
  - roles
  - web
doc_kind: spec
---

# F2026060701 [shared] 数据模型统一：消除重复定义，全系统共用 shared 层类型

<!-- [design-time] -->

## 背景

代码仓中同一数据模型在多个模块重复定义，导致架构越来越松散。AI 改代码时"想改哪就改哪、哪缺就随意补"，全代码仓充斥着重复的多重定义。

### 具体问题

**问题 1：11 个 view 类型双重定义**

`manager-types.ts` 和 `api-contracts/dto/` 各自独立定义了一套完全相同的 view 类型：

| 类型 | manager-types.ts | api-contracts/dto/ |
|------|-----------------|-------------------|
| `WorkspaceSummary` | `Workspace & { conversation_count, ... }` | `WorkspaceSummaryDto = 同结构` |
| `WorkspaceDetail` | `WorkspaceSummary & { issues }` | `WorkspaceDetailDto = 同结构` |
| `IssueDetail` | `Issue & { stages, ... }` | `IssueDetailDto = 同结构` |
| `StageDetail` | `Stage & { input_artifacts, ... }` | `StageDetailDto = 同结构` |
| `ConversationDetail` | `Conversation & { message_count, ... }` | `ConversationDetailDto = 同结构` |
| `ConversationMessagesPage` | `{ items, next_offset, has_more }` | 同结构 |
| `ConversationRecentMessagesSnapshot` | `{ items, last_event_id }` | 同结构 |
| `ConversationHistoryWindow` | `{ items }` | 同结构 |
| `ConversationHistorySearchPage` | `{ items, next_offset, has_more }` | 同结构 |
| `BossMentionItem` | `{ dispatch_id, message_id, ... }` | 同结构 |
| `ConversationDispatchState` | `{ dispatches, inbox_groups }` | 同结构 |

改一处不改另一处就会产生不一致。

**问题 2：`RoleDefinition` 三处定义**

| 位置 | 定义方式 |
|------|---------|
| `shared/domain-types.ts` | `StageRoleDefinition`（canonical） |
| `roles/index.ts` | `type RoleDefinition = StageRoleDefinition`（deprecated 别名） |
| `web/types.ts` | `interface RoleDefinition { name, description?, ... }`（独立重定义） |

**问题 3：`GuardProfile`、`SnailAgentSession`、`SopSeedItem` 散落在 persistence 层**

这三个是核心领域概念，却被定义在 persistence 实现文件中：
- `GuardProfile` 定义在 `persistence/guard-profile-store.ts`
- `SnailAgentSession` 定义在 `persistence/store.ts`（内联在 class 文件中）
- `SopSeedItem` 定义在 `persistence/types.ts`

**问题 4：零值 DTO 别名污染**

DTO 层存在大量零值别名（`type X = Y`，无任何扩展），违反"一个东西只有一个名字"原则：

| 别名 | Canonical Name | 零值？ |
|------|---------------|--------|
| `SopDto` | `Sop` | 是 |
| `SopTransitionDto` | `SopTransition` | 是 |
| `IssueDto` | `Issue` | 是 |
| `ConversationDto` | `Conversation` | 是 |
| `LobbySessionDto` | `LobbySession` | 是 |
| `LobbyMessageDto` | `LobbyMessage` | 是 |
| `KnowledgeEntryDto` | `KnowledgeLibraryEntry` | 是 |
| `KnowledgeSearchResultDto` | `KnowledgeLibrarySearchResult` | 是 |
| `EvolutionItemSearchResultDto` | `EvolutionItemSearchResult` | 是 |
| `EvolutionItemWithConversationDto` | `EvolutionItemWithConversation` | 是 |
| `RoleDefinition` | `StageRoleDefinition` | 是 |

**问题 5：`web/types.ts` broken import 和 RoleDefinition 重定义**

`web/types.ts` 导入了不存在的 `WorkspaceModule` 类型，且独立定义了 `RoleDefinition` 接口（与 `StageRoleDefinition` 结构相同）。

**问题 6：零值 re-export 链**

类型从 `shared/domain-types` → `shared/types` → `persistence/types` → `persistence/store` 经过 4 层 re-export 才到达消费者，每层都是零值传递。

## 目标

**一个东西只有一个名字，所有类型定义在 `shared/` 中。**

### D1 — 所有数据模型定义在 shared/

1. 核心实体类型在 `shared/domain-types.ts`（Workspace, Issue, Stage, Conversation, Message, Sop 等）
2. 聚合视图类型在 `shared/view-types.ts`（WorkspaceSummary, StageDetail, IssueDetail 等）
3. 消息内容块类型在 `shared/message-types.ts`
4. 演进/知识库类型在 `shared/evolution-types.ts`、`shared/knowledge-library-types.ts`
5. SOP 快照类型在 `shared/sop-snapshot.ts`
6. 所有类型通过 `shared/types.ts` 和 `shared/index.ts` 统一 re-export

### D2 — 消灭零值别名

1. 删除所有 `type X = Y` 形式的零值别名
2. 消费者直接使用 canonical name（如 `Sop` 而非 `SopDto`）
3. `RoleDefinition` 别名删除，消费者使用 `StageRoleDefinition`

### D3 — 消灭零值 re-export 链

1. `persistence/types.ts` 不再定义任何类型，仅 re-export from shared
2. `persistence/store.ts` 移除内联类型定义，从 shared 导入
3. 本 PR 不改动现有消费者从 `persistence/store` 导入的路径（保留向后兼容），但新增或修改的代码必须从 `shared/` 直接导入

### D4 — 散落类型迁入 shared

1. `GuardProfile` 从 `persistence/guard-profile-store.ts` 迁入 `shared/view-types.ts`
2. `SnailAgentSession` 从 `persistence/store.ts` 迁入 `shared/domain-types.ts`
3. `SopSeedItem` 从 `persistence/types.ts` 迁入 `shared/view-types.ts`

### D5 — 修复 broken import 和 RoleDefinition 重定义

1. `web/types.ts` 移除不存在的 `WorkspaceModule` 导入
2. `web/types.ts` 删除 `RoleDefinition` 接口定义，改为从 shared 导入 `StageRoleDefinition`
3. `ContextPanel.tsx` 中 `RoleDefinition` 改为 `StageRoleDefinition`
4. `src/index.ts` 删除 `RoleDefinition` @deprecated re-export

## 非目标

1. 不改变 DTO 层中扩展类型（有额外字段的）的定义位置——它们在 `api-contracts/dto/` 中定义，引用 shared 实体类型组合而成
2. 不改变 `api-contracts/endpoints.ts` 的契约映射结构
3. 不改变模块特定接口（`WorkspaceManagerDeps`、`SummaryGenerationInput`、`MessageProtocolDeps` 等）——它们是模块内部的依赖注入接口，不是共享数据模型
4. 不改变 `persistence/types.ts` 和 `persistence/store.ts` 的 re-export——它们保留向后兼容，但消费者应逐步迁移到直接从 shared 导入

## 设计

### D1 详设：shared/ 目录结构

```
src/shared/
  domain-types.ts      # 核心实体（Workspace, Issue, Stage, Conversation, Message, Sop, StageRoleDefinition, SnailAgentSession, ...）
  view-types.ts        # 聚合视图（WorkspaceSummary, StageDetail, IssueDetail, ...）+ 辅助类型（GuardProfile, SopSeedItem）
  message-types.ts     # 消息内容块（MessageTextBlock, MessageQuestionBlock, ...）
  evolution-types.ts   # 演进条目（EvolutionItem, ...）
  knowledge-library-types.ts  # 知识库（KnowledgeLibraryEntry, ...）
  sop-snapshot.ts      # SOP 快照（SopSnapshot）
  types.ts             # 统一 re-export 入口
  index.ts             # 统一 re-export 入口 + 工具函数
  event-content-utils.ts
  message-context-utils.ts
  platform-paths.ts
  runtime-error.ts
```

### D2 详设：消灭零值别名

**删除的别名及消费者迁移：**

| 删除的别名 | Canonical Name | 消费者文件 |
|-----------|---------------|-----------|
| `SopDto` | `Sop` | `endpoints.ts`, `SopCenter.tsx` |
| `SopTransitionDto` | `SopTransition` | `endpoints.ts`, `sop.mutations.ts` |
| `IssueDto` | `Issue` | `endpoints.ts`, `ContextPanel.tsx`, `AppShell.tsx` |
| `ConversationDto` | `Conversation` | `endpoints.ts` |
| `LobbySessionDto` | `LobbySession` | `endpoints.ts`, `Lobby.tsx` |
| `LobbyMessageDto` | `LobbyMessage` | `endpoints.ts`, `Lobby.tsx` |
| `KnowledgeEntryDto` | `KnowledgeLibraryEntry` | `endpoints.ts`, `KnowledgeLibrary.tsx` |
| `KnowledgeSearchResultDto` | `KnowledgeLibrarySearchResult` | `endpoints.ts` |
| `EvolutionItemSearchResultDto` | `EvolutionItemSearchResult` | `endpoints.ts` |
| `EvolutionItemWithConversationDto` | `EvolutionItemWithConversation` | `endpoints.ts` |
| `RoleDefinition` | `StageRoleDefinition` | `ContextPanel.tsx`, `web/types.ts`, `index.ts` |
| `WorkspaceSummaryDto` | `WorkspaceSummary` | `endpoints.ts`, `web/types.ts`, `AppShell.tsx` |
| `WorkspaceDetailDto` | `WorkspaceDetail` | `endpoints.ts`, `web/types.ts` |
| `IssueDetailDto` | `IssueDetail` | `endpoints.ts`, `web/types.ts` |
| `StageDetailDto` | `StageDetail` | `endpoints.ts`, `web/types.ts` |
| `ConversationDetailDto` | `ConversationDetail` | `endpoints.ts`, `web/types.ts` |
| `WorkspaceSummaryDto` | `WorkspaceSummary` | `endpoints.ts`, `web/types.ts`, `AppShell.tsx` |
| `WorkspaceDetailDto` | `WorkspaceDetail` | `endpoints.ts`, `web/types.ts` |
| `IssueDetailDto` | `IssueDetail` | `endpoints.ts`, `web/types.ts` |
| `StageDetailDto` | `StageDetail` | `endpoints.ts`, `web/types.ts` |
| `ConversationDetailDto` | `ConversationDetail` | `endpoints.ts`, `web/types.ts` |

**保留的类型（有扩展字段或独立定义）：**

| 类型 | 定义 | 说明 |
|------|------|------|
| `MessageDto` | `Message & { content?, quoted_message? }` | API 响应扩展 |
| `SopDetailDto` | `Sop & { stage_definitions, transitions }` | API 响应扩展 |
| `SopStageDefinitionWithRolesDto` | `SopStageDefinition & { roles }` | API 响应扩展 |
| `SopStageDefinitionInputDto` | 独立定义 | API 请求体 |
| `CreateWorkspaceResult` | 独立定义 | API 响应组合 |
| `CreateIssueResult` | 独立定义 | API 响应组合 |
| `AdvanceIssueResult` | 独立定义 | API 响应组合 |
| `IssueCleanupResult` | 独立定义 | API 响应组合 |
| `RepoCleanupResult` | 独立定义 | API 响应组合 |
| `StageSuggestion` | 独立定义 | API 响应 |
| `UpdateStageBody` | 独立定义 | API 请求体 |
| `ConversationEventWithMessage` | 独立定义 | API 响应扩展 |
| `SendMessageResult` | 独立定义 | API 响应 |
| `ApproveToolResult` | 独立定义 | API 响应 |
| `InterruptMessageResult` | 独立定义 | API 响应 |
| `DeleteSopResult` | 独立定义 | API 响应 |
| `PromptDto` | 独立定义 | API 响应 |
| `SkillDto` | 独立定义 | API 响应 |
| `SnailDenTemplateDto` | 独立定义 | API 响应 |
| `McpServerDto` | 独立定义 | API 响应 |
| `RoleDto` | 独立定义 | API 响应 |

**`WorkspaceSummaryDto` 等 re-export 别名的处理：**

`WorkspaceSummaryDto = WorkspaceSummary`、`IssueDetailDto = IssueDetail` 等在结构上也是零值别名。但它们是 `endpoints.ts` API 契约映射中的响应类型名（如 `Dto.WorkspaceSummaryDto[]`），删除后 `endpoints.ts` 需要改为 `Dto.WorkspaceSummary[]`，语义上从"API 契约类型"变为"领域类型"。

**决策**：一并删除。`endpoints.ts` 直接引用 canonical name。API 契约的命名一致性不值得用别名维护。

### D3 详设：清理 re-export 链

`persistence/types.ts` 保留 re-export（向后兼容），但添加注释说明消费者应从 `shared/` 直接导入。

`persistence/store.ts` 保留 re-export（向后兼容），但移除内联的 `SnailAgentSession` 定义（已迁入 `shared/domain-types.ts`）。

### D4 详设：类型迁移

| 类型 | 原位置 | 新位置 | 理由 |
|------|--------|--------|------|
| `SnailAgentSession` | `persistence/store.ts` | `shared/domain-types.ts` | 核心实体，映射 DB 表 |
| `GuardProfile` | `persistence/guard-profile-store.ts` | `shared/view-types.ts` | 领域概念，被 agent/capability 层消费 |
| `SopSeedItem` | `persistence/types.ts` | `shared/view-types.ts` | 数据形状定义，被 FileConfigStore 和 store 消费 |

## 改动范围

### shared/

- `src/shared/domain-types.ts` — 新增 `SnailAgentSession`
- `src/shared/view-types.ts` — 新增（聚合视图 + GuardProfile + SopSeedItem）
- `src/shared/types.ts` — 新增 re-export
- `src/shared/index.ts` — 新增 re-export

### api-contracts/dto/

- `src/api-contracts/dto/sop.dto.ts` — 删除 `SopDto`、`SopTransitionDto` 零值别名
- `src/api-contracts/dto/issue.dto.ts` — 删除 `IssueDto` 零值别名
- `src/api-contracts/dto/conversation.dto.ts` — 删除 `ConversationDto`、`ConversationDetailDto` 零值别名
- `src/api-contracts/dto/lobby.dto.ts` — 删除 `LobbySessionDto`、`LobbyMessageDto` 零值别名
- `src/api-contracts/dto/knowledge.dto.ts` — 删除 `KnowledgeEntryDto`、`KnowledgeSearchResultDto` 零值别名
- `src/api-contracts/dto/evolution.dto.ts` — 删除 `EvolutionItemSearchResultDto`、`EvolutionItemWithConversationDto` 零值别名
- `src/api-contracts/dto/stage.dto.ts` — 删除 `StageDetailDto` re-export 别名
- `src/api-contracts/dto/workspace.dto.ts` — 删除 `WorkspaceSummaryDto`、`WorkspaceDetailDto` re-export 别名
- `src/api-contracts/dto/index.ts` — 更新 re-export 列表
- `src/api-contracts/dto/message.dto.ts` — 更新 import 来源

### api-contracts/

- `src/api-contracts/endpoints.ts` — 所有 `Dto.*Dto` 零值别名引用改为 canonical name：`Dto.SopDto` → `Dto.Sop`，`Dto.IssueDto` → `Dto.Issue`，`Dto.ConversationDto` → `Dto.Conversation`，`Dto.LobbySessionDto` → `Dto.LobbySession`，`Dto.LobbyMessageDto` → `Dto.LobbyMessage`，`Dto.KnowledgeEntryDto` → `Dto.KnowledgeLibraryEntry`，`Dto.KnowledgeSearchResultDto` → `Dto.KnowledgeLibrarySearchResult`，`Dto.EvolutionItemSearchResultDto` → `Dto.EvolutionItemSearchResult`，`Dto.EvolutionItemWithConversationDto` → `Dto.EvolutionItemWithConversation`，`Dto.SopTransitionDto` → `Dto.SopTransition`，`Dto.WorkspaceSummaryDto` → `Dto.WorkspaceSummary`，`Dto.WorkspaceDetailDto` → `Dto.WorkspaceDetail`，`Dto.IssueDetailDto` → `Dto.IssueDetail`，`Dto.StageDetailDto` → `Dto.StageDetail`，`Dto.ConversationDetailDto` → `Dto.ConversationDetail`
- `src/api-contracts/index.ts` — 更新 re-export 列表

### persistence/

- `src/persistence/guard-profile-store.ts` — `GuardProfile` 改为从 shared 导入 + re-export
- `src/persistence/store.ts` — 移除内联 `SnailAgentSession`，从 shared 导入
- `src/persistence/types.ts` — 更新 re-export 列表

### agent/

- `src/agent/capability/spec.ts` — `GuardProfile` 改为从 shared 导入
- `src/agent/interface.ts` — `RoleDefinition` 改为 `StageRoleDefinition`

### roles/

- `src/roles/index.ts` — 删除 `RoleDefinition` 别名

### message-bus/

- `src/message-bus/collaboration.ts` — `RoleDefinition` → `StageRoleDefinition`，import 来源改为 shared
- `src/message-bus/message-protocol.ts` — `RoleDefinition` → `StageRoleDefinition`，import 来源改为 shared
- `src/message-bus/message-events.ts` — import 来源改为 shared
- `src/message-bus/message-context.ts` — import 来源改为 shared

### prompt-center/

- `src/prompt-center/builder.ts` — `RoleDefinition` → `StageRoleDefinition`

### workspace-workflow/

- `src/workspace-workflow/manager-types.ts` — 删除重复的 view 类型定义，改为从 shared re-export
- `src/workspace-workflow/manager-collaboration.ts` — `RoleDefinition` → `StageRoleDefinition`，import 来源改为 shared
- `src/workspace-workflow/workflow.ts` — import 来源改为 shared

### web/

- `src/web/types.ts` — 移除 `WorkspaceModule` broken import，删除 `RoleDefinition` 接口定义，删除所有 `*Dto` re-export（`WorkspaceSummaryDto`、`WorkspaceDetailDto`、`IssueDetailDto`、`StageDetailDto`、`ConversationDetailDto` 等），改为从 shared 直接导出 canonical name
- `src/web/components/ContextPanel.tsx` — `RoleDefinition` → `StageRoleDefinition`，`IssueDto` → `Issue`
- `src/web/layouts/AppShell.tsx` — `WorkspaceSummaryDto` → `WorkspaceSummary`，`IssueDto` → `Issue`
- `src/web/pages/SopCenter.tsx` — `SopDto` → `Sop`
- `src/web/pages/Lobby.tsx` — `LobbySessionDto` → `LobbySession`，`LobbyMessageDto` → `LobbyMessage`
- `src/web/pages/KnowledgeLibrary.tsx` — `KnowledgeEntryDto` → `KnowledgeLibraryEntry`
- `src/web/pages/WorkspaceBoard.tsx` — `WorkspaceDetailDto` → `WorkspaceDetail`，`IssueDetailDto` → `IssueDetail`
- `src/web/pages/ConversationView.tsx` — `ConversationDetailDto` → `ConversationDetail`
- `src/web/components/Sidebar/WorkspaceTree.tsx` — `WorkspaceSummaryDto` → `WorkspaceSummary`
- `src/web/mutations/sop.mutations.ts` — `SopTransitionDto` → `SopTransition`

### src/

- `src/index.ts` — 删除 `RoleDefinition` re-export

### tests/

- `tests/workspace/collaboration-test.ts` — `RoleDefinition` → `StageRoleDefinition`
- `tests/workspace/resolve-snail-display-name-test.ts` — `RoleDefinition` → `StageRoleDefinition`

## 验证

### 编译与测试

- [ ] `tsc --noEmit` 零错误
- [ ] `eslint .` 零错误
- [ ] 全部 39 个测试文件通过
- [ ] `npm run build` + `npm run build:web` 通过

### D1 验证：所有数据模型在 shared/

- [ ] `shared/domain-types.ts` 包含 `SnailAgentSession` 导出
- [ ] `shared/view-types.ts` 包含 `WorkspaceSummary`、`WorkspaceDetail`、`IssueDetail`、`StageDetail`、`ConversationDetail`、`ConversationMessagesPage`、`ConversationRecentMessagesSnapshot`、`ConversationHistoryWindow`、`ConversationHistorySearchPage`、`BossMentionItem`、`ConversationDispatchState`、`GuardProfile`、`SopSeedItem` 导出
- [ ] `shared/types.ts` 和 `shared/index.ts` re-export 以上所有类型
- [ ] `grep -rn "^export interface\|^export type " src/shared/*.ts | grep -v "from"` 输出覆盖所有核心类型（无遗漏）

### D2 验证：零值别名全部删除

- [ ] `grep -rn "export type SopDto\b\|export type IssueDto\b\|export type ConversationDto\b\|export type LobbySessionDto\b\|export type LobbyMessageDto\b\|export type KnowledgeEntryDto\b\|export type KnowledgeSearchResultDto\b\|export type EvolutionItemSearchResultDto\b\|export type EvolutionItemWithConversationDto\b\|export type SopTransitionDto\b\|export type WorkspaceSummaryDto\b\|export type WorkspaceDetailDto\b\|export type IssueDetailDto\b\|export type StageDetailDto\b\|export type ConversationDetailDto\b" src/api-contracts/dto/` 输出为空
- [ ] `grep -rn "Dto\.SopDto\|Dto\.IssueDto\|Dto\.ConversationDto\|Dto\.LobbySessionDto\|Dto\.LobbyMessageDto\|Dto\.KnowledgeEntryDto\|Dto\.KnowledgeSearchResultDto\|Dto\.EvolutionItemSearchResultDto\|Dto\.EvolutionItemWithConversationDto\|Dto\.SopTransitionDto\|Dto\.WorkspaceSummaryDto\|Dto\.WorkspaceDetailDto\|Dto\.IssueDetailDto\|Dto\.StageDetailDto\|Dto\.ConversationDetailDto" src/api-contracts/endpoints.ts` 输出为空
- [ ] `grep -rn "RoleDefinition" src/ tests/ | grep -v StageRoleDefinition | grep -v node_modules` 输出为空

### D3 验证：re-export 链清理

- [ ] `persistence/types.ts` 不包含 `export interface` 或 `export type` 定义（仅 re-export）
- [ ] `persistence/store.ts` 不包含内联的 `SnailAgentSession` 接口定义

### D4 验证：散落类型迁入 shared

- [ ] `grep -rn "export interface GuardProfile" src/persistence/guard-profile-store.ts` 输出为空（已迁出）
- [ ] `grep -rn "export interface SnailAgentSession" src/persistence/store.ts` 输出为空（已迁出）
- [ ] `grep -rn "export interface SopSeedItem" src/persistence/types.ts` 输出为空（已迁出）
- [ ] `agent/capability/spec.ts` 的 `GuardProfile` import 来源为 `../../shared/types`

### D5 验证：broken import 和 RoleDefinition 清理

- [ ] `grep -rn "WorkspaceModule" src/ tests/` 输出为空
- [ ] `grep -rn "interface RoleDefinition\|type RoleDefinition" src/` 输出为空
- [ ] `web/types.ts` 从 shared 导出 `StageRoleDefinition`（不导出 `RoleDefinition`）
- [ ] `ContextPanel.tsx` 使用 `StageRoleDefinition` 而非 `RoleDefinition`
- [ ] `src/index.ts` 不导出 `RoleDefinition`

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|-----------|------|------|
| 1 | DTO 层零值别名是否保留 | 不保留。统一数据模型的核心是"一个东西只有一个名字"，别名是重复定义的变种 | 2026-06-07 |
| 2 | `RoleDefinition` 如何处理 | 不保留任何别名。直接更新消费者（`ContextPanel.tsx`）使用 `StageRoleDefinition`，删除 `web/types.ts` 和 `index.ts` 中的 `RoleDefinition` | 2026-06-07 |
| 3 | `WorkspaceSummaryDto` 等 re-export 别名是否删除 | 删除。`type WorkspaceSummaryDto = WorkspaceSummary` 结构上与 `type SopDto = Sop` 完全一样，都是零值别名。统一标准：所有零值别名一律删除，`endpoints.ts` 直接引用 canonical name | 2026-06-07 |
| 4 | `persistence/types.ts` 和 `persistence/store.ts` 的 re-export 链是否删除 | 不删除，保留向后兼容。但消费者应逐步迁移到直接从 shared 导入 | 2026-06-07 |
