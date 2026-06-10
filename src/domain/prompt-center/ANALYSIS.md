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

### 2.4 现有 Prompt 文档

| ID | Layer | Priority | Stability | When | 说明 |
|----|-------|----------|-----------|------|------|
| B-01 | platform | 10 | static | 无条件 | 身份与责任契约 |
| B-02 | platform | 20 | static | 无条件 | 演进治理 |
| B-03 | platform | 30 | static | runtimes: [claude-code-cli, claude-code-stateful-cli] | 运行时边界 |
| B-04 | platform | 5 | static | 无条件 | 环境认知 |
| S-01 | platform | 40 | dynamic | 无条件 | 工作区上下文 |
| S-02 | platform | 50 | dynamic | 无条件 | 历史能力 |

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

### 3.2 三层架构与优先级

```
Layer 排序：sop (0) < workspace (1) < platform (2)
同 Layer 内：priority 数字升序

合并规则：mergePrompts(global, workspace) → workspace 按 id 覆盖 global
```

### 3.3 3+3 架构限制

```
validatePromptCount():
  → platform 活跃 prompt > 6 → 警告
  → sop 活跃 prompt > 3 → 警告
  → 总活跃 prompt > 6 → 警告
  → 仅警告，不阻塞
```

---

## 四、模板变量

### 4.1 变量构建器（8 个）

**buildWorkspace**：
- workspace_id, workspace_name, workspace_summary

**buildIssue**：
- issue_title, issue_summary
- issue_task_anchor_block → `<task_anchor>[HARD] {{task_anchor}}</task_anchor>`（无 anchor 时为空）

**buildStage**：
- stage_id, issue_id, stage_title, stage_progress_label, stage_next_action
- stage_input_description, stage_output_description
- stage_acceptance_focus_block, stage_artifact_requirements_block, stage_acceptance_checklist_block
- stage_input_artifacts, stage_output_artifacts（inline 格式）
- stage_input_artifacts_block, stage_output_artifacts_block（带标题块格式）
- stage_required_artifacts

**buildRole**：
- active_role_name, default_role_name, participating_roles
- remaining_rounds, mention_allowed, forced_wrap_up_line
- active_role_identity_line → "你是 <role_name>。"
- participating_role_details_block → 每个角色的 name + description
- snail_display_name → "by <role_name> (<Snail name>)"

**buildConversation**：
- conversation_title, conversation_kind, conversation_sources, conversation_summary

**buildHistory**：
- history_script_path → ".meta/scripts/conversation-history"

**buildEvolutionVars**：
- evolution_item_id, evolution_title, evolution_content, evolution_tags

**buildKnowledgeLib**：
- knowledge_library_summary → "当前知识库：global X 条，workspace Y 条。使用 knowledge-library skill 按需查询。"

### 4.2 关键变量断言

```
assertCriticalVariables(vars):
  → stage_id 非空
  → issue_id 非空
  → workspace_name 非空
  → active_role_name 非空
  → 任一为空 → throw "context injection pipeline fault"
```

---

## 五、后组装增强

### 5.1 Role Handbook 注入

```
buildRoleContent(context, variables):
  → sharedHandbook → renderPromptTemplate(variables)
  → activeRole.handbook → renderPromptTemplate(variables)
  → 拼接后追加到 systemReminder
```

### 5.2 Evolution 上下文注入

```
owner_type === "evolution":
  → buildEvolutionContext(variables)
  → 硬编码中文治理上下文块
  → 含 evolution_item_id/title/content/tags 模板变量
  → 追加到 systemReminder
```

### 5.3 能力对象组装

```
→ collectActiveSkills(workspaceSkills) → SkillCapability[]
→ resolveGuardProfile() → GuardProfile
→ collectActiveMcpServers(workspaceRoot) → MCPServerCapability[]
→ 返回 AgentCapability {
    systemPrompt, systemReminder, skills, mcpServers,
    hooks: [],        // TODO
    permissions: {},  // TODO
    tools: [],        // TODO
    subAgents: [],    // TODO
    guardProfile
  }
```

---

## 六、Prompt 评估框架

### 6.1 评估样本

**PromptEvaluationSample**：
```typescript
interface PromptEvaluationSample {
  id: string;           // "PE001"
  title: string;
  dimension: PromptEvaluationDimension;
  risk: string;
  source: string;
  agent_runtimes: AgentRuntime[];
  scenario: { workspace_kind: string; stage: string; user_request: string };
  expected_behaviors: string[];
  forbidden_behaviors: string[];
}
```

