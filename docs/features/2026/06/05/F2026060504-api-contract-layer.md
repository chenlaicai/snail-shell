---
id: F2026060504
title: api-contract-layer
from_ids:
  - F2026052003
  - F2026060310
  - F2026052907
  - F2026050805
  - F2026051307
tags:
  - architecture
  - type-safety
  - api
  - frontend
  - backend
  - contract
  - framework
  - tanstack-query
  - shadcn
  - zod
modules:
  - web
  - interaction-entry
  - shared
doc_kind: spec
---

# F2026060504 [web/shared] API Contract Layer — 前后端交互契约层

<!-- [design-time] -->

## 背景

Snail Shell 经历了多次 UI 重构（`F2026052003` 架构一步到位重构、`F2026060310` UI 重设计），但每次重构后都出现大量功能遗漏——新 UI 丢掉了后端已有的交互能力。更严重的是，AI（Claude）无法通过代码分析发现这些遗漏，只能靠用户手动测试后反馈。

**根因诊断：前后端之间没有契约层。** 具体表现为三层断裂：

### 断裂点 1：API 响应无类型定义

后端 handler 在 `res.json(...)` 中拼装了 enrichment 数据（如 Issue 带 `current_stage`、Stage 带 `stage_definition`、Message 带 `events` 嵌入），但这些"API DTO"从未被定义为类型。它们是隐式的，只存在于 handler 代码的拼装逻辑中。

### 断裂点 2：前端不导入共享类型

`src/shared/types.ts` 和 `src/shared/domain-types.ts` 定义了完整的领域实体类型（635+ 行），但前端（`src/web/`）**零导入**。每个组件各自手写 interface，造成：

- **字段大量遗漏**：Issue 丢 `sop_snapshot`/`role_snail_mapping`/`task_anchor`；Conversation 丢 11/14 个字段；Stage 丢 `output_artifacts`/`gate_evidence`/`entered_at`/`left_at`
- **union 类型退化为 `string`**：`MessageRole`、`MessageStatus`、`StageStatus`、`ConversationKind` 等字面量联合在前端全部退化为 `string`，丧失 exhaustiveness 检查
- **同一实体多处矛盾定义**：`Message` 在 `conversationStore.ts`、`ConversationView.tsx`、`MessageRenderer.tsx` 中各有不同字段；`Stage` 在 4 个文件中各定义一次；`Issue` 在 5 个文件中各定义一次
- **索引签名破坏类型**：`conversationStore.ts` 的 `Message` 用了 `[key: string]: unknown`，等于对编译器说"任何属性都合法"

### 断裂点 3：API 客户端返回 `any`

`src/web/services/api.ts` 是一个 15 行的裸 `fetch` 包装器：

```typescript
export async function api(method: string, path: string, body?: unknown) {
  // ...
  const data = response.status === 204 ? null : await response.json();
  // 返回值是 implicit any
  return data;
}
```

所有前端调用点（`api("GET", "/workspaces")`）的结果都是 `any`，TypeScript strict mode 在 I/O 边界完全失效。

### 断裂点 4：框架机制被浪费

项目安装了现代前端框架但只用了最表面的一层，丢弃了它们真正有价值的类型安全部分：

| 框架 | 类型安全机制 | 项目现状 | 后果 |
|------|-------------|---------|------|
| TypeScript strict mode | 强制类型检查 | 被 `any`/`as`/索引签名架空 | strict 形同虚设，`api()` 返回 `any` 是最大的逃逸口 |
| TanStack Query | `queryFn` 返回类型 → `data` 类型自动推导 | **未安装** | 每个页面手写 `useState`+`useEffect`+`api()`，无缓存、无去重、无类型流 |
| shadcn/ui | 组件 props 类型 + Radix 无障碍约束 | 只装了 4/40+ 组件；27 个手写 CSS 文件与 Tailwind 并存 | 两套样式系统无边界；`lucide-react` 配置了但未安装 |
| React Router v7 | loader/action 的 request/response 类型 | 用的老 `BrowserRouter`+`Routes` API，无 loader、无 typed params、无 error element、无 lazy loading | 数据获取全在组件内，路由无类型约束 |
| Zustand v5 | store state 类型 + selector 推导 | 单个平铺 store，无 middleware；`Message` 有 `[key: string]: unknown`；`updateMessage` 签名与 WebSocket 调用矛盾（`id: string` vs `id: number`） | store 级别的类型安全被索引签名完全破坏 |
| 表单验证 | zod/yup/react-hook-form 的 schema 类型推导 | **未安装**；用原生 `prompt()` 弹窗收集输入 | 无输入校验、无 schema 类型 |

**核心结论：框架的类型安全是 opt-in 的，不是 opt-out 的。项目的前端重构只关注了"UI 长什么样"，完全没有关注"前后端之间的类型契约"。每个框架都被只用了"壳"，丢弃了"类型契约"层。**

## 目标

### P1 — 建立 API Contract 层

1. 定义所有 API endpoint 的完整契约（Method + Path + Params + Query + Body + Response）
2. 定义所有 API DTO（Data Transfer Object）——即 API 实际返回的精确类型（含 enrichment）
3. 定义 WebSocket 协议的完整类型（Client→Server / Server→Client）
4. 前端 API client 具备类型安全，编译期可检测遗漏和类型错误

### P2 — 消除前端类型漂移

5. 前端删除所有局部 interface，统一从 contract 层导入 DTO
6. 所有 union 类型恢复为字面量联合，不再退化为 `string`
7. 删除 `[key: string]: unknown` 索引签名

### P3 — 可检验性

8. 存在机制可以在编译期或 CI 中验证：前端消费的 API 调用是否完整覆盖了后端暴露的能力

### P4 — 框架归位

9. TypeScript strict mode 真正生效——消除所有 `any` 逃逸口（`api()` 返回值、`response.json()`、索引签名、`as` 断言）
10. 引入 TanStack Query 替代手写 `useState`+`useEffect`+`api()` 模式，类型从 API 契约一路流到组件
11. 引入 zod 做运行时 schema 校验，与 TypeScript 类型双向推导（`z.infer<typeof schema>` = 静态类型）
12. Zustand store 类型修复——删除索引签名、修复 `updateMessage` 签名矛盾、引入必要的 middleware
13. shadcn/ui 统一为唯一的组件/样式来源——删除手写 CSS 系统，补全缺失组件
14. React Router v7 使用 `createBrowserRouter` + loader/action 数据流模式

## 非目标

- 不考虑渐进式迁移——直接做完整方案
- 不考虑向后兼容——旧的局部 interface 全部删除、旧的 CSS 全部删除
- 不改后端实现——只定义类型，不改 handler 逻辑
- 不做 OpenAPI/Swagger 代码生成——直接手写 TypeScript 类型，因为后端和前端在同一 monorepo 内
- 不覆盖 IM 通道（Feishu/WeCom）的消息格式——IM 通道走各自平台的消息协议，不是 JSON REST API，DTO 不覆盖 IM 响应

## 设计

### P1 详设

#### 1. 目录结构

```
src/api-contracts/
├── index.ts                    # barrel export
├── endpoints.ts                # 所有 endpoint 的 Method+Path+Params+Body+Response 声明
├── dto/
│   ├── workspace.dto.ts        # Workspace 相关 API 响应类型
│   ├── issue.dto.ts            # Issue 相关
│   ├── stage.dto.ts            # Stage 相关
│   ├── conversation.dto.ts     # Conversation 相关
│   ├── message.dto.ts          # Message 相关（含 MessageEvent）
│   ├── sop.dto.ts              # SOP 相关
│   ├── evolution.dto.ts        # Evolution 相关
│   ├── knowledge.dto.ts        # Knowledge Library 相关
│   ├── lobby.dto.ts            # Lobby 相关
│   └── meta.dto.ts             # Meta/Prompt/Skill/MCP/SnailDen 相关
├── ws-protocol.ts              # WebSocket 消息类型（client→server / server→client）
└── validators.ts               # 共享的运行时校验规则（从 validation.ts + 各 handler 提取）
```

#### 2. DTO 设计原则

DTO 描述 API 实际返回的形状，不是 DB 实体，不是前端 UI 模型。DTO 基于 `src/shared/domain-types.ts` 的实体类型，用交叉类型表达 enrichment：

**DTO 提取方法论**（阻塞项——必须在编写 DTO 代码前完成）：

1. **逐个 handler 逆向提取**：读每个 route handler 的 `res.json(...)` 调用，提取返回对象的所有字段和类型
2. **每个 DTO 字段必须有 handler 代码出处**：DTO 字段的名称和类型必须与 handler 中 `res.json()` 的赋值一一对应，不允许凭空设计
3. **enrichment 字段标注来源**：DTO 中超出 DB 实体的字段（如 `IssueDetailDto.current_stage`）必须在注释中标注 handler 中的拼装逻辑位置
4. **P1 验证增加人工比对**：每个 DTO 完成后，与 handler 的 `res.json()` 返回值进行逐字段比对，记录比对结果

```typescript
// 示例：message.dto.ts
import type { Message, MessageEvent, MessageRole, MessageStatus, RoleName } from "../shared/domain-types";

// API 返回的 Message 带有 enrichment（events 嵌入、content 便捷字段、quoted_message 反规范化）
export type MessageDto = Message & {
  content?: string;
  events: MessageEvent[];
  quoted_message: { speaker: string; preview: string } | null;
};

// API 返回的分页消息
export type MessagePageDto = {
  items: MessageDto[];
  next_offset: number;
  has_more: boolean;
};
```

