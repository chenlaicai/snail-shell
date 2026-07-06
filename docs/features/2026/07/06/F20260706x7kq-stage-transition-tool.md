---
id: F20260706x7kq
title: stage-transition-tool
from_ids: []
tags: [issue-collaboration, mcp, auto-advance, signal]
modules: [issue-collaboration, snail-mcp-server]
doc_kind: spec
change_type: feature
---

# F20260706x7kq Stage 推进工具：分离推进意图与产物校验

## 背景

用户反馈系统"还是没有自动推进"——agent 完成工作后路由给用户说"没问题了"，但 stage 不自动流转，用户必须手动推进。此问题经历了多轮修复（F20260630m8ia、F20260630uyj5、F20260703advb），前几轮集中在引擎侧（信号链路、校验逻辑、反馈闭环），但 agent 侧的信号投递断层始终未解决。

## 问题分析

### 根因：Agent 不知道如何发出 stage_transition 信号

信号投递机制要求 agent 在 `set_final_body` 的 `text` 参数中嵌入 `stage_transition` JSON，系统通过 `extractStageTransition()` 提取。但这一机制存在五层信息断层：

1. **工具描述未提及信号投递**：`set_final_body` 描述只说"传入 Markdown 内容"，未提到 stage_transition、JSON、信号
2. **系统提示词只说"通过信号表达"，未说怎么投递**：提到 signal_type 但未说明信号要嵌入 set_final_body 的 text 中
3. **投递机制只在参考文件中文档化**：`stage-gate.md` 第 14 行说明了机制，但该文件不自动加载
4. **`validate_stage_signal` 是纯校验工具，不注册信号**：agent 可能以为校验通过 = 信号已发出
5. **"守门人，不是推进者"措辞导致过度保守**：agent 可能理解为"不应主动推进"

### 职责混淆

当前设计把两个不同关注点塞进一个操作：

| 关注点 | 含义 | 谁应该负责 |
|--------|------|-----------|
| stage 推进（意图） | "工作做完了，请求推进到下一阶段" | Agent |
| 产物校验（验证） | "Feature 文档存在吗？两位架构师都同意吗？" | 系统 |

Agent 被要求构造复杂的 `gate_evidence` JSON 和 `adversarial_artifact` JSON（含 audit_trail、independent_verification、critique_obligation 等），但引擎对这些字段的校验只是检查"非空字符串"——任何非空值都能过。这是纯粹的官僚门槛，既不增加安全性，又阻止了 agent 发出信号。

### 故障链路

```
Agent 完成工作 → 调用 set_final_body 传入纯 Markdown 文本（无 JSON）
→ extractStageTransition() 返回 null → 无 signal 事件注入
→ detectStageTransition() 无信号可检测 → 无 L1/L2 评估
→ 无自动推进 → 用户手动推进
```

## 用户意图锚

| ID | 用户原话 | 来源 | 关键修饰语 | 架构师解读 |
|----|---------|------|-----------|-----------|
| UA-1 | "系统有没有提供类似于《stage推进》的mcp tool" | 消息 #1 | 空间：mcp tool；条件：类似于stage推进 | 用户需要系统提供专门用于 stage 推进的 MCP 工具，且该工具应当是可发现的 |
| UA-2 | "当前运行效果还是纯靠我来手动推进（基本上），非常少次数遇到ai自行推进" | 消息 #1 | 时序：基本上（高频率）；数量：非常少次数 | 用户期望 AI 自动推进为常态，手动推进为例外。当前情况与期望相反 |
| UA-3 | "看对话明明都to speaker给用户（我）说都没问题了" | 消息 #1 | 条件：to speaker 给用户说没问题 | Agent 完成了工作并路由给用户，但系统未触发自动推进。工作完成≠推进触发 |
| UA-4 | "除了最后的合入pr权必须由我控制，这一点还是必须保持" | 消息 #1 | 条件：除了最后合入 PR 权；时序：必须保持 | PR 合入权是用户保留的唯一手动控制点，其他阶段应自动推进。已满足：merge 阶段无 auto_advance 配置 |
| UA-5 | "产物校验是一回事，issue的stage推进tool是另外一回事" | 消息 #3 | 空间：两件事分离 | 产物校验和 stage 推进是两个独立关注点，不应混在一个机制中 |

## 设计方案

### 核心原则

**分离推进意图和产物校验**。Agent 只需表达"我要推进到哪、为什么"；系统自动执行产物校验。

### 变更范围

#### 变更 1：`validate_stage_signal` → `request_stage_transition`（重命名 + 行为变更）

