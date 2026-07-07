# Stage Gate 自检

## 流程

阶段即将结束时，必须对照验收清单逐项自查，在消息中呈现完整证据。

1. 逐项对照验收清单（定义在各角色 SKILL.md 的"Stage Gate 自检"章节），检查每项是否满足
2. 为每项准备证据（验证命令+实际输出、文档引用、PR 链接等）
3. 在消息中呈现证据摘要（格式见各 SKILL.md）
4. 确认所有 required 项通过后，才可包含 stage_transition 建议

## 信号投递方式

Agent 通过 `request_stage_transition` MCP 工具请求推进。工具校验通过后信号被持久化，进入自动推进评估流程。校验失败时返回 reasons，agent 根据原因自纠后重试。

## 注意事项

- required 项必须全部 passed 才能提议推进
- 可选项可以标记为 skipped，但需说明原因
- 用户有最终决定权，即使有未通过项也可以手动推进
- 证据必须基于实际验证，不得虚构（禁止以 "I checked"、"I verified" 作为唯一证据）
- 各角色的验收清单定义在对应的 SKILL.md 中，不在本文件中重复

## 禁止的逃逸话术

以下话术不得作为 gate 自检的唯一依据——每项必须附带具体的验证命令输出、文件引用或 PR 链接：

- "看起来没问题" / "基本完成" / "没有明显问题"
- "代码写完了" / "测试通过了" / "PR 提了"
- "检视完了" / "没问题了" / "可以合入"
- "不堵塞" / "可遗留" / "建议合入" / "后续优化"
- "差不多了" / "问题不大" / "可以先合"

## 自动推进条件表

当 agent 发出信号后，系统会根据以下条件自动判断是否推进：

| 阶段转换 | 自动推进条件 | 升级条件 |
|----------|-------------|---------|
| design → development | 收到 2 个 `adversarial_consensus` 信号（两个架构师）+ 系统自动检查通过（design-01: feature_doc_path 存在） | `signal_type: "disagreement"` 信号 |
| development → review | 收到 `gate_complete` 信号 + 系统自动检查通过（dev-04: pr_url 存在） | 系统校验失败 |
| development → design | 收到 `gate_complete` 信号 + target_key 指向 design（intake 审视或工作过程中发现设计缺陷） | 方向与已有信号冲突 |
| review → merge 前置 | 收到 2 个 `adversarial_consensus` 信号（两个 reviewer）+ 系统自动检查通过（rev-04: feature_number 正则校验） | `signal_type: "disagreement"` 信号 |
| review → design | 收到信号 + target_key 指向 design（intake 审视或检视中发现设计问题） | 方向与已有信号冲突 |
| merge → review | 收到信号 + target_key 指向 review（合入检查失败） | — |
| merge 前置 → merge | **不自动推进**。呈现"合入就绪"状态，等待用户显式执行 | — |

### 特殊规则

- **[Incompatible] 标签**：如果 PR 标题包含 `[Incompatible]`，review → merge 前置的自动推进被阻断，必须等待用户确认
- **手动 advance**：用户手动调用 `advanceStage()` 时，直接绕过自动推进条件
- **回滚**：用户可以回退到上一个 stage，回滚时会清理所有信号防止重新触发
- **方向互斥**：同一阶段内，已有正向信号时不得发出反向信号（反之亦然），方向冲突自动触发 disagreement
- **target_key 一致性**：双 agent 阶段（design、review），所有 speaker 的 target_key 必须一致，不一致时升级到人工
- **反向转移后 kickoff**：反向转移后，reactivated stage 的 kickoff 消息包含打回原因
- **Intake 审视**：agent 进入阶段后首先评估上游产物质量，不足时立即调用 `request_stage_transition` 请求退回。详见 `intake-protocol.md`

## 失败反馈

自动推进引擎每次评估都返回结构化 `EvaluationResult`，包含 `action`（auto_advanced / blocked / escalated）和 `reasons` 列表。每个 reason 包含 `code`、`severity`、`message` 和可选的 `details`。

常见错误码：

| code | 含义 |
|------|------|
| `CONTEXT_MISSING` | Issue 上下文缺少必要字段（worktree_path / branch_name / pr_url / feature_number） |
| `SPEAKERS_INSUFFICIENT` | 共识信号的 speaker 不足 2 个 |
| `GATE_FAILED` | 系统自动检查未通过（如 feature_doc_path 不存在、feature_number 格式错误） |
| `INCOMPATIBLE_BLOCKED` | PR 标题含 [Incompatible] |
| `DISAGREEMENT` | 存在分歧，需人工决策 |

当自动推进被阻断时，系统会通过 `onEvaluationResult` 通知消费者，前端可展示阻断原因。