```typescript
// 示例：issue.dto.ts
import type { Issue, Stage, StageDetail, Conversation } from "../shared/domain-types";

// API 返回的 Issue 含 stages 和 current_stage enrichment
export type IssueDto = Issue;
export type IssueDetailDto = Issue & {
  stages: StageDetail[];
  current_stage: StageDetail | null;
  conversation_count: number;
  boss_pending_count: number;
};

// Issue 创建响应
export type CreateIssueResult = {
  issue: IssueDto;
  stage: StageDetail;
  conversation: Conversation;
};

// Issue advance 响应
export type AdvanceIssueResult = {
  completed_stage: StageDetail;
  next_stage: StageDetail | null;
  conversation?: Conversation;
};
```

#### 3. Endpoint 契约声明

```typescript
// endpoints.ts — 编译期完整描述每个 endpoint 的输入输出
import type * as Dto from "./dto";

// 每个 endpoint 的契约类型
interface ApiEndpointDef<
  TParams = never,
  TQuery = never,
  TBody = never,
  TResponse = undefined
> {
  params: TParams;
  query: TQuery;
  body: TBody;
  response: TResponse;
}

// 所有 endpoint 的契约映射
export type ApiEndpoints = {
  // ── Workspace ──
  "GET /api/workspaces": ApiEndpointDef<
    never,
    { limit?: number; offset?: number },
    never,
    Dto.WorkspaceSummaryDto[]
  >;
  "POST /api/workspaces": ApiEndpointDef<
    never,
    never,
    { name: string; summary?: string; workspace_root?: string; sop_id: string; role_bindings?: Record<string, string | string[]>; load_from_snail?: boolean },
    { workspace: Dto.WorkspaceDto; issue: Dto.IssueDto; stage: Dto.StageDetail; conversation: Dto.ConversationDto }
  >;
  "GET /api/workspaces/:workspaceId": ApiEndpointDef<
    { workspaceId: string },
    never,
    never,
    Dto.WorkspaceDetailDto | null
  >;
  "GET /api/workspaces/:workspaceId/stages": ApiEndpointDef<
    { workspaceId: string },
    never,
    never,
    Dto.StageDetailDto[]
  >;
  "GET /api/workspaces/:workspaceId/issues": ApiEndpointDef<
    { workspaceId: string },
    never,
    never,
    Dto.IssueDetailDto[]
  >;
  "GET /api/workspaces/:workspaceId/conversations": ApiEndpointDef<
    { workspaceId: string },
    never,
    never,
    Dto.ConversationDetailDto[]
  >;

  // ── Snail Config ──
  "POST /api/workspaces/detect-snail": ApiEndpointDef<
    never,
    never,
    { workspace_root: string },
    { has_snail: boolean; config: { name: string; summary?: string; default_sop_key?: string } | null }
  >;
  "POST /api/workspaces/:workspaceId/load-snail": ApiEndpointDef<
    { workspaceId: string },
    never,
    never,
    { success: boolean; message: string }
  >;

  // ── SOP ──
  "GET /api/sops": ApiEndpointDef<
    never,
    { source?: "platform" | "workspace" },
    never,
    Dto.SopDto[]
  >;
  "GET /api/sops/:sopId": ApiEndpointDef<
    { sopId: string },
    never,
    never,
    Dto.SopDetailDto
  >;
  "POST /api/sops": ApiEndpointDef<
    never,
    never,
    { key: string; name: string; description?: string; first_stage?: string; shared_handbook?: string; stage_definitions: Dto.SopStageDefinitionInputDto[]; transitions?: Dto.SopTransitionDto[] },
    Dto.SopDto
  >;
  "PATCH /api/sops/:sopId": ApiEndpointDef<
    { sopId: string },
    never,
    { name?: string; description?: string; first_stage?: string; shared_handbook?: string; stage_definitions?: Dto.SopStageDefinitionInputDto[]; transitions?: Dto.SopTransitionDto[] },
    Dto.SopDto
  >;
  "DELETE /api/sops/:sopId": ApiEndpointDef<
    { sopId: string },
    never,
    never,
    { affected_workspaces: string[] }
  >;
  "GET /api/workspaces/:workspaceId/sops": ApiEndpointDef<
    { workspaceId: string },
    never,
    never,
    Dto.WorkspaceSopDto[]
  >;
  "POST /api/workspaces/:workspaceId/sops": ApiEndpointDef<
    { workspaceId: string },
    never,
    { sop_id: string; is_default?: boolean; role_bindings?: Record<string, string> },
    Dto.WorkspaceSopDto
  >;
  "PATCH /api/workspaces/:workspaceId/sops/:sopId": ApiEndpointDef<
    { workspaceId: string; sopId: string },
    never,
    { is_default?: boolean; role_bindings?: Record<string, string> },
    Dto.WorkspaceSopDto
  >;
  "DELETE /api/workspaces/:workspaceId/sops/:sopId": ApiEndpointDef<
    { workspaceId: string; sopId: string },
    never,
    never,
    undefined
  >;

  // ── Issue ──
  "POST /api/workspaces/:workspaceId/issues": ApiEndpointDef<
    { workspaceId: string },
    never,
    { title: string; summary?: string; adopted_sop_id?: string },
    Dto.CreateIssueResult
  >;
  "GET /api/issues/:issueId": ApiEndpointDef<
    { issueId: string },
    never,
    never,
    Dto.IssueDetailDto
  >;
  "GET /api/issues/:issueId/stages": ApiEndpointDef<
    { issueId: string },
    never,
    never,
    Dto.StageDetailDto[]
  >;
  "GET /api/issues/:issueId/conversations": ApiEndpointDef<
    { issueId: string },
    never,
    never,
    Dto.ConversationDetailDto[]
  >;
  "POST /api/issues/:issueId/advance": ApiEndpointDef<
    { issueId: string },
    never,
    { target_stage_key?: string },
    Dto.AdvanceIssueResult
  >;
  "POST /api/issues/:issueId/bounce-stage": ApiEndpointDef<
    { issueId: string },
    never,
    { target_stage_key: string },
    Dto.AdvanceIssueResult
  >;
  "PATCH /api/issues/:issueId/task-anchor": ApiEndpointDef<
    { issueId: string },
    never,
    { task_anchor: string },
    Dto.IssueDto
  >;
  "PATCH /api/issues/:issueId/role-snail": ApiEndpointDef<
    { issueId: string },
    never,
    { stage_id: string; role_name: string; snail_template_id: string },
    Dto.IssueDto
  >;
  "POST /api/issues/:issueId/complete": ApiEndpointDef<
    { issueId: string },
    never,
    never,
    { issue: Dto.IssueDto; cleanup: Dto.RepoCleanupResult }
  >;
  "POST /api/issues/:issueId/archive": ApiEndpointDef<
    { issueId: string },
    never,
    never,
    { issue: Dto.IssueDto; cleanup: Dto.RepoCleanupResult }
  >;
  "GET /api/issues/:issueId/stage-suggestion": ApiEndpointDef<
    { issueId: string },
    never,
    never,
    Dto.StageSuggestion | null
  >;
  "POST /api/issues/:issueId/confirm-stage-suggestion": ApiEndpointDef<
    { issueId: string },
    never,
    never,
    Dto.AdvanceIssueResult
  >;
  "POST /api/issues/:issueId/reject-stage-suggestion": ApiEndpointDef<
    { issueId: string },
    never,
    never,
    { ok: true }
  >;

  // ── Stage ──
  "GET /api/stages/:stageId": ApiEndpointDef<
    { stageId: string },
    never,
    never,
    Dto.StageDetailDto
  >;
  "PATCH /api/stages/:stageId": ApiEndpointDef<
    { stageId: string },
    never,
    { status?: Dto.StageStatus; entered_at?: string; left_at?: string; gate_evidence?: { items: { checklistId: string; status: "passed" | "failed" | "skipped"; evidence: string }[]; preparedAt: string; preparedBy: string } | null; output_artifacts?: Record<string, unknown> },
    Dto.StageDetailDto
  >;
  "GET /api/stages/:stageId/conversations": ApiEndpointDef<
    { stageId: string },
    never,
    never,
    Dto.ConversationDetailDto[]
  >;

  // ── Conversation ──
  "POST /api/issues/:issueId/stages/:stageId/conversations": ApiEndpointDef<
    { issueId: string; stageId: string },
    never,
    { workspace_id: string; title: string; kind: Dto.ConversationKind; from_conversation_ids?: string[]; summary?: string },
    Dto.ConversationDto
  >;
  "GET /api/conversations/:conversationId": ApiEndpointDef<
    { conversationId: string },
    never,
    never,
    Dto.ConversationDetailDto
  >;

  // ── Message ──
  "GET /api/conversations/:conversationId/messages": ApiEndpointDef<
    { conversationId: string },
    { limit?: number; offset?: number },
    never,
    Dto.MessageDto[]
  >;
  "GET /api/conversations/:conversationId/messages/page": ApiEndpointDef<
    { conversationId: string },
    { limit?: number; offset?: number; before?: string },
    never,
    Dto.MessagePageDto
  >;
  "GET /api/conversations/:conversationId/messages/recent": ApiEndpointDef<
    { conversationId: string },
    { limit?: number },
    never,
    Dto.RecentMessagesSnapshot
  >;
  "GET /api/conversations/:conversationId/events": ApiEndpointDef<
    { conversationId: string },
    { after_event_id?: number },
    never,
    { items: Dto.MessageEventDto[] }
  >;
  "POST /api/conversations/:conversationId/messages/by-ids": ApiEndpointDef<
    { conversationId: string },
    never,
    { message_ids: number[] },
    Dto.MessageDto[]
  >;
  "GET /api/conversations/:conversationId/messages/window": ApiEndpointDef<
    { conversationId: string },
    { anchor_message_id: number; before?: number; after?: number },
    never,
    { items: Dto.MessageDto[] }
  >;
  "GET /api/conversations/:conversationId/dispatch-state": ApiEndpointDef<
    { conversationId: string },
    never,
    never,
    Dto.ConversationDispatchState
  >;
  "GET /api/conversations/:conversationId/boss-mentions": ApiEndpointDef<
    { conversationId: string },
    never,
    never,
    Dto.BossMentionItem[]
  >;
  "POST /api/conversations/:conversationId/boss-mentions/ack": ApiEndpointDef<
    { conversationId: string },
    never,
    never,
    Dto.BossMentionItem[]
  >;
  "GET /api/conversations/:conversationId/history/search": ApiEndpointDef<
    { conversationId: string },
    { query: string; limit?: number; offset?: number },
    never,
    Dto.ConversationHistorySearchPage
  >;
  "POST /api/conversations/:conversationId/messages": ApiEndpointDef<
    { conversationId: string },
    never,
    { content?: string; events?: Array<{ kind: "text" | "content_block"; payload: unknown }>; from_role?: string; producer_role?: string; quoted_message_id?: number; asker_role?: string; client_id?: string },
    { messageIds: number[] }
  >;
  "POST /api/conversations/:conversationId/messages/:messageId/interrupt": ApiEndpointDef<
    { conversationId: string; messageId: number },
    never,
    never,
    { interrupted: boolean }
  >;
  "POST /api/conversations/:conversationId/messages/:messageId/approve-tool": ApiEndpointDef<
    { conversationId: string; messageId: number },
    never,
    { approved: boolean },
    { approved: boolean; status: "retrying" | "denied" }
  >;

  // ── Evolution ──
  "GET /api/evolution/items": ApiEndpointDef<
    never,
    { workspace_id?: string; issue_id?: string; query?: string; limit?: number; offset?: number },
    never,
    Dto.EvolutionItemDto[]
  >;
  "GET /api/workspaces/:workspaceId/evolution/items": ApiEndpointDef<
    { workspaceId: string },
    { issue_id?: string; query?: string; limit?: number; offset?: number },
    never,
    Dto.EvolutionItemDto[]
  >;
  "GET /api/evolution/items/:itemId": ApiEndpointDef<
    { itemId: string },
    never,
    never,
    Dto.EvolutionItemWithConversationDto | null
  >;
  "POST /api/evolution/items": ApiEndpointDef<
    never,
    never,
    { title: string; content: string; workspace_id: string; tags?: string[]; metadata?: string },
    Dto.EvolutionItemWithConversationDto
  >;
  "PATCH /api/evolution/items/:itemId": ApiEndpointDef<
    { itemId: string },
    never,
    { issue_id?: string; title?: string; content?: string; tags?: string[]; metadata?: string },
    Dto.EvolutionItemWithConversationDto
  >;

  // ── Knowledge Library ──
  "GET /api/knowledge/items/summary": ApiEndpointDef<never, never, never, Record<string, number>>;
  "GET /api/knowledge/items": ApiEndpointDef<
    never,
    { scope?: "global" | "workspace"; workspace_id?: string; limit?: number; offset?: number },
    never,
    Dto.KnowledgeEntryDto[]
  >;
  "GET /api/knowledge/items/search": ApiEndpointDef<
    never,
    { q: string },
    never,
    Dto.KnowledgeEntryDto[]
  >;
  "GET /api/knowledge/items/:id": ApiEndpointDef<
    { id: string },
    never,
    never,
    Dto.KnowledgeEntryDto
  >;

  // ── Lobby ──
  "GET /api/lobby/sessions": ApiEndpointDef<never, never, never, Dto.LobbySessionDto[]>;
  "GET /api/lobby/sessions/:sessionId": ApiEndpointDef<
    { sessionId: string },
    never,
    never,
    { session: Dto.LobbySessionDto; messages: Dto.LobbyMessageDto[] }
  >;
  "GET /api/lobby/sessions/:sessionId/messages": ApiEndpointDef<
    { sessionId: string },
    { limit?: number; offset?: number },
    never,
    Dto.LobbyMessageDto[]
  >;
  "POST /api/lobby/sessions/:sessionId/reset": ApiEndpointDef<
    { sessionId: string },
    never,
    never,
    Dto.LobbySessionDto
  >;
  "DELETE /api/lobby/sessions/:sessionId": ApiEndpointDef<
    { sessionId: string },
    never,
    never,
    undefined
  >;

  // ── Meta ──
  "GET /api/meta/prompts": ApiEndpointDef<never, never, never, Dto.PromptDto[]>;
  "GET /api/meta/skills": ApiEndpointDef<never, never, never, Dto.SkillDto[]>;
  "GET /api/snail-den": ApiEndpointDef<never, never, never, Dto.SnailDenTemplateDto[]>;
  "GET /api/meta/mcps": ApiEndpointDef<never, { workspace_root?: string }, never, Dto.McpServerDto[]>;

  // ── Role ──
  "GET /api/roles": ApiEndpointDef<never, never, never, Dto.RoleDto[]>;
};
```