将现有 `validate_stage_signal` MCP 工具重命名为 `request_stage_transition`，行为从"纯校验"改为"校验 + 注册信号"。

**工具定义**：

```
名称：request_stage_transition
描述：请求推进到下一阶段。完成 Stage Gate 自检后调用此工具，系统会校验推进条件并注册信号。校验通过后信号被持久化，进入自动推进评估流程。
参数：
  - stage_id: string（必填，从环境变量 SNAIL_CTX_STAGE_ID 获取）
  - target_key: string（必填，目标阶段 key）
  - reason: string（必填，自然语言描述推进理由和自检证据）
  - signal_type?: string（可选，默认从 stage config 的 accepted_signal_types 推断；
    disagreement 时需显式指定）
  - from_speaker: string（必填，从 identity 块的角色实例字段提取）
返回：
  - { valid: true, registered: true } — 信号已注册
  - { valid: false, reasons: [...] } — 校验失败，agent 应根据 reasons 自纠后重试
```

**移除的参数**（相比 `validate_stage_signal`）：
- `gate_evidence` → 系统自动检查
- `adversarial_artifact` → 系统自动检查
- `guard` → 引擎从 stage config 自动获取
- `decision_mode` / `recommendation` / `alternatives` → 当前不需要

**行为变更**：
- 校验通过时：将信号持久化到 `StageSuggestionRepository` 和内存缓存，触发 `onStageTransitionSuggested` 通知
- 校验失败时：返回 reasons，不持久化
- 复用现有 `validateSingleSignal()` 校验逻辑（需适配移除 gate_evidence/adversarial_artifact 后的校验路径）

← UA-1（提供专门的 stage 推进 MCP 工具）、UA-5（分离推进意图与产物校验）

#### 变更 2：`set_final_body` 回归纯粹

移除 `set_final_body` 中的 `extractStageTransition()` 信号提取机制。`set_final_body` 只负责展示文本和路由，不再承担信号投递职责。

**移除的代码路径**：
- `snail-final-response.ts` 中的 `extractStageTransition()`、`tryParseStageTransition()`、`findMatchingBrace()` 函数
- `handleSetFinalBody` 中的 stage_transition 提取和 signal 事件注入逻辑

**保留**：`to_speakers` 参数和路由逻辑不变。

← UA-5（stage 推进 tool 是独立的事，不应混在 set_final_body 中）

#### 变更 3：gate_evidence 移除，系统自动检查

移除信号中的 `gate_evidence` 字段。系统自动检查能检查的 gate，无法自动检查的 gate 降级为 prompt 级约束（SKILL.md 中要求 agent 自检，证据写在 `reason` 参数中）。

**系统自动检查的 gate**：

| Gate | 检查方式 |
|------|---------|
| design-01 | 检查 issue context 中是否有 feature_doc_path 指向的文件 |
| design-02 | 检查当前 stage 是否存在未解决的 disagreement 信号 |
| dev-04 | 检查 issue context 中的 `pr_url` 字段 |
| rev-04 | 检查 issue context 中的 `feature_number` 字段，正则校验 `F\d{8}[a-kmnp-z][2-9a-kmnp-z]{3}` |

**降级为 prompt 级约束的 gate**：

| Gate | 原因 |
|------|------|
| dev-01 | 系统无法自动检查"代码是否完整实现" |
| dev-02 | 系统不执行测试命令 |
| dev-03 | 系统不检查 feature 文档是否有更新 |
| dev-06 | 系统不执行验证命令 |
| rev-01 | 系统无法自动检查"所有评论是否已处理" |
| rev-02 | 系统不执行验证命令 |
| rev-03 | 系统不检查 PR 评论签名 |

← UA-5（产物校验是系统的事，不是 agent 构造 JSON 的事）

#### 变更 4：adversarial_artifact 移除，R 规则重新分类

移除信号中的 `adversarial_artifact` 字段。对抗产物校验规则重新分类：

| 规则 | 处置 | 理由 |
|------|------|------|
| R1 产物存在 | **废弃** | agent 调用 request_stage_transition 即证明信号存在 |
| R2 审计轨迹 | **降级为 prompt 级约束** | 系统无法自动验证 agent 是否真正审视了对方的工作 |
| R3 独立验证 | **降级为 prompt 级约束** | 系统无法自动验证 agent 是否真正执行了验证命令 |
| R4/R4b 批判义务 | **降级为 prompt 级约束** | 结构化字段不增加真实质量保证 |
| R5 文件覆盖 | **降级为 prompt 级约束** | 同上 |
| R6 相似性 | **保留** | 已有系统侧实现，无需 agent 输入 |
| R7 全 clear | **保留** | 已有系统侧实现，无需 agent 输入 |
| R8 未解决发现 | **由 speaker count 替代** | 两个 speaker 都发同方向共识信号 = 发现已解决。R8 原本检查 agent 自报的 finding disposition，agent 可虚报 "no issues" 绕过，保护力有限 |

