---
id: F2026060602
title: architecture-review
from_ids: [F2026051307]
tags: [architecture, refactor, review]
modules: [all]
doc_kind: spec
---

# F2026060602 架构审视：代码架构与模块质量评审

## 背景

Snail Shell 经过多次迭代，模块数量已增长到 18 个后端模块 + 1 个前端 SPA。随着功能叠加，部分模块出现 God Class、职责混杂、代码重复和边界违反等架构债务。本次审视基于 main 分支最新代码（`129f2527`），对全部模块的架构层级、依赖关系、边界清晰度、内聚耦合进行系统评估。

## 目标

1. 建立全模块质量基线：明确每个模块的内聚/耦合/SRP 评分
2. 识别结构性架构债务并按优先级排序
3. 追溯核心业务场景中的不合理代码和多版本残留
4. 为后续渐进式重构提供明确的改进路线图
5. 实施 P0 改进项（结构性债务修复）

## 非目标

1. 不评估测试覆盖率或运行时性能
2. 不评估 `.meta/` 提示词体系的质量
3. 不实施 P1-P3 改进项（留待后续 feature）

## 设计

### 全景模块清单与分层

```
Layer 0 (零依赖叶子):     skill-center, feature-chain
Layer 1 (基础设施):        shared (类型), persistence (数据), logger, llm, mcp, bin
Layer 2 (能力构建):        roles, prompt-center, snail-den, agent
Layer 3 (协作引擎):        message-bus, workspace-workflow
Layer 4 (接入层):          interaction-entry, lobby, evolution-center, api-contracts
Layer 5 (前端):            web (React SPA)
```

### 跨模块依赖全景

```
shared        ← 几乎所有模块
persistence   ← 几乎所有模块 (含 logger)
agent         ← message-bus, prompt-center, snail-den, mcp, evolution-center, api-contracts
message-bus   ← workspace-workflow, evolution-center, interaction-entry
workspace-workflow ← interaction-entry, lobby
lobby         ← interaction-entry (lobby-aware-channel, server, lobby-routes)
interaction-entry ← lobby (router.ts)
```

依赖方向基本正确。存在一组模块间循环引用：`lobby ↔ interaction-entry`（lobby/router.ts 导入 interaction-entry/gateway，interaction-entry 的多个文件导入 lobby/types、lobby/session-store）。其余模块依赖图是有向无环图。

### 模块质量评分

| 模块 | 内聚 | 耦合 | SRP | 评分 |
|------|------|------|-----|------|
| shared | 中 | 低 | 部分 | 3/5 |
| skill-center | 高 | 零 | 是 | 5/5 |
| feature-chain | 高 | 零 | 是 | 5/5 |
| llm | 高 | 低 | 是 | 5/5 |
| snail-den | 高 | 中 | 是 | 4/5 |
| mcp | 高 | 低 | 是 | 4/5 |
| logger | 高 | 低 | 是 | 4/5 |
| lobby | 高 | 中 | 是 | 4/5 |
| agent/utilities | 高 | 低 | 是 | 4/5 |
| agent/implementations | 中 | 高 | 否 | 2/5 |
| persistence/sub-modules | 高 | 低 | 是 | 4/5 |
| persistence/store | 低 | 高 | 否 | 2/5 |
| persistence/file-config | 低 | 中 | 否 | 2/5 |
| workspace-workflow/叶子模块 | 高 | 零 | 是 | 4/5 |
| workspace-workflow/manager.ts | 低 | 高 | 否 | 2/5 |
| message-bus | 中 | 高 | 否 | 3/5 |
| interaction-entry/api | 低 | 高 | 否 | 2/5 |
| prompt-center | 中 | 高 | 部分 | 3/5 |
| evolution-center | 中 | 中 | 部分 | 3/5 |
| api-contracts | 高 | 中 | 是 | 4/5 |
| web | 高 | 低 | 是 | 4/5 |

### 核心架构问题（按严重程度排序）

#### 问题 1：God Class 集群

| Class | 文件 | 行数 | 方法签名 | 直接跨模块依赖 |
|-------|------|------|----------|---------------|
| ConversationStore | persistence/store.ts | 671 | ~82（含 private） | 4（shared, logger, feature-chain, persistence 子模块） |
| FileConfigStore | persistence/file-config-store.ts | 729 | ~114（含 private） | 2（shared, logger） |
| WorkspaceManager | workspace-workflow/manager.ts | 538 | ~41 | 7（logger, message-bus x3, evolution-center, shared, agent） |

