# Issue Conversation 运行态分析（v1 遗留）

> 本文档基于 `v1/` 目录下的遗留代码分析，用于指导 v2 重写。

---

## 一、业务场景

### 1.1 运行态是什么

Issue Conversation 运行态是用户进入 Issue 的 Conversation 后，**发送消息、触发 Agent 协作、接收流式响应**的完整交互循环。这是 Snail Shell 最核心的运行时场景。

核心设计：**事件溯源 + Dispatch 路由 + 协作循环**。用户消息创建 dispatch，drainMessageBus 按目标角色分组调用 Agent，Agent 回复产生新 dispatch，循环直到无 pending dispatch 或达到 round 上限。

### 1.2 核心业务场景

| 场景 | 说明 |
|------|------|
| **用户发送消息** | 用户通过 Web/IM 发送消息，系统解析 mention、路由到目标角色、触发 Agent |
| **Agent 协作循环** | drainMessageBus 迭代处理 dispatch，直到 inbox 为空或 round 耗尽 |
| **流式响应** | Agent 输出通过 event 流实时推送到前端（WebSocket/SSE） |
| **消息中断** | 用户可中断正在 streaming 的 Agent 消息 |
| **工具审批** | Agent 请求权限时，消息变为 pending_approval，用户 approve/deny |
| **Stage 转换检测** | Agent 输出中嵌入 stage_transition 提议，需用户确认 |
| **终端上下文提取** | 消息完成后提取 prompt 可注入的摘要（优先 mcp_final_body） |
| **System Prompt 动态构建** | 每次 Agent 调用时根据 workspace/issue/stage/role 动态组装 prompt |

---

## 二、完整调用链

### 2.1 入口层

```
用户输入
  → ConversationGateway.sendMessage()
    → normalizeInput() → 校验事件类型（仅 text/content_block）
    → 规范化 fromRole, clientId, quotedMessageId
  → WorkspaceManager.sendStructuredMessage()
    → shutdown guard → 拒绝关闭中的请求
    → write guard → assertConversationIssueWritable → 校验 issue 未关闭
    → ConversationQueue.enqueue(conversationId, ...) → 串行化
```

### 2.2 协作编排层

```
sendStructuredMessageWithCollaboration(deps, conversationId, normalizedInput)
  |
  |-- Phase A: 持久化用户消息
  |   1. 校验 conversation 存在，events 非空
  |   2. 捕获 contextCutoffAt = latestMessageId（上下文边界）
  |   3. resolveMentions() → 结构化 mention 提取（或 LLM 兜底）
  |   4. resolveMessageToRoles() → 目标角色路由
  |      → 显式 @mention > askerRole > latestRespondingRole > default_role
  |   5. store.addMessage() → 创建 message + dispatch（每个目标角色一个）
  |   6. appendEvents() → start event + content events + completed signal
  |   7. buildTerminalMessageContext() → 持久化终端上下文
  |   8. emit message_started, message_event_appended, message_status_changed
  |
  |-- Phase B: 消息总线排空
  |   → drainMessageBus(store, handlers, invokeRoleBatch)
  |
  |-- Phase C: 后处理
  |   → refreshConversationSummary()（安全，错误不阻塞）
  |   → 返回所有 messageIds
```

### 2.3 消息总线排空（drainMessageBus）

```
drainMessageBus(store, handlers, invokeRoleBatch)
  |
  while (true) {
    |-- batches = getPendingInboxBatches()
    |     → 按 to_role 分组 pending dispatch
    |     → 每个 batch 有 contextCutoffMessageId（最大 message ID）
    |
    |-- if (batches.length === 0) return
    |
    |-- executableBatches = selectExecutableBatches(batches, remainingRounds)
    |     → 人类角色（项目负责人）：跳过 dispatch，发 boss mention 通知
    |     → remainingRounds <= 0：强制 default_role，mentionAllowed=false，forcedWrapUp=true
    |
    |-- settled = await Promise.allSettled(batches.map(processBatch))
    |     → 并行执行多个角色 batch
    |
    |-- decrement remainingRounds（每个 agent batch -1）
    |-- MAX_COLLABORATION_ROUNDS = 30
  }
```

### 2.4 单角色 Agent 调用（invokeRoleBatch）