**对抗审视的保障机制**（替代 R1-R8 结构化校验）：
1. Speaker count ≥ 2（已有，保留）—结构性保证两个 agent 都同意
2. SKILL.md prompt 级约束（R2-R5 降级）—指导 agent 该做什么
3. 用户监督—对话记录对用户可见，用户可以判断 agent 是否真正审视

#### 变更 5：系统提示词更新

**协作规则**（`system-prompt-builder.ts`）：

当前：
> 你是当前阶段的守门人，不是推进者。建议 stage_transition 前，必须先完成所在 SKILL.md 中的 Stage Gate 自检并呈现完整证据。
> 通过信号表达阶段工作结果：signal_type: gate_complete（单人完成）、adversarial_consensus（多人共识）、disagreement（分歧）

改为：
> 完成 Stage Gate 自检后，应主动调用 `request_stage_transition` 请求推进。自检证据写在 reason 参数中供用户和对方审视。
> 如果对推进方向有分歧，调用 `request_stage_transition` 时设置 signal_type 为 disagreement。

**最终答复规则**：

当前：
> 必须使用 `set_final_body` MCP 设置最终答复。

增加调用顺序说明：
> 发言结束流程：(1) 如需推进阶段，先调用 `request_stage_transition`；(2) 调用 `get_current_message_id` 获取 message_id；(3) 调用 `set_final_body` 提交展示文本和路由目标，结束发言。

← UA-2（让 AI 自动推进成为常态）

#### 变更 6：校验逻辑合并（实现指引）

当前同一套 gate 校验逻辑存在于三处：
- `snail-signal-validation.ts`（MCP 工具层）
- `signal-validation.ts`（L1 协作层）
- `auto-advance.ts`（L2 引擎层）

新方案应合并为单一校验函数，三层共用。

**问题**：三层校验逻辑重复，维护成本高，且容易不一致。
**预期方向**：提取共享校验函数，三层调用同一实现。
**关键约束**：不改变校验的语义和行为，只消除代码重复。

#### 变更 7：rev-04 feature number 来源

移除 `gate_evidence` 后，rev-04 的 feature number 需要从其他来源获取。

**方案**：从 issue context 的 `feature_number` 字段获取。开发者在创建 PR 时通过 `set_context` 设置 `feature_number`。系统在 rev-04 校验时读取该字段并执行正则校验。

如果 issue context 中没有 `feature_number` 字段，rev-04 校验失败，返回 `fix_guidance` 提示 agent 设置该字段。

## 核心业务行为

| ID | 场景 | 预期行为 | 追溯 |
|----|------|---------|------|
| B1 | Agent 完成工作并调用 `request_stage_transition`，传入有效的 `target_key` 和 `reason`，且系统自动校验全部通过 | 信号被持久化，进入自动推进评估流程，系统返回 `{ valid: true, registered: true }` | ← UA-1, UA-5 |
| B2 | Agent 调用 `request_stage_transition`，但 issue context 缺少必要字段（如 worktree_path） | 系统返回 `{ valid: false, reasons: [{ code: "CONTEXT_MISSING", ... }] }`，信号不被持久化，agent 可根据 reasons 自纠 | ← UA-5 |
| B3 | 两位架构师都调用了 `request_stage_transition` 且 target_key 一致，系统自动校验全部通过 | stage 自动推进到 target_key 指定的阶段，无需用户手动点击 | ← UA-2, UA-3 |
| B4 | Agent 调用 `request_stage_transition` 后再调用 `set_final_body` 提交展示文本 | `set_final_body` 正常存储展示文本和路由目标，不触发信号提取（text 提取机制已废弃） | ← UA-5 |
| B5 | Agent 只调用 `set_final_body` 而未调用 `request_stage_transition`（仅回复消息，不推进阶段） | `set_final_body` 正常工作，不报错，不触发自动推进 | ← UA-5 |
| B6 | Agent 调用 `request_stage_transition` 时设置 `signal_type: "disagreement"` | 系统注册 disagreement 信号，触发升级流程（通知用户介入裁决），不自动推进 | ← UA-2 |
| B7 | Agent 处于 merge 阶段 | `request_stage_transition` 不可用或系统不自动推进（merge 阶段无 auto_advance 配置），用户保持对 PR 合入的手动控制 | ← UA-4 |
| B8 | 系统自动校验 rev-04 时，从 issue context 的 `feature_number` 字段读取特性编号 | 如果字段存在且匹配正则 `F\d{8}[a-kmnp-z][2-9a-kmnp-z]{3}`，校验通过；否则返回 `fix_guidance` 提示设置该字段 | ← UA-5 |

