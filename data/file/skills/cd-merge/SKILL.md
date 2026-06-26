---
name: cd-merge
description: |
  合入者角色在 merge 阶段的工作流程。当你是合入者，需要检查 PR 是否满足合入条件时触发。
  触发条件：merge stage 开始、合入者角色被激活、需要执行合入检查时。
---

# 合入者工作流程

## 前置依赖

必须先加载 `cd-shared` skill（特性编号、PR签名、证据规则、完成标准）。

## 硬条件检查（全部必须通过）

**[HARD] 你是合入阶段的守门人**：必须逐项完成下方检查，逐条附带证据。任一条件未通过则回退，不得"降级通过"或"建议合入"。禁用"差不多了"、"问题不大"、"可以先合"等话术。

1. **PR 基于最新 `origin/main`**：commit 历史比对，确认没有落后

1. **PR 基于最新 `origin/main`**：commit 历史比对，确认没有落后
2. **CI 通过**：所有检查项为绿色
3. **Feature 文档编号合规**：`FYYYYMMDDxxxx` 格式正确，目录不冲突，符合特性编号规则
4. **PR 标题/commit 模板合规**：格式正确
5. **PR 标题特性编号与 Feature 文档编号一致**：PR 标题中的特性编号必须与当前 Issue 关联的 Feature 文档编号完全一致。不一致时，合入者必须先修正 PR 标题再 squash
6. **不兼容更新已标注**：如有不兼容变更，commit 和 PR title 中有 `[Incompatible]` 标记
7. **Gate evidence 完整**：dev-06（开发者验证）和 rev-02（审查者验证）的 evidence 均已记录。gate evidence 格式要求见 `cd-shared/references/stage-gate.md`
8. **PR 评论签名合规**：所有 PR 评论的签名格式正确，角色名和 Snail 名称与 system prompt 注入值一致。签名合规性为 required（详见 `cd-shared/references/pr-signature.md`）

## 决策

- **全部通过** → squash merge
- **任一失败** → 回退到 review stage，说明具体失败项

## Stage Gate 自检（必须）

**在执行合入或建议推进之前，必须完成以下自检。未完成自检不得执行合入。**

### 验收清单

| ID | 清单项 | 必须 |
|---|--------|------|
| merge-01 | PR 基于最新 origin/main | ✅ |
| merge-02 | CI 全部通过 | ✅ |
| merge-03 | Feature 文档编号合规 | ✅ |
| merge-04 | PR 标题和 commit 模板合规 | ✅ |
| merge-05 | 使用 Squash Merge 合入 | ✅ |
| merge-06 | PR 标题中的特性编号与当前 Issue 关联的 Feature 文档编号一致 | ✅ |
| merge-07 | PR 评论签名合规 | ✅ |

### 执行步骤

1. 逐项对照上方清单，逐条执行检查并记录结果
2. 为每项准备证据（命令输出、截图说明等）
3. 在消息中呈现完整证据摘要，格式：

```
## Gate 自检结果

- merge-01 ✅ [证据：commit 比对]
- merge-02 ✅ [证据：CI 状态]
- merge-03 ✅ [证据：编号格式验证]
- merge-04 ✅ [证据：标题格式]
- merge-05 ✅ [证据：merge 方式]
- merge-06 ✅ [证据：编号一致性]
- merge-07 ✅ [证据：签名合规]

所有 required 项通过，执行合入。
```

4. 所有项通过后执行 squash merge
5. 任一未通过时，回退到 review stage 并说明具体失败项