**ConversationStore** 同时承担 DB 生命周期、Workspace/Issue/Stage/Conversation/Message CRUD、SOP 管理（代理给 FileConfigStore）、Evolution/Knowledge Library CRUD（代理给子 Model）、Feature Chain 索引重建，以及 45 个纯透传方法（35 个到 fileConfigStore + 4 个到 evolution + 6 个到 knowledgeLibrary，均为 `return this.xxx.method()` 委托调用）。其直接跨模块导入仅 4 个（shared、logger、feature-chain、persistence 子模块），但作为 facade 它聚合了 persistence 下 13 个子模块的完整 API 表面，任何消费方都通过它访问全部持久化能力。

**WorkspaceManager** 覆盖 9 个业务域：workspace CRUD、issue 生命周期、conversation 管理、消息发送与中断、SOP 管理、evolution center、knowledge library、stage suggestions、query 委托。其内部已部分分解为 `manager-detail.ts`、`manager-queries.ts`、`manager-events.ts`、`manager-collaboration.ts` 等辅助模块，但写操作（mutation）逻辑仍全部内联。

**FileConfigStore** 管理 workspace 定义（含缓存）、workspace SOP 绑定、SOP 文件 CRUD、SOP 转换查询与验证、stage/role 定义查询、evolution 配置加载、原子文件写入、workspace root 路径解析。SOP 数据每次访问都从 YAML 重新解析（无缓存）。

#### 问题 2：Agent 模块代码重复

`claude-code.ts`（351 行）与 `claude-code-stateful.ts`（501 行）之间存在 ~130-150 行逐字复制的代码。经逐行比对确认的重复方法：

| 方法 | claude-code.ts 行号 | stateful 行号 | 差异 |
|------|---------------------|---------------|------|
| emitEvent | 36-39 | 54-57 | 仅日志前缀字符串不同 |
| logStdoutLine | 41-43 | 59-61 | 仅日志前缀字符串不同 |
| parseStdoutMessage | 45-52 | 63-70 | 完全相同 |
| logStdoutMessage | 54-59 | 72-77 | 仅日志前缀字符串不同 |
| handleAssistantMessage | 61-76 | 373-408 | 结构相同，stateful 提取了子方法 |
| handleResultMessage | 78-113 | 410-447 | 完全相同 |
| handleIgnoredMessage | 115-120 | 449-454 | 仅日志前缀字符串不同 |
| writeStdin | 308-319 | 456-467 | 完全相同 |
| readOutput (核心循环) | 241-299 | 288-334 | 结构相同 |
| captureStderr | 301-306 | 234-239 | 完全相同 |
| isOutputEvent | 347-350 | 496-499 | 完全相同 |

真正不同的部分仅 5 处：session resume 支持、`--no-session-persistence` 标志、输入构建策略（stateless transcript vs incremental messages）、invokeMessage 入参组装、sendUserMessage 的 systemReminder 包装方式。

附加重复：
- JSONC 解析器在 `guard-config.ts:275-341` 和 `mcp-config.ts:322-380` 中各实现了一套功能等价的手写 parser
- 4 个 agent 实现的 `invokeMessage` 方法都复制了相同的 capability 注入前导序列（`ensureMcpServers + ensureSkillSymlinks + writeGuardConfig + buildContextEnv`）

#### 问题 3：interaction-entry/api/server.ts God File

677 行的文件同时包含 Express app 创建、WebSocket server 管理、12+ 路由组、内联业务逻辑（approve-tool handler），从 12 个外部模块导入。是系统中扇出最大的单一文件。

#### 问题 4：边界与层级违反

| 严重程度 | 违反类型 | 位置 | 详情 |
|----------|----------|------|------|
| **严重** | Persistence 嵌入业务逻辑 | evolution-model.ts:18-63 | `create` 方法在一个事务内创建 issue+stage+conversation，硬编码 SOP key `"evolution"`、stage key `"development"`、中文字符串 `'治理对话'`/`'演进执行者'`，绕过标准工作流生命周期 |
| **严重** | AgentRuntime 跨边界泄漏 | shared/types.ts → 8+ 模块 | Agent 内部实现命名（`-cli` 后缀）定义在 shared 层，prompt-center/message-bus/persistence/workspace-workflow 直接依赖，SnailDen 封装失效 |
| **中等** | message-bus 深入 agent 内部 | collaboration.ts | 直接依赖 agent/permission-store、agent/message-flow-logger、agent/runtime-error |
| **中等** | message-protocol 层注入业务逻辑 | message-protocol.ts:96-97 | 在 `invokeRuntimeMessage` 中向 systemPrompt 追加 MCP 指令块，且处理 permission_store 写入（175-185 行）和前端事件发射（185 行） |
| **中等** | server.ts 内联业务逻辑 | server.ts:623-677 | approve-tool handler 查找原始用户消息、提取事件、重新发送触发 agent 重试，这是领域逻辑不是 HTTP 路由 |
| **低** | Agent 反向依赖 Persistence | agent/guard-config.ts | 直接从 persistence/guard-profile-store 导入 GuardProfile 类型 |
| **低** | api-contracts 层泄漏 | lobby.dto.ts, ws-protocol.ts | 契约层从 lobby/types 和 agent/interface 导入 |
| **低** | im-channel 抽象层被破坏 | lobby-aware-channel.ts:9 | 平台无关抽象层直接导入 feishu/streaming-session.ts |
| **低** | 模块间循环依赖 | lobby ↔ interaction-entry | lobby/router.ts 导入 interaction-entry/gateway；interaction-entry 多文件导入 lobby/types、lobby/session-store |