```
invokeRoleBatch(deps, batch)
  |
  |-- Step 1: 解析调用上下文
  |   → resolveInvocationContext()
  |     → 加载 conversation, stage, issue
  |     → 解析 active role definition（必须有 snail_template_id）
  |     → resolveRuntimeByRole() → 查询 Snail Den 获取运行时对象
  |     → buildConversationSystemPrompt() → 构建 system prompt
  |     → 查找或创建 SnailAgentSession
  |
  |-- Step 2: 构建运行时输入
  |   → getRecentMessages() → 最近 3 条消息作为历史
  |   → 构建 inbox prompt events（role:\n<context> 格式）
  |   → resolveEffectiveSystemReminder() → hash 去重
  |   → SnailRuntimeMessageInput {
  |       workspaceRoot, conversation, role, capability,
  |       history, latestUserEvents, incrementalMessages,
  |       externalSessionId
  |     }
  |
  |-- Step 3: 创建流式上下文
  |   → createStreamingContext()
  |     → 创建 assistant message（status="streaming"）
  |     → emit message_started
  |     → append start event
  |     → 返回 StreamingContext（messageId, outputSeq, error, permissionRequest）
  |
  |-- Step 4: 设置中断处理
  |   → createInterruptController() → AbortController
  |   → bindInterruptMessage(conversationId, messageId, controller)
  |   → registerStopPromise()
  |   → 标记 dispatch 为 consumed
  |
  |-- Step 5: 调用运行时
  |   → invokeRuntimeMessage()
  |     → 注入 <mcp_context> 到 system prompt
  |     → runtime.invokeMessage(input, onEvent, options)
  |       → Agent 适配器执行（见下文）
  |     → 更新 snail_agent_session.external_session_id
  |
  |-- Step 6: 调用后处理
  |   → 检查 terminalFailure / pendingPermissionRequest
  |   → commitSystemReminderHash()
  |   → scanAndExecuteStageTransition() → 检测 stage_transition 提议
  |   → resolveAgentMessageRouting() → Agent 回复的下一个目标角色
  |   → updateMessageRouting()
  |   → finalizeMessageLifecycle("completed")
  |
  |-- Step 7: 错误处理
  |   → AgentInvocationInterruptedError → finalize "interrupted" → throw CollaborationInterruptedError
  |   → 其他错误 → finalize "failed"
```

---

## 三、System Prompt 构建

### 3.1 多层组装

```
resolveConversationSystemPrompt(store, conversation, role, deps)
  |
  |-- owner_type === "evolution"
  |   → buildEvolutionSystemPrompt()
  |
  |-- owner_type === "workspace_stage"
  |   → buildWorkflowSystemPrompt()
  |     → resolveWorkflowContext() → workspace, issue, stage, stageDef, roles, activeRole
  |     → loadWorkspaceContext() → .snail/ 目录的 prompts + skills
  |     → buildConversationSystemPrompt(context)
  |     → 追加 transition hint（可用的前进转换 + gate evidence 状态）
```

### 3.2 模板变量

```
buildConversationSystemPrompt(context)
  → 构建模板变量：
    buildWorkspace → workspace_id, workspace_name, workspace_summary
    buildIssue → issue_title, issue_summary, issue_task_anchor_block ([HARD] 标记)
    buildStage → stage_id, stage_title, stage_progress_label,
                  stage input/output descriptions, acceptance focus,
                  checklist, artifacts
    buildRole → active_role_name, default_role_name, participating_roles,
                remaining_rounds, mention_allowed, forced_wrap_up_line,
                active_role_identity_line, participating_role_details_block,
                snail_display_name
    buildConversation → conversation_title, conversation_kind,
                        conversation_sources, conversation_summary
    buildHistory → history_script_path
    buildEvolutionVars → evolution_item_id, evolution_title, evolution_content, evolution_tags
    buildKnowledgeLib → knowledge_library_summary
```

### 3.3 Prompt 组装

```
assembleSystemPrompt(prompts, variables)
  → 按 when 条件过滤（runtime, stage_type, role, conversation_kind, owner_type）
  → 按 layer 优先级排序（sop < workspace < platform）→ 按 numeric priority 排序
  → 模板变量替换 {{variable_name}}
  → 分离为：
    systemPrompt（stability: "static"）
    systemReminder（stability: "dynamic"）
```

### 3.4 后组装增强

