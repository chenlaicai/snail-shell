---
id: F2026060901
title: v2-init-ddd-api-contract-ui-integration
from_ids:
  - F2026060504
  - F2026060603
tags:
  - init
  - architecture
  - ddd
  - hono
  - api-contracts
  - web
  - react
  - stage
  - issue-collaboration
modules:
  - api-contracts
  - infra-http
  - web
  - issue
  - message
  - workspace
doc_kind: spec
---

# F2026060901 [init] Snail Shell v2 项目初始化：DDD 架构 + Issue 协作 UI 全链路集成

## 背景

`feature/v2-init` 是 Snail Shell v2 的初始化 PR。该 PR 以当前 v2 后端领域模型为权威，保留 `v1` 目录作为历史实现参考，同时建立新的 DDD 分层、HTTP API 契约层和 v2 Web UI 接入链路。

本轮整理重点修正了前期集成中容易回退到旧模型的问题：

- 不再使用旧 UI 的 `conversation` 后端主模型；当前后端以 `Stage` 作为消息/协作容器。
- 不引入 `src/shared` 上帝目录；HTTP DTO 和端点定义统一放在独立 `src/api-contracts`。
- PR375 UI 只复用视觉、布局和组件组织；数据模型、业务流和 API 以当前 v2 后端为准。
- 源码目录下的临时 `ANALYSIS.md` / `DESIGN.md` / `SPEC-V2.md` 设计残留已移除，正式记录沉淀到 `docs/features`。

## 架构边界

### 分层约束

| 层 | 职责 |
|---|---|
| `src/domain/*` | 当前业务模型和端口定义，作为后端权威语义来源 |
| `src/app/*` | 应用用例编排，例如 Issue collaboration runtime |
| `src/infra/http/*` | Hono HTTP routes、DTO 映射、workspace id 编解码 |
| `src/api-contracts/*` | 独立 HTTP DTO / endpoint / validator contract，供前端和后端对齐 |
| `src/web/*` | React + Vite + TanStack Query 前端，按当前 contract 调用 API |
| `v1/*` | 历史实现保留目录，不参与本轮删除 |

### `shared` 禁令

本 PR 明确禁止重新引入 `src/shared`：

- DTO 放 `src/api-contracts`。
- 业务模型放 `src/domain`。
- Web 内部 UI-only 类型保留在 `src/web/types.ts`。
- ESLint 增加规则阻止 `shared` 导入和 `src/shared/**/*` 文件出现。

## 核心模型决策

### Workspace

- 后端仍以 `workspace.path` 作为真实主键语义。
- HTTP URL 中使用 `workspace_id = base64url(workspace.path)`，避免路径直接出现在路由中。
- 新增 `src/infra/http/workspace-id.ts` 提供 `encodeWorkspaceId` / `decodeWorkspaceId` / `toWorkspaceDto`。

### Issue / Stage / Message

- `Issue` 属于 `workspace_path`。
- `Stage` 是 Issue 内的当前协作状态和消息分区。
- `Message` 属于 `stage_id`，流式过程持久化到 `message_event`，终态上下文持久化到 `message_context`。
- 前端 WebSocket 使用 Issue 级连接 `/issue-events?issue_id=...`，事件 payload 携带 `stage_id`，进入新 Stage 不重建页面级实时生命周期。
- HTTP 查询仍以 Stage 读取消息，TanStack Query 作为前端权威缓存；WebSocket 只承载实时增量，重连后通过 API 回补。
- 旧 PR375 中以 `/api/conversations/*` 为中心的 API 不再作为 v2 后端接口。

## API Contract

新增独立契约层：

- `src/api-contracts/dto.ts`：HTTP DTO 类型。
- `src/api-contracts/endpoints.ts`：端点、params、query、body、response 类型映射。
- `src/api-contracts/validators.ts`：前端运行时校验用 Zod schema。
- `src/api-contracts/index.ts`：barrel export。

当前 Web 已接入的主要端点：

