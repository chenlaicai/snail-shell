---
id: F2026060103
title: small-fixes
from_ids: []
tags: [fix, workflow, skill]
modules: [workflow, agent]
doc_kind: spec
---

# F2026060103 小问题修复

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

SOP v2（F2026053102）上线后发现若干流程和工具层面的问题：

1. worktree 只允许 `.claude/worktrees/`，但其他 agent（如 OpenCode、Codex）需要在 workspace 目录内创建 worktree（`.snail/worktrees/`），该路径不在白名单中。
2. 检视阶段研发者改完代码后没有强制要求再次申请检视 — **排查后发现 SOP v2 已包含此规则**（S-03 第 111 行、S-04 第 31 行），无需重复添加。
3. 检视者确认无问题时没有在 PR 中留下评论痕迹 — **排查后发现 SOP v2 已包含此规则**（S-04 第 32 行 [HARD]、reviewer-handbook 复检流程），无需重复添加。
4. message-out mention skill 的设计让 AI 误以为调用 skill 等同于已呼叫到目标角色；MCP set_final_body 工具从未被 AI 使用过。

## 目标

1. worktree 白名单新增 `<workspace>/.snail/worktrees/`（保留原有 `.claude/worktrees/`）。
2. 检视规则已存在于 SOP v2 中，无需重复添加。
3. 同上。
4. 改进 mention 语义和 MCP set_final_body 注入指令；将 message-out skill 改名为 message-payload。

## 非目标

- 不改变 SOP v2 的四阶段整体结构
- 不改变 PR 模板和 commit 模板格式
- 不改变 `.claude/worktrees/`（Claude Code 自身机制）

## 设计

### P1 详设：worktree 双路径

- `.claude/worktrees/` — Claude Code 自身创建的 worktree（保留不变）
- `<workspace>/.snail/worktrees/` — 其他 agent 的 worktree（新增到白名单）
- `.snail/` 添加到 .gitignore

### P2 详设：检视阶段强化

排查确认 SOP v2 已包含以下 [HARD] 规则：
- 研发者修复后必须重新请求检视（S-03 第 111 行、developer-handbook 第 109 行）
- 检视者无问题时必须在 PR 留评论（S-04 第 32 行 [HARD]、reviewer-handbook 第 83/93 行）

本次不做重复添加。

### P3 详设：mention 语义和 MCP 改进

**mention 语义问题根因**：工作流指令"通过 message-out mention 协议请求检视"暗示调用 skill = 完成请求。AI 调用 CLI 工具获得 JSON 输出后，自然认为动作已完成。

**修复策略**：
- 重构工作流指令为分步骤："步骤 1 — 格式化 payload → 步骤 2 — 返回消息内容 → 步骤 3 — 此时尚未送达，系统执行实际投递"
- B-01 契约强化："调用 skill ≠ 已通知到对方"

**MCP set_final_body 问题根因**：注入指令在系统提示词末尾，措辞为建议性（"当你准备好时"），AI 容易忽略。

**修复策略**：改为 `[HARD]` 级指令，明确"回复完成前必须调用"。

**message-out → message-payload 改名**：skill 目录、CLI 脚本和所有提示词/模板引用从 `message-out` 改为 `message-payload`。数据库中的 `"message_out"` 是 `MessageContextKind` 内部实现细节，与 skill 名称无关，无需变更。

## 生效路径

- worktree 路径：`src/workspace-workflow/repo-cleanup.ts`（validateWorktreePath 白名单）+ `.meta/prompts/` GATE-2
- mention 语义：B-01 契约 + S-03/S-04 工作流指令 + developer-handbook/reviewer-handbook
- MCP：`src/message-bus/message-protocol.ts`（mcpContextBlock 注入）

<!-- [design-time] 章节结束 -->

## 改动范围

- `.meta/prompts/prompts/B-01-身份与责任契约.md` — mention 协议语义强化
- `.meta/prompts/prompts/S-03-研发者手册.md` — GATE-2 worktree 路径、mention 语义、message-out → message-payload
- `.meta/prompts/prompts/S-04-检视者手册.md` — mention 语义、message-out → message-payload
- `.meta/prompts/prompts/S-08-演进执行者手册.md` — message-out → message-payload
- `.meta/prompts/prompts/S-09-设计者手册.md` — GATE-1 与 GATE-2 顺序互换
- `.meta/skills/developer-handbook/SKILL.md` — 同 S-03
- `.meta/skills/reviewer-handbook/SKILL.md` — mention 语义、message-out → message-payload
- `.meta/skills/message-payload/SKILL.md` — 重命名自 message-out，更新标题和引用
- `.meta/skills/message-payload/scripts/message-payload.js` — 重命名自 message-out.js
- `.meta/skills/message-out/` — 已删除
- `scripts/build-dist.ts` — skillScripts 中 message-out → message-payload
- `.meta/skills/SKILL.md.template` — 示例从 message-out 改为 message-payload
- `.meta/templates/pr-comment-signature.md` — message-out → message-payload
- `.meta/prompt-evaluations/prompt-behavior-samples.json` — message-out → message-payload
- `.meta/scripts/db-bridge.js` — 注释修正
- `src/workspace-workflow/repo-cleanup.ts` — `validateWorktreePath` 白名单新增 `.snail/worktrees`
- `src/agent/guard-config.ts` — 注释补充双路径说明
- `src/message-bus/message-protocol.ts` — MCP set_final_body 注入指令强化
- `tests/workspace/repo-cleanup-test.ts` — 测试 worktree 路径改为 `.snail/worktrees`
- `.gitignore` — 新增 `.snail/`

## 验证

### P1
- [x] worktree 白名单包含两条路径（.claude/worktrees、.snail/worktrees）
- [x] TypeScript 编译通过
- [x] repo-cleanup 核心测试通过

### P3
- [x] B-01 mention 规则已强化（"调用 skill ≠ 已通知到对方"）
- [x] 工作流指令语义重构（分步骤格式化 → 返回 → 系统投递）
- [x] MCP set_final_body 注入指令从建议性改为 [HARD]
- [x] MCP endpoint 测试全部通过
- [x] message-out skill 改名为 message-payload（目录、脚本、所有引用）
- [x] 旧 .meta/skills/message-out/ 目录已删除
- [x] 提示词/模板/行为样本中的 message-out 引用全部更新

## 关联

- **前置**: F2026053102（SOP v2 四阶段流程）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | .snail/ 目录是否在 .gitignore 中 | 已添加 | 2026-06-01 |
| 2 | .claude/worktrees 是否应保留 | 保留，Claude Code 自身机制 | 2026-06-01 |
| 3 | 检视规则是否需要重复添加 | SOP v2 已包含，无需重复 | 2026-06-01 |

## 范围变更记录

| 日期 | 变化 | 原因 |
|---|---|---|
| 2026-06-01 | P2 检视规则从"新增"改为"已存在无需修改" | 排查发现 SOP v2 已包含完整 [HARD] 规则 |
| 2026-06-01 | P1 worktree 从三条路径改为两条路径（.claude/worktrees + .snail/worktrees） | sibling 目录不属于 workspace 内部，不符合目录边界控制约束 |
| 2026-06-01 | message-out 改名从"未实现"改为"已完成" | 用户确认无需兼容性考虑，数据库 MessageContextKind 与 skill 名称无关 |
| 2026-06-01 | 环境准备 GATE-1 与 GATE-2 互换顺序 | 原顺序暗示先在主目录 fetch 再进 worktree；正确顺序应先进 worktree 再在 worktree 内 fetch，主目录保持零写入 |