## 非目标

- 不改变 merge 阶段的手动控制机制（UA-4 已满足）
- 不改变 `set_final_body` 的 `to_speakers` 路由逻辑
- 不改变 `get_current_message_id` 的行为
- 不引入 suggestive/requires_human 决策模式（当前 autonomous 足够）
- 不自动执行测试命令或验证命令（系统不执行 bash，保持 prompt 级约束）

## 关键决策记录

### 决策 1：演进 vs 新建工具

- **决策点**：是新建 `request_stage_transition` 工具，还是从 `validate_stage_signal` 演进？
- **正方论点（架构师-1）**：新建工具更清晰，避免历史包袱
- **反方论点（架构师-2）**：`validate_stage_signal` 已有结构化参数和校验逻辑，新建是多余复杂度
- **最终决策**：演进。重命名 + 行为变更，复用已有基础设施
- **决策依据**：避免新增工具的复杂度，复用已有的参数结构和校验逻辑
- **参与者**：架构师-1、架构师-2

### 决策 2：对抗产物校验处置

- **决策点**：R1-R8 规则如何处置？
- **正方论点（架构师-1）**：完全废弃，简化为 speaker count
- **反方论点（架构师-2）**：不能完全废弃，系统侧自动提取 R2-R3 保留质量约束
- **最终决策**：R1 废弃，R2-R5 降级为 prompt 级，R6-R7 保留，R8 由 speaker count 替代
- **决策依据**：架构师-1 论证了系统提取 R2-R3 只能检测工具调用不能检测真实审视（虚假安全感），架构师-2 确认 R8 保护力有限（agent 可虚报 "no issues" 绕过）。speaker count 是结构性保证，prompt 级约束 + 用户监督是补充
- **参与者**：架构师-1、架构师-2

### 决策 3：gate_evidence 处置

- **决策点**：gate_evidence 完全废弃还是部分保留？
- **正方论点（架构师-1）**：完全废弃，系统自动检查 + agent 自然语言自证
- **反方论点（架构师-2）**：部分保留，系统自动检查能检查的，其余 agent 在 reason 中自证
- **最终决策**：收敛为"系统自动检查 + reason 自证"，无结构化 gate_evidence
- **决策依据**：引擎对 gate_evidence 只检查非空字符串，不验证内容质量。结构化 gate_evidence 是官僚门槛，不增加安全性
- **参与者**：架构师-1、架构师-2

### 决策 4：调用顺序约束

- **决策点**：`request_stage_transition` 和 `set_final_body` 的调用顺序如何约束？
- **正方论点（架构师-2）**：`set_final_body` 返回 `end_turn` 立即结束回合，必须先调用 `request_stage_transition`
- **反方论点**：无（双方同意）
- **最终决策**：正确顺序为 `request_stage_transition` → `set_final_body`，系统提示词明确说明
- **决策依据**：`set_final_body` 的 `end_turn` 语义决定了调用顺序
- **参与者**：架构师-1、架构师-2

## 变更影响分析

### 后端

- **MCP 工具层**：`validate_stage_signal` → `request_stage_transition`（重命名 + 参数精简 + 行为变更：校验通过时注册信号）
- **信号解析层**：移除 `set_final_body` 中的 `extractStageTransition()` 信号提取逻辑
- **校验层**：适配移除 gate_evidence/adversarial_artifact 后的校验路径，三层校验合并为单一函数
- **自动推进引擎**：L2 评估逻辑适配——不再检查 gate_evidence 非空，改为系统自动检查；R1 废弃、R2-R5 移除、R8 由 speaker count 替代
- **rev-04 检查**：从 issue context `feature_number` 字段获取特性编号

### 前端

- **无直接影响**。前端不直接调用 MCP 工具。`onStageTransitionSuggested` 和 `onAutoAdvanced` 事件流不变。
- **间接影响**：如果 `request_stage_transition` 注册信号后触发 `onStageTransitionSuggested`，前端的 suggestion card 展示逻辑不变。

### 提示词/SOP

- **系统提示词**（`system-prompt-builder.ts`）：软化"守门人"措辞，增加调用顺序说明
- **cd-shared/references/stage-gate.md**：更新信号投递方式描述——从"嵌入 set_final_body text"改为"调用 request_stage_transition"
- **cd-design/SKILL.md**：更新信号协议——简化信号格式，移除 adversarial_artifact 要求
- **cd-development/SKILL.md**：更新 Stage Gate 自检——移除 gate_evidence 构造要求
- **cd-review/SKILL.md**：同上