#### 4. WebSocket 协议类型

```typescript
// ws-protocol.ts
import type { RealtimeConversationEvent } from "../agent/interface";
import type { StageSuggestion } from "../shared/domain-types";

// ── Client → Server ──
export interface WsSendMessage {
  type: "send_message";
  content?: string;
  events?: Array<{ kind: "text" | "content_block"; payload: unknown }>;
  from_role?: string;
  producer_role?: string;
  quoted_message_id?: number;
  asker_role?: string;
  client_id?: string;
}

export type WsClientMessage = WsSendMessage;

// ── Server → Client ──
export interface WsAgentEvent {
  type: "agent_event";
  conversation_id: string;
  event: RealtimeConversationEvent;
}

export interface WsError {
  type: "error";
  error: string;
  hint?: string;
  client_id?: string;
}

export interface WsConversationBadge {
  type: "conversation_badge";
  payload: {
    conversation_id: string;
    issue_id: string | null;
    stage_id: string | null;
    boss_pending_count: number;
  };
}

export interface WsStageSuggestion {
  type: "stage_suggestion";
  payload: StageSuggestion;
}

export type WsServerMessage =
  | WsAgentEvent
  | WsError
  | WsConversationBadge
  | WsStageSuggestion;
```

#### 5. 类型安全 API Client

```typescript
// src/web/services/api-client.ts — 替换现有的 api.ts
import type { ApiEndpoints } from "../../api-contracts";

type EndpointKey = keyof ApiEndpoints;

// 类型安全的 API 调用函数——无 as 断言
export async function api<K extends EndpointKey>(
  endpoint: K,
  options?: {
    params?: ApiEndpoints[K]["params"] extends never ? never : ApiEndpoints[K]["params"];
    query?: ApiEndpoints[K]["query"] extends never ? never : ApiEndpoints[K]["query"];
    body?: ApiEndpoints[K]["body"] extends never ? never : ApiEndpoints[K]["body"];
  }
): Promise<ApiEndpoints[K]["response"]> {
  // 运行时拆分 method 和 path，不用 as 断言
  const spaceIdx = endpoint.indexOf(" ");
  if (spaceIdx === -1) throw new Error(`Invalid endpoint format: ${endpoint}`);
  const method = endpoint.slice(0, spaceIdx);
  let path = endpoint.slice(spaceIdx + 1);

  // 替换路径参数
  if (options?.params) {
    for (const [key, value] of Object.entries(options.params)) {
      path = path.replace(`:${key}`, encodeURIComponent(String(value)));
    }
  }

  // 拼接 query string
  if (options?.query) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== null) qs.set(key, String(value));
    }
    const qsStr = qs.toString();
    if (qsStr) path += `?${qsStr}`;
  }

  const fetchOptions: RequestInit = { method };
  if (options?.body) {
    fetchOptions.headers = { "Content-Type": "application/json" };
    fetchOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(`/api${path}`, fetchOptions);
  // 204 无 body，直接返回。DELETE 等 endpoint 的 TResponse 为 undefined，类型匹配。
  if (response.status === 204) return undefined!;
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || data?.message || "Request failed");
  return data;
}
```

使用示例——编译期类型安全：

```typescript
// 正确用法——类型从 endpoint 契约一路流到组件
const issues = await api("GET /api/workspaces/:workspaceId/issues", {
  params: { workspaceId: "abc" }
});
// issues 的类型是 IssueDetailDto[]，编译器知道它有哪些字段

const result = await api("POST /api/issues/:issueId/advance", {
  params: { issueId: "123" },
  body: { target_stage_key: "design" }
});
// result 的类型是 AdvanceIssueResult

// 编译错误示例——错误的 path
await api("GET /api/nonexistent"); // 编译报错：不在 ApiEndpoints 中

// 编译错误示例——缺少必填 body
await api("POST /api/workspaces/:workspaceId/issues", {
  params: { workspaceId: "abc" },
  body: {} // 编译报错：title 是必填字段
});
```

### P2 详设

#### 前端类型统一入口