#### 问题 5：重复模式与 DRY 违反

| 重复项 | 位置 | 影响 |
|--------|------|------|
| buildWhere 助手 x2 | evolution-model.ts + knowledge-library-model.ts | 结构相同的动态 WHERE 构建 |
| getMessageContext x2 | message-read-model.ts + message-context-model.ts | 完全相同的实现 |
| Config store 模式 x7 | 7 个 config store（file-config-store 除外） | 相同的构造-缓存-读取模式无共享抽象 |
| Feishu/WeCom config store x2 | 结构克隆 | 不同类型名但相同模式 |
| sendMessage 三层包装 | manager.ts:335-368 | sendMessage→sendStructuredMessage→sendConversationMessage，三入口一实现 |
| `process.cwd()` 路径解析散射 | 15+ 文件、30+ 处调用 | 每个模块独立从 CWD 解析配置/数据路径，`shared/platform-paths.ts` 的 `PLATFORM_ROOT` 仅 1 个消费方，无统一路径解析层 |

### 核心业务场景审视

#### 场景 1：IM 消息 → Agent 响应（8 层路由）

消息从 IM 输入到 agent 响应经过 8 层：

```
IMTransport.onMessage → LobbyAwareChannel.handleInbound → LobbyRouter.processInbound
→ ConversationGateway.sendMessage → WorkspaceManager.sendStructuredMessage
→ collaboration.sendStructuredMessage → drainMessageBus → invokeRoleBatch
```

**发现的问题：**

**回声消除的时序 hack**（lobby-aware-channel.ts:64-72）：`pendingForwardChatId` 是一个为解决竞态条件而存在的 workaround。`gateway.sendMessage` 同步发射 `message_event_appended` 事件，导致 outbound handler 在 `processInbound` 返回之前就触发，此时 `recentForwardedMessages` 尚未填充。这个 hack 将 channel 的正确性耦合到了 gateway 的同步事件发射行为上。

**三层消息发送入口**（manager.ts:335-368）：`sendMessage`（字符串输入）、`sendStructuredMessage`（真正实现）、`sendConversationMessage`（带 try/catch 包装）三个方法指向同一实现。Lobby 走 gateway → sendStructuredMessage，REST API 走 gateway → sendMessage，approve-tool 走直接调 sendStructuredMessage。认知开销高。

**`producer_role` 遗留别名**（server.ts:478, 614）：REST 和 WebSocket 路径都有 `from_role ?? producer_role ?? HUMAN_ROLE_NAME` 的降级逻辑。`producer_role` 是旧版 API 的字段名，未标注 `@deprecated`，在 gateway 的 `ConversationSendInput` 接口中不存在。

**`AgentRuntime` 命名体系跨边界泄漏**：`AgentRuntime`（`"claude-code-cli" | "claude-code-stateful-cli" | "opencode-cli" | "codex-cli"`）定义在 `shared/types.ts`，直接暴露给 8+ 模块（message-bus、prompt-center、persistence、workspace-workflow）。SnailDen 的设计意图是封装 agent runtime 细节，但 `SnailTemplate.runtime` 直接暴露 `AgentRuntime` 类型，导致 prompt 匹配（registry.ts:29）、消息路由（collaboration.ts:43）、评估配置（evaluation-registry.ts:37 硬编码 `["opencode-cli", "claude-code-cli", "codex-cli"]`）全都耦合到 agent 内部实现命名。下游存在另一套 `MessageRuntime`（`"claude" | "opencode" | "codex" | "system" | "unknown"`），两套命名无类型级映射，靠 `normalizeRuntime`（message-protocol.ts:56-62）的运行时字符串匹配桥接。新增 agent runtime 需改动 shared/types、normalizeRuntime、evaluation-registry 等多处。

**drainMessageBus 循环终止条件不充分**（message-bus.ts:45-83）：`while(true)` 循环在 `batches.length === 0` 时退出，`remainingRounds` 递减限制 agent-to-agent 链。但 `selectExecutableBatches`（line 86）在 `remainingRounds <= 0` 时仍允许 1 个 agent batch，且 human-role batches 永远执行（line 89）。若 agent 输出持续生成新的 human-role dispatch 且这些 dispatch 永不被 consumed，循环不会终止。风险不是"无超时"，而是 human dispatch 的无限生成。

