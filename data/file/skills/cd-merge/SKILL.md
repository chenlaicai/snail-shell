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
