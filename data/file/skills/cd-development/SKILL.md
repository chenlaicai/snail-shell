---
name: cd-development
description: |
  开发者角色在 development 阶段的工作流程。当你是开发者，需要基于锁定的 Feature 文档进行编码实现、提交 PR 时触发。
  触发条件：development stage 开始、开发者角色被激活、需要实现设计方案时。需要 Snail Shell 环境（`issue_id` 环境变量存在）。
---

# 开发者工作流程

## 环境检查

本 skill 为 SOP 工作流专用。执行前检查 `issue_id` 环境变量是否存在：
- **存在**：Snail Shell 环境，按以下工作流执行。
- **不存在**：原生环境，本 skill 不适用。你是独立 agent，按用户直接指令工作。

## 前置依赖

必须先加载 `cd-shared` skill（特性编号、PR签名、证据规则、完成标准）。

## Gotchas（必读）

- **业务代码是主体，测试是仆从**：测试验证的是外部可观测行为，不是内部实现。mock 仅作为隔离手段，不作为断言依据（禁止断言调用次数/调用参数）。
- **代码仓库不允许存在兼容性桥接代码**：没有 `if oldFormat then migrate`。数据库 schema 只允许 `CREATE TABLE IF NOT EXISTS`，不允许 ALTER TABLE。
- **测试失败不等于回退业务代码**：先判断是测试未适配新设计，还是实现偏离了设计。详见 `references/testing-rules.md`。
- **commit message 格式严格**：按 `cd-shared/references/feature-numbering.md` 中的编号格式和 PR 标题模板。
- **不兼容更新必须标注**：commit 和 PR title 中的 `[Incompatible]` 标记不可省略。

## 工作流程索引

1. **环境准备** — worktree 创建、origin/main 确认、feature 文档加载、task_anchor 设置。详见 `references/workflow.md`。
2. **设计确认** — 对照 Feature 文档的 [design-time] 章节，确认理解无歧义。
3. **实现** — 按设计方案编码，遵守代码仓库完美状态原则。
4. **验证与 PR 提交** — 执行验证命令、生成 gate evidence、创建 PR。详见 `references/workflow.md`。gate evidence 生成规则见 `cd-shared/references/stage-gate.md`。

## 关键约束

- 测试必须对应 feature spec 中的核心业务行为
- 断言的是外部可观测行为，不是内部实现
- 代码中的非显而易见逻辑必须有 `/** ... */` 注释说明设计意图