```typescript
// src/web/types.ts — 前端唯一的类型来源
// 实体枚举类型（不退化为 string）
export type {
  RoleName, MessageRole, MessageStatus, StageStatus,
  ConversationKind, ConversationStatus, WorkspaceModule,
  ConversationOwnerType, StageType,
} from "../shared/domain-types";

// API DTO（API 响应的精确形状）
export type {
  WorkspaceDto, WorkspaceSummaryDto, WorkspaceDetailDto,
  IssueDto, IssueDetailDto, CreateIssueResult, AdvanceIssueResult,
  StageDto, StageDetailDto,
  ConversationDto, ConversationDetailDto,
  MessageDto, MessagePageDto, RecentMessagesSnapshot,
  SopDto, SopDetailDto, WorkspaceSopDto, SopStageDefinitionInputDto, SopTransitionDto,
  EvolutionItemDto, EvolutionItemWithConversationDto,
  KnowledgeEntryDto,
  LobbySessionDto, LobbyMessageDto,
  PromptDto, SkillDto, SnailDenTemplateDto, McpServerDto, RoleDto,
  StageSuggestion, RepoCleanupResult,
  BossMentionItem, ConversationDispatchState, ConversationHistorySearchPage,
} from "../api-contracts/dto";

// WebSocket 协议
export type {
  WsServerMessage, WsClientMessage,
  WsAgentEvent, WsError, WsConversationBadge, WsStageSuggestion,
} from "../api-contracts/ws-protocol";

// 前端 UI 专用类型（纯展示逻辑，不来自 API）
export interface ToastMessage {
  id: string;
  type: "success" | "error" | "info";
  text: string;
}
```

#### 消除清单

以下前端局部 interface 需要删除，替换为从 `../types` 导入的 DTO：

| 文件 | 删除的 interface | 替换为 |
|------|-----------------|--------|
| `conversationStore.ts` | `Message`, `Stage`, `Conversation` 及所有数据状态 | 删除——messages 迁移到 TanStack Query 缓存，store 只保留 `wsStatus` 和 `composerDraft` |
| `ConversationView.tsx` | `Message`, `Stage`, `Conversation`, `Role`, `RuntimeUsage` | `MessageDto`, `StageDto`, `ConversationDto`, `RoleDto` |
| `WorkspaceBoard.tsx` | `Issue`, `Stage`, `Workspace` | `IssueDetailDto`, `StageDetailDto`, `WorkspaceDetailDto` |
| `AppShell.tsx` | `Workspace`, `Issue` | `WorkspaceSummaryDto`, `IssueDto` |
| `StageActions.tsx` | `Stage`, `Issue`, `Transition` | `StageDetailDto`, `IssueDto`, `SopTransition` |
| `ContextPanel.tsx` | `Workspace`, `Issue`, `Conversation`, `Participant` | `WorkspaceSummaryDto`, `IssueDto`, `ConversationDetailDto` |
| `WorkspaceTree.tsx` | `Workspace` | `WorkspaceSummaryDto` |
| `MessageRenderer.tsx` | `ContentBlock`（20+ optional fields） | 使用 discriminated union `MessageEventPayload` |
| `EvolutionCenter.tsx` | `EvolutionItem` | `EvolutionItemDto` |
| `KnowledgeLibrary.tsx` | `KnowledgeEntry` | `KnowledgeEntryDto` |
| `SopCenter.tsx` | `Sop`, `SopStageDefinition` | `SopDto`, `SopDetailDto` |
| `WorkspaceConfig.tsx` | `Sop`, `StageDefinition`, `Role` | `SopDetailDto`, `StageDetailDto`, `RoleDto` |
| `Lobby.tsx` | `LobbySession`, `SessionMessage` | `LobbySessionDto`, `LobbyMessageDto` |
| `PromptCenter.tsx` | `Prompt` | `PromptDto` |
| `SkillCenter.tsx` | `Skill` | `SkillDto` |
| `SnailDen.tsx` | `Template` | `SnailDenTemplateDto` |
| `McpCenter.tsx` | `McpServer` | `McpServerDto` |
| `BossMentionsBanner.tsx` | `BossMention` | `BossMentionItem` |
| `StageSuggestionBanner.tsx` | `StageSuggestion` | `StageSuggestion` |
| `ConversationSource.tsx` | `ConversationSource` | `ConversationDto` |
| `useWebSocket.ts` | `WebSocketMessage` | `WsServerMessage` |

### P3 详设

#### 可检验性机制

**编译期检验**：TypeScript 编译器自然提供。如果前端代码引用了 DTO 上不存在的字段，编译失败。如果后端新增了 endpoint 但 `ApiEndpoints` 中没有声明，前端无法调用（无入口）。

**覆盖率检验**（可选的 CI 脚本）：

```typescript
// scripts/check-api-coverage.ts
// 扫描 src/web/ 中所有 api("METHOD /path") 调用
// 与 ApiEndpoints 的 key 列表对比
// 输出：已覆盖 / 未覆盖的 endpoint 列表
```

这使得"前端重构后遗漏了哪些后端能力"变成一个可自动检测的问题。

### P4 详设

#### 1. TypeScript strict mode 真正生效

消除所有 `any` 逃逸口，按优先级排序：

| 逃逸口 | 位置 | 消除方式 |
|--------|------|---------|
| `api()` 返回 `any` | `services/api.ts` | 被 P1 的类型安全 `api-client.ts` 替代，返回值类型从 `ApiEndpoints` 推导 |
| `response.json()` 返回 `any` | `services/api.ts` | 同上，`api-client.ts` 内部显式 cast 为 `ApiEndpoints[K]["response"]` |
| `[key: string]: unknown` 索引签名 | `conversationStore.ts` 的 `Message` | 删除，`Message` 改用 `MessageDto`，所有字段有明确类型 |
| `as` 类型断言 | `useWebSocket.ts`（`event.message_id as number` 等） | 用 discriminated union `WsServerMessage` 替代 `WebSocketMessage`，编译器自动 narrow |
| `catch` 静默吞错 | `WorkspaceBoard.tsx` `.catch(() => {})` | 至少 log error；关键路径上抛出或展示 toast |
| `updateMessage` 签名矛盾 | `conversationStore.ts`（`id: string`）vs `useWebSocket.ts`（`id: number`） | 统一为 `number`（与 `MessageDto.id` 一致） |

#### 2. 引入 TanStack Query

**安装**：`@tanstack/react-query`、`@tanstack/react-query-devtools`

**QueryClient 配置**：

```typescript
// src/web/queries/client.ts
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,         // 30 秒内不重复请求
      refetchOnWindowFocus: true, // 切回窗口时刷新
    },
  },
});

// 不同查询域的 stale 策略差异（通过 queryOptions 覆盖默认值）：
// - workspace/issue 元数据：staleTime: 60_000（变化不频繁）
// - 消息列表：staleTime: 0（实时性要求高，但 WebSocket 推送会主动更新缓存）
// - meta（prompt/skill/mcp）：staleTime: 300_000（几乎不变）
```

**Query Key 工厂**——queries、mutations、WebSocket handler 统一引用，避免 key 结构不一致导致缓存静默失效：

```typescript
// src/web/queries/keys.ts
export const queryKeys = {
  workspaces: {
    all: ["workspaces"] as const,
    list: (query?: { limit?: number; offset?: number }) => ["workspaces", query] as const,
    detail: (id: string) => ["workspaces", id] as const,
    issues: (id: string) => ["workspaces", id, "issues"] as const,
    stages: (id: string) => ["workspaces", id, "stages"] as const,
    conversations: (id: string) => ["workspaces", id, "conversations"] as const,
    sops: (id: string) => ["workspaces", id, "sops"] as const,
    evolution: (id: string) => ["workspaces", id, "evolution"] as const,
  },
  issues: {
    detail: (id: string) => ["issues", id] as const,
    stages: (id: string) => ["issues", id, "stages"] as const,
    conversations: (id: string) => ["issues", id, "conversations"] as const,
  },
  conversations: {
    detail: (id: string) => ["conversations", id] as const,
    messages: (id: string) => ["conversations", id, "messages"] as const,
  },
  sops: {
    all: ["sops"] as const,
    list: (source?: string) => ["sops", { source }] as const,
    detail: (id: string) => ["sops", id] as const,
  },
  evolution: {
    list: (filters?: Record<string, unknown>) => ["evolution", filters] as const,
    detail: (id: string) => ["evolution", id] as const,
  },
  knowledge: {
    list: (filters?: Record<string, unknown>) => ["knowledge", filters] as const,
    search: (q: string) => ["knowledge", "search", q] as const,
  },
  lobby: {
    sessions: ["lobby", "sessions"] as const,
    detail: (id: string) => ["lobby", id] as const,
  },
  meta: {
    prompts: ["meta", "prompts"] as const,
    skills: ["meta", "skills"] as const,
    mcps: (root?: string) => ["meta", "mcps", root] as const,
    snailDen: ["meta", "snail-den"] as const,
  },
  roles: ["roles"] as const,
};
```

**核心模式**：用 `queryOptions` 工厂函数将 API 契约与查询绑定，类型从 `ApiEndpoints` 一路流到组件：

```typescript
// src/web/queries/workspace.queries.ts
import { queryOptions } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "./keys";

export const workspaceQueries = {
  list: (query?: { limit?: number; offset?: number }) =>
    queryOptions({
      queryKey: queryKeys.workspaces.list(query),
      queryFn: () => api("GET /api/workspaces", { query }),
    }),

  detail: (workspaceId: string) =>
    queryOptions({
      queryKey: queryKeys.workspaces.detail(workspaceId),
      queryFn: () => api("GET /api/workspaces/:workspaceId", { params: { workspaceId } }),
    }),

  issues: (workspaceId: string) =>
    queryOptions({
      queryKey: queryKeys.workspaces.issues(workspaceId),
      queryFn: () => api("GET /api/workspaces/:workspaceId/issues", { params: { workspaceId } }),
    }),
};
```