**resolveWorkspaceRootForInvocation 每次调用做同步 I/O**（collaboration.ts:372-383）：`existsSync` + `statSync` + `accessSync` 三个同步文件系统操作阻塞事件循环，且 workspace root 在 server 生命周期内不会变化。

#### 场景 2：Issue 生命周期（创建→阶段推进→完成）

**advanceIssue vs transitionIssueStage 断言不一致（待确认）**：`advanceIssue`（manager.ts:234）调用 `assertStageCanAdvance` 检查 `output_artifacts` 非空，但 `transitionIssueStage`（manager.ts:252）不调用此断言。两者是独立 API 端点（`POST /issues/:id/advance` vs `POST /issues/:id/transition`），语义不同：advance 是自动推进需守卫，transition 是用户显式指定目标可能故意跳过守卫。需确认是 bug 还是设计意图。

**completeIssue vs archiveIssue 断言不一致**：`completeIssue`（manager.ts:291）调用 `assertIssueWritable`，`archiveIssue`（manager.ts:302）不调用。已关闭的 issue 可以被再次 archive。

**is_primary 类型 round-trip**：`StageRoleDefinition.is_primary` 是 `number`（0/1，SQLite 风格），`SopSnapshot.is_primary` 是 `boolean`。`buildSopSnapshot`（workflow.ts:296）做 `Boolean()` 转换，`SopSnapshotReader.expandRole`（sop-snapshot-reader.ts:145）转回 number，`buildStageDetail`（manager-detail.ts:31）再转回 boolean。boolean↔number round-trip 缺乏统一的规范表示。

**"feature" 命名残留**（domain-types.ts:170）：`Sop.first_stage` 的注释写 `"创建 feature 时从此 stage 开始"`，"feature" 是 "issue" 的旧名。

#### 场景 3：Evolution 治理（绕过标准工作流的平行路径）

`EvolutionModel.create()`（evolution-model.ts:18-63）在 persistence 层内嵌了完整的工作流逻辑：
- 直接用 SQL 创建 issue 记录，绕过 `createIssueWorkflow`（无 SOP snapshot、无标准 stage 定义）
- 硬编码 SOP key `"evolution"`、stage key `"development"`
- 硬编码中文字符串 `'治理对话'`、`'演进执行者'`、`'["项目负责人","演进执行者"]'`
- `owner_type: 'evolution'` 被 `assertConversationIssueWritable`（manager-detail.ts:108）豁免写入检查

这是一条完全独立于标准 SOP 驱动生命周期的平行工作流路径。

#### 场景 4：提示词构建与能力注入

**roles/index.ts 虚假所有权**：barrel 文件 re-export 了 `buildConversationSystemPrompt` 和 `buildConversationCapability`（来自 prompt-center），造成 roles 模块"拥有"提示词构建的假象。2 个消费方（manager-collaboration.ts、evolution-prompt.ts）从 `"../roles"` 直接导入这些函数（其余从 roles 导入的是 RoleDefinition 类型和 RoleRegistry 类，这些是 roles 自身的导出）。

**模块级 eager I/O**：`prompt-center/registry.ts:37` 在 import 时执行 `const prompts = buildRegistry()` 扫描 `.meta/prompts/prompts/` 目录。`guard-config.ts:64` 在模块加载时执行 `getDefaultGuardProfile()` 触发文件读取。

**buildStage 模板变量重复**（builder.ts:184-185）：`stage_acceptance_focus_block` 和 `stage_artifact_requirements_block` 都映射同一个 `acceptance_focus` 数组，格式近乎相同。其中一个应映射不同数据源。

**renderList 静默剥离 H2 标题**（registry.ts:100）：`.replace(/^## [^\n]*\n+/, "")` 会移除每个 prompt 的第一个 H2 标题，这是格式化副作用。

### 历史残留与死代码

#### 零调用方法（可直接删除，无行为变化）

