---
id: F2026052106
title: B-03 运行时边界提示词更新：反映 --bare 架构级工具过滤
from_ids: []
tags: [prompt, convention]
modules: [project_management]
---
# F2026052106 B-03 运行时边界提示词更新：反映 --bare 架构级工具过滤

## 背景

B-03 运行时边界提示词写于 `--bare` flag 引入之前。当时 Snail Shell 通过 `claude -p` 调用 Claude Code 时，工具列表包含 EnterPlanMode / ExitPlanMode / AskUserQuestion 等交互式 tool，B-03 通过 `[HARD]` 规则禁止模型调用这些 tool 来防止非交互环境下的中断。

#232 引入 `--bare` flag 后，Claude Code 将工具列表从 20 个精简到 3 个（Bash / Edit / Read），EnterPlanMode / ExitPlanMode / AskUserQuestion 在工具列表层即被移除，模型无法调用。

但 B-03 提示词未同步更新，其 protocol 仍描述"Snail Shell 运行在非交互式调度环境，无法接管 Claude Code 内置计划审批流"，与实际架构不一致。

## 目标

- B-03 的 `[HARD]` 规则保留为防御纵深，追加 `--bare` 已移除对应 tool 的注释
- B-03 的 protocol 新增 `--bare` 架构级工具过滤的机制说明
- 保持两层防御：`--bare`（架构层）+ `[HARD]` 规则（提示词层）
- 同步更新 `prompt-assets-test.ts` 中引用旧文本的断言

## 非目标

- 不修改 `--bare` 的行为或调用方式
- 不在 `claude-code.ts` 中变更参数
- 不新增 `permissions.deny` 配置（已通过 `--bare` 解决）

## 设计

### 两层防御纵深

```
Layer 1 (架构): --bare → 工具列表仅保留 Bash/Edit/Read
Layer 2 (提示词): [HARD] 规则 → 即使 --bare 行为变化，仍禁止调用
```

### B-03 变更

**constitution**：`[HARD]` 规则追加 `--bare` 已移除对应 tool 的说明：

```
[HARD] 不要调用 Claude Code 的 `EnterPlanMode` 或 `ExitPlanMode`
  → `claude -p --bare` 已从工具列表移除这两个 tool（仅暴露 Bash/Edit/Read），本规则为防御纵深
[HARD] 不要调用 Claude Code 的 `AskUserQuestion` tool
  → `claude -p --bare` 已从工具列表移除此 tool，本规则为防御纵深
```

**protocol**：替换旧的"非交互式调度环境"描述：

```
[STD] `--bare` 提供架构级工具过滤：仅暴露 Bash、Edit、Read 三个必要工具，
  EnterPlanMode / ExitPlanMode / AskUserQuestion 等交互式 tool 在工具列表层即被移除，模型无法调用
[STD] 若未来 `--bare` 行为变化或新增非 bare 调用路径，以上 [HARD] 规则提供提示词层防御纵深
```

### 测试同步

`tests/meta/prompt-assets-test.ts` 中 B-03 渲染断言：
- 旧：`assert(transcriptContent.includes("Snail Shell 运行在非交互式调度环境"))`
- 新：`assert(transcriptContent.includes("防御纵深"))`

## 生效路径

- `.meta/prompts/prompts/B-03-运行时边界.md`：constitution 和 protocol 更新
- `tests/meta/prompt-assets-test.ts`：断言字符串同步

## 改动范围

- `.meta/prompts/prompts/B-03-运行时边界.md`：6 insertions / 4 deletions
- `tests/meta/prompt-assets-test.ts`：1 insertion / 1 deletion

## 验证

- `claude -p --bare` 下工具列表仅含 Bash/Edit/Read，不含 EnterPlanMode/ExitPlanMode/AskUserQuestion
- `npm test` 全部 35 个测试文件通过

## 风险与决策记录

- `--bare` 是当前 EnterPlanMode 问题的主要解决方案，`[HARD]` 规则降级为防御纵深
- 如果未来需要 Glog/Grep/Write/WebSearch 等工具，移除 `--bare` 后需在工具层和提示词层同时补上防护
- `permissions.deny` 已验证在 `--bare` + `bypassPermissions` 下仍生效，如有需要可额外配置为第三层防御
