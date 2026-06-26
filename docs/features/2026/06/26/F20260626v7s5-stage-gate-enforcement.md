---
id: F20260626v7s5
title: stage-gate-enforcement
from_ids: [F2026060306, F2026060305, F2026060113]
tags: [stage-transition, gate, sop, prompt]
modules: [skills]
doc_kind: spec
---

# F20260626v7s5 [sop] Stage Gate 强制执行：消除 Agent 急迫推进

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

当前系统中，每个 role 的 Agent 都急迫地推进 stage transition——即使有问题、没校验，每次发言基本都在说"没啥问题，建议推进 stage"。

**根因分析**：

1. **协作规则过弱**：`buildContextBlock()` 注入的协作规则是"如果阶段看起来完成了，建议 stage_transition"。"看起来完成了"是主观判断，无具体标准，反而暗示 Agent 积极推进。

2. **Gate 自检不是强制步骤**：`stage-gate.md` 定义了自检流程，但只是描述性文本，没有嵌入各角色的工作流中。Agent 可以完全跳过。

3. **无身份约束**：Agent 不认为自己是"守门人"，而是"推进者"。身份认知错误导致行为偏差。

4. **无逃逸话术封堵**：Agent 可以用"看起来没问题"、"基本完成"等模糊话术绕过检查。

## 目标

通过 skill 层面的强化，使 Agent 在 gate 未通过时不会建议推进。

## 设计

### 核心设计原则

基于 Agent 行为特性分析，有效的行为约束需要满足：

| 原则 | 说明 | 示例 |
|------|------|------|
| 身份重定义 | 改变 Agent 的自我认知 | "你是守门人，不是推进者" |
| 规则自带验证 | 规则内嵌入验证步骤 | "执行 X，确认 Y 输出 Z" |
| 禁止+替代 | 封堵逃逸路径并给出正确做法 | "不得说'没问题'，必须逐条列出" |
| 话术封堵 | 列出禁止的具体话术 | "禁用'不堵塞''可遗留'" |
| `[HARD]` 标记 | 标记为核心行为边界 | 提升到系统提示词级别 |

### 改动 1：协作规则措辞强化

**文件**：`src/app/issue-collaboration/collaboration.ts` 的 `buildContextBlock()`

**当前**：
```
- 如果阶段看起来完成了，建议 stage_transition 等待用户确认
```

**改为**：
```
- 你是当前阶段的守门人，不是推进者。建议 stage_transition 前，必须先完成所在 SKILL.md 中的 Stage Gate 自检并呈现完整证据。未完成自检不得建议推进。
```

### 改动 2：各 SKILL.md 增加 `[HARD]` Gate 自检

**设计要点**：
- 使用 `[HARD]` 标签提升为系统提示词级别的核心行为边界
- 身份重定义：明确 Agent 是"守门人"
- 话术封堵：列出禁止的逃逸话术
- 规则自带验证：内嵌验证步骤和输出格式
- 放在 Gotchas 首位（最高优先级）

**cd-design/SKILL.md Gotchas 新增**：
```markdown
- **[HARD] Stage Gate 自检**：你是设计阶段的守门人。在建议 stage_transition 之前，必须逐项完成下方 Stage Gate 自检章节，呈现完整证据。禁用"看起来没问题"、"基本完成"、"没有明显问题"等模糊话术。未完成自检直接建议推进 = 违规。
```

**cd-development/SKILL.md Gotchas 新增**：
```markdown
- **[HARD] Stage Gate 自检**：你是开发阶段的守门人。在建议 stage_transition 之前，必须逐项完成下方 Stage Gate 自检章节，呈现完整证据。禁用"代码写完了"、"测试通过了"、"PR 提了"等笼统陈述——必须附带具体验证输出。未完成自检直接建议推进 = 违规。
```

**cd-review/SKILL.md Gotchas 新增**：
```markdown
- **[HARD] Stage Gate 自检**：你是检视阶段的守门人。在建议 stage_transition 之前，必须逐项完成下方 Stage Gate 自检章节，呈现完整证据。禁用"检视完了"、"没问题了"、"可以合入"等笼统结论——必须逐条列出处置状态。未完成自检直接建议推进 = 违规。
```

**cd-merge/SKILL.md 新增（在硬条件检查之前）**：
```markdown
- **[HARD] Stage Gate 自检**：你是合入阶段的守门人。必须逐项完成下方硬条件检查，逐条附带证据。任一条件未通过则回退，不得"降级通过"或"建议合入"。
```

### 改动 3：stage-gate.md 补充执行规范

在现有流程之后补充：

```markdown
## 禁止的逃逸话术

以下话术不得作为 gate 自检的唯一依据：
- "看起来没问题" / "基本完成" / "没有明显问题"
- "代码写完了" / "测试通过了" / "PR 提了"
- "检视完了" / "没问题了" / "可以合入"
- "不堵塞" / "可遗留" / "建议合入" / "后续优化"

每项必须附带具体的验证命令输出、文件引用或 PR 链接。
```

### 改动 4：workflow.md 移除过时引用

**文件**：`data/file/skills/cd-development/references/workflow.md`

移除对不存在的 "stage-gate API" 的引用，将自检步骤指向 SKILL.md 的 Stage Gate 自检章节。

## 非目标

1. 不改变 gate_evidence 的 advisory 性质
2. 不引入代码层面的硬拦截
3. 不改变 stage_transition JSON 格式
4. 不修改 SOP YAML 结构

## 核心业务行为

| # | 场景 | 预期行为 |
|---|------|----------|
| B1 | Agent 建议 stage_transition 时 | 必须先完成 Stage Gate 自检并呈现完整证据 |
| B2 | Agent 使用模糊话术时 | 被 Gotchas 中的 `[HARD]` 规则和话术封堵阻断 |
| B3 | 用户主动推进时 | 不受 gate 限制，可直接推进 |
| B4 | Agent 加载 skill 时 | `[HARD]` Gate 规则在 Gotchas 首位，优先级最高 |

## 改动范围

- `src/app/issue-collaboration/collaboration.ts` — 协作规则措辞
- `data/file/skills/cd-design/SKILL.md` — Gotchas 增加 `[HARD]` Gate
- `data/file/skills/cd-development/SKILL.md` — Gotchas 增加 `[HARD]` Gate
- `data/file/skills/cd-review/SKILL.md` — Gotchas 增加 `[HARD]` Gate
- `data/file/skills/cd-merge/SKILL.md` — 增加 `[HARD]` Gate
- `data/file/skills/cd-shared/references/stage-gate.md` — 补充话术封堵

## 验证

- [ ] Agent 在 gate 未完成时不会建议推进
- [ ] Agent 的 gate 自检包含具体证据而非笼统陈述
- [ ] 用户主动推进不受限制
- [ ] `[HARD]` 规则在 Gotchas 首位

## 关联

- **前置 Feature**：F2026060306（Stage Transition Suggestion）
- **前置 Feature**：F2026060305（Evidence-based Gate Verification）