```
→ 注入 role handbook（shared_handbook + role handbook）到 systemReminder
→ evolution 对话注入治理上下文
→ collectActiveSkills() → 合并平台 + workspace skill
→ resolveGuardProfile() → 安全黑名单
→ collectActiveMcpServers() → 合并平台 + workspace MCP Server
→ 返回 AgentCapability {
    systemPrompt, systemReminder, skills, mcpServers,
    hooks, permissions, tools, subAgents, guardProfile
  }
```

### 3.5 关键变量断言

`stage_id`、`issue_id`、`workspace_name`、`active_role_name` 必须非空，否则抛异常阻止 Agent 在空上下文中运行。

---

## 四、Agent 调用（以 Claude Code 为例）

### 4.1 调用准备

```
ClaudeCodeAgent.invokeMessage(input, onEvent, options)
  → extract capability.systemPrompt, capability.systemReminder
  → ensureMcpServers(mcpServers, workspaceRoot, "claude")
    → 写入 .claude/mcp.json + .claude/settings.json 白名单
  → ensureSkillSymlinks(workspaceRoot, skills)
    → 创建 .claude/skills/ 和 .agents/skills/ symlink
```

### 4.2 CLI 启动

```
invokeStateless(input)
  → 构建 CLI 参数：
    -p, --no-session-persistence, --output-format stream-json,
    --input-format stream-json, --verbose, --permission-mode bypassPermissions
    --model (可选)
    --disallowedTools (guard profile 安全黑名单)
    --mcp-config <wsRoot>/.claude/mcp.json
    --append-system-prompt-file <tempFile>
  → 构建 context env：
    SNAIL_CTX_ISSUE_ID, SNAIL_CTX_CONVERSATION_ID, SNAIL_CTX_STAGE_ID
    → 注入 process.env
  → spawn "claude" as detached child process (piped stdin/stdout/stderr)
  → ManagedProcessController → 处理 abort signal + invocation timeout（默认 30 分钟）
```

### 4.3 消息发送与接收

```
→ 发送用户消息到 stdin：
  { type: "user", message: { role: "user", content: snail_shell_stateless_transcript } }
  → systemReminder 包裹在 <system-reminder> 标签中前置到 content blocks

→ 逐行读取 stdout JSON：
  type: "assistant"
    → text blocks → emit message_event(kind: "text")
    → tool_use blocks → emit message_event(kind: "tool_call")
  type: "result"
    → final content → emit usage signals
    → permission_denials → 日志记录
    → is_error → emit message_failure
```

### 4.4 进程生命周期管理

```
ManagedProcessController:
  → abort signal → 启动停止协议
  → invocation timeout → 启动停止协议
  → 停止协议（三阶段升级）：
    1. SIGINT（优雅中断，15s 超时）
    2. SIGTERM（终止，5s 超时，标记为强制）
    3. SIGKILL（杀死，2s 超时，强制）
    → 先发进程组 -pid，fallback 到子进程
  → throwIfStopped() → AgentInvocationInterruptedError / AgentInvocationTerminatedError
```

---

## 五、流式事件管线

### 5.1 事件类型

| 事件 | 说明 |
|------|------|
| `message_started` | 新消息创建 |
| `message_event_appended` | 单个事件追加（text, tool_call, tool_result 等） |
| `message_context_updated` | 终端上下文持久化 |
| `message_status_changed` | 消息到达终态（completed/failed/interrupted/cancelled/pending_approval） |
| `permission_required` | Agent 需要用户审批 |

### 5.2 事件流路径

```
Agent 产出事件
  → onEvent 回调
  → handleStreamingEvent()
    → message_event → handleMessageEvent()
      → 递增 outputSeq
      → 持久化到 store
      → emitAgentEvent(conversationId, event)
    → message_failure → 记录终端失败文本
    → permission_required → 存入 permissionStore，转发前端
  → WorkspaceManager.emit("agent-event", conversationId, event)
  → ConversationGateway 订阅 → 分发到 per-conversation handler set
  → SSE/WebSocket 推送到前端
```

### 5.3 WebSocket 连接

```
前端 useWebSocket hook:
  → 连接 /ws?conversation_id=...
  → 接收 agent_event 消息
  → 处理 message_started, message_event_appended, message_status_changed
  → 直接更新 TanStack Query cache
  → 断线重连（指数退避 1s → 30s）
```

---

## 六、终端上下文提取

### 6.1 提取优先级

```
persistTerminalMessageContext()
  → store.getMessageContext(messageId, conversationId)
  → if kind === "mcp_final_body" → 直接使用（最高优先级）
  → else → buildTerminalMessageContext()
```

