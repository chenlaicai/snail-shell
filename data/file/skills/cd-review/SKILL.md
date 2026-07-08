---
name: cd-review
description: |
  审查者角色在 review 阶段的工作流程。当你是审查者，需要对 PR 进行对抗性检视时触发。
  触发条件：review stage 开始、审查者角色被激活、需要执行 PR 审查时。
---

# 审查者工作流程

## 前置依赖

必须先加载 `cd-shared` skill（特性编号、PR签名、证据规则、完成标准）。

## Gotchas（必读）

- **[HARD] 信号预校验**：完成 Stage Gate 自检后，调用 `request_stage_transition` 工具请求推进。校验失败时根据 reasons 自纠后重试。未校验直接结束发言 = 违规。
- **[HARD] Stage Gate 自检**：在调用 `request_stage_transition` 之前，必须逐项完成下方 Stage Gate 自检章节，呈现完整证据。禁用"检视完了"、"没问题了"、"可以合入"等笼统结论——每项必须逐条列出处置状态。未完成自检直接请求推进 = 违规。
- **"低风险"不是跳过问题的理由**：只要问题有修复价值，无论风险高低，都应在当前 PR 修复。禁止使用"低风险"、"可忽略"、"不重要"等标签。
- **验证命令必须独立执行**：不是检查开发者是否执行了，而是自己再跑一遍。"看了 diff，都改了"不是有效的 evidence。
- **复检必须覆盖完整 PR diff**：不能只确认单条评论是否已处理，需覆盖完整 PR diff 和可能的回归风险。
- **一方说没问题，另一方必须更仔细**：交叉审视的核心是对抗性——如果一方表示"完全没问题"而对方发现了问题，必须重新审视自己的检视范围。
- **开发者修复后必须基于最终状态重新判断**：复检是检视闭环的一部分，不是可选帮助。
- **[HARD] 复检必须发布新评论**：重新进入 review 阶段时，必须在 PR 上发布新的评论（不得复用上一轮评论链接），并通过 set_context 更新 review_comment_url。rev-03 gate 每轮都需满足，不是一次性检查。

## 情境感知

进入 stage 后，在开始具体工作前，先了解当前情境：

1. **阅读 context block**：system-reminder 中的"阶段历史"段落已包含完整的阶段链和前序阶段的关键消息
2. **判断是否为重新进入**：如果 kickoff 消息包含"重新进入"或 context block 标注"重新进入"，说明你正在重新进入一个已访问过的阶段，需要特别关注前序阶段发生了什么变化
3. **按需深入查询**：如果 context block 中的信息不足以理解当前情况，使用以下 MCP 工具：
   - `get_stage_history`：获取完整的阶段历史和结构化数据
   - `list_messages`：查询特定阶段的消息列表
   - `search_messages`：按关键词搜索历史消息
   - `get_context`：读取 Issue 上下文中存储的跨阶段元数据
4. **不要假设"开始执行"意味着从零开始**：前序阶段可能已经完成了大量工作，你需要在已有基础上继续

## 工作流程索引

1. **准备与上下文加载** — 进入 worktree、确认 PR 基于最新 main、确认分支属于当前 issue、feature 文档编号合规。详见 `references/workflow.md`。
2. **Intake 审视** — 评估 PR 方向是否忠实于 feature 文档。详见 `cd-shared/references/intake-protocol.md`。
3. **判断检视重点** — 判断 PR 语义类型和本质目标，按对应成功标准检视。
4. **对抗性检查** — 主动寻找 bug、回归风险、边界条件、缺失验证。详见 `references/adversarial-check.md`。
5. **交叉审视** — 两位审查者独立完成后交叉阅读对方结论。详见 `references/cross-review.md`。
6. **问题报告与对话回传** — 问题在 PR 上评论，逐条列出处置状态。

## Intake 审视（进入阶段后第一步）

**在开始任何检视工作之前，必须先执行 intake 审视。**

### 评估问题

1. PR 的整体架构方向是否忠实于 feature 文档的设计意图？
2. PR 是否引入了 feature 文档未提及的重大架构变更？
3. 如果存在方向偏差，这是设计文档的问题还是实现的问题？

### 判断与行动

- **偏差是设计问题** → 立即调用 `request_stage_transition` 请求退回到 `design` 阶段
- **偏差是实现问题** → review 阶段内解决，不打回
- **无偏差** → 继续正常工作（进入判断检视重点步骤）