| 方法/文件 | 位置 | 状态 |
|-----------|------|------|
| `seedWorkspaceConfigs` | store.ts:177 | `@deprecated`，零调用，始终返回 `{ created: false }` |
| `touchWorkspace` | file-config-store.ts:133 | 零调用，no-op |
| `persistence/message-types.ts` | 整文件 | 零文件导入此模块，完全未使用 |
| `SopSeedItem` 类型 | persistence/types.ts:87 | 仅被 store.ts re-export，零消费方 |
| `findWorkspaceByName` | store.ts:265 | 零外部调用 |
| `getInitialConversationByStage` | store.ts:413 | 零外部调用 |
| `listConversationsByOwner` | store.ts:408 | 零外部调用 |
| `getRoleDefinition` | store.ts:252 | 零外部调用 |
| `refreshConversationSummary` 接线 | manager.ts:437 | 死接线（非死代码）：deps wiring 用 `async () => {}` 空壳替换了 summary-input.ts:14 的真实函数，真实函数仍被 index.ts:31 导出 |
| `createKnowledgeLibraryEntry` | store.ts:280 | 零调用，pass-through 到 knowledgeLibraryModel |
| `updateKnowledgeLibraryEntry` | store.ts:284 | 零调用，pass-through 到 knowledgeLibraryModel |
| `addMessageDispatch` | store.ts:571 | 零调用（含测试） |
| `seedWorkspaceToCache` | store.ts:180 | 零调用 |
| `seedSopToCache` | store.ts:184 | 零调用（JSDoc 标注 "Test helper" 但测试中也无调用） |
| `listRoleDefinitions` | store.ts:253 | 零调用 |

#### 幽灵参数与遗留包装

| 问题 | 位置 | 详情 |
|------|------|------|
| 7 个幽灵 `_conversationId` 参数 | store.ts:465(`addMessageEvent`),490(`completeMessageWithEvent`),508(`upsertMessageContext`),516(`getMessageContext`),522(`getMessageEvents`),576(`rebuildDispatchesForMessage`),584(`updateMessageRouting`) | 调用方始终传入 conversationId 但实现忽略，是从未实现的 per-conversation 作用域的残留 |
| 3 个 `markConversation*` 丢弃参数包装 | store.ts:606-620 | `markConversationDispatchesConsumed`/`Seen`/`Skip` 接受 conversationId 但直接丢弃 |
| `_ignoredInputArtifacts` 防御性剥离 | helpers.ts:50 | `mapStage` 剥离 `input_artifacts` 列，但该列已从 schema 中移除，是 schema 迁移残留 |
| `log-preview.ts` 恒等函数 | agent/log-preview.ts:5-9 | `formatText` 调用 `fullText`，`fullText` 直接 `return text`，零转换 |
| `DEFAULT_SOP_YAML` 硬编码 | snail-loader.ts:131-181 | 50 行 YAML 字符串硬编码为 `code-delivery` 的 fallback，可能与平台 SOP 文件不同步 |
| store.ts 也是 re-export hub | store.ts:30-78,108 | 49 行 `export type { ... } from "./types"` 加 line 108 单独 re-export `StageType`，与 persistence/types.ts 形成三跳链 |
| workspace `created_at` 总是 "now" | file-config-store.ts:678 | `mapWorkspaceEntry` 同时设置 `created_at: now` 和 `updated_at: now`，workspace 创建时间永久丢失 |

#### @deprecated 标记与实际使用矛盾

| 项目 | 位置 | 矛盾 |
|------|------|------|
| `DEFAULT_GUARD_PROFILE` | guard-config.ts:61-64 | 标记 `@deprecated`，但 `resolveGuardProfile`（72, 82-83 行）仍在使用。lazy-load 模式被模块级 eager 赋值（64 行）defeat |

#### 类型系统问题

| 问题 | 位置 | 详情 |
|------|------|------|
| `RoleName = string` | domain-types.ts:64 | 无 nominal typing，与 `string` 完全等价，四层 re-export 无附加安全 |
| `StageType = string` | domain-types.ts:65 | 同上 |
| `is_primary` boolean↔number round-trip | domain-types.ts vs sop-snapshot.ts vs workflow.ts vs sop-snapshot-reader.ts | 无统一规范表示 |

### 测试覆盖风险（已知盲区）

本次审视不评估测试覆盖率（非目标 #2），但需记录：全仓库 69 个测试用例覆盖 18 个模块，核心协作引擎 `collaboration.ts`（554 行）的测试用例约 10 个，`evolution-center`、`lobby`、`snail-den` 模块零测试。测试目录结构不反映 src/ 模块边界（如 message-bus 测试在 `tests/workspace/` 下）。这是已知的架构风险，应在各重构 feature 中同步补充测试。

### 前端架构评估

前端（src/web/）是架构最清晰的部分：

- **分层干净**：pages/ → components/ → hooks/ → services/ → queries/ + mutations/
- **API 契约驱动**：api-client.ts 基于 api-contracts 编译期类型安全，支持可选 Zod 运行时校验
- **React Query 数据层**：queries + mutations 分离，loader 预取
- **URL 路由**：react-router-dom v7，路由定义集中在 router.tsx
- **状态管理**：Zustand 用于 conversationStore，其余靠 React Query