```text
GET  /api/workspaces
POST /api/workspaces
GET  /api/workspaces/:workspaceId
GET  /api/workspaces/:workspaceId/issues
POST /api/workspaces/:workspaceId/issues
GET  /api/issues/:issueId
POST /api/issues/:issueId/launch
GET  /api/issues/:issueId/stages
GET  /api/stages/:stageId
GET  /api/stages/:stageId/messages
POST /api/stages/:stageId/messages
GET  /api/stages/:stageId/transition-suggestions
POST /api/stages/:stageId/advance
GET  /api/sops
GET  /api/sops/:sopKey
GET  /api/meta/prompts
GET  /api/meta/skills
GET  /api/meta/mcps
GET  /api/snail-den
GET  /api/knowledge/items
GET  /api/knowledge/items/search
GET  /api/knowledge/items/summary
GET  /api/evolution/items
GET  /api/evolution/items/:itemId
GET  /issue-events?issue_id=...
```

后端额外保留 `/api/snails` 作为兼容读接口，但当前 Web 不依赖它。

## Hono Routes

新增/调整 Hono routes：

- `workspace.route.ts`：workspace list/create 返回带 URL-safe id 的 DTO。
- `issue.route.ts`：Issue / Stage / Message 协作主链路。
- `meta.route.ts`：Prompt、Skill、MCP、SOP、Snail template 只读元数据。
- `knowledge.route.ts`：Knowledge item 查询、搜索、摘要。
- `evolution.route.ts`：Evolution item 查询和详情。
- `app.ts` / `main.ts`：注入当前模块端口并挂载 routes。

## Web UI 集成

Web UI 复用 PR375 视觉和布局，但按 v2 contract 重接数据链路：

- `api-client.ts` 改为端点字面量形式：`api("GET /api/...")`。
- `ConversationLayout` 以 Issue detail 和当前 Stage 驱动页面。
- `ConversationView` 使用 Stage detail/messages，不再调用旧 conversation endpoints。
- `useIssueRealtime(issueId)` 使用 Issue 级 `/issue-events?issue_id=...`，连接状态不再被 Stage 切换窗口误置为长期 reconnecting。
- Message 气泡、发言人、时间、运行时 usage、Context Panel 采用 PR375 风格 token 和布局，同时保持当前后端 DTO/业务模型。
- `StageActions` 和 `StageSuggestionBanner` 使用 Stage advance API。
- `WorkspaceBoard` 创建 Issue 时要求显式选择 SOP，并发送 `adopted_sop_key`。
- `SopCenter` 调整为只读列表/详情。
- `Lobby` 暂保留入口，等待当前 IM domain 正式 HTTP routes。
- `ContextPanel` 中旧的产物编辑和 role-snail 切换写接口未在当前后端提供，已改为只读展示。

## Issue 协作与持久化运行态

本 PR 将 v2 对话链路从 UI/API 接入推进到可运行的 Issue collaboration runtime：

- `issue` / `stage` / `role_snail_assignment` / `message` / `message_event` / `message_context` / `call_signal` 使用 SQLite 持久化。
- Stage 内用户消息会解析 `@角色实例`，生成 call signal 并由 `StageQueue` 串行 drain。
- Agent 回复以 `streaming` message 开始，流式事件实时落库，完成后写入终态 context 并更新 message status。
- `snail_instance` 持久化 stateful runtime session id，避免服务重启后依赖内存 map 恢复会话。
- Stage transition suggestion 由 Agent 输出解析生成，仍需用户确认后通过 Stage advance API 推进。

## ACS Agent Runtime 修复

本 PR 对照 v1 runtime 实现补齐 v2 ACS adapter 的关键调用边界：

- Claude Code / Claude Code Stateful 捕获 stderr、处理非 0 退出码、保留 result 内容、在进程终止后执行 timeout/interruption 检查。
- Codex 首次调用显式使用 `-` 从 stdin 读取 prompt，并对 `developer_instructions` 做 TOML basic string 转义。
- OpenCode 关闭 stdin，避免 `opencode run` 在服务端 spawn 后等待 EOF 导致消息长期 `thinking`。
- OpenCode 兼容 `part.sessionID`，记录 raw output 诊断，并将 runtime 原生 `error` 事件转为明确失败。



