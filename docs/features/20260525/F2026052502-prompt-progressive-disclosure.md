# F2026052502 系统提示词渐进式披露：运行时上下文外移

## 背景

PR #258（F2026052402）将系统提示词总注入量从 ~990 行降至 ~280 行（-72%），修复了 Skill 全量注入 bug 和 `--system-prompt` 覆盖问题。当前 Snail Shell 自研规则约 70 条，Claude 内置 ~50 条，总指令密度约 120 条。

在此基础上，发现了四个可进一步优化的方向：

1. **上场/候补双轨制**：每条规则有 [HARD]/[STD] 分级，经常失误的升级。"上场"直接写入提示词（精确控数），"候补"存知识库间接披露
2. **Base + Project 分层配额**：Base 层固定 N 条，Project 层固定 M 条，不会轻易调整
3. **内容结构固化**：数量有限就不浪费，内容结构固定下来
4. **渐进式披露：运行时上下文外移**：stageId、featureId、当前人员等运行时信息不全部注入系统提示词，改为 skill 查询

本 Feature 聚焦思路四。思路一、二、三的分析记录于本文档供后续参考。

### 思路四的核心原则

**系统提示词告诉要做哪几步，但每一步的详细内容挪到 skill/tool/MCP。只要提示词生效，这些自然会被触发执行。** 这比一股脑灌入但模型跳读更可靠。

## 目标

- 将运行时上下文变量从 systemPrompt 中移出，改为通过 skill 查询
- 系统提示词保留最小"锚点"信息，确保模型知道何时调用查询 skill
- systemPrompt 进一步精简，释放配额给核心规则
- 创建 `query-current-context` skill 供模型按需查询运行时上下文

## 非目标

- 不修改 Base 层 (B-01~B-03) 和 Scenario 层规则体系（思路一/二/三）
- 不修改 Frame 组装逻辑的核心架构
- 不修改 AgentCapability 协议

## 设计

### 当前运行时注入量分析

builder.ts 通过 6 个子函数注入约 40+ 个运行时变量，全部直接拼入 systemPrompt `<context>` 块：

| 变量组 | 注入函数 | 典型变量 | 预估行数 |
|---|---|---|---|
| Project | buildProjectVariables | project_name, project_summary | ~4 |
| Feature | buildFeatureVariables | feature_title, feature_summary, task_anchor | ~6 |
| Stage | buildStageVariables | stage_id, feature_id, stage_title, progress, next_action, input, output, artifacts | ~18 |
| Role | buildRoleVariables | active_role, default_role, participating_roles, remaining_rounds, mention_allowed, working_rules | ~15 |
| Conversation | buildConversationVariables | conversation_title, kind, sources, summary | ~6 |
| Governance | buildGovernanceVariables | governance_id, knowledge_* | ~4 |

合计约 50-60 行运行时上下文。

### 外移策略

按"必须保留在提示词中"vs"可通过 skill 查询"分类：

**必须保留（锚点信息）**：
- 身份声明（我是研发者）
- 当前阶段名称和基本方向（1-2 行）
- Skill 引用和触发条件

**可外移（查询获取）**：
- Stage 详细上下文（id、进度、输入/输出、产物要求）
- Feature 详细上下文（id、摘要）
- Role 详细上下文（参与角色列表、工作规则）
- Conversation 详细上下文（标题、类型、摘要）
- Project 详细上下文（名称、摘要）

### Skill 设计

创建 `query-current-context` skill，通过脚本查询数据库获取当前 stage/feature/role/conversation 详细信息。

命令格式：
```
node .meta/skills/query-current-context/scripts/query-current-context.js --db-path <path> --conversation-id <id>
```

### 提示词改动

在 S-01（项目上下文）中添加一条 STD 规则：需要详细运行时上下文时，调用 `query-current-context` skill。同时精简 S-01 的 `<context>` 块，只保留最小锚点。

## 四个思路完整分析

### 思路一：分级 + "上场/候补"双轨制

当前已有 [HARD]/[STD]/[GUIDE] 三级（47/77/9），但缺少：

1. **"上场/候补"选拔机制**：当前 ~70 条全部上场，没有候补概念。核心问题是模型何时知道该去查候补规则——需要在提示词中保留"索引条目"指向知识库
2. **失误反馈升级闭环**：当前 prompt-behavior-samples.json 是手工维护，无自动化"违规→统计→升级"机制

| 利 | 弊 |
|---|---|
| 精确控数，核心规则不被稀释 | 候补规则可能被遗漏 |
| 数据驱动，持续优化 | 需要违规追踪基础设施 |

### 思路二：Base + Project 分层配额

当前实际分层（研发者场景）：Base ~32 条 + Scenario ~38 条 = ~70 条。无配额上限约束。

引入配额的好处是强制取舍：如果 Base 配额 15 条，必须把当前 32 条中最重要的挑出来。许多 Base 层规则并非"对所有 AI 都成立"。

