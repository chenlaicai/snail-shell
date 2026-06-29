---
name: cd-development
description: |
  开发者角色在 development 阶段的工作流程。当你是开发者，需要基于锁定的 Feature 文档进行编码实现、提交 PR 时触发。
  触发条件：development stage 开始、开发者角色被激活、需要实现设计方案时。
---

# 开发者工作流程

## 前置依赖

必须先加载 `cd-shared` skill（特性编号、PR签名、证据规则、完成标准）。

## Gotchas（必读）

- **[HARD] Stage Gate 自检**：你是开发阶段的守门人，不是推进者。在建议 stage_transition 之前，必须逐项完成下方 Stage Gate 自检章节，呈现完整证据。禁用"代码写完了"、"测试通过了"、"PR 提了"等笼统陈述——每项必须附带具体验证输出或 PR 链接。未完成自检直接建议推进 = 违规。
- **业务代码是主体，测试是仆从**：测试验证的是外部可观测行为，不是内部实现。mock 仅作为隔离手段，不作为断言依据（禁止断言调用次数/调用参数）。
- **代码仓库不允许存在兼容性桥接代码**：没有 `if oldFormat then migrate`。数据库 schema 只允许 `CREATE TABLE IF NOT EXISTS`，不允许 ALTER TABLE。
- **测试失败不等于回退业务代码**：先判断是测试未适配新设计，还是实现偏离了设计。详见 `references/testing-rules.md`。
- **commit message 格式严格**：按 `cd-shared/references/feature-numbering.md` 中的编号格式和 PR 标题模板。
- **不兼容更新必须标注**：commit 和 PR title 中的 `[Incompatible]` 标记不可省略。

## 工作流程索引

1. **环境准备** — worktree 创建、origin/main 确认、feature 文档加载、issue context `sop.change_type` 设置。详见 `references/workflow.md`。
2. **设计确认** — 对照 Feature 文档的 [design-time] 章节，确认理解无歧义。
3. **实现** — 按设计方案编码，遵守代码仓库完美状态原则。
4. **验证与 PR 提交** — 执行验证命令、生成 gate evidence、创建 PR。详见 `references/workflow.md`。gate evidence 生成规则见 `cd-shared/references/stage-gate.md`。

## 关键约束

- 测试必须对应 feature spec 中的核心业务行为
- 测试的规格来源必须是 spec 中的核心业务行为，不是从代码实现反推
- 断言的是外部可观测行为，不是内部实现；禁止 `toHaveBeenCalledWith` / `toBeCalledTimes`（绑定实现），允许 `toHaveBeenCalled()`（验证副作用触发）、`toBe` / `toEqual` / `toMatchObject` / `toContain`（验证返回值和状态）
- 代码中的非显而易见逻辑必须有 `/** ... */` 注释说明设计意图

## Stage Gate 自检（必须）

**在考虑提议推进 stage_transition 之前，必须完成以下自检。未完成自检不得建议推进。**

### 验收清单

| ID | 清单项 | 必须 |
|---|--------|------|
| dev-01 | 代码已在 worktree 中完整实现 | ✅ |
| dev-02 | 自检通过：业务代码按设计意图实现；测试已随业务变更同步更新；测试、构建无报错 | ✅ |
| dev-03 | Feature 文档已同步更新 | ✅ |
| dev-04 | PR 已创建且包含完整改动摘要 | ✅ |
| dev-05 | 不兼容更新已在 PR 中标注 | |
| dev-06 | 变更完整性已验证：根据 issue context 的 `sop.change_type` 执行对应验证命令，实际输出已写入 gate_evidence | ✅ |
| dev-ctx | worktree_path、branch_name、pr_url 已通过 set_context 写入 Issue.context | ✅ |

### 执行步骤

1. 逐项对照上方清单，检查每项是否满足
2. 为每项准备证据（验证命令+实际输出，或具体说明）
3. 在消息中呈现完整证据摘要，格式：

```
## Gate 自检结果

- dev-01 ✅ [证据]
- dev-02 ✅ [证据]
- dev-03 ✅ [证据]
- dev-04 ✅ [证据]
- dev-05 ⏭️ [跳过原因]
- dev-06 ✅ [证据]
- dev-ctx ✅ [证据：set_context 调用记录]

所有 required 项通过，可以提议推进。
```

4. 确认所有标 ✅ 的 required 项均有实质性证据后，才可在消息中包含 stage_transition 建议
5. 存在未通过项时，不得建议推进，应继续处理未完成的工作

## 信号协议

完成 Gate 自检后，通过结构化信号表达阶段工作结果：

### Gate Complete 信号（单人完成）

```json
{
  "stage_transition": {
    "target_key": "review",
    "consensus": true,
    "reason": "代码实现完成，自检通过，PR 已创建",
    "guard": "dev-01: 代码已实现; dev-02: 自检通过; dev-03: 文档已更新; dev-04: PR 已创建; dev-06: 变更完整性已验证",
    "gate_evidence": {
      "dev-01": "src/app/issue-collaboration/collaboration.ts 已修改",
      "dev-02": "npm run check 通过",
      "dev-03": "docs/features/2026/06/26/F20260626m4vx.md 已更新",
      "dev-04": "PR #123 已创建",
      "dev-06": "npm run check 通过",
      "dev-ctx": "worktree_path=/Users/.../worktrees/xxx, branch_name=feature-xxx, pr_url=https://github.com/..."
    }
  }
}
```

**注意**：development stage 只有一个开发者，不存在对抗机制，所以 `consensus` 固定为 `true`。