**评估维度**（7 个）：
- action-restraint — 分析请求不应自动升级为实现
- scope-boundary — 用户示例不应成为默认任务范围上限
- continuous-execution — 自主工作不应过早停止
- message-protocol — 跨 Snail 交接必须使用结构化 mention 协议
- runtime-differentiation — 运行时差异必须独立记录
- delivery-traceability — 不兼容更新必须显式标记
- causal-direction — 测试失败的因果归因

**13 个样本**（PE001-PE009e）覆盖上述维度。

### 6.2 评估执行（Target-Judge 模式）

```
runPromptEvaluations(options)
  → 遍历所有 samples
    → 遍历 sample.agent_runtimes
      → runSingleEvaluation(sample, runtime, judgeRuntime, invoker)

runSingleEvaluation():
  → Phase 1: Target 运行时
    → buildPromptEvaluationTargetPrompt(sample, runtime)
      → 构建中文 prompt，指示 Agent 在模拟 Snail Shell 场景中行动
      → 明确禁止讨论评估框架或复述 expected/forbidden 字段
    → invoker.invoke(targetPrompt) → 获取 targetOutput
  → Phase 2: Judge 运行时
    → buildPromptEvaluationJudgePrompt({ sample, targetOutput })
      → 构建中文 judge prompt，JSON-only 输出
      → Schema: { status: pass|partial|fail, rationale, evidence[] }
      → fail = forbidden 行为触发
      → partial = 部分 expected 满足且无核心 forbidden 违规
      → pass = 全部满足
    → invoker.invoke(judgePrompt) → parsePromptEvaluationJudgement()
  → 返回 { sampleId, runtime, status, targetOutput, judgement }
```

### 6.3 失败分类

```
classifyPromptEvaluationFailure(error):
  → "blocked" — 基础设施问题（CLI 未找到、权限、认证、网络、限流）
    → 22 个 BLOCKED_RUNTIME_ERROR_KEYWORDS 关键词匹配
    → classifyRuntimeError() 共享模块
  → "error" — 评估质量问题（judge 解析失败、schema 问题）
```

---

## 七、Handbook 格式

### 7.1 文件命名

`<stage>#<role>.handbook.md` + `shared.handbook.md`

### 7.2 内容格式

纯 Markdown（无 frontmatter），包含角色专属的工作规则、工作流、检查清单、场景指南。

### 7.3 现有 Handbook

| 文件 | 用途 |
|------|------|
| shared.handbook.md | 通用规则：PR 签名、Stage Gate 自检、证据规则、完成标准 |
| design#designer.handbook.md | 设计师角色手册 |
| development#developer.handbook.md | 开发者角色手册（最大，27KB） |
| review#reviewer.handbook.md | 审查者角色手册 |
| review#developer.handbook.md | 开发者-审查者手册 |
| merge#merger.handbook.md | 合并者角色手册 |

### 7.4 shared.handbook.md 核心规则

- PR 签名格式：`by <role_name> (<Snail name>)`
- Stage Gate 自检：遍历 acceptance_checklist → 生成 gate_evidence → 通过 stage-gate API 写入
- 证据规则：必须包含可验证的命令输出，不能仅"我检查了"
- 完成标准：所有 required checklist items 必须 passed

---

## 八、关键设计决策（v1）

1. **三层 Prompt 架构** — platform（全局基础）< sop（流程专属）< workspace（项目专属）
2. **静态/动态分离** — static → systemPrompt（不变），dynamic → systemReminder（可更新）
3. **条件激活** — when 字段按 runtime/stage_type/role/conversation_kind/owner_type 过滤
4. **模板变量注入** — {{key}} 替换，缺失变量解析为空字符串
5. **关键变量断言** — stage_id/issue_id/workspace_name/active_role_name 必须非空
6. **3+3 限制** — platform 最多 6 个，sop 最多 3 个，仅警告不阻塞
7. **Target-Judge 评估** — 两阶段评估模式，基础设施失败与评估质量失败分离
8. **Handbook 渲染** — shared + role-specific handbook 通过模板变量渲染后注入 systemReminder

---

## 九、v2 重写待决问题

1. **Prompt 文档是否需要版本管理？** 当前文件即真相，无版本历史
2. **3+3 限制是否调整？** 当前硬编码，是否需要更灵活的配额？
3. **when 条件是否需要扩展？** 当前 5 维度，是否需要更多（如 workspace_kind）？
4. **模板变量是否需要类型安全？** 当前纯字符串替换，缺失变量静默为空
5. **评估框架是否需要自动化？** 当前手动触发，是否需要 CI 集成？
6. **评估维度是否需要与 TypeScript 类型同步？** 当前 JSON 用 7 维度，TS 类型仅 5 个
7. **Handbook 是否需要结构化？** 当前纯 Markdown，是否需要 frontmatter 元数据？
8. **Prompt 渲染性能？** 每次 Agent 调用都完整渲染，是否需要缓存？
