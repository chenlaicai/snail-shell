---
name: cd-shared
description: |
  代码交付 SOP 的跨角色共享规则。当你的角色属于 code-delivery SOP 的任意阶段时，本 skill 提供特性编号、PR 签名、证据规则和完成标准。
  触发条件：code-delivery SOP 中的任意角色被激活时自动适用。
---

# 代码交付共享规则

## Gotchas（必读）

- **特性编号终身不变**：编号在创建时一次性分配，无论 PR 何时合入均不变更。不存在顺延机制。详见 `references/feature-numbering.md`。
- **evidence 不能是 "I checked"**：passed 项必须附带验证命令 + 实际输出，或影响面清单逐条确认，或配置对一致性对比。
- **完成标准是"做到最好"**：不是"没有阻塞项"。发现的质量改进必须在当前 PR 修复，不得推到"后续 feature"。
- **签名必须独占一行**：PR 评论最后一行 `by <角色名>（<Snail 名称>）`，与正文之间保留空行，不得挤在同一行。
- **[HARD] 文件修改前必须先进 worktree**：严禁在主目录写任何文件，包括 feature 文档。详见 `references/worktree-discipline.md`。

## 核心规则

### Worktree 纪律

- **任何文件修改前必须先创建并进入 worktree**（基于最新 `origin/main`）
- 验证当前工作目录在 `<workspace>/.claude/worktrees/` 或 `<workspace>/.snail/worktrees/` 内
- **严禁在主目录进行任何文件修改**（包括 feature 文档、代码、配置）
- 详见 `references/worktree-discipline.md`

### 特性编号

编号创建后终身不变，目录 `docs/features/YYYY/MM/DD/`。详见 `references/feature-numbering.md`。

### PR 评论签名

评论最后一行：`by <角色名>（<Snail 名称>）`。Snail 名称使用系统提示词注入的值，不得自行猜测。详见 `references/pr-signature.md`。

### Stage Gate 自检

阶段结束时对照验收清单逐项自查，自检证据写在 `request_stage_transition` 的 `reason` 参数中。详见 `references/stage-gate.md`。

### 证据规则

每个 passed 项必须附带客观数据。按 `change_type` 选择验证命令。详见 `references/evidence-rules.md`。

### 完成标准

完成 = "在当前 PR 范围内做到了最好"。可选项不是"可忽略项"——必须评估，确认不适用才跳过。

### 意图锚追溯验证

当 Feature 文档包含意图锚时，各角色在 Stage Gate 自检中必须验证：
- **架构师**：意图锚已填写、逐字引用、修饰语完整、来源有消息 ID；行为条目有 `← UA-n` 追溯
- **开发者**：实现保留了意图锚中的所有修饰语；视觉/空间类变更附截图/录屏
- **审查者**：截图/录屏与意图锚描述一致；行为条目追溯关系正确
