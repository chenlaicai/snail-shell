# Workspace Workflow 模块分析（v1 遗留）

> 本文档基于 `v1/src/workspace-workflow/` 目录下的遗留代码分析，用于指导 v2 重写。

---

## 一、业务场景

### 1.1 Workspace Workflow 是什么

Workspace Workflow 是 Snail Shell 的**中央编排层**。WorkspaceManager（约 550 行）是系统的 god-object，扩展 EventEmitter，串联所有业务模块：Workspace 生命周期、Issue 工作流引擎、Stage 转换、消息协作、SOP 管理、Evolution、Knowledge Library。

### 1.2 核心业务场景

| 场景 | 说明 |
|------|------|
| **Workspace 生命周期** | 创建（含 .snail 初始化）、加载、列表、详情 |
| **Issue 工作流引擎** | 创建（含 SOP 快照冻结）、前进、回退、完成、归档 |
| **Stage 转换** | Guard 校验（requires_artifacts）、Gate Evidence 警告（不阻塞）、终态检测 |
| **SOP 快照冻结** | Issue 创建时冻结 SOP 模板，运行中只读快照 |
| **协作 round 管理** | 最多 30 轮，强制 wrap-up 到 default_role |
| **Stage 建议** | Agent 提议 Stage 转换，需用户确认 |
| **启动崩溃恢复** | 恢复孤儿 streaming 消息 |
| **Git 资源清理** | Issue 完成/归档时清理 worktree 和 branch |
| **.snail 目录约定** | workspace 级配置加载（init.json、SOP、prompts、skills） |

---

## 二、Workspace 生命周期

### 2.1 创建 Workspace

```
WorkspaceManager.createWorkspace(name, input)
  → randomUUID() 生成 workspaceId
  → resolveWorkspaceRoot(workspaceId, input.workspaceRoot)
    → 用户指定路径 或 默认 ~/SnailShell/workspaces/{workspaceId}

  → loadFromSnail 路径：
    → .snail 不存在 → initializeSnailDirectory() 创建默认结构
    → loadWorkspaceFromSnail() → 加载 init.json + SOP YAML + prompts + skills
      → SOP ID 格式：${workspaceId}#${sopKey}
      → source="workspace", sourceRef=workspaceId
      → resolveHandbookRefs() → @file 引用解析
      → store.replaceWorkspaceConfigs() → 全量替换 workspace SOP
    → createIssue("初始研发迭代", sopId, {})

  → 默认路径：
    → createInitialWorkflow()
      → store.createWorkspace()
      → createIssueWorkflow() → 创建默认 issue "初始设计与实现"
```

### 2.2 .snail 目录结构

```
<workspaceRoot>/.snail/
  init.json                    → { name, summary, guard_profile? }
  config/sop/<key>.yaml        → SOP YAML 定义
  config/sop/<stage>#<role>.handbook.md → 角色手册
  prompts/*.md                 → workspace 级 prompt 文档
  skills/<name>/SKILL.md       → workspace 级 skill 定义
```

### 2.3 .snail 初始化（initializeSnailDirectory）

```
→ mkdir .snail/ + .snail/config/sop/
→ ensureInitJson() → 写入 init.json（name, summary, guard_profile）
→ ensureSopYaml() → 优先从 platform config/sop/ 复制，fallback 到内置 DEFAULT_SOP_YAML
  → DEFAULT_SOP_YAML：2 stage（development → review），每 stage 一个 developer role
```

---

## 三、Issue 工作流引擎

### 3.1 createIssueWorkflow

```
→ getSop(adoptedSopId) → 校验存在 + workspace 归属
→ buildSopSnapshot(sopId) → 冻结完整 SOP 到 SopSnapshot
→ new SopSnapshotReader(snapshot) → 只读访问器
→ store.createIssue({id, workspaceId, title, summary, sopSnapshot, roleSnailMapping})
→ resolve first_stage_key → snapshot.first_stage ?? 最小 sequence 的 stage
→ createIssueStage(reader, stageKey, sequence: 1) → status="in_progress"
→ createDefaultStageConversation(reader, stage)
  → primaryRole = is_primary===1 ?? roles[0]
  → participatingRoles = [HUMAN_ROLE_NAME, ...stageRoles]
  → title = "${issue.title} . ${stage.type} #${stage.sequence}"
```

### 3.2 transitionIssueStage

```
→ resolveTransitionTarget(reader, activeStage, targetStageKey?)
  → 0 个前向边 → null（终态）
  → 显式 targetStageKey → 直接使用
  → 1 个前向边 → 自动选择
  → 多个前向边 + 无显式目标 → throw Error（需消歧）

→ reader.validateTransition(from, to) → 校验边存在
→ checkGuard(activeStage, edge)
  → guard=null → 跳过
  → type="requires_artifacts" → 检查 output_artifacts 中必需 key
  → 未知 guard type → throw Error（fail-fast）

→ checkGateEvidence(reader, activeStage)
  → required checklist items 无对应 passed evidence → 日志警告（不阻塞）
  → 人类拥有最终决定权

→ UPDATE stage SET status="completed", left_at=now
→ 获取前一 stage 的 conversation → fromConversationIds
→ createIssueStage(reader, targetStageKey, sequence+1)
```

### 3.3 advanceIssue / bounceIssueStage

