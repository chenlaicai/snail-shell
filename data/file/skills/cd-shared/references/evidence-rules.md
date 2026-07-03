# 证据规则

## 基本要求

每个阶段的 gate_evidence 中，任何标记为 passed 的 checklist 项，必须附带以下之一：

1. **验证命令 + 实际输出**：执行具体的验证命令（grep、启动、测试、配置读取等），将输出内容作为 evidence
2. **影响面清单 + 逐条确认**：列出受影响的文件/模块/配置，逐条记录确认结果
3. **配置对一致性对比**：列出关联配置对，逐条读取并对比一致性
4. **视觉证据（截图/录屏）**：当 Feature 文档的意图锚中包含视觉/空间/动画类修饰语时，开发者 PR 描述中必须附带关键状态的截图或录屏。截图必须标注与意图锚描述的对应关系。审查者比对截图与意图锚描述，不一致 = 审查不通过，标记为 bug

**禁止**以 "I checked"、"I verified"、"I confirmed"、"diff 看起来都改了" 作为唯一 evidence。evidence 必须包含可复查的客观数据。

## 按变更类型选择验证命令

issue context 中的 `sop.change_type` 决定本 feature 应执行哪组验证命令。开发者在提交 PR 前执行并记录输出；审查者在审查时独立执行同一组命令，对比结果。

issue context 中有 `sop.verification_commands` 时，按其执行。没有时，按以下默认模板执行：

| 变更类型 | 默认验证命令 | evidence 要求 |
|---|---|---|
| `rename` | `grep -r "旧名字" <受影响目录>` | 输出为 0 匹配 |
| `migration` | 列出所有消费者，逐一确认已切换 | 每条消费者确认结果（路径/命令 + 结果） |
| `config-sync` | 列出关联配置对，逐条读取对比 | 每个配置对的关键字段值一致（附实际值） |
| `refactor` | `npm run check` + `npm run test` + 核心路径 smoke test | 编译输出 + 测试输出 + 启动日志 |
| `feature` | `npm run check` + `npm run test` + 正向 + 边界 case 验证 | 编译输出 + 测试输出 + 执行结果 |
| `bugfix` | 复现步骤确认修复 + 回归检查 | 修复前后对比 |
| `testing` | `npm run check` + `npm run test` | 编译输出 + 测试输出 + 断言约束 lint 通过 |