组件中使用：

```typescript
// WorkspaceBoard.tsx — 类型自动推导
const { data: issues } = useQuery(workspaceQueries.issues(workspaceId));
// issues 的类型是 IssueDetailDto[] | undefined，编译器知道每个字段
```

**目录结构**：

```
src/web/queries/
├── keys.ts                 # query key 工厂（queries/mutations/WebSocket handler 统一引用）
├── client.ts               # QueryClient 实例配置
├── workspace.queries.ts    # workspace + issue + stage 查询
├── conversation.queries.ts # conversation + message 查询
├── sop.queries.ts          # SOP 查询
├── evolution.queries.ts    # evolution 查询
├── knowledge.queries.ts    # knowledge 查询
├── lobby.queries.ts        # lobby 查询
├── meta.queries.ts         # prompt/skill/mcp/snail-den 查询
└── index.ts                # barrel export
```

**每个页面的手写 `useState`+`useEffect`+`api()` 模式全部替换为 `useQuery`/`useMutation`。**

**Mutation 模式**——写操作（创建/修改/删除）使用 `useMutation` + 查询缓存失效：

```typescript
// src/web/mutations/issue.mutations.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api-client";
import { queryKeys } from "../queries/keys";

export function useCreateIssue(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; summary?: string; adopted_sop_id?: string }) =>
      api("POST /api/workspaces/:workspaceId/issues", { params: { workspaceId }, body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.issues(workspaceId) });
    },
  });
}

export function useAdvanceIssue(issueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body?: { target_stage_key?: string }) =>
      api("POST /api/issues/:issueId/advance", { params: { issueId }, body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.stages(issueId) });
    },
  });
}
```

组件中使用：

```typescript
// WorkspaceBoard.tsx — 替代 prompt() + 手动 fetch
const createIssue = useCreateIssue(workspaceId);

function handleCreateIssue() {
  // 打开 shadcn/ui Dialog，zod 校验输入
  // Dialog 提交时：
  createIssue.mutate({ title, summary }, {
    onSuccess: () => setOpen(false),
  });
}
```

**Mutation 模块目录结构**（与 queries 平行）：

```
src/web/mutations/
├── workspace.mutations.ts    # createWorkspace, loadSnail
├── issue.mutations.ts        # createIssue, advance, bounce, complete, archive, taskAnchor, roleSnail
├── conversation.mutations.ts # createConversation, sendMessage, interrupt, approveTool
├── sop.mutations.ts          # createSop, updateSop, deleteSop, bindWorkspaceSop
├── evolution.mutations.ts    # createEvolutionItem, updateEvolutionItem
├── knowledge.mutations.ts    # createKnowledgeEntry, updateKnowledgeEntry（预留）
└── index.ts                  # barrel export
```

#### 3. 引入 zod 做运行时 schema 校验

**安装**：`zod`

**用途**：在 API 边界做运行时校验，与 TypeScript 类型双向推导。

```typescript
// src/api-contracts/validators.ts — 共享的运行时校验 schema
// 类型统一从 shared/domain-types.ts 导入，不从 zod 推导——避免双重定义
import { z } from "zod";
import type { ConversationKind, StageStatus, MessageRole } from "../shared/domain-types";

// 运行时值数组——与 shared 类型的字面量值一一对应，但只在此处维护字面量列表
export const CONVERSATION_KINDS: readonly [ConversationKind, ...ConversationKind[]] = [
  "discussion", "planning", "design", "implementation", "review", "bugfix"
];
export const ConversationKindSchema = z.enum(CONVERSATION_KINDS);

export const STAGE_STATUSES: readonly [StageStatus, ...StageStatus[]] = [
  "in_progress", "completed", "cancelled"
];
export const StageStatusSchema = z.enum(STAGE_STATUSES);

export const MESSAGE_ROLES: readonly [MessageRole, ...MessageRole[]] = [
  "user", "assistant", "system"
];
export const MessageRoleSchema = z.enum(MESSAGE_ROLES);

// API 响应的运行时校验（可选，用于关键路径的防御性编程）
export const MessageDtoSchema = z.object({
  id: z.number(),
  conversation_id: z.string(),
  role: MessageRoleSchema,
  status: z.string(),
  created_at: z.string(),
  // ... 完整字段（实施时从 MessageDto 完整展开）
});

// 使用方式：
// import type { ConversationKind } from "../types";  ← 类型从 types.ts 导入
// import { ConversationKindSchema } from "../api-contracts/validators";  ← schema 从 validators 导入
// 两处引用的是同一个类型，schema 的值与类型的字面量值一一对应
```

**使用场景**：
- 前端表单输入校验（替代原生 `prompt()`）
- WebSocket 消息的运行时类型守卫（替代 `as` 断言）
- API 响应的防御性校验（关键路径可选启用）

#### 4. Zustand store 修复 + WebSocket 与 TanStack Query 集成

**核心变化：messages 从 store 迁移到 TanStack Query 缓存，store 只保留纯客户端状态。**

```typescript
// src/web/stores/conversationStore.ts — 修复后，只保留纯客户端状态
interface ConversationState {
  wsStatus: "connecting" | "connected" | "disconnected";
  setWsStatus: (status: "connecting" | "connected" | "disconnected") => void;
  composerDraft: string;                     // composer 输入草稿（纯 UI 状态）
  setComposerDraft: (draft: string) => void;
  clear: () => void;  // 重置 wsStatus + 清空 composerDraft（切换 conversation 时调用）
}
// messages、currentStage、currentConversation 全部删除
// messages → TanStack Query 缓存（conversation.queries.ts）
// currentStage、currentConversation → 来自路由 loader，不需要 store
```

**WebSocket 实时事件 → TanStack Query 缓存更新**：

```typescript
// src/web/hooks/useWebSocket.ts — 修复后
import { useQueryClient } from "@tanstack/react-query";

export function useWebSocket(conversationId: string) {
  const queryClient = useQueryClient();
  // ...
  // 收到 agent_event 时，更新 TanStack Query 缓存而不是 store
  function handleAgentEvent(event: WsAgentEvent) {
    if (event.event.type === "message_started") {
      const startedEvent = event.event;
      queryClient.setQueryData(
        queryKeys.conversations.messages(conversationId),
        (old: MessageDto[] | undefined) => [...(old ?? []), {
          id: startedEvent.message_id,
          conversation_id: conversationId,
          client_id: startedEvent.client_id ?? null,
          from_role: startedEvent.role_name ?? null,
          to_roles: [],
          role: startedEvent.role,
          quoted_message_id: null,
          context_cutoff_at: "",
          runtime: null,
          status: startedEvent.status,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          events: [],
          quoted_message: null,
        }]
      );
    }
    if (event.event.type === "message_event_appended") {
      const appendedEvent = event.event;
      queryClient.setQueryData(
        queryKeys.conversations.messages(conversationId),
        (old: MessageDto[] | undefined) => old?.map(m =>
          m.id === appendedEvent.message_id
            ? { ...m, events: [...(m.events ?? []), appendedEvent.event] }
            : m
        )
      );
    }
    if (event.event.type === "message_status_changed") {
      const statusEvent = event.event;
      queryClient.setQueryData(
        queryKeys.conversations.messages(conversationId),
        (old: MessageDto[] | undefined) => old?.map(m =>
          m.id === statusEvent.message_id
            ? { ...m, status: statusEvent.status }
            : m
        )
      );
    }
    // message_context_updated、permission_required 同理
  }
}
```

**WebSocket 重连策略**：保留现有 `useWebSocket.ts` 的指数退避重连（exponential backoff）。重连后自动 backfill——TanStack Query 缓存中的消息可能已过期，重连时应调用 `conversationQueries.messages(conversationId)` 的 `refetch()` 刷新缓存，而不是仅靠 WebSocket backfill 事件。

**middleware 引入**：
- `devtools`：开发环境的 Redux DevTools 集成，方便调试状态变化

#### 5. shadcn/ui 统一

**原则：删除所有手写 CSS，shadcn/ui + Tailwind 是唯一的样式来源。**

**步骤**：

1. 删除 `src/web/styles/` 目录下全部 27 个 CSS 文件
2. 删除 `src/web/styles.css`（27 个 `@import` 的聚合文件）
3. 从 shadcn/ui 补全所需组件（按实际使用频率排序）：

| 组件 | 替代 |
|------|------|
| `dialog` | 替代原生 `prompt()` 弹窗 |
| `select` | 替代原生 `<select>` |
| `dropdown-menu` | 替代手写下拉菜单 |
| `tabs` | 替代手写 tab 切换 |
| `toast` / `sonner` | 替代手写 Toast 组件 |
| `sheet` | 替代手写侧边抽屉 |
| `popover` | 替代手写弹出层 |
| `command` | 替代手写搜索/命令面板 |
| `scroll-area` | 替代手写滚动容器 |
| `separator` | 替代手写分隔线 |
| `skeleton` | 替代手写加载占位 |
| `avatar` | 替代手写头像 |
| `tooltip` | 替代手写 tooltip |

4. 安装 `lucide-react`（已在 `components.json` 中配置但未安装）
5. 所有页面的 `className="task-board-panel"` 等手写类名替换为 Tailwind utility classes
6. **design tokens 迁移**：`src/web/styles/tokens.css` 中的 CSS custom properties 迁移为 Tailwind v4 的 `@theme` 配置（写入 `globals.css`）：

