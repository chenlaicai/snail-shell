---
name: cd-merge
description: |
  合入者角色在 merge 阶段的工作流程。当你是合入者，需要检查 PR 是否满足合入条件时触发。
  触发条件：merge stage 开始、合入者角色被激活、需要执行合入检查时。
---

# 合入者工作流程

## 前置依赖

必须先加载 `cd-shared` skill（特性编号、PR签名、证据规则、完成标准）。

## 情境感知

进入 stage 后，在开始具体工作前，先了解当前情境：

1. **阅读 context block**：system-reminder 中的"阶段历史"段落已包含完整的阶段链和前序阶段的关键消息
2. **判断是否为重新进入**：如果 kickoff 消息包含"重新进入"或 context block 标注"重新进入"，说明你正在重新进入一个已访问过的阶段，需要特别关注前序阶段发生了什么变化
3. **按需深入查询**：如果 context block 中的信息不足以理解当前情况，使用以下 MCP 工具：
   - `get_stage_history`：获取完整的阶段历史和结构化数据
   - `list_messages`：查询特定阶段的消息列表
   - `search_messages`：按关键词搜索历史消息
   - `get_context`：读取 Issue 上下文中存储的跨阶段元数据
4. **不要假设"开始执行"意味着从零开始**：前序阶段可能已经完成了大量工作，你需要在已有基础上继续

## 硬条件检查（全部必须通过）

**[HARD] 合入者不得执行 `gh pr merge` 或任何 PR 合入命令。合入者的职责是检查 + 声明就绪，合入操作由用户执行。**

**[HARD] 你是合入阶段的守门人**：必须逐项完成下方检查，逐条附带证据。任一条件未通过则回退，不得"降级通过"或"建议合入"。禁用"差不多了"、"问题不大"、"可以先合"等话术。

1. **PR 基于最新 `origin/main`**：commit 历史比对，确认没有落后
2. **CI 通过**：所有检查项为绿色
3. **Feature 文档编号合规**：`FYYYYMMDDxxxx` 格式正确，目录不冲突，符合特性编号规则
4. **PR 标题/commit 模板合规**：格式正确
5. **PR 标题特性编号与 Feature 文档编号一致**：PR 标题中的特性编号必须与当前 Issue 关联的 Feature 文档编号完全一致。不一致时，合入者必须先修正 PR 标题
6. **不兼容更新已标注**：如有不兼容变更，commit 和 PR title 中有 `[Incompatible]` 标记
7. **Gate evidence 完整**：dev-06（开发者验证）和 rev-02（审查者验证）的 evidence 均已记录。gate evidence 格式要求见 `cd-shared/references/stage-gate.md`
8. **PR 评论签名合规**：所有 PR 评论的签名格式正确，角色名和 Snail 名称与 system prompt 注入值一致。签名合规性为 required（详见 `cd-shared/references/pr-signature.md`）

## 决策

- **全部通过** → 声明"合入就绪"，等待用户执行合入
- **任一失败** → 回退到 review stage，说明具体失败项

## 自动推进说明

merge 阶段**不自动推进**，合入者**不得执行合入命令**。当 review 阶段的对抗机制达成共识且所有 gate 通过时，合入者声明"合入就绪"状态，**合入操作由用户显式执行**。

原因：merge 是不可逆操作（代码进入 main），必须由用户控制。

## Stage Gate 自检（必须）

**在声明合入就绪之前，必须完成以下自检。未完成自检不得声明就绪。**

### 验收清单

| ID | 清单项 | 必须 |
|---|--------|------|
| merge-01 | PR 基于最新 origin/main | ✅ |
| merge-02 | CI 全部通过 | ✅ |
| merge-03 | Feature 文档编号合规 | ✅ |
| merge-04 | PR 标题和 commit 模板合规 | ✅ |
| merge-05 | 声明 Squash Merge 合入就绪 | ✅ |
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

所有 required 项通过，声明合入就绪，等待用户操作。
```

4. 所有项通过后，声明合入就绪并告知用户执行合入操作
5. 任一未通过时，回退到 review stage 并说明具体失败项
