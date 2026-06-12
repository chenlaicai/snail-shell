# Prompt Center 模块分析（v1 遗留）

> 本文档基于 `v1/src/prompt-center/` 目录下的遗留代码分析，用于指导 v2 重写。

---

## 一、业务场景

### 1.1 Prompt Center 是什么

Prompt Center 是 Snail Shell 的**大脑配置系统**。负责从分层、条件化的 prompt 文档中组装 system prompt，注入运行时上下文模板变量，并提供评估框架测试 prompt 在多个 Agent 运行时上的有效性。

核心职责：**决定 AI 看到什么、如何行为**。

### 1.2 核心业务场景

| 场景 | 说明 |
|------|------|
| **Prompt 组装** | 三层架构（platform/sop/workspace）+ 条件激活 + 静态/动态分离 |
| **模板变量注入** | 40+ 变量覆盖 workspace/issue/stage/role/conversation 上下文 |
| **Role Handbook 注入** | shared handbook + role-specific handbook 渲染后注入 systemReminder |
| **Evolution 上下文注入** | owner_type="evolution" 时注入治理上下文 |
| **Prompt 评估** | target-judge 模式，13 个样本覆盖 7 个维度 |
| **3+3 架构限制** | platform 最多 6 个，sop 最多 3 个，总计最多 6 个活跃 prompt |

---

## 二、Prompt 文档格式

### 2.1 文件位置

- 平台级：`.meta/prompts/prompts/*.md`
- Workspace 级：`<workspaceRoot>/.snail/prompts/*.md`
- SOP Handbook：`config/sop/<key>/*.handbook.md`

### 2.2 PromptDocument 接口

```typescript
interface PromptDocument {
  id: string;           // 如 "B-01"
  title: string;        // 如 "身份与责任契约"
  layer: "platform" | "sop" | "workspace";  // 默认 "platform"
  priority: number;     // 排序键，数字越小越靠前
  when?: PromptWhen;    // 条件激活，undefined = 无条件
  stability: "static" | "dynamic";  // static → systemPrompt, dynamic → systemReminder
  content: string;      // Markdown body，含 {{variable}} 模板占位符
  filePath: string;
}
```

### 2.3 PromptWhen 条件匹配

```typescript
interface PromptWhen {
  runtimes?: string[];            // AgentRuntime 列表
  stage_types?: string[];         // stage key 列表
  roles?: string[];               // role name 列表
  conversation_kinds?: string[];  // ConversationKind 列表
  owner_types?: string[];         // ConversationOwnerType 列表
}
```

匹配逻辑：AND 跨维度，OR 维度内。未指定的维度 = 匹配所有。

---

## 三、Prompt 组装流程

### 3.1 assembleSystemPrompt

```
assembleSystemPrompt(options)
  → 过滤：matchesWhen(when, context) → 按 runtime/stage_type/role/conversation_kind/owner_type 匹配
  → 排序：layer 顺序（sop=0, workspace=1, platform=2）→ priority 数字升序
  → 渲染：每个 prompt 的 content 通过 renderPromptTemplate(variables) 替换 {{key}}
  → 剥离：移除每个 prompt body 的 ## title 标题行
  → 分离：
    systemPrompt = stability="static" 的所有 prompt 拼接
    systemReminder = stability="dynamic" 的所有 prompt 拼接
  → validatePromptCount() → 超限时警告（不阻塞）
```

### 3.2 模板变量

```
buildWorkspace → workspace_id, workspace_name, workspace_summary
buildIssue → issue_title, issue_summary, issue_task_anchor_block ([HARD] 标记)
buildStage → stage_id, issue_id, stage_title, stage_progress_label,
              stage input/output descriptions, acceptance focus, checklist, artifacts
buildRole → active_role_name, default_role_name, participating_roles,
            remaining_rounds, mention_allowed, forced_wrap_up_line,
            active_role_identity_line, participating_role_details_block, snail_display_name
buildConversation → conversation_title, conversation_kind, conversation_sources, conversation_summary
buildHistory → history_script_path
buildEvolutionVars → evolution_item_id, evolution_title, evolution_content, evolution_tags
buildKnowledgeLib → knowledge_library_summary
```

### 3.3 后组装增强

- 注入 role handbook（shared + role-specific）到 systemReminder
- evolution 对话注入治理上下文
- collectActiveSkills() → SkillCapability[]
- resolveGuardProfile() → GuardProfile
- collectActiveMcpServers() → MCPServerCapability[]
- 返回 AgentCapability

---

## 四、Prompt 评估框架

### 4.1 Target-Judge 模式

```
runPromptEvaluations(options)
  → 遍历所有 samples
    → 遍历 sample.agent_runtimes
      → runSingleEvaluation(sample, runtime, judgeRuntime, invoker)

runSingleEvaluation():
  → Phase 1: Target 运行时
    → buildPromptEvaluationTargetPrompt(sample, runtime)
    → invoker.invoke(targetPrompt) → 获取 targetOutput
  → Phase 2: Judge 运行时
    → buildPromptEvaluationJudgePrompt({ sample, targetOutput })
    → invoker.invoke(judgePrompt) → parsePromptEvaluationJudgement()
  → 返回 { sampleId, runtime, status, targetOutput, judgement }
```

### 4.2 评估维度（7 个）

- action-restraint — 分析请求不应自动升级为实现
- scope-boundary — 用户示例不应成为默认任务范围上限
- continuous-execution — 自主工作不应过早停止
- message-protocol — 跨 Snail 交接必须使用结构化 mention 协议
- runtime-differentiation — 运行时差异必须独立记录
- delivery-traceability — 不兼容更新必须显式标记
- causal-direction — 测试失败的因果归因

---

## 五、关键设计决策（v1）

1. **三层 Prompt 架构** — platform（全局基础）< sop（流程专属）< workspace（项目专属）
2. **静态/动态分离** — static → systemPrompt（不变），dynamic → systemReminder（可更新）
3. **条件激活** — when 字段按 runtime/stage_type/role/conversation_kind/owner_type 过滤
4. **模板变量注入** — {{key}} 替换，缺失变量解析为空字符串
5. **关键变量断言** — stage_id/issue_id/workspace_name/active_role_name 必须非空
6. **3+3 限制** — platform 最多 6 个，sop 最多 3 个，仅警告不阻塞
7. **Target-Judge 评估** — 两阶段评估模式，基础设施失败与评估质量失败分离
8. **Handbook 渲染** — shared + role-specific handbook 通过模板变量渲染后注入 systemReminder

---

## 六、v2 重写待决问题

1. **Prompt 文档是否需要版本管理？** 当前文件即真相，无版本历史
2. **3+3 限制是否调整？** 当前硬编码，是否需要更灵活的配额？
3. **when 条件是否需要扩展？** 当前 5 维度，是否需要更多（如 workspace_kind）？
4. **模板变量是否需要类型安全？** 当前纯字符串替换，缺失变量静默为空
5. **评估框架是否需要自动化？** 当前手动触发，是否需要 CI 集成？
6. **评估维度是否需要与 TypeScript 类型同步？** 当前 JSON 用 7 维度，TS 类型仅 5 个
7. **Handbook 是否需要结构化？** 当前纯 Markdown，是否需要 frontmatter 元数据？
8. **Prompt 渲染性能？** 每次 Agent 调用都完整渲染，是否需要缓存？