```css
/* src/web/globals.css — Tailwind v4 @theme 替代 tokens.css */
@import "tailwindcss";

@theme {
  /* 从 tokens.css 逐个迁移，保持变量名一致 */
  --color-primary: #f97316;
  --color-bg-main: #0b1120;
  --color-bg-card: #111827;
  --color-border: #1e293b;
  --color-text-primary: #f1f5f9;
  --color-text-secondary: #94a3b8;
  /* ... tokens.css 中所有颜色、间距、字体、阴影变量 */
}
```

迁移后删除 `tokens.css`。Tailwind utility classes 通过 `bg-primary`、`text-text-primary` 等方式引用这些 token。

#### 6. React Router v7 loader 模式

**原则：用 loader 替代组件内的 `useState`+`useEffect` 数据获取。**

```typescript
// src/web/router.tsx — 替代 App.tsx 中的扁平 Routes（13 个路由 + 1 个 404）
import { createBrowserRouter, type LoaderFunctionArgs } from "react-router-dom";
import { queryClient } from "./queries/client";

// 类型安全的 loader 参数提取——不依赖 as 断言或 ! 非空断言
function requireParams(loaderArgs: LoaderFunctionArgs, ...keys: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = loaderArgs.params[key];
    if (!value) throw new Response(`Missing param: ${key}`, { status: 400 });
    result[key] = value;
  }
  return result;
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    errorElement: <ErrorBoundary />,
    children: [
      {
        index: true,
        element: <HomePage />,
      },
      {
        path: "ws/new",
        element: <WorkspaceConfig />,
        loader: async () => {
          await queryClient.ensureQueryData(sopQueries.list());
          return null;
        },
      },
      {
        path: "ws/:workspaceId",
        element: <WorkspaceBoard />,
        loader: async (args) => {
          const { workspaceId } = requireParams(args, "workspaceId");
          await Promise.all([
            queryClient.ensureQueryData(workspaceQueries.detail(workspaceId)),
            queryClient.ensureQueryData(workspaceQueries.issues(workspaceId)),
          ]);
          return null;
        },
      },
      {
        path: "ws/:workspaceId/issue/:issueId",
        element: <ConversationLayout />,
        loader: async (args) => {
          const { issueId } = requireParams(args, "issueId");
          await Promise.all([
            queryClient.ensureQueryData(issueQueries.detail(issueId)),
            queryClient.ensureQueryData(issueQueries.stages(issueId)),
          ]);
          return null;
        },
      },
      {
        path: "evolution",
        element: <EvolutionCenter />,
        loader: async () => {
          await queryClient.ensureQueryData(evolutionQueries.list());
          return null;
        },
      },
      {
        path: "knowledge",
        element: <KnowledgeLibrary />,
        loader: async () => {
          await queryClient.ensureQueryData(knowledgeQueries.list());
          return null;
        },
      },
      {
        path: "sops",
        element: <SopCenter />,
        loader: async () => {
          await queryClient.ensureQueryData(sopQueries.list());
          return null;
        },
      },
      {
        path: "snail-den",
        element: <SnailDen />,
        loader: async () => {
          await queryClient.ensureQueryData(metaQueries.snailDen());
          return null;
        },
      },
      {
        path: "prompts",
        element: <PromptCenter />,
        loader: async () => {
          await queryClient.ensureQueryData(metaQueries.prompts());
          return null;
        },
      },
      {
        path: "skills",
        element: <SkillCenter />,
        loader: async () => {
          await queryClient.ensureQueryData(metaQueries.skills());
          return null;
        },
      },
      {
        path: "mcps",
        element: <McpCenter />,
        loader: async () => {
          await queryClient.ensureQueryData(metaQueries.mcps());
          return null;
        },
      },
      {
        path: "lobby",
        element: <Lobby />,
        loader: async () => {
          await queryClient.ensureQueryData(lobbyQueries.sessions());
          return null;
        },
      },
      {
        path: "*",
        element: <NotFound />,
      },
    ],
  },
]);
```

**`main.tsx` 改造**——`QueryClientProvider` + `RouterProvider` + 全局 `Toast`：

```typescript
// src/web/main.tsx — 改造后
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { RouterProvider } from "react-router-dom";
import { queryClient } from "./queries/client";
import { router } from "./router";
import { Toast } from "./components/Toast";

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Toast />              {/* 全局 Toast，不受路由影响 */}
      <RouterProvider router={router} />
      <ReactQueryDevtools /> {/* 开发环境 */}
    </QueryClientProvider>
  );
}
```

**效果**：
- `params` 类型从 `useParams()` 的 `string | undefined` 变为 loader 参数中的明确 `string`
- 数据在组件渲染前已就绪，无 loading 状态闪烁
- `errorElement` 提供路由级错误处理
- `<Toast />` 在 `RouterProvider` 外层，全局可用（WebSocket 断连通知等）

#### 7. 消息乐观更新模式

聊天界面的核心 UX：用户发消息后立即显示，不等服务器确认。

```typescript
// src/web/mutations/conversation.mutations.ts
export function useSendMessage(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SendMessageBody) =>
      api("POST /api/conversations/:conversationId/messages", { params: { conversationId }, body }),

    // 乐观更新：立即插入临时消息
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.conversations.messages(conversationId) });
      const previous = queryClient.getQueryData<MessageDto[]>(queryKeys.conversations.messages(conversationId));
      const optimisticMessage: MessageDto = {
        id: Date.now(),           // 临时 ID，服务端会返回真实 ID
        conversation_id: conversationId,
        client_id: body.client_id ?? null,
        from_role: body.from_role ?? null,
        to_roles: [],
        role: "user",
        quoted_message_id: body.quoted_message_id ?? null,
        context_cutoff_at: "",
        runtime: null,
        status: "streaming",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        content: body.content,
        events: body.events ?? [],
        quoted_message: null,
      };
      queryClient.setQueryData(
        queryKeys.conversations.messages(conversationId),
        (old: MessageDto[] | undefined) => [...(old ?? []), optimisticMessage]
      );
      return { previous };
    },

    // 失败回滚
    onError: (_err, _body, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.conversations.messages(conversationId), context.previous);
      }
    },

    // 成功后用服务端数据刷新（替换临时 ID）
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.messages(conversationId) });
    },
  });
}
```

#### 8. 统一 loading/error 状态模式

```typescript
// src/web/components/QueryState.tsx — 统一的 loading/error 渲染
import { Skeleton } from "@/components/ui/skeleton";

interface QueryStateProps<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
  children: (data: T) => React.ReactNode;
  skeleton?: React.ReactNode;  // 自定义 loading 骨架
}

export function QueryState<T>({ data, isLoading, error, children, skeleton }: QueryStateProps<T>) {
  if (isLoading) return <>{skeleton ?? <Skeleton className="h-48 w-full" />}</>;
  if (error) return <div className="p-4 text-destructive">加载失败：{error.message}</div>;
  if (data === undefined) return null;
  return <>{children(data)}</>;
}

// 使用示例：
function WorkspaceBoard() {
  const { workspaceId } = useParams() as { workspaceId: string };
  const { data: issues, isLoading, error } = useQuery(workspaceQueries.issues(workspaceId));
  return (
    <QueryState data={issues} isLoading={isLoading} error={error} skeleton={<BoardSkeleton />}>
      {(issues) => <IssueList issues={issues} />}
    </QueryState>
  );
}
```

#### 9. 原生 `prompt()` 替换

```typescript
// 当前（WorkspaceBoard.tsx line 89）：
const title = prompt("Issue 标题")?.trim();

// 替换为 shadcn/ui Dialog + zod 校验：
const [createIssueOpen, setCreateIssueOpen] = useState(false);
// Dialog 内使用 zod schema 校验输入
// 通过 useMutation 提交，自动 invalidate 查询缓存
```

## 生效路径

1. **`src/api-contracts/endpoints.ts`**：所有 API 契约的单一真相来源。后端新增/修改 endpoint 时必须同步更新此文件。
2. **`src/api-contracts/dto/*.dto.ts`**：所有 API 响应类型的单一真相来源。后端 handler 的 `res.json()` 返回值必须符合 DTO 类型。
3. **`src/web/services/api-client.ts`**：前端唯一的 API 调用入口。替换现有的 `api.ts`。
4. **`src/web/types.ts`**：前端唯一的类型导入入口。所有组件从这里导入，不从 `../shared/` 或自行定义。
5. **`src/api-contracts/ws-protocol.ts`**：WebSocket 消息的唯一类型来源。替换 `useWebSocket.ts` 中的 `{ type: string; [key: string]: unknown }`。
6. **`src/web/queries/*.queries.ts`**：每个查询用 `queryOptions` 工厂函数绑定 API 契约，组件通过 `useQuery(queries.xxx())` 消费。
7. **`src/web/router.tsx`**：路由定义从 `App.tsx` 的扁平 `Routes` 迁移到 `createBrowserRouter` + loader 模式。
8. **`src/api-contracts/validators.ts`**：zod schema 作为运行时校验的单一来源，`z.infer<>` 推导静态类型。
9. **`src/web/styles/`**：删除。所有样式由 shadcn/ui + Tailwind utility classes 提供。

## 设计约束摘要

