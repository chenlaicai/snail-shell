---
id: F2026060101
title: snail-display-name-injection
from_ids: [F2026051912]
tags: [fix, prompt, signature]
modules: [prompt-center, workspace-workflow, message-bus]
doc_kind: spec
---

# F2026060101 签名漂移修复：注入 Snail 显示名

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

PR 评论签名模板要求格式为 `by 研发者（<Snail 名称>）`，其中 `<Snail 名称>` 应为当前响应 Snail 的可展示名称（如 "Claude Code Stateful + Sonnet"）。但实际上签名经常漂移为各种猜测值（如 "orca"、"claude code"、"snail shell" 等）。

根因：`SnailTemplate.name` 在 `config/snail-den.json` 中定义，运行时可通过 `SnailDen.getTemplate(templateId).name` 获取，但该值从未被注入到系统提示词中。签名模板告诉 AI 使用"当前响应 Snail 的可展示名称"，但 AI 无法从系统提示词中获取该值，只能基于上下文猜测。

## 目标

将 Snail 显示名从 Snail Den 经过协作层注入到系统提示词模板变量中，使 AI 在签名时使用准确的值而非猜测。

## 非目标

- 不改变签名模板的格式（仍为 `by <角色>（<Snail 名称>）`）
- 不改变 Snail Den 的配置结构
- 不改变 message-out 的 mentions 机制

## 设计

### 详设：数据链路

Snail 显示名的传播路径：

1. `config/snail-den.json` → `SnailTemplate.name`（数据源）
2. `SnailDen.getTemplate(templateId).name`（运行时查询）
3. `CollaborationInvocationOptions.snailDisplayName`（新增字段，从协作层传递）
4. `PromptBuildContext.snailDisplayName`（新增字段，prompt builder 接收）
5. `buildRole()` 输出 `snail_display_name` 模板变量
6. S-01 系统提示词模板 `{{snail_display_name}}`（最终注入点）

### 详设：注入位置

在 `manager-collaboration.ts` 的 `buildWorkflowSystemPrompt` 中，通过 activeRole 的 `snail_template_id` 查询 `SnailDen.getTemplate()` 获取显示名，传入 `PromptBuildContext`。

演进中心路径（`evolution-prompt.ts`）同样处理。

### 详设：回退策略

当 `snail_template_id` 为空或模板不存在时，使用 `AgentRuntime` 字符串作为回退值（如 "claude-code-cli"）。这比空值更安全，至少能区分不同 runtime。

## 生效路径

- 代码：`src/prompt-center/builder.ts`（模板变量构建）
- 代码：`src/workspace-workflow/manager-collaboration.ts`（依赖传递）
- 代码：`src/message-bus/collaboration.ts`（选项传递）
- 代码：`src/workspace-workflow/manager.ts`（依赖注入）
- 代码：`src/evolution-center/evolution-prompt.ts`（演进中心路径）
- 提示词：`.meta/prompts/prompts/S-01-工作区上下文.md`（模板变量注入）
- 模板：`.meta/templates/pr-comment-signature.md`（规则更新）
- 手册：`.meta/prompts/prompts/S-03-研发者手册.md`、`S-09-设计者手册.md`、`S-10-合入者手册.md`（规则引用更新）
- 手册：`.meta/skills/developer-handbook/SKILL.md`、`.meta/skills/reviewer-handbook/SKILL.md`（SKILL.md 规则引用更新）

<!-- [design-time] 章节结束 -->

## 改动范围

- `src/prompt-center/builder.ts` — 新增 `snail_display_name` 模板变量
- `src/workspace-workflow/manager-collaboration.ts` — `CollaborationDeps` 增加 `snailDen`，`buildWorkflowSystemPrompt` 解析显示名，导出 `resolveSnailDisplayName`
- `src/message-bus/collaboration.ts` — `CollaborationInvocationOptions` 增加 `snailDisplayName`
- `src/workspace-workflow/manager.ts` — 构造 `collaborationDeps` 时传入 `snailDen`
- `src/evolution-center/evolution-prompt.ts` — 传递 `snailDisplayName`
- `.meta/prompts/prompts/S-01-工作区上下文.md` — 增加 `{{snail_display_name}}` 注入
- `.meta/templates/pr-comment-signature.md` — 更新规则说明
- `.meta/prompts/prompts/S-03-研发者手册.md` — 更新签名规则引用
- `.meta/prompts/prompts/S-09-设计者手册.md` — 更新签名规则引用
- `.meta/prompts/prompts/S-10-合入者手册.md` — 更新签名规则引用
- `.meta/skills/developer-handbook/SKILL.md` — 更新签名规则引用
- `.meta/skills/reviewer-handbook/SKILL.md` — 更新签名规则引用
- `tests/workspace/resolve-snail-display-name-test.ts` — 新增单元测试

**不在本次改动范围**：
- `.meta/prompts/prompts/S-04-检视者手册.md` — 检视者签名规则定义在 `reviewer-handbook/SKILL.md` 中，S-04 本身无签名段落

## 验证

### 通用

- [ ] 系统提示词中包含准确的 `snail_display_name` 值
- [ ] 签名模板规则明确引用注入的变量

## 关联

- **前置**: F2026051912（PR 评论签名模板）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | snail_template_id 为空时的回退 | 使用 AgentRuntime 字符串作为回退值 | 2026-06-01 |

## 范围变更记录

| # | 变更 | 原因 | 日期 |
|---|---|---|---|
| 1 | 新增 S-09、S-10 签名规则更新；新增 SKILL.md 更新；新增单元测试；移除 S-04（无签名段落） | PR #319 检视意见：签名规则未同步、scope 不一致、缺少测试 | 2026-06-01 |
