---
id: I2026052908
title: prompt-optimization
from_ids: []
tags: [prompt, skill, system-prompt]
modules: [prompt-center, agent]
doc_kind: spec
---

# I2026052908 [prompt] 提示词优化：B-03 精简与 skill_references 移除

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

三个问题：

1. **B-03 冗余**：原 B-03 包含 5 条规则，其中规则 1-2（messages 数组和 transcript 文本）对 Claude 而言是冗余的——Claude 天然理解这些概念。规则 4-5（使用 message-out 提问/说明）属于协议行为，不是"运行时边界"。只有规则 3（禁止交互式 tool）是 Snail Shell 非交互调度环境的真正边界。
2. **skill_references 冗余**：skill 已拆分为独立能力包（`.meta/skills/*/SKILL.md`），但 prompt 文档的 frontmatter 仍保留 `skill_references` 字段，导致 `buildSkillReferenceSection()` 在系统提示词中生成重复的 "Skill References" 段落。系统提示词应只在具体步骤中按需引用 skill，不再通过声明式字段关联。
3. **B-01 缺乏上下文发现机制**：base layer（B-01/B-02/B-03）无任何指令要求 agent 验证 SOP 手册和项目上下文是否已加载。当 S-01/S-03 的模板变量为空时，agent 直接跳过手册流程，用"没有 stage_id"作借口拒绝记录输出产物。

## 目标

1. B-03 只保留一条 HARD 规则：禁止调用交互式 tool（EnterPlanMode/ExitPlanMode/AskUserQuestion）
2. 移除整个 `skill_references` 机制：接口、渲染函数、frontmatter 字段、UI 展示
3. `collectActiveSkills()` 简化为返回所有已注册 skill（不再按 prompt 引用过滤）
4. B-01 新增上下文发现机制：agent 必须验证 SOP 手册已加载、stage 运行时标识已知

## 非目标

- 不改变 skill 的物理结构（仍为独立目录）
- 不改变 ACS 协议中 `skills` 字段的消费方（`claude-code-stateful.ts` 从未消费它）
- 不修改 B-01/B-03 以外的 prompt 正文内容（已变更为：B-01 新增上下文发现规则）

## 设计

### B-03 精简

原 5 条规则 → 1 条：
```
[HARD] 不要调用 EnterPlanMode / ExitPlanMode / AskUserQuestion 等交互式 tool。这些 tool 在 Snail Shell 非交互式调度环境中不可用；即使工具列表包含也不得调用
```

协议规则（message-out question/explanation）移至 B-01：
```
[协议] 需要向用户提问时，使用 message-out question 生成问题卡片并将 payload 作为消息内容返回
[协议] 需要说明方案时直接用普通消息或正式产物表达，并继续完成当前任务
```

### skill_references 移除

**移除的类型/函数**：
- `PromptSkillReference` 接口（registry.ts）
- `buildSkillReferenceSection()` 函数（registry.ts）
- `PromptFrontmatter.skill_references` 字段（registry.ts）
- `PromptDocument.skill_references` 字段（registry.ts）
- `PromptSkillReference` 导出（index.ts）

**简化**：
- `collectActiveSkills(referencedPromptIds, allPrompts)` → `collectActiveSkills()`：无参数，返回所有已注册 skill
- `renderList()` 不再拼接 skill 引用段落
- `prompt-library.js` 移除 Skill References 面板和统计

**移除 frontmatter 的 prompt 文档**（8 个）：B-01, B-02, S-01, S-02, S-03, S-04, S-08, _template-prompt.md

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `.meta/prompts/prompts/B-01-*.md` | 修改 | 移除 skill_references，添加协议规则，添加上下文发现规则 |
| `.meta/prompts/prompts/B-02-*.md` | 修改 | 移除 skill_references |
| `.meta/prompts/prompts/B-03-*.md` | 修改 | 5 条规则 → 1 条 HARD 规则 |
| `.meta/prompts/prompts/S-01~S-04, S-08-*.md` | 修改 | 移除 skill_references |
| `.meta/prompts/_template-prompt.md` | 修改 | 移除 skill_references 示例 |
| `src/prompt-center/registry.ts` | 修改 | 移除 PromptSkillReference、buildSkillReferenceSection、简化 renderList |
| `src/prompt-center/builder.ts` | 修改 | collectActiveSkills() 无参调用，移除未使用变量 |
| `src/prompt-center/index.ts` | 修改 | 移除 PromptSkillReference 导出 |
| `src/agent/capability/builder.ts` | 重写 | collectActiveSkills() 无参，返回全部已注册 skill |
| `src/web/prompt-library.js` | 修改 | 移除 Skill References UI |
| `tests/agent/capability-spec-test.ts` | 重写 | 适配新 collectActiveSkills() 签名 |
| `tests/meta/prompt-assets-test.ts` | 修改 | 更新 B-03 断言 |

## 验证

### 通用

- [x] TypeScript 编译通过（`tsc --noEmit`）
- [x] ESLint 通过
- [x] 全部 43 个测试文件通过（`npm test`）
- [x] 系统提示词不再包含 "Skill References" 段落
- [x] B-03 只输出交互式 tool 禁止规则

## 关联

无前置/阻塞依赖。

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | `capability.skills` 从未被 agent adapter 消费 | 确认为死代码路径，不影响运行时 | 2026-05-29 |
| 2 | 移除后 skill 引用完全依赖 prompt 正文中的自然语言提及 | 符合预期：skill 是独立能力包，系统提示词按需引用 | 2026-05-29 |
| 3 | B-01 缺乏上下文发现机制导致 agent 跳过手册流程 | 根因：base layer 无指令要求验证 SOP 手册和 stage 上下文已加载；修复：B-01 新增两条发现规则 | 2026-05-29 |

## 范围变更记录

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-05-29 | B-01 新增上下文发现机制（2 条规则） | 实施过程中发现 agent 跳过研发手册、以"没有 stage_id"为由拒绝记录产物；根因分析确认 base layer 缺乏发现指令 |
| 2026-05-30 | Feature ID 从 I2026052906 更改为 I2026052908 | 检视发现 I2026052906 已被 PR #306（context-usage-display）使用，ID 冲突 |
