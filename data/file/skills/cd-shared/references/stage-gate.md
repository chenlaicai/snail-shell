# Stage Gate 自检

## 流程

阶段即将结束时，必须对照验收清单逐项自查，生成 gate evidence。

1. 逐项对照验收清单，检查每项是否满足
2. 为每项生成证据：`{ checklistId, status: "passed"|"failed"|"skipped", evidence: "具体说明" }`
3. 将完整证据通过 `stage-gate` API 写入当前 stage 的 `gate_evidence` 字段
4. 在消息中呈现证据摘要，等待用户确认推进

## 注意事项

- required 项必须全部 passed 才能提议推进
- 可选项可以标记为 skipped，但需说明原因
- 用户有最终决定权，即使有未通过项也可以手动推进
- 证据必须基于实际验证，不得虚构