- **API 契约是前后端之间的唯一耦合点**：前端重构只改变"用哪些 DTO、怎么渲染"；后端重构只改变"怎么实现"；契约层是不变量
- **DTO 基于实体类型 + enrichment 交叉类型**：不重复定义实体字段，用 `Message & { events, content?, quoted_message? }` 表达
- **前端禁止自行定义 API 实体 interface**：所有实体类型必须从 `src/web/types.ts` 导入
- **前端禁止使用 `[key: string]: unknown` 索引签名**：每个字段必须有明确类型
- **前端禁止 union 类型退化为 `string`**：必须使用字面量联合（`MessageRole`、`StageStatus` 等）
- **`ApiEndpoints` 映射表是 endpoint 的完整清单**：新增 endpoint 必须在此声明，否则前端无法调用
- **前端禁止手写 CSS 文件**：`src/web/styles/` 目录删除后，样式只通过 shadcn/ui 组件和 Tailwind utility classes 定义
- **前端禁止 `useState`+`useEffect`+`api()` 手写数据获取**：必须使用 TanStack Query 的 `useQuery`/`useMutation`
- **前端禁止原生 `prompt()`/`alert()`/`confirm()`**：必须使用 shadcn/ui Dialog 组件
- **前端禁止 `as` 类型断言**：必须使用 discriminated union + 类型窄化，或 zod 运行时校验。`!` 非空断言仅允许在 `api-client.ts` 的 204 返回处使用（TypeScript 泛型约束的已知限制）
- **前端 `api()` 函数的返回值必须有静态类型**：不允许 implicit any，不允许手动 cast
- **zod schema 不重复定义类型**：枚举类型的字面量值在 `validators.ts` 中维护运行时数组，类型从 `src/web/types.ts` 导入，不从 `z.infer` 推导出独立的同名类型

<!-- [/design-time] -->

## 改动范围

### 实施顺序

每个步骤完成后应可编译、可回滚：

1. **新建 `src/api-contracts/`**（P1，纯新增，不改现有代码）→ 编译通过即完成
2. **新建 `src/web/types.ts` + `src/web/services/api-client.ts`**（P1-P2 桥梁）→ 替换 `api.ts` → 重写 `api.test.ts`
3. **逐个页面替换局部 interface**（P2，每个页面一个 commit，共 13 个 commit）→ 每个页面的测试同步更新
4. **修复 `conversationStore.ts` + `useWebSocket.ts`**（P4.4，store 缩减 + WebSocket→Query 缓存）→ 重写 `conversationStore.test.ts` + `useWebSocket.test.ts`
5. **删除 `src/web/styles/` + 补全 shadcn 组件 + tokens 迁移**（P4.5，一次性）
6. **引入 TanStack Query：`main.tsx` 改造（QueryClientProvider + RouterProvider + Toast）+ `router.tsx` 新建 + 逐个页面迁移数据获取**（P4.2 + P4.6）→ 重写组件测试（mock QueryClientProvider）
7. **P3 覆盖率脚本 + P4 验证**（收尾检验）→ `npm test` 全部通过

### P1-P3 改动（契约层 + 类型漂移 + 可检验性）

