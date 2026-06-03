---
id: I2026060303
title: stage-transition-verification
from_ids: []
tags: []
modules: [workflow, prompt, web]
doc_kind: spec
---

# I2026060303 [workflow] 设计阶段 worktree 约束、设计约束摘要与阶段自动触发

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

三个关联问题：

1. **设计阶段产物写入主目录**：designer handbook GATE-1 要求创建 worktree，但未要求调用 `record-issue-repo-context` 记录资源，导致设计阶段的 issue 文档可能直接写入主目录而非 worktree。与 developer handbook 不一致。

2. **设计文档太长，研发者不会全文看**：issue 文档的设计章节（背景、目标、非目标、设计、生效路径）可能很长，研发者进入实现阶段时难以快速抓住关键边界。AI 有时会提出"完整方案 vs 临时方案"的伪选择题，违反了"必须做完整实现"的基本原则。

3. **进入新阶段后还得手动说话**：stage transition 完成后 conversation 为空，用户必须手动发消息才能触发 AI 工作。

## 目标

### P1 — 设计阶段 worktree 纪律

designer handbook GATE-1 与 developer handbook 对齐：创建 worktree 后必须调用 `record-issue-repo-context` 记录到 stage output_artifacts，确保归档时能清理。措辞从"代码修改"改为"文件修改（包括 issue 文档）"。

### P2 — 设计约束摘要

issue 文档模板新增 `## 设计约束摘要` 章节（在 [design-time] 范围内），设计者从设计章节中提取：边界、关键决策、非目标约束、语义不变量。研发者以此为快速参考入口。

### P3 — 禁止伪选择题

通用指南新增 [STD] 规则：禁止将"完整方案"与"临时方案/兼容方案"作为等价选项呈现。基本原则是必须做完整实现，只有存在真实外部约束时才允许分步。

### P4 — 阶段自动触发

stage transition 完成后，前端自动发送"开始执行。"消息触发 AI 工作。B-01 明确 stage 转移后的首次输入属于"明确任务触发"。

## 非目标

- 不改变 stage transition 的后端逻辑
- 不改变 AI 的 stage transition proposal 机制
- 不改变 issue 文档的其他章节结构

## 设计

### P1 详设

designer handbook GATE-1 新增：
- worktree 路径验证：`<workspace>/.claude/worktrees/` 或 `<workspace>/.snail/worktrees/`
- `record-issue-repo-context --set worktree_path=<path> --set branch_name=<branch>` 要求
- 措辞："严禁在主目录进行任何文件修改（包括 issue 文档）"

### P2 详设

issue 文档模板在 `## 生效路径` 之后、`<!-- [design-time] 章节结束 -->` 之前插入：

```markdown
## 设计约束摘要

从上述设计章节中提取研发阶段必须遵守的关键约束。此节为研发者快速参考入口，避免全文阅读遗漏边界。

- **边界**：不得越过的范围限制（模块边界、数据边界、职责边界）
- **关键决策**：已确认的设计取舍及理由（研发者不得自行推翻）
- **非目标约束**：明确不处理的范围（研发者不得扩展）
- **语义不变量**：实现中必须保持为真的事实
```

designer handbook 阶段四新增确认「设计约束摘要」已提取。

### P3 详设

`.meta/prompts/reference/通用指南.md` 在"分步原则"下新增：

```
[STD] 禁止将"完整方案"与"临时方案/兼容方案"作为等价选项呈现。基本原则是必须做完整实现、不考虑兼容性或改动量——只有存在真实外部约束时才允许分步，且必须明确说明约束来源。如果发现自己在提议临时方案，先追溯为什么完整方案不可行；如无真实约束，直接执行完整方案。
```

### P4 详设

`src/web/stage-controller.js` 的 `createNextStage` 和 `bounceStage` 在 `connectWS` 之后追加：

```javascript
api("POST", `/conversations/${result.conversation.id}/messages`, { content: "开始执行。" }).catch(() => {});
```

B-01 第 24 行更新：stage 转移后的首次输入（如"开始执行"）属于明确任务触发，应直接按当前阶段工作流程开始执行。

## 生效路径

- `config/sop/code-delivery/design#designer.handbook.md` — 设计者 GATE-1 和产出锁定
- `docs/README.md` — issue 文档模板
- `.meta/prompts/reference/通用指南.md` — 分步原则
- `.meta/prompts/prompts/B-01-身份与责任契约.md` — 全阶段规则
- `src/web/stage-controller.js` — 前端 stage 控制器

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 改动 |
|------|------|
| `config/sop/code-delivery/design#designer.handbook.md` | GATE-1 新增 record-issue-repo-context + 路径验证 + 措辞修正；阶段四新增设计约束摘要确认；自检清单更新 |
| `docs/README.md` | issue 模板新增 `## 设计约束摘要` 章节 |
| `.meta/prompts/reference/通用指南.md` | 新增 [STD] 禁止伪选择题规则 |
| `.meta/prompts/prompts/B-01-身份与责任契约.md` | 第 24 行更新：stage 转移后首次输入 = 明确任务触发 |
| `src/web/stage-controller.js` | createNextStage + bounceStage 新增自动 kickoff 消息 |

## 验证

### P1

- [ ] designer handbook GATE-1 包含 record-issue-repo-context 要求
- [ ] 措辞为"文件修改（包括 issue 文档）"而非"代码修改"
- [ ] 自检清单包含 "repo context 已记录"

### P2

- [ ] issue 模板包含 `设计约束摘要` 章节且在 [design-time] 范围内
- [ ] 包含四个子项：边界、关键决策、非目标约束、语义不变量
- [ ] designer handbook 阶段四要求确认摘要已提取

### P3

- [ ] 通用指南包含 [STD] 禁止伪选择题规则

### P4

- [ ] stage-controller.js 在 createNextStage 和 bounceStage 中均有 kickoff 消息
- [ ] B-01 明确 stage 转移后首次输入属于明确任务触发
- [ ] stage-controller.js 语法检查通过

### 通用

- [ ] 所有改动文件无语法错误
