# Stage Gate 自检

## 流程

阶段即将结束时，必须对照验收清单逐项自查，在消息中呈现完整证据。

1. 逐项对照验收清单（定义在各角色 SKILL.md 的"Stage Gate 自检"章节），检查每项是否满足
2. 为每项准备证据（验证命令+实际输出、文档引用、PR 链接等）
3. 在消息中呈现证据摘要（格式见各 SKILL.md）
4. 确认所有 required 项通过后，才可包含 stage_transition 建议

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
| design → development | 收到 `consensus: true` 信号（两个架构师）+ design-01/02 通过 | 收到 `consensus: false` 信号 或 无信号 |
| development → review | 收到 `consensus: true` + `gate_evidence` 信号 + dev-01~06 通过 | dev-06 evidence 缺失 |
| review → merge 前置 | 收到 `consensus: true` 信号（两个 reviewer）+ rev-01~03 通过 + review 循环 ≤ 2 轮 | 收到 `consensus: false` 信号 或 review 循环 > 2 轮 |
| merge 前置 → merge | **不自动推进**。呈现"合入就绪"状态，等待用户显式执行 | — |

### 特殊规则

- **[Incompatible] 标签**：如果 PR 标题包含 `[Incompatible]`，review → merge 前置的自动推进被阻断，必须等待用户确认
- **手动 advance**：用户手动调用 `advanceStage()` 时，直接绕过自动推进条件
- **回滚**：用户可以回退到上一个 stage，回滚时会清理所有信号防止重新触发