## 正式启动链路

v2 Web 本地开发使用两个进程：

- 前端 Vite dev server：`npm run web`，默认 `http://127.0.0.1:5173/`，由 `config/server.yaml` 的 `web_port` 可配置。
- 后端正式入口：`npm start`，默认 `http://localhost:3000/`，由 `config/server.yaml` 的 `port` 可配置。

端口配置统一使用 `config/server.yaml`：后端入口通过 `src/infra/server-config.ts` 解析 `port` 作为监听端口和 MCP endpoint base URL；Web 专用的 `src/web/vite.config.ts` 在 Vite 启动时直接读取 `web_port` 作为前端 dev server 严格端口，并读取 `port` 将 `/api` 与 `/ws` 代理到后端。默认值为 `port: 3000`、`web_port: 5173`；如需修改，复制 `config/server.yaml.example` 为 `config/server.yaml` 并设置对应字段，重启后端和 Vite 即可。


`npm start` 保持正式链路：

```bash
npm run build && node dist/src/main.js
```

为保证编译产物可被 Node 直接运行，`npm run build` 在 `tsc` 后执行 `tsc-alias`，将 TypeScript path aliases 重写为 dist 中的相对路径。同时，ACS runtime loader 只加载真实运行时模块，排除 `.d.ts` declaration 文件，避免编译产物启动时误加载类型声明。

## 禁用的旧 UI 写能力

以下 PR375 旧接口没有在当前 v2 后端中恢复，Web 侧已移除调用或显示不可用提示：

- `/api/conversations/*`
- Issue 归档 / bounce-stage / task-anchor / confirm-stage-suggestion 等旧 Issue-level 写接口
- Workspace `.snail` detect/load 旧接口
- SOP 写接口
- Evolution 写接口
- Prompt detail 旧接口
- Boss mentions 旧接口
- Role/snail reassignment 旧接口
- Stage artifact mutation 旧接口

后续若产品需要这些能力，应在当前 domain/app/infra-http/api-contracts 链路中完整建模，而不是恢复旧 UI 的历史 endpoint。

## 清理结果

已移除源码目录中的临时分析/设计残留文档：

- `src/**/ANALYSIS.md`
- `src/**/DESIGN.md`
- `src/**/SPEC*.md`

保留范围：

- `v1` 目录保留。
- `docs/features` 正式特性文档保留。
- `src/README.md`、业务 TODO 等非本轮临时分析文档保留。

## 全链路检视结果

本轮完成加压检视：

- 前端 `api(...)` 调用与 `src/api-contracts/endpoints.ts` 对齐。
- `src/api-contracts/endpoints.ts` 与 Hono routes 对齐。
- 未发现前端继续调用旧 `/api/conversations/*` 或旧 Issue-level 写接口。
- 未发现 `src/shared` 架构污染；仅业务字段 `shared_handbook` 命中字符串扫描，属于 SOP 业务语义。
- Vitest alias 已补齐 `@api-contracts`，测试期与构建期解析一致。
- Web 测试已更新为 Stage 模型断言。
- Issue 级实时连接、SQLite 消息持久化、stateful snail instance、ACS runtime stdout/stderr/timeout 边界已按 v1 行为复核。

## 验证

已通过：

```bash
npm run build
npm run check
./bin/snail-service restart
```

额外完成 test06 服务侧验证：通过 HTTP API 发送 `@架构师-2 再测试一次，只回复 ok` 后，OpenCode-backed message 正常完成，事件落库为 `step_start` / `text` / `step_finish` / `message_completed`，并持久化 OpenCode session id。

`npm run build:web` 仍有 Vite chunk size warning，属于包体拆分提示，不阻塞当前集成。

## 后续事项

- 如需恢复产物编辑、role-snail 切换、IM Lobby HTTP、SOP/Evolution 写操作，应先补充当前 v2 domain/app/contract，再接 UI。
- Root `tsconfig.json` 当前排除 `src/web`，Web 的类型覆盖主要来自 Vite/Vitest；后续可增加独立 web typecheck 脚本。