| 目录/文件 | 操作 | 说明 |
|-----------|------|------|
| `src/api-contracts/` | 新增 | 整个目录：endpoints.ts、dto/*.dto.ts、ws-protocol.ts、validators.ts、index.ts |
| `src/web/services/api-client.ts` | 新增 | 类型安全 API client |
| `src/web/services/api.ts` | 删除 | 被 api-client.ts 替代 |
| `src/web/types.ts` | 新增 | 前端统一类型入口 |
| `src/web/stores/conversationStore.ts` | 修改 | 删除局部 interface，导入 DTO；修复 `updateMessage` 签名 |
| `src/web/pages/*.tsx`（13 个页面） | 修改 | 删除局部 interface，导入 DTO，使用 api-client |
| `src/web/components/*.tsx` | 修改 | 删除局部 interface，导入 DTO |
| `src/web/hooks/useWebSocket.ts` | 修改 | 使用 WsServerMessage 类型，删除 `as` 断言 |
| `src/shared/domain-types.ts` | 不改 | 保持不变，DTO 交叉引用它 |
| 后端 route handlers | 不改 | 不改实现，只确保返回值符合 DTO |

### P4 改动（框架归位）

| 目录/文件 | 操作 | 说明 |
|-----------|------|------|
| `package.json` | 修改 | 新增 `@tanstack/react-query`、`@tanstack/react-query-devtools`、`zod`、`lucide-react` |
| `src/web/router.tsx` | 新增 | `createBrowserRouter` + loader 模式，替代 `App.tsx` 的扁平 Routes |
| `src/web/App.tsx` | 删除 | 被 `router.tsx` + `main.tsx` 替代 |
| `src/web/main.tsx` | 重写 | 改为 `QueryClientProvider` + `Toast` + `RouterProvider` + `ReactQueryDevtools` |
| `src/web/queries/*.queries.ts` | 新增 | 7 个查询模块（workspace/conversation/sop/evolution/knowledge/lobby/meta） |
| `src/web/queries/keys.ts` | 新增 | query key 工厂（queries/mutations/WebSocket handler 统一引用） |
| `src/web/queries/client.ts` | 新增 | QueryClient 实例配置 |
| `src/web/styles/` | 删除 | 全部 27 个 CSS 文件删除 |
| `src/web/styles.css` | 删除 | 27 个 `@import` 的聚合文件 |
| `src/web/components/ui/` | 扩展 | 从 4 个组件扩展到 17+ 个（dialog/select/dropdown-menu/tabs/toast/sheet/popover/command/scroll-area/separator/skeleton/avatar/tooltip 等） |
| `src/web/components/ui/icons.tsx` | 新增 | lucide-react 图标统一导出 |
| `src/web/pages/*.tsx`（13 个页面） | 修改 | 所有 `useState`+`useEffect`+`api()` 替换为 `useQuery`；所有手写 CSS 类名替换为 Tailwind；所有 `prompt()` 替换为 Dialog |
| `src/web/stores/conversationStore.ts` | 缩减 | 删除 `messages`/`currentStage`/`currentConversation`/`setMessages`/`appendMessages`/`updateMessage`；只保留 `wsStatus` + `composerDraft` |
| `src/web/hooks/useWebSocket.ts` | 修改 | agent_event 处理从 store 更新改为 `queryClient.setQueryData()` 更新 TanStack Query 缓存 |
| `src/web/globals.css` | 修改 | Tailwind 主题配置（design tokens 从 `tokens.css` 迁移） |
| `src/web/tests/conversationStore.test.ts` | 重写 | store 结构从 messages/currentStage/currentConversation 缩减为 wsStatus/composerDraft，测试全部重写 |
| `src/web/tests/api.test.ts` | 重写 | api 函数从无类型 wrapper 替换为类型安全 api-client，测试全部重写 |
| `src/web/tests/useWebSocket.test.ts` | 重写 | WebSocket 集成从 store 更新改为 queryClient.setQueryData，mock 方式变化 |
| `src/web/tests/ConversationView.test.tsx` | 修改 | 数据获取从 useState+useEffect 改为 useQuery，需 mock QueryClientProvider |
| `src/web/tests/WorkspaceBoard.test.tsx` | 修改 | 同上，需 mock QueryClientProvider + 更新类型 fixture |
| `src/web/tests/StageActions.test.tsx` | 修改 | 局部 interface 替换为 DTO，更新 fixture 数据类型 |
| `src/web/tests/ConversationLayout.test.tsx` | 修改 | 同上 |
| `src/web/tests/AppShell.test.tsx` | 轻改 | 类型导入变化，fixture 数据更新 |
| `src/web/tests/ErrorBoundary.test.tsx` | 不改 | 不涉及 API 类型 |
| `src/web/tests/HomePage.test.tsx` | 不改 | 不涉及 API 类型 |
| `src/web/tests/Toast.test.tsx` | 不改 | 不涉及 API 类型 |

## 验证

### P1 验证

- [ ] `src/api-contracts/endpoints.ts` 编译通过
- [ ] `src/api-contracts/dto/*.dto.ts` 编译通过
- [ ] **每个 DTO 字段与 handler 的 `res.json()` 返回值逐字段人工比对，记录比对结果**——不允许凭空设计 DTO，必须从 handler 代码逆向提取
- [ ] enrichment 字段在 DTO 注释中标注了 handler 中的拼装逻辑位置
- [ ] `src/api-contracts/ws-protocol.ts` 编译通过
- [ ] 类型安全 API client 编译通过，IDE 补全正确显示 endpoint 列表和参数类型
- [ ] `api-client.ts` 内部无 `as` 类型断言

### P2 验证

- [ ] 前端所有页面和组件编译通过（`tsc --noEmit`）
- [ ] 前端不存在任何自行定义的 API 实体 interface（`grep -r "interface.*{" src/web/pages/ src/web/components/ src/web/stores/` 只有 UI 专用类型）
- [ ] 前端不存在 `[key: string]: unknown` 索引签名
- [ ] 前端不存在 `as` 类型断言（除 WebSocket 事件解析外）
- [ ] 所有 union 类型使用字面量联合而非 `string`

### P3 验证

- [ ] CI 脚本可输出"前端已覆盖/未覆盖的 endpoint"清单
- [ ] 已覆盖 endpoint 数量 == `ApiEndpoints` key 总数（100% 覆盖）

### P4 验证

- [ ] `src/web/styles/` 目录不存在，`styles.css` 不存在
- [ ] `grep -rn 'className="task-\|className="workspace-\|className="conversation-\|className="stage-\|className="issue-\|className="lobby-\|className="evolution-\|className="knowledge-\|className="sop-\|className="prompt-\|className="skill-\|className="mcp-' src/web/pages/` 无结果（无手写 CSS 类名；匹配已知的手写类名前缀）
- [ ] `grep -r "prompt(" src/web/` 无结果（无原生 prompt）
- [ ] `grep -r "useState.*api\|useEffect.*api" src/web/pages/` 无结果（无手写数据获取）
- [ ] `grep -rn ' as [A-Z]' src/web/ --include='*.ts' --include='*.tsx'` 结果中无 `as` 类型断言（排除 `as const`、`import type { X as Y }`、注释、以及 `api-client.ts` 的 204 返回处的 `!` 非空断言）——人工审查确认
- [ ] `grep -r "\[key: string\]" src/web/` 无结果（无索引签名）
- [ ] `grep -r "import.*from.*styles" src/web/` 无结果（无手写 CSS 导入）
- [ ] 所有页面数据通过 `useQuery` 获取，loading/error 状态由 TanStack Query 管理
- [ ] 路由使用 `createBrowserRouter` + loader，`App.tsx` 中无 `<Routes>` 声明
- [ ] `main.tsx` 包含 `QueryClientProvider` + `RouterProvider` + `Toast`，无 `BrowserRouter`
- [ ] `lucide-react` 已安装，图标从 `@/components/ui/icons` 导入
- [ ] `tsc --noEmit` 零错误、零 `any` 警告
- [ ] `npm test` 全部通过（11 个测试文件，含重写的 store/api/WebSocket 测试和更新的组件测试）
- [ ] `conversationStore` 中无 `messages`、`currentStage`、`currentConversation` 字段（已迁移到 TanStack Query）
- [ ] `useWebSocket` 中无 store 的 `appendMessage`/`updateMessage` 调用（已改为 `queryClient.setQueryData`）
- [ ] queries、mutations、WebSocket handler 中的 query key 全部引用 `queryKeys` 工厂，无硬编码数组

## 关联

- **前置**: `F2026052003` (UI 架构一步到位重构——本次分析的重构基线)
- **前置**: `F2026060310` (UI 重设计——最近一次 UI 重构)
- **相关**: `F2026052907` (evolution-center-ui-fix-and-create——UI 重构遗漏功能的典型案例)
- **相关**: `F2026050805` (UI 重构回归修复——UI 重构引入回归的典型案例)
- **相关**: `F2026051307` (模块结构重构——模块边界问题的早期识别)

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|-----------|------|------|
| 1 | DTO 与实体类型的关系：是复制还是交叉引用？ | 交叉引用（`Message & { enrichment }`），不复制实体字段。实体类型定义在 `src/shared/` 不变，DTO 在 `src/api-contracts/dto/` 中用交叉类型表达 API 层的 enrichment。 | 2026-06-05 |
| 2 | 是否引入 OpenAPI/Swagger 代码生成？ | 否。前后端在同一 monorepo 内，直接手写 TypeScript 类型比维护 YAML schema + 代码生成工具链更简单、更可控。 | 2026-06-05 |
| 3 | 是否同时引入 TanStack Query？ | **是。** 初版方案只做契约层，但分析发现框架机制被全面浪费——手写 `useState`+`useEffect`+`api()` 模式是 `any` 逃逸口之一，也是每次 UI 重构功能遗漏的温床（数据获取逻辑散落在每个组件中，重构时容易丢）。TanStack Query 与类型安全 API client 天然配合，必须一起引入。 | 2026-06-05 |
| 4 | 前端 MessageRenderer 的 `ContentBlock` 类型如何处理？ | 删除现有的 20+ optional fields 的 `ContentBlock` interface，替换为 `src/shared/message-types.ts` 的 discriminated union（`MessageTextBlock`、`MessageMarkdownBlock` 等）。`extractMessageContent` 函数的映射逻辑保留但类型化。 | 2026-06-05 |
| 5 | 路径参数的类型安全如何实现？ | 从 endpoint key 字符串（`"GET /api/workspaces/:workspaceId"`）中提取参数名，映射到 `{ workspaceId: string }` 类型。编译期保证 params 对象的 key 与 path 中的 `:param` 一致。 | 2026-06-05 |
| 6 | 27 个手写 CSS 文件是否值得全部删除？ | 是。手写 CSS 与 Tailwind/shadcn 并存导致两套样式系统无边界，每次 UI 重构都产生样式回归。shadcn/ui 的组件自带样式和无障碍约束，Tailwind utility classes 提供布局灵活性，两者组合已覆盖所有需求。删除手写 CSS 是一次性成本，换来的是样式系统的单一来源。 | 2026-06-05 |
| 7 | React Router loader 模式是否必须？ | 是。当前 `BrowserRouter`+`Routes` 模式下，数据获取在组件内部（`useEffect`），组件渲染时数据未就绪导致 loading 闪烁。loader 模式让数据在路由匹配后、组件渲染前就绪，与 TanStack Query 的 `ensureQueryData` 配合可实现零闪烁导航。同时 loader 的 `params` 有明确类型，消除了 `useParams()` 的 `string \| undefined` 问题。 | 2026-06-05 |
| 8 | zod 是否必须引入？ | 是。当前前端无任何运行时校验——原生 `prompt()` 接受任意输入，WebSocket 消息用 `as` 断言跳过类型检查。zod 提供 schema 定义与 TypeScript 类型的双向推导（`z.infer<>`），一份 schema 同时满足编译期类型检查和运行时校验。与 TanStack Query 的 `queryFn` 配合可在 API 响应边界做防御性校验。 | 2026-06-05 |
| 9 | conversationStore 是否保留 messages 状态？ | **不保留。** messages 迁移到 TanStack Query 缓存。WebSocket `agent_event` 通过 `queryClient.setQueryData()` 直接更新查询缓存。store 缩减为纯客户端状态（`wsStatus` + `composerDraft`）。理由：如果 store 和 Query 缓存同时管理 messages，会出现双重数据源，同步成本高且容易不一致。 | 2026-06-05 |
| 10 | DTO 提取方法论：凭空设计还是从 handler 逆向？ | **必须从 handler 逆向提取。** 每个 DTO 字段必须在 handler 的 `res.json()` 调用中有对应赋值。不允许凭空设计 DTO——否则 TypeScript 类型变成"类型幻觉"（编译器认为安全，运行时形状不匹配）。 | 2026-06-05 |
| 11 | query key 如何保证 queries/mutations/WebSocket 三处一致？ | **集中定义 `queryKeys` 工厂**（`src/web/queries/keys.ts`）。所有 query、mutation、WebSocket handler 的 `setQueryData`/`invalidateQueries` 调用必须引用 `queryKeys`，禁止硬编码数组。P4 验证增加"无硬编码 query key"检查。 | 2026-06-05 |
| 12 | zod schema 与 TypeScript 类型如何保持单一真相来源？ | **类型从 `shared/domain-types.ts` 导出，zod schema 从 `validators.ts` 导出但不推导类型。** `validators.ts` 中维护运行时字面量数组（如 `CONVERSATION_KINDS`），数组元素类型标注为 shared 的类型（如 `ConversationKind`），保证值与类型同源。前端代码 `import type` 从 `types.ts` 导入类型，`import` 从 `validators.ts` 导入 schema——两者引用同一类型，不会出现双重定义。 | 2026-06-05 |
| 13 | `!` 非空断言的使用边界？ | **仅允许在 `api-client.ts` 的 204 返回处使用 `undefined!`。** 这是 TypeScript 泛型约束的已知限制——`TResponse = undefined` 时，`return undefined` 无法通过泛型类型检查。设计约束中明确"`as` 类型断言"禁止，`!` 非空断言仅此处例外。 | 2026-06-05 |
| 14 | IM 通道（Feishu/WeCom）是否受契约层约束？ | **不受。** IM 通道走各自平台的消息协议（飞书消息卡片、微信客服消息），不是 JSON REST API，DTO 不覆盖 IM 响应格式。IM 通道通过 `ConversationGateway` 发送消息的输入端受契约约束（`WsSendMessage` 类型），但输出端（平台消息格式）不在范围内。 | 2026-06-05 |
| 15 | 测试文件如何随架构迁移？ | **测试与源码同步更新。** 11 个测试文件中：4 个重写（conversationStore/api/useWebSocket + 涉及 useQuery 的组件测试需 mock QueryClientProvider）、4 个修改（类型 fixture 更新）、3 个不改。每个实施步骤的 commit 必须同时包含源码和测试变更，`npm test` 全部通过作为每个步骤的验收条件。 | 2026-06-05 |
| 16 | 消息发送的乐观更新模式？ | **使用 `useMutation` 的 `onMutate` + `onError` 回滚模式。** 用户发消息后立即插入临时消息（临时 ID），服务端返回后 `onSettled` 触发 `invalidateQueries` 刷新缓存替换临时 ID。失败时 `onError` 回滚到 `onMutate` 保存的前一状态。 | 2026-06-05 |
| 17 | loading/error 状态的统一渲染模式？ | **`QueryState` 组件封装 `useQuery` 的 `isLoading`/`error`/`data` 三态。** 使用 shadcn/ui `Skeleton` 做 loading 骨架，`text-destructive` 做 error 展示。每个页面用 `<QueryState>` 包裹，避免重复手写 loading/error 分支。 | 2026-06-05 |
| 18 | WebSocket 重连后如何与 TanStack Query 缓存同步？ | **保留现有指数退避重连策略。重连后主动 `refetch()` 消息查询，不仅依赖 WebSocket backfill。** 理由：WebSocket backfill 只补推送期间的增量事件，而 `refetch()` 获取完整最新状态，两者互补。重连 → refetch → 后续增量事件通过 `setQueryData` 追加。 | 2026-06-05 |