## 不兼容更新

- `validate_stage_signal` MCP 工具重命名为 `request_stage_transition`，参数结构变更（移除 gate_evidence、adversarial_artifact、guard、decision_mode 等）
- `set_final_body` 的 text 参数不再提取 stage_transition JSON
- 信号中不再包含 `gate_evidence` 和 `adversarial_artifact` 字段
- R1-R5 校验规则从引擎强制变为 prompt 级约束
- rev-04 feature number 来源从 gate_evidence 变为 issue context `feature_number` 字段

## [design-time]

### 设计锁定状态

- 两位架构师已通过交叉审视达成共识
- 三个分歧已全部收敛（详见关键决策记录）
- 架构师-2 的三个补充发现已全部采纳（调用顺序约束、三层校验合并、守门人措辞软化）
- 无未解决争议

### 交叉审视记录

- **Phase 1（独立分析）**：架构师-1 产出草稿方案（5 层信息断层分析 + set_final_body 增加 stage_transition 参数方案）
- **Phase 2（交换对抗）**：架构师-2 独立验证确认核心事实，提出 3 个分歧（演进 vs 新建、对抗产物处置、gate_evidence 处置）和 3 个补充发现
- **Phase 3（合并收敛）**：架构师-1 回应所有分歧，双方达成共识。最终方案：演进 validate_stage_signal、R1 废弃/R2-R5 降级/R6-R8 保留或替代、gate_evidence 系统自动检查 + reason 自证

### 质疑义务产出

**风险点**：
1. 移除 R2-R5 引擎校验后，对抗审视质量完全依赖 prompt 约束和用户监督，存在"两个 agent 互不审视直接发共识信号"的风险
2. `request_stage_transition` → `set_final_body` 的调用顺序依赖提示词约束，agent 可能先调用 `set_final_body` 导致回合结束无法再调用 `request_stage_transition`

**遗漏场景**：
1. Agent 调用 `request_stage_transition` 失败后放弃推进，只调用 `set_final_body` 回复消息——此场景下系统不报错，但 stage 不推进，用户需要从对话中判断是否应该手动推进

**替代方案**：
1. 在 `set_final_body` 中增加 `stage_transition` 参数（架构师-1 原方案）——被否决，因为仍然把推进和展示混在一个工具中

### 实现指引

**三层校验合并**：
- 问题：同一套 gate 校验逻辑存在于三处（MCP 工具层、L1 协作层、L2 引擎层），维护成本高
- 预期方向：提取共享校验函数，三层调用同一实现
- 关键约束：不改变校验的语义和行为，只消除代码重复

## [development-time]

### 实现记录

- **变更 1**：`validate_stage_signal` → `request_stage_transition`，通过 `StageTransitionPort` 接口委托给 `IssueCollaboration.requestTransition()` 实现"校验+注册+评估"一体化
- **变更 2**：移除 `set_final_body` 中的 `extractStageTransition()`/`tryParseStageTransition()`/`findMatchingBrace()`，删除信号事件注入逻辑
- **变更 3**：移除 `gate_evidence` 字段，L1/L2 改为系统自动检查（design-01: feature_doc_path、dev-04: pr_url、rev-04: feature_number 正则）
- **变更 4**：移除 `adversarial_artifact` 字段，R1 废弃、R2-R5 降级为 prompt 级、R6/R7 保留但无数据（artifact 已移除）、R8 由 speaker count 替代
- **变更 5**：系统提示词从"守门人，不是推进者"改为"完成自检后主动调用 request_stage_transition"，增加调用顺序说明
- **变更 6**：三层校验合并 — MCP 工具层委托给 `requestTransition()`，L1 简化为 `validateSingleSignal()`（仅检查 context + system gates + blocking rules），L2 简化为 speaker count + context + system gates + blocking rules
- **变更 7**：rev-04 从 issue context `feature_number` 字段获取，正则校验 `F\d{8}[a-kmnp-z][2-9a-kmnp-z]{3}`
- **删除文件**：`signal-parser.ts`（信号不再从消息文本中提取）、`snail-signal-validation.ts`（替换为 `snail-stage-transition.ts`）
- **新增类型**：`StageTransitionPort`、`TransitionRequestResult`、`TransitionValidationReason`（定义在 `src/domain/snail-mcp-server/port.ts`）
- **main.ts**：使用 lazy proxy 模式将 `StageTransitionPort` 传递给 MCP server（collaboration 在 MCP server 之后初始化）