### 调用示例

```
request_stage_transition({
  stage_id: "<从环境变量获取>",
  target_key: "design",
  reason: "PR 方向偏离 feature 文档设计意图，需回到设计阶段修正。\n\nintake-1: 具体偏差说明",
  from_speaker: "审查者-1"
})
```

### 注意

- intake 信号是早期信号，与后续的 adversarial_consensus 信号互斥
- 发出 intake sendback 信号后，不得再发出正向推进信号
- review 是双 agent 阶段，如果一个 reviewer 发出 sendback 而另一个发出正向 → 触发 disagreement
- 详见 `cd-shared/references/intake-protocol.md`

## 关键约束

- 检视结论必须逐条列出处置状态：已修复 / 开发者回应（审查者认可）/ 待处理
- 存在任何"待处理"项时，结论必须是"需要开发者继续处理"
- 变更完整性验证命令必须独立执行，输出写入 rev-02 的自检证据
- 每轮检视（含复检）均必须在 PR 上发布新的签名评论（规则见 cd-shared 的 `references/pr-signature.md`）
- 审查报告中每个问题必须有"处置方式"字段，只允许填"在当前 PR 修复"，禁用"不堵塞""可遗留""建议合入""后续优化""不影响功能""不影响，建议合入"等变体话术
- 检视后必须通过 `set_final_body` 的 `to_speakers` 声明路由目标
- **视觉/空间类 PR 必须比对截图与意图锚**：当行为条目有 `← UA-n` 追溯且意图锚含视觉/空间修饰语时，审查者必须比对 PR 中的截图/录屏与意图锚描述。不一致 = 审查不通过，标记为 bug

## Stage Gate 自检（必须）

**在调用 `request_stage_transition` 之前，必须完成以下自检。未完成自检不得请求推进。**

### 验收清单

| ID | 清单项 | 必须 |
|---|--------|------|
| rev-01 | 所有检视意见已逐条处理 | ✅ |
| rev-02 | 根据变更类型独立执行验证命令，实际输出作为检视证据 | ✅ |
| rev-03 | 每轮检视（含复检）均已在 PR 上发布新的签名评论，且评论 URL 已通过 set_context 写入 issue context 的 review_comment_url 字段 | ✅ |
| rev-04 | 特性编号已通过 set_context 写入 issue context 的 feature_number 字段（格式：FYYYYMMDDxxxx） | ✅ |
| rev-ctx | pr_url 已通过 set_context 写入 Issue.context（reviewer 需据此定位 PR） | ✅ |

### 执行步骤

1. 逐项对照上方清单，检查每项是否满足
2. 为每项准备证据（PR 评论链接、验证命令输出等）
3. 在消息中呈现完整证据摘要，格式：

```
## Gate 自检结果

- rev-01 ✅ [证据：所有评论处置状态]
- rev-02 ✅ [证据：验证命令+实际输出]
- rev-03 ✅ [证据：本轮新发布的签名评论链接 + set_context review_comment_url 调用记录]
- rev-ctx ✅ [证据：set_context 调用记录]

所有 required 项通过，可以提议推进。
```

4. 确认所有标 ✅ 的 required 项均有实质性证据后，调用 `request_stage_transition` 请求推进
5. 存在未通过项时，不得请求推进，应继续处理检视意见

## 信号协议

完成 Gate 自检后，调用 `request_stage_transition` 工具请求推进。自检证据写在 `reason` 参数中。

### 共识信号（两个 reviewer 都认可）

```
request_stage_transition({
  stage_id: "<从环境变量获取>",
  target_key: "merge",
  reason: "所有检视意见已处理，验证通过。\n\nrev-01: 所有评论处置状态: 已修复\nrev-02: npm run check 通过\nrev-03: PR #123 本轮新评论已签名，review_comment_url 已写入\nrev-04: feature_number=F20260701tj92\nrev-ctx: pr_url=https://github.com/...",
  from_speaker: "审查者-1"
})
```

**注意**：review 阶段需要两个审查者都调用 `request_stage_transition` 才能自动推进。系统通过 speaker count ≥ 2 保证共识。

### 分歧信号（存在问题）

```
request_stage_transition({
  stage_id: "<从环境变量获取>",
  target_key: "merge",
  signal_type: "disagreement",
  reason: "发现未处理的检视意见",
  from_speaker: "审查者-1"
})
```
