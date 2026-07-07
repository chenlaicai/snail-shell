---
id: F20260707a626
title: 名词统一：消除全系统同一概念不同名词的命名不一致
status: locked
created_at: 2026-07-06
---

# F20260707a626 — 名词统一：消除全系统同一概念不同名词的命名不一致

## 背景

### 问题现象

创建 Issue 界面中，问题描述的 placeholder 是"描述你希望 AI 帮你解决的问题"。但同一界面的 SOP 执行计划说明中写的是"Assign every role instance to a Snail"，下拉选项写的是"Select Snail..."。同一对话框内对用户交替使用 "AI" 和 "Snail"。

这不是孤立现象。全系统术语审计发现 **11 处同类不一致**——同一个概念在不同层有不同的名字。AI/Snail 只是其中最显眼的一个。

### 根因分析

系统演进过程中，各层（system prompt / UI / README / 开发者注释）各自命名，缺乏同步。system prompt 早就用 "snail" 了，但 UI 仍然是 "AI"，README 仍然是"智能体"，三者各自演进。每一处不一致都遵循同一个模式：某层引入概念 → 用了自选名称 → 其他层不知道 → 各自命名 → 不一致累积。

### 全系统术语审计结果

| # | 概念 | 不同层的称呼 | 来源 | 类型 |
|---|------|-------------|------|------|
| 1 | 协调组件 | ProjectManager / WorkspaceManager / **IssueCollaboration** | README / README.en / 代码 | 名称错误 |
| 2 | 助理角色 | 助理 / 助手 / assistant / **Agent**（UI fallback） | SOP / 特性文档 / 代码 / ChatMessage | 多名混用 |
| 3 | 工作空间 | **工作空间** / **工作区** / workspace | README+domain注释 / UI按钮 / 代码 | 中英文混用 |
| 4 | 智能体 | **智能体** / agent / Snail | README / 代码+prompt / UI | 不是问题（中英文翻译） |
| 5 | 蜗牛 | **蜗牛**（仅README）/ Snail | README / 全系统其他 | 不是问题（中英文翻译） |
| 6 | IM功能 | **IM Lobby** / Lobby / im-hub / im | Sidebar+页面 / 路由 / domain模块 | 不是问题（中英文表达，均正确） |
| 7 | 目录路径 | **.meta/prompts/** / data/file/prompts/ | 多处文档+skill / 实际文件系统 | 错误路径 |
| 8 | 特性 | **特性** / **功能** / feature | 特性文档 / 行为准则 / 代码 | 不是问题（不同概念：feature vs functionality） |
| 9 | 执行者/器 | **执行者**（SOP角色）/ **执行器**（行为准则） | evolution.yaml / T-01 | 不同概念（者=人，器=工具） |
| 10 | 对话/协作 | 对话 / conversation / 协作 / collaboration | UI / store / README / app模块 | 不同概念（线程 vs 过程） |
| 11 | Agent标签 | **Agent**（多组件）/ **AI**（ChatMessage badge）/ Snail | ChatInput+ToolApproval / ChatMessage / identity-block | 多名混用 |

**#4、#5、#6、#8、#9 和 #10 不是真正的不一致**——#4/#5 是中英文翻译，#6 是中英文表达，#8 是不同概念（feature vs functionality），#9 和 #10 是不同概念用了相似但不同的词。**实际需修复 5 处**（#1-3, #7, #11）。

### 范围边界

**In scope**：排查全仓所有"同一概念但不同名词"的实际存在问题，全部修复。

**Out of scope**：

| 类别 | 位置 | 排除理由 |
|------|------|----------|
| LLM 集成模块 | `src/domain/lite-ai/`（5 文件）、`src/main.ts:109` | "AI" 指底层 LLM API 技术，非 agent 身份 |

### 用户意图锚

| ID | 用户原话 | 来源 | 关键修饰语 | 架构师解读 |
|----|----------|------|------------|------------|
| UA-1 | 在创建issue界面中，提示文本是"你希望ai做什么"，这里的"ai"其实反映了一个问题 | msg#3916 | 空间：创建 issue 界面；视觉属性：提示文本内容 | 用户从具体 UI 入口发现名词问题，但问题本身不限于此界面 |
| UA-2 | 那就是本系统的机制没有统一化，理论上应该叫snail，而不应该再有ai的概念 | msg#3916 | 空间：本系统（全系统范围）；条件：不应该再有 ai 的概念 | 明确指令：全系统范围内用 "Snail" 替代 "AI"，不是局部修改 |
| UA-3 | 而这个问题，对用户、对snail底层agent这两个"读者"来说都存在 | msg#3916 | 数量：两个读者（用户、snail底层agent） | 名词统一的受众是两个：用户面和 agent 面。agent 面已统一，用户面未统一 |
| UA-4 | 让人和snail都能够确定自己是谁、是什么 | msg#3916 | 目标：身份确定性（"确定自己是谁、是什么"） | 终极目标是身份认知一致性——用户看到的称呼与 agent 自我认知一致 |
| UA-5 | 其实我提出这个问题，但不止是ai > snail这个具体问题，而是 看到这个问题本质，其他的也有这种问题。先找到问题根因。 | msg#3966 | 空间：全系统；条件：不止是 ai>snail，而是问题本质 | 用户明确扩大范围：AI/Snail 只是症状，要排查所有同类问题并修复 |
| UA-6 | 我的意思是，本次不要额外加机制来，边界就限定在，排查全仓所有的 同一概念但不同名词 的实际存在问题，然后全都修复一下即可 | msg#4111 | 空间：全仓；条件：不加额外机制，只修复已发现问题 | 明确边界：只做修复，不建 glossary/CI 脚本/skill 规则等额外机制 |

## 核心业务行为

| ID | 行为 | 预期行为 | 追溯 |
|----|------|----------|------|
| B1 | 用户在 UI 中看到的所有对 agent 的称呼 | 统一为 "Snail"，不再出现 "AI" 或 "Agent" 指代 agent 的用户可见文本 | ← UA-2, UA-3 |
| B2 | 用户创建 Issue 时看到的 placeholder | 文案中使用 "Snail" 而非 "AI" | ← UA-1, UA-2 |
| B3 | Issue 看板状态标签 | "AI Running" 变为 "Snail Running" | ← UA-2 |
| B4 | Agent 消息旁的身份标签 | 显示 "Snail" 而非 "AI" 或 "Agent" | ← UA-4 |
| B5 | Stage 推进建议文案 | "AI 建议" 变为 "Snail 建议" | ← UA-2 |
| B6 | Agent 流式响应/卡住提示 | "AI is responding..." / "AI 已长时间无新事件" 变为 "Snail is responding..." / "Snail 已长时间无新事件" | ← UA-2 |
| B7 | `ActivityStatus` 枚举值 | `ai_running` 变为 `snail_running`，全链路同步 | ← UA-2 |
| B8 | 开发者注释中的 "AI" | 统一为 "Snail" 或 "agent"（根据语境） | ← UA-2 |
| B9 | README 中的类名/概念名 | 与实际代码一致（IssueCollaboration 非 ProjectManager） | ← UA-5 |
| B10 | UI 中 "工作空间" 统一为 "工作区" | README 和 domain 注释同步更新 | ← UA-5 |
| B11 | 文档中的路径引用 | `.meta/` 修正为 `data/file/` | ← UA-5 |
| B12 | UI 中 "Agent" 标签统一为 "Snail" | ChatInput、ToolApprovalCard、ChatMessage 中的用户可见 "Agent" → "Snail"（SnailFormDialog 的 "Agent Name" 保留，指底层技术标识） | ← UA-2, UA-4 |
| B13 | docs/README.md 中 "AI" 指代 agent | "AI" → "agent"（技术语境）或 "Snail"（身份语境） | ← UA-2 |

## [design-time]

### 决策记录

#### D1: 统一用 "Snail" 而非保留 "AI"

**问题**：面向用户的 UI 文案中，应该用 "Snail" 还是 "AI"？

**方案 A**：统一用 "Snail"
**方案 B**：保留 "AI"（更通用，用户更容易理解）

**选择方案 A**。理由：
- system prompt 已经确立 "snail" 作为 agent 身份定义，UI 应与之同步
- "Snail" 是系统品牌名（Snail Shell），具有唯一性和辨识度
- "AI" 是通用概念，不携带系统特有身份信息
- 用户明确指令："理论上应该叫 snail，而不应该再有 ai 的概念"（UA-2）

#### D2: 枚举值 `ai_running` 同步修改

**问题**：`ActivityStatus` 类型中的 `"ai_running"` 枚举值是否要改为 `"snail_running"`？

**方案 A**：改为 `snail_running`，全链路同步
**方案 B**：只改 label，保留枚举值 `ai_running`

**选择方案 A**。理由：
- 用户指令是"不应该再有 ai 的概念"（UA-2），枚举值属于代码中的概念
- 保留 `ai_running` 枚举值 + 展示 "Snail Running" 是向后兼容 hack
- `ai_running` 不是数据库持久化字段（由 `getActivityStatus()` 实时计算），不需要数据库迁移
- 全链路同步修改范围可控，前后端同时部署，无兼容性问题

#### D3: 开发者注释中的 "AI" 是否纳入范围

**问题**：代码注释中的 "AI" 是否需要修改？

**方案 A**：纳入范围，统一修改
**方案 B**：不纳入，只改用户可见文本

**选择方案 A**。理由：
- 注释中用 "AI" 指代 agent 会让开发者误以为 "AI" 是正式概念
- 修改成本低，注释修改不影响功能

**修改规则**：
- "AI Agent" / "AI agent" → "Snail"（指代 Snail 实体）或 "agent"（指代底层技术实现）
- "AI 消息" / "AI 信号" → "Snail 消息" / "Snail 信号"
- "AI 运行时" → "agent 运行时"（指底层 AI 技术时保留 "agent"）

#### D4: "AI Snail" 复合词处理

**问题**：HomePage 中的 "AI Snail" 如何处理？

**方案 A**：直接改为 "Snail"
**方案 B**：改为 "Snail Shell"（用系统名）

**选择方案 A**。理由："AI Snail" 是历史遗留的过渡性复合词，既然已确定统一用 "Snail"，复合词无需保留。

#### D5: 工作空间 → 工作区

**问题**：README 和 domain 注释用"工作空间"，UI 按钮用"工作区"。

**方案 A**：统一为"工作区"（UI 已使用，更简洁）
**方案 B**：统一为"工作空间"（README 已使用，更正式）

**选择方案 A**。理由：UI 是用户直接接触的面，"工作区"更简洁且已在 active UI 中使用。

#### D6: .meta/ → data/file/

**问题**：多处文档和 skill 引用 `.meta/prompts/` 和 `.meta/skills/`，但实际路径是 `data/file/prompts/` 和 `data/file/skills/`。

**方案 A**：更新文档引用为 `data/file/`
**方案 B**：创建 `.meta/` 软链接指向 `data/file/`

**选择方案 A**。理由：`.meta/` 目录不存在，是历史遗留路径。更新引用是正确做法，创建软链接是兼容 hack。

#### D7: UI 中 "Agent" → "Snail"（排除技术配置字段）

**问题**：ChatInput（"Ask Agent"）、ToolApprovalCard（"Agent wants to use..."）、ChatMessage fallback（"Agent"）、SnailFormDialog（"Agent Name"）中使用 "Agent" 指代 Snail。

**方案 A**：全部改为 "Snail"
**方案 B**：ChatInput/ToolApprovalCard/ChatMessage 改为 "Snail"，SnailFormDialog 的 "Agent Name" 保留

**选择方案 B**。理由：
- SnailFormDialog 有两个名称字段："Name"（Snail 显示名称，如 "Claude Code + Sonnet"）和 "Agent Name"（底层 agent 技术标识，如 "claude-code"）
- 将 "Agent Name" 改为 "Snail Name" 会与 "Name" 字段语义混淆
- "Agent Name" 对应 API 字段 `agent_name`，是技术配置字段，"Agent" 在此处指底层技术实现，符合 D3 规则

### 变更清单

#### C0: ActivityStatus 枚举值重命名（不兼容变更）

**影响范围**：
- `src/api-contracts/dto.ts`: `ActivityStatus` 类型定义
- `src/app/issue-collaboration/port.ts`: `getActivityStatus` 和 `onActivityStatusChanged` 接口签名
- `src/domain/collaboration/port.ts`: 同上
- `src/app/issue-collaboration/collaboration.ts`: 类型注解和返回值
- `src/adapter/http/unified-websocket.ts`: WebSocket 事件中的 `activity_status` 值
- `src/adapter/http/routes/issue.route.ts`: API 响应中的 `activity_status` 值
- `src/web/lib/issue-utils.ts`: 看板分组和 label
- `src/web/components/StatusBadge.tsx`: 状态徽章配置
- `src/web/hooks/__tests__/activity-status-filter.test.ts`: 测试用例

**行为变更**：`activity_status` 字段值 `"ai_running"` → `"snail_running"`

**不兼容说明**：API 响应和 WebSocket 事件中的 `activity_status` 枚举值改变。前后端同仓部署，无外部消费者。

#### C1: 用户可见 UI 文案 — AI → Snail（8 处）

| 文件 | 行号 | 原文 | 新文 |
|------|------|------|------|
| `HomePage.tsx` | 12 | "与 AI Snail 协作完成复杂任务" | "与 Snail 协作完成复杂任务" |
| `NewIssueDialog.tsx` | 158 | "描述你希望 AI 帮你解决的问题" | "描述你希望 Snail 帮你解决的问题" |
| `StatusBadge.tsx` | 8 | `{ label: "AI Running", ... }` | `{ label: "Snail Running", ... }` |
| `issue-utils.ts` | 13 | `{ status: "ai_running", label: "AI Running", ... }` | `{ status: "snail_running", label: "Snail Running", ... }` |
| `StageSuggestionCard.tsx` | 91 | "AI 建议由" | "Snail 建议由" |
| `ChatMessage.tsx` | 123 | `AI` 标签 | `Snail` 标签 |
| `ChatMessage.tsx` | 241 | "AI is responding..." | "Snail is responding..." |
| `ChatMessage.tsx` | 267 | "AI 已长时间无新事件" | "Snail 已长时间无新事件" |

#### C2: 开发者注释统一（5 处）

| 文件 | 行号 | 原文 | 新文 |
|------|------|------|------|
| `snail/model.ts` | 4 | "Snail — AI Agent 运行时配置" | "Snail — agent 运行时配置" |
| `snail/model.ts` | 7 | "一个可调用的 AI Agent" | "一个可调用的 agent" |
| `snail-signal-validation.ts` | 36 | "AI 信号预校验...让 AI 在发出..." | "Snail 信号预校验...让 Snail 在发出..." |
| `useWebSocket.ts` | 206 | "服务端推送的 AI 消息开始" | "服务端推送的 Snail 消息开始" |
| `issue-utils.ts` | 3 | "Group issues by activity status (ai_running / needs_human / completed)" | "Group issues by activity status (snail_running / needs_human / completed)" |

#### C3: UI 中 "Agent" → "Snail"（3 处，排除 SnailFormDialog）

| 文件 | 原文 | 新文 |
|------|------|------|
| `ChatMessage.tsx:122` | `message.from_role ?? "Agent"` | `message.from_role ?? "Snail"` |
| `ChatInput.tsx:166` | "Ask Agent" | "Ask Snail" |
| `ToolApprovalCard.tsx:27` | "Agent wants to use..." | "Snail wants to use..." |

**注意**：SnailFormDialog 的 "Agent Name" 保留不变（D7 方案 B）。该字段对应底层 agent 技术标识（`agent_name`），改为 "Snail Name" 会与已有的 "Name"（Snail 显示名称）字段混淆。

#### C4: README 不一致修复

| 文件 | 问题 | 修复 |
|------|------|------|
| `README.md:24` | "ProjectManager" | "IssueCollaboration" |
| `README.en.md:24` | "WorkspaceManager" | "IssueCollaboration" |
| `README.md:5` | "工作空间" | "工作区" |
| `README.md:198` | "AI 智能体运行时适配器" | "智能体运行时适配器"（只去 "AI" 前缀） |
| `README.en.md:186` | "AI agent runtime adapters" | "agent runtime adapters"（只去 "AI"） |
| `domain/knowledge/model.ts` | 注释中"工作空间" | "工作区" |
| `domain/guard-profile/model.ts:16` | "工作空间" | "工作区" |

#### C5: 路径引用修复（.meta/ → data/file/）

| 文件 | 原文 | 新文 |
|------|------|------|
| `docs/README.md:27` | `.meta/prompts/` | `data/file/prompts/` |
| `docs/README.md:28` | `.meta/skills/` | `data/file/skills/` |
| `src/README.md:48,195` | `.meta/prompts/` | `data/file/prompts/` |
| `src/README.md:196` | `.meta/skills/` | `data/file/skills/` |
| `data/file/skills/prompt-constraints/SKILL.md:3,10,21,24,25` | `.meta/prompts/reference/` | `data/file/prompts/reference/` |

#### C6: "AI" 指代 agent 的残留修复

| 文件 | 原文 | 新文 | 理由 |
|------|------|------|------|
| `data/file/prompts/T-01-行为准则.md:17` | "AI 缺乏的领域知识" | "agent 缺乏的领域知识" | AI→agent（技术语境） |
| `data/file/sops/general-assistant/general-assistant.yaml:6,11` | "AI 助理" | "Snail 助理" | AI→Snail（身份语境） |
| `CONTRIBUTING.md:19` | "multiple AI runtimes" | "multiple agent runtimes" | AI→agent（技术语境） |
| `docs/README.md:27` | "AI 运行时行为规则" | "agent 运行时行为规则" | AI→agent（技术语境） |
| `docs/README.md:73` | "章节由 AI 在设计阶段" | "章节由 Snail 在设计阶段" | AI→Snail（身份语境） |

### 不兼容更新

- `ActivityStatus` 枚举值 `"ai_running"` → `"snail_running"`
- 影响范围：API 响应、WebSocket 事件、前端类型定义
- 无数据库迁移需求（`activity_status` 由代码实时计算，不持久化）
- 前后端同仓部署，无外部消费者

### 验收标准

| ID | 标准 | 验证方式 |
|----|------|----------|
| AC-0 | UI 中不再出现 "AI" 指代 agent | `grep -r "\bAI\b" src/web/ --include="*.tsx" --include="*.ts"` 返回结果中无 "AI" 指代 agent 的用户可见文本 |
| AC-1 | NewIssueDialog placeholder 使用 "Snail" | 查看 `NewIssueDialog.tsx` placeholder 值 |
| AC-2 | StatusBadge label 为 "Snail Running" | 查看 `StatusBadge.tsx` 和 `issue-utils.ts` label 值 |
| AC-3 | ChatMessage 中标签和提示使用 "Snail" | 查看 `ChatMessage.tsx` 第 123、241、267 行 |
| AC-4 | StageSuggestionCard 使用 "Snail 建议" | 查看 `StageSuggestionCard.tsx` 第 91 行 |
| AC-5 | ActivityStatus 枚举值为 "snail_running" | 查看 `dto.ts` ActivityStatus 类型定义 |
| AC-6 | 全链路无残留 "ai_running" | `grep -r "ai_running" src/` 返回空 |
| AC-7 | 开发者注释中 "AI" 已替换 | `grep -r "AI Agent\|AI agent\|AI 消息\|AI 信号\|ai_running" src/ --include="*.ts" --include="*.tsx"` 返回空 |
| AC-8 | 前端测试更新为 "snail_running" | `activity-status-filter.test.ts` 中所有 "ai_running" 改为 "snail_running" |
| AC-9 | WebSocket 事件 activity_status 值正确 | 验证 unified-websocket.ts 中 activity_status 事件值为 "snail_running" |
| AC-10 | UI 中 "Agent" 标签替换为 "Snail" | ChatInput、ToolApprovalCard、ChatMessage fallback 中无用户可见 "Agent" 指代 Snail（SnailFormDialog 的 "Agent Name" 保留，D7 方案 B） |
| AC-11 | README 类名与代码一致 | README.md 和 README.en.md 中无 "ProjectManager" 或 "WorkspaceManager" |
| AC-12 | "工作空间" 统一为 "工作区" | `grep -r "工作空间" src/ README.md` 返回空 |
| AC-13 | 路径引用正确 | `grep -r "\.meta/" docs/ README.md README.en.md src/README.md data/file/skills/` 返回空 |
| AC-14 | docs/README.md 中 "AI" 指代 agent 已替换 | `grep "\bAI\b" docs/README.md` 返回空 |
| AC-15 | README.md "AI" 前缀已去除 | README.md:198 无 "AI 智能体"（应为"智能体"），README.en.md:186 无 "AI agent"（应为"agent"） |