### 6.2 确定性提取

```
buildDeterministicMessageContext(events)
  → findFinalOutputText()
    → 反向扫描 events，找最后一个 content_block 或 text event
    → 如果 text event 包含 message-out JSON → 解析结构化内容
  → 如果未找到 → eventSummary()
    → 报告最终状态、tool call 数、command 执行数、失败数
    → 提取最近的 result text + terminal signal reason
```

### 6.3 LLM 摘要降级

```
→ 如果 deterministic context > 12,000 字符 且 summaryGenerator 可用
  → LLM 摘要（目标 3,000 字符）→ kind = "llm_summary"
→ 如果 LLM 不可用 → 硬截断 12,000 字符 + "[上下文因摘要不可用被安全截断]"
```

---

## 七、Stage 转换检测

### 7.1 检测流程

```
scanAndExecuteStageTransition(messageEvents)
  → 遍历 text events
  → extractStageTransition(text)
    → 快速路径：不含 "stage_transition" → null
    → JSON.parse 全文
    → 失败则 regex 提取：/\{[^{}]*"format"\s*:\s*"stage_transition"[^{}]*\}/
    → 校验 format === "stage_transition" && typeof target_stage === "string"
  → 首个有效转换 → deps.onStageTransitionDetected()
```

### 7.2 转换处理

```
WorkspaceManager.handleAgentStageSuggestion()
  → 存储为 StageSuggestion
  → emit "stage-suggestion" 事件（前端展示）
  → 不自动执行，需用户确认 confirmStageSuggestion
```

---

## 八、MCP 上下文注入

### 8.1 注入时机

```
invokeRuntimeMessage()
  → 追加 <mcp_context> 到 system prompt：
    <mcp_context>
    conversation_id: {conversationId}
    message_id: {assistantMessageId}

    [HARD] 回复完成前必须调用 MCP 工具 set_final_body，
    传入 text（最终正文）、conversation_id 和 message_id。
    这是标准收尾步骤，不可跳过。
    </mcp_context>
```

### 8.2 消费时机

```
finalizeMessageLifecycle()
  → persistTerminalMessageContext()
    → getMessageContext() → if mcp_final_body → 直接使用
    → 否则 → 自动提取降级
```

---

## 九、关键设计决策（v1）

1. **ConversationQueue 串行化** — 每个 Conversation 独立 promise chain，防止并发消息处理
2. **Dispatch 路由** — 消息不直接调用接收方，创建 dispatch，drainMessageBus 批量处理
3. **协作 round 上限** — MAX_COLLABORATION_ROUNDS = 30，防止 Agent 无限循环
4. **人类角色特殊处理** — 项目负责人不触发 Agent 调用，发 boss mention 通知
5. **context_cutoff_at** — 每条消息记录上下文边界（message ID），防止并发写入污染
6. **System Reminder hash 去重** — 有状态 Agent 只在 hash 变化时注入 systemReminder
7. **mcp_final_body 最高优先级** — Agent 显式声明的最终正文优先于自动提取
8. **Stage 转换不自动执行** — Agent 提议需用户确认
9. **三阶段进程停止** — SIGINT → SIGTERM → SIGKILL 优雅升级
10. **事件实时推送** — Agent 事件通过 EventEmitter → Gateway → WebSocket 实时推送

---

## 十、v2 重写待决问题

1. **ConversationQueue 是否保留？** 当前 Promise chain 方式是否需要改为更健壮的队列？
2. **协作 round 上限是否可配置？** 当前硬编码 30，是否需要 per-SOP 或 per-conversation 配置？
3. **Agent 并行调用策略？** 当前 Promise.allSettled 并行，是否需要更细粒度的调度？
4. **终端上下文提取策略？** LLM 摘要是否保留，还是简化？
5. **MCP 上下文注入方式？** 当前注入 system prompt，是否需要更灵活的机制？
6. **System Prompt 构建性能？** 每次 Agent 调用都完整构建，是否需要缓存？
7. **Agent 进程管理？** 当前 spawn 子进程，是否需要进程池或复用？
8. **事件流协议是否演进？** 当前自定义 event 类型，是否需要标准化？
9. **permission_required 流程是否需要优化？** 当前的审批 UX 是否需要改进？
10. **Stage 转换确认机制？** 当前需用户确认，是否需要部分自动化？
