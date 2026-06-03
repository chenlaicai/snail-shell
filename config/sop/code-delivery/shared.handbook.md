## 通用规则

### PR 评论签名

具体模板见 `.meta/templates/pr-comment-signature.md`。

规则摘要：
- 评论最后一行：`by <角色名>（<Snail 名称>）`
- 签名与正文之间保留一个真实 Markdown 空行
- 签名不得与正文挤在同一行或非末行位置
- `<Snail 名称>` 使用系统提示词中"当前 Snail 名称"注入的值，不得自行猜测

### Stage Gate 自检

阶段即将结束时，必须对照验收清单逐项自查，生成 gate 证据。

验收清单见 `{{stage_acceptance_checklist_block}}`。

自检流程：
1. 逐项对照验收清单，检查每项是否满足
2. 为每项生成证据：`{ checklistId, status: "passed"|"failed"|"skipped", evidence: "具体说明" }`
3. 将完整证据通过 `stage-gate` API 写入当前 stage 的 `gate_evidence` 字段
4. 在消息中呈现证据摘要，等待用户确认推进

注意事项：
- required 项必须全部 passed 才能提议推进
- 可选项可以标记为 skipped，但需说明原因
- 用户有最终决定权，即使有未通过项也可以手动推进
- 证据必须基于实际验证，不得虚构

### 证据规则

每个阶段的 gate_evidence 中，任何标记为 passed 的 checklist 项，必须附带以下之一：

1. **验证命令 + 实际输出**：执行具体的验证命令（grep、启动、测试、配置读取等），将输出内容作为 evidence
2. **影响面清单 + 逐条确认**：列出受影响的文件/模块/配置，逐条记录确认结果
3. **配置对一致性对比**：列出关联配置对，逐条读取并对比一致性

禁止以 "I checked"、"I verified"、"I confirmed"、"diff 看起来都改了" 作为唯一 evidence。evidence 必须包含可复查的客观数据（命令输出、文件内容、对比结果）。

**按变更类型选择验证命令**：task_anchor 中的 `change_type` 决定本 issue 应执行哪组验证命令。开发者在提交 PR 前执行并记录输出；检视者在检视时独立执行同一组命令，对比结果。

task_anchor 中有 `verification_commands` 时，按其执行。没有时，按以下默认模板执行：

| 变更类型 | 默认验证命令 | evidence 要求 |
|---|---|---|
| `rename` | `grep -r "旧名字" <受影响目录>` | 输出为 0 匹配 |
| `migration` | 列出所有消费者，逐一确认已切换 | 逐条记录确认结果 |
| `config-sync` | 列出关联配置对，逐条读取对比 | 实际内容对比 |
| `refactor` | 启动验证 + 核心路径 smoke test | 启动日志/测试输出 |
| `feature` | 正向 + 边界 case 验证 | 执行结果 |
| `bugfix` | 复现步骤确认修复 + 回归检查 | 修复前后对比 |