仅有的问题：3 个遗留 .js 文件（sop-center-view.js, sop-detail-view.js, sop-form-view.js）未迁移到 TypeScript。

### shared/ 层审视

shared/ 标榜"所有领域类型在一处定义"，但实际成了类型垃圾场。domain-types.ts（651 行）同时承载 6 类不同职责：

| 职责 | 行数 | 真正消费方 | 是否属于 shared |
|------|------|-----------|----------------|
| 核心实体（Workspace, Issue, Stage, Conversation, Message） | ~200 | 15+ 模块 | 是 |
| SOP/Stage 定义（Sop, SopStageDefinition, TransitionGuard, WorkspaceSop） | ~100 | 5 模块（persistence, workflow, api-contracts） | 否，应归属 persistence |
| 事件系统（15 种 EventPayload + 9 种 MessageEvent 变体） | ~200 | 4 模块（message-bus, persistence, agent, api-contracts） | 边界，可独立为 message-events |
| Input 创建类型（CreateMessageInput, CreateStageInput, CreateConversationInput） | ~60 | 2 模块（persistence, workflow） | 否，应归属 persistence |
| RuntimeBinding / InvocationSubject | ~50 | 3 模块（agent, workspace-workflow, message-bus） | 否，Agent 层泄漏 |
| HUMAN_ROLE_NAME 业务常量 | 1 | 8 模块 | 否，业务常量不属于类型层 |

**应移出 shared/ 的内容：**

| 内容 | 应归属 | 理由 |
|------|--------|------|
| EvolutionItem CRUD 类型 | evolution-center | 只有 3 个消费方，全是 evolution 相关 |
| KnowledgeLibrary CRUD 类型 | evolution-center 或独立模块 | 同上 |
| RuntimeBinding, InvocationSubject | agent/invocation-types | Agent 层内部概念，不是领域类型 |
| AgentRuntime 类型 | agent | Agent 内部实现标识 |
| MessageContextSummaryGenerator | llm | 只有 llm 实现、workflow 消费 |
| HUMAN_ROLE_NAME 常量 | roles | 业务常量不属于类型层 |
| classifyRuntimeError / summarizeRuntimeError | agent 或 message-bus | 只有 2 个相关模块消费 |
| PLATFORM_ROOT / PLATFORM_META | prompt-center | 只有 1 个消费方 |
| Create*Input 类型 | persistence | 只有 persistence 和 workflow 消费 |
| SOP/Stage 定义类型 | persistence/sop-types | 配置层类型，不是运行时共享概念 |

**重构后 shared/ 应只保留：**
- 核心实体（Workspace, Issue, Stage, Conversation, Message）~200 行
- 消息事件协议（MessageEvent, EventPayload, MessageContentBlock）~200 行
- 全局枚举（StageStatus, MessageRole, MessageRuntime 等）~30 行
- SopSnapshot（冻结快照，跨 3 个独立模块）~35 行

总计 ~465 行，比当前 1000+ 行减少一半以上。domain-types.ts 拆分为 shared/domain-types.ts（核心实体 + 枚举）+ shared/message-events.ts（事件协议）+ persistence/sop-types.ts（SOP 定义）+ agent/invocation-types.ts（调用绑定）。

### 值得保持的设计

1. **api-contracts/ 契约层**：前后端编译期类型安全，REST 签名 + DTO + Zod 校验一体
2. **IMTransport 接口设计**：接口本身干净隔离飞书/企业微信平台差异（但 LobbyAwareChannel 实现违反了抽象，直接导入 feishu/streaming-session，见边界违反表）
3. **Agent 抽象**：SnailRuntime / StatelessAgentInvoker / StatefulAgentInvoker 接口设计清晰
4. **SOP Snapshot 机制**：issue 创建时冻结 SOP 模板快照，运行时不受模板变更影响
5. **叶子模块设计优秀**：skill-center, feature-chain, managed-process, conversation-queue, sop-snapshot-reader 等均为高内聚零耦合典范

### 方向正确但需修正的设计

1. **shared/ 类型层**：核心实体和消息事件协议集中定义的方向正确，但当前承载了过多非共享内容（SOP 定义、AgentRuntime、业务常量、CRUD input 类型），需瘦身（见 P1 #10）
2. **模块依赖 DAG**：除 `lobby ↔ interaction-entry` 一组循环外，依赖方向基本正确，需解耦该循环（见风险记录 #4）

以上问题按严重程度排列。以下是按 ROI 和依赖关系组织的改进路线图——先做低风险高收益项，再逐步攻克结构性债务。

### 优先改进路线图

#### P0 — 结构性债务（按 ROI 排序，先做高 ROI 低风险项）