```
advanceIssue(issueId):
  → assertIssueWritable()
  → assertStageCanAdvance() → output_artifacts 必须非空
  → 清除 pending stage suggestion
  → transitionIssueStage(issueId)

transitionIssueStage(issueId, targetStageKey):
  → assertIssueWritable()
  → 显式 targetStageKey（支持回退）
  → 清除 pending stage suggestion
```

### 3.4 终态检测

Stage 无前向边时返回 `next_stage: null`，调用方需检查此值判断工作流是否完成。

---

## 四、Stage 建议机制

```
Agent 输出中嵌入 stage_transition JSON
  → scanAndExecuteStageTransition() 提取
  → handleAgentStageSuggestion(conversationId, targetStageKey, reason)
    → resolveAgentTransitionContext() → 校验 conversation/issue/workspace/stage 存在 + issue 可写
    → 存入 pendingStageSuggestions Map<issueId, StageSuggestion>
    → emit "stage-suggestion" 事件 → WebSocket 通知前端
    → 不自动执行，需用户确认

confirmStageSuggestion(issueId):
  → 查找 pending suggestion
  → transitionIssueStage(issueId, suggestion.toStageKey)
  → 成功后删除 suggestion，失败保留可重试

clearStageSuggestion(issueId):
  → 删除 suggestion 不执行
```

---

## 五、协作 Round 管理

```
MAX_COLLABORATION_ROUNDS = 30

drainMessageBus():
  → remainingRounds = 30
  → 每个 agent batch → remainingRounds--
  → remainingRounds <= 0 → 强制 default_role + mentionAllowed=false + forcedWrapUp=true
  → 防止 Agent 间无限循环
```

---

## 六、Writable 断言

| 断言 | 规则 |
|------|------|
| `assertIssueWritable` | closed_at !== null → throw "Closed issue is read-only" |
| `assertConversationIssueWritable` | owner_type="evolution" → 始终可写；否则校验 issue writable |
| `assertStageCanAdvance` | output_artifacts 为空 → throw（Stage 必须产出 artifact 才能前进） |

---

## 七、启动崩溃恢复

```
recoverOrphanedStreamingAssistantMessages(store)
  → listStreamingAssistantMessages() → 查找所有 status="streaming" 的消息
  → 对每条消息：
    → 0 事件 → 插入合成 start event
    → 有事件 → 不插入 start（避免违反事件排序不变量）
    → append signal event: message_interrupted, reason=server_shutdown
    → 构建终端消息上下文
  → 返回 { recovered_message_ids, failed_message_ids }
```

---

## 八、Git 资源清理

```
cleanupIssueRepoContext(stages)
  → 遍历所有 stage 的 output_artifacts
  → 清理 worktree_path 和 branch_name
  → 跳过 {value, keep:true} 格式的永久保留 artifact

Worktree 清理：
  → validateWorktreePath → 必须在 .claude/worktrees 或 .snail/worktrees 内
  → git worktree remove -- <path>
  → 清除 GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE 环境变量

Branch 清理：
  → validateBranchName → 拒绝 main/master、origin/、..、空格
  → git check-ref-format --branch 校验
  → git branch -d（安全删除，未合入的会被 Git 拒绝）

跨 Stage 去重：seen.worktrees Set + seen.branches Set
```

---

## 九、关闭协议

```
markShuttingDown():
  → shuttingDown = true
  → interruptAllRunningMessages()

waitForAllAgentProcessesStopped():
  → await 所有 interrupt stop promises

sendStructuredMessage():
  → shuttingDown === true → throw
```

---

## 十、关键设计决策（v1）

1. **WorkspaceManager 是 god-object** — 串联所有业务模块，EventEmitter 模式
2. **ConversationQueue 串行化** — 每个 conversation 独立 promise chain
3. **SOP 快照隔离** — Issue 创建时冻结，运行中只读快照
4. **Guard fail-fast** — 未知 guard type 直接 throw，不静默绕过
5. **Gate Evidence 仅警告** — 人类拥有最终决定权
6. **Stage 建议不自动执行** — Agent 提议需用户确认
7. **output_artifacts 必填** — Stage 无 artifact 不能前进
8. **Evolution 对话始终可写** — 跳过 writable 断言
9. **30 round 上限** — 防止 Agent 间无限协作循环
10. **合成 start event** — 恢复 0 事件的孤儿消息时插入

---

## 十一、v2 重写待决问题

1. **WorkspaceManager 是否拆分？** 当前 god-object 约 550 行，是否需要按领域拆分？
2. **协作 round 上限是否可配置？** 当前硬编码 30，是否需要 per-SOP/per-conversation 配置？
3. **Guard 类型是否扩展？** 当前仅 requires_artifacts，是否需要时间/审批等类型？
4. **Gate Evidence 是否需要强制阻塞模式？** 当前仅警告
5. **Stage 建议是否需要自动执行选项？** 当前全部需人工确认
6. **启动恢复是否需要更完善的策略？** 当前仅处理 streaming 消息
7. **Git 清理是否需要更细粒度的控制？** 当前清理所有非 keep artifact
8. **.snail 目录约定是否演进？** 当前固定结构，是否需要扩展？
9. **output_artifacts 必填是否过于严格？** 是否需要允许无 artifact 的 Stage 前进？