| 利 | 弊 |
|---|---|
| 强制取舍，防止膨胀 | 配额本身可能成为争论焦点 |
| Base 精简后对所有场景生效 | Base/Scenario 边界需重新厘清 |

### 思路三：内容结构固化

当前通过 XML 标签已有一定规范化，但标签内部仍是自由文本。进一步固化可定义每个区块的固定模板（如 `<constitution>` 只放 [HARD] 条目）。

| 利 | 弊 |
|---|---|
| 可审计、可自动统计 | 过度模板化可能让表达僵化 |

### 综合关系

思路三（结构固化）是基础 → 思路四（上下文外移）释放空间 → 思路一（上场/候补）和思路二（配额）是目标。

## 改动范围

- `.meta/prompts/prompts/S-01-项目上下文.md`：精简 5 个 `<context>` 块为 3 个，从 73 行降至 46 行（-37%）。移除 stage 输入/输出产物、角色列表与工作规则、conversation 元数据等变量引用。新增 `query-current-context` skill 引用和触发 STD 规则。
- `.meta/skills/query-current-context/`：新建 skill 目录，含 `SKILL.md`（入口文档）和 `scripts/query-current-context.js`（DB 查询脚本）
- `src/prompt-center/builder.ts`：未修改（已计算但未使用的变量无害，后续清理）

## 实现结果

| 指标 | 变更前 (PR #258后) | 变更后 | 变化 |
|---|---|---|---|
| systemPrompt 行数 | ~280 | **253** | **-10%** |
| S-01 行数 | 73 | 58 | -21% |
| 活跃 skills | 5 | 6 | +1 (query-current-context) |

### S-01 精简详情

**保留在提示词中（行为约束 + 阶段承接）**：
- Project 名称 + 摘要 + 内置项目声明
- Feature 标题 + 摘要 + ID (stage_id, feature_id) + 归属 HARD 规则 + task_anchor
- Stage 名称 + 进度 + 下一步动作 + 上一 Stage 输入产物（阶段间信息传递机制）
- 角色身份描述 + 角色工作规则（区分 development/review 阶段的关键差异化信息）
- 当前响应角色 + mention 权限 + 强制收口标记
- 协议和宪法规则（2 HARD + 4 STD + mention 扩散 STD）

**外移的内容**（改为通过 `query-current-context` skill 查询）：
- Stage 输出摘要、交付要求、验收关注点
- 默认主角色、参与角色列表与详情
- Conversation 标题、类型、来源、摘要

**分类原则**：行为约束保留，参考信息外移。阶段输入产物保留（阶段间关键信息传递），阶段输出产物外移（可在交付前查询）。

### builder.ts 变量状态

以下变量仍在 `buildTemplateVariables()` 中计算但不再被任何 prompt 模板引用，属于无害冗余：

- `buildStageVariables`: stage_input, stage_input_description, stage_output_summary, stage_required_artifacts, stage_output_description, stage_acceptance_focus_block, stage_artifact_requirements_block, stage_output_artifacts, stage_input_artifacts
- `buildRoleVariables`: default_role_name, participating_roles, participating_role_details_block
- `buildConversationVariables`: conversation_title, conversation_kind, conversation_sources, conversation_summary

## 风险

- **Skill 不触发风险**：如果模型不主动调用 `query-current-context`，会丢失运行时上下文。缓解：提示词中保留 1-2 行锚点信息 + 明确的 STD 规则要求查询
- **查询耗时**：每次查询需要执行脚本访问 SQLite。缓解：上下文信息量小，查询应在毫秒级完成

## 验证

- [x] builder.ts 生成的 systemPrompt 从 ~280 行降至 253 行（-10%）
- [x] query-current-context skill 可正常查询并返回结构化上下文（Project、Feature、Stage、Role、Conversation 五个块）
- [x] query-current-context skill 被 skill registry 自动发现并注册
- [x] S-01 的 skill_reference 被 prompt registry 正确解析
- [x] 系统提示词中 Skill References 段正确展示了 query-current-context skill
- [x] TypeScript 编译通过（`tsc --noEmit` 无错误）
- [x] 全部 36 个测试通过（含 stage-cycle-test 的阶段角色区分和输入产物传递）
- [x] 角色工作规则正确注入（development: "先写测试再实现"，review: "回应所有 comment"）
- [x] 阶段间输入产物正确传递（review stage 可见 development 的 PR URL）
- [x] S-02 历史能力块未受影响

## 残余风险

- **Skill 不触发风险**：如果模型不主动调用 `query-current-context`，会丢失 stage 输入/输出产物要求、参与角色工作规则等上下文。缓解措施：S-01 保留的 [STD] 规则明确指引查询，且锚点信息（stage 名称、进度、角色名称、剩余轮次）足以驱动基本行为。实际效果需在后续使用中观察。
- **builder.ts 冗余变量**：builder.ts 仍计算 20+ 个不再被引用的变量，属于无害冗余。后续清理不影响功能。