| # | 改进项 | Effort | Risk | Impact | ROI |
|---|--------|--------|------|--------|-----|
| 1 | **提取 ClaudeCodeBase**：将 claude-code.ts 和 claude-code-stateful.ts 的共同 stream protocol 处理提升到共享基类（~130-150 行重复代码） | 低（2 文件改动，零消费方变更） | 低 | 中（消除双文件同步维护） | 高 |
| 2 | **拆解 ConversationStore**：将 35 个透传方法暴露的子 store 直接注入消费方，ConversationStore 只保留 message/stage/conversation 核心 CRUD | 中（消费方改 import 路径） | 中 | 高（消除 God Class） | 中 |
| 3 | **拆解 WorkspaceManager**：按业务域提取 IssueService, SopService, MessageService, WorkspaceService，保留薄 coordination facade | 高（9 域拆分，需同步改多模块） | 高 | 高（消除 God Class） | 中低 |

#### P1 — 边界修正（防止进一步退化，按 effort 从小到大排列）

4. **GuardProfile 类型移入 agent/capability/**：消除 agent → persistence 的反向依赖（GuardProfile 是 agent 能力规格的一部分，不应从 persistence 导入）
5. **FeishuStreamingSession 移到 im-channel/**：消除抽象层违反
6. **EvolutionModel.create() 上移到 evolution-center**：将内嵌的工作流逻辑（issue/stage/conversation 创建、硬编码 SOP key 和中文字符串）从 persistence 层提取到 service 层，复用标准 createIssueWorkflow
7. **api/server.ts 拆分**：路由按域分文件，WebSocket 逻辑独立，approve-tool 业务逻辑上移到 gateway 或 workspace-workflow
8. **collaboration.ts 分层 + message-protocol.ts 清理**：将 agent 调用编排逻辑从 message-bus 提取到 workspace-workflow 或独立 orchestration/ 模块；MCP context 注入上移到 prompt 构建层，permission_store 写入上移到 collaboration 层（两项互相关联，建议连续执行）
9. **shared/ 层瘦身（含 AgentRuntime 封装）**：将 domain-types.ts（651 行）拆分为核心实体 + 消息事件协议 + SOP 定义（移入 persistence）+ 调用绑定（移入 agent）；`AgentRuntime` 从 shared/types.ts 移入 agent 模块内部，SnailTemplate 不再暴露 AgentRuntime，SnailDen 返回 SnailRuntimeInstance 时附带 MessageRuntime，消除 normalizeRuntime 转换层；evolution-types/knowledge-library-types 移回各自业务模块；HUMAN_ROLE_NAME 移入 roles；runtime-error 移入 agent 或 message-bus；PLATFORM_ROOT 移入 prompt-center；Create*Input 移入 persistence（影响 15+ 文件，建议最后执行）

#### P2 — DRY 清理与死代码清除（降低维护成本）

10. 合并两套 JSONC parser 为共享 utility
11. 提取 CapabilityInjector 消除 4 处 agent 注入重复
12. 泛型化 config store 工厂，消除 7 个结构克隆
13. 消除 persistence/types.ts（82 个 re-export）、message-types.ts（零消费方）和 store.ts:30-78（49 行 re-export block）的三跳 re-export 链，消费方直接从 shared/types 导入
14. 清理零调用方法：`seedWorkspaceConfigs`、`touchWorkspace`、`findWorkspaceByName`、`getInitialConversationByStage`、`listConversationsByOwner`、`getRoleDefinition`、`createKnowledgeLibraryEntry`、`updateKnowledgeLibraryEntry`、`addMessageDispatch`、`seedWorkspaceToCache`、`seedSopToCache`、`listRoleDefinitions`
15. 清理幽灵参数：7 个 `_conversationId`、3 个 `markConversation*` 包装
16. 清理遗留代码：`_ignoredInputArtifacts` 剥离、`DEFAULT_GUARD_PROFILE` deprecated 常量、`log-preview.ts` 恒等函数、3 个遗留 .js 文件（664 行）
17. roles/index.ts 移除 prompt-center re-export，消费方直接从 prompt-center 导入

#### P3 — 运行时健壮性

18. `drainMessageBus` 修改 `selectExecutableBatches` 在 `remainingRounds <= 0` 时不再允许新 agent batch，并对 human-role dispatch 增加 TTL 或 dead-letter 机制
19. `resolveWorkspaceRootForInvocation` 缓存检查结果，避免每次调用做同步 I/O
20. `pendingForwardChatId` 时序 hack 改为 gateway 支持异步事件发射
21. workspace `created_at` 总是 "now" 的数据完整性修复（file-config-store.ts:678 的 mapWorkspaceEntry 需区分 created_at 和 updated_at）

## 生效路径

本次评审为一次性架构审计，不直接修改代码或配置。改进路线图中的每一项应作为独立 feature 推进，各自有独立的生效路径（代码重构 + 测试验证 + 模块边界 lint 规则）。

## 设计约束摘要

- **边界**：依赖方向应保持 DAG，当前唯一的循环依赖 `lobby ↔ interaction-entry` 应在后续重构中解耦
- **关键决策**：God Class 拆解应按业务域垂直切分，而非按技术层水平切分
- **非目标约束**：P1-P3 改进项留待后续 feature，本 PR 仅实施 P0
- **语义不变量**：shared/ 只承载真正的跨模块共享类型（核心实体、消息事件协议、全局枚举），业务域类型和层内类型不得为满足单向依赖而放入 shared；api-contracts/ 是前后端唯一契约源

## 改动范围

### 文档
- `docs/features/2026/06/06/F2026060602-architecture-review.md`

### P0 代码实施

**P0 #1 提取 ClaudeCodeBase（已完成）**
- `src/agent/claude-code-base.ts` 新增 344 行
- `src/agent/claude-code.ts` 350→124 行
- `src/agent/claude-code-stateful.ts` 500→181 行
- 净减 201 行

**P0 #2 拆解 ConversationStore（待实施）**
- `src/persistence/store.ts` 移除 45 个透传方法
- 消费方直接注入 `FileConfigStore`、`EvolutionModel`、`KnowledgeLibraryModel`

**P0 #3 拆解 WorkspaceManager（待实施）**
- `src/workspace-workflow/manager.ts` 按业务域提取 Service 类
- 消费方（interaction-entry、lobby）按需依赖具体 Service

## 验证

### 通用

- [x] 所有模块评分基于实际代码审查，非推测
- [x] 问题清单覆盖 persistence、agent、workspace-workflow、interaction-entry、message-bus 五大核心模块及 lobby ↔ interaction-entry 循环依赖
- [x] 改进路线图 P0-P3 分级合理（21 项），P0 按 ROI 排序，P1 按 effort 从小到大排列
- [x] 核心业务场景（消息路由、issue 生命周期、evolution 治理、提示词构建）均已追溯审查
- [x] 死代码、幽灵参数、遗留别名、deprecated 矛盾均已逐项验证

## 关联

- **前置**: F2026051307（模块结构重构 — 建立了当前 8 模块格局的基础）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|-----------|------|------|
| 1 | God Class 拆解是否会引入过多间接层 | 按业务域垂直切分，每个 Service 只覆盖一个域，不会增加层数 | 2026-06-06 |
| 2 | Agent 模块 ClaudeCodeBase 提取的 ROI | ~130-150 行重复代码，每次协议变更需双文件同步修改，提取 ROI 高 | 2026-06-06 |
| 3 | message-bus collaboration.ts 是否应保持现状 | 当前 554 行混合了 5 个不同关注点，应拆分但优先级为 P1 | 2026-06-06 |
| 4 | lobby ↔ interaction-entry 循环依赖如何解耦 | 将 lobby/types 和 lobby/session-store 的类型定义提取为独立的 lobby-types 模块（或移入 api-contracts），切断 interaction-entry → lobby 方向；lobby → interaction-entry/gateway 方向是合理的（命令层依赖接入层） | 2026-06-06 |
| 5 | EvolutionModel.create 是否应重构 | 是。当前在 persistence 层硬编码 SOP key、stage key、中文字符串，绕过标准工作流。应上移到 evolution-center 复用 createIssueWorkflow | 2026-06-06 |
| 6 | drainMessageBus while(true) 是否有风险 | 有。`selectExecutableBatches` 在 remainingRounds<=0 时仍允许 1 个 agent batch，且 human dispatch 永远执行。应修改 batch 选择逻辑并对 human dispatch 增加 dead-letter 机制 | 2026-06-06 |
| 7 | 零调用方法是否可以直接删除 | 是。seedWorkspaceConfigs、touchWorkspace、findWorkspaceByName 等均无外部调用方，删除无行为变化 | 2026-06-06 |
| 8 | shared/ 是否应大幅瘦身 | 是。当前 1000+ 行中约一半不属于共享层。核心实体 + 消息事件协议 + 全局枚举 + SopSnapshot 约 465 行即可。SOP 定义归 persistence、调用绑定归 agent、CRUD 类型归各自业务模块 | 2026-06-06 |
| 9 | P0 执行顺序 | 按 ROI 排序：先 ClaudeCodeBase（低 effort 低 risk），再 ConversationStore（中 effort），最后 WorkspaceManager（高 effort 高 risk） | 2026-06-06 |
| 10 | P1 项依赖关系 | P1 #10（shared/ 瘦身）已合并 AgentRuntime 封装，原独立 P1 #10 取消。P1 各项无强依赖，可并行推进 | 2026-06-06 |
