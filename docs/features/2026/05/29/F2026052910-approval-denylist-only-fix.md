---
id: F2026052910
title: approval-denylist-only-fix
from_ids: [F2026052904]
tags: []
modules: [agent]
doc_kind: spec
---

# F2026052910 [agent] denylist-only 策略下审批弹窗误触发与批准报错修复

## 背景

commit `15d7356`（F2026052904）将 Claude Code agent 的授权语义从"非白名单即审批"改为"denylist-only"——只拦截黑名单命令，非白名单操作由 Claude Code 自身启发式判断。

但实际运行中发现两个 bug：

1. **审批弹窗仍然出现**：Claude Code 在 `-p --permission-mode default` 下，对不在 deny list 中的工具（如 `AskUserQuestion`）仍产生 `permission_denials`。`classifyDenials()` 把这些当作"软拒绝"→ 发射 `permission_required` → 前端展示审批 UI。但用户批准后 agent 仍会重试同一个工具，再次被拒，形成无意义循环。

2. **点击"批准"后报错**：审批 retry 路径中 `sendStructuredMessage` 失败时，内层 catch 吞掉异常仍返回 success，前端无法感知失败；但外层 catch 可能在某些条件下捕获到错误，返回 "The string did not match the expected pattern"。

## 目标

- Bug 1：denylist-only 策略下，不向用户展示审批弹窗。只有匹配 deny list 的命令报错，其余让 Claude Code 自行处理。
- Bug 2：审批 retry 失败时，正确把错误传播给前端。

## 非目标

- 不改变 denylist-only 策略本身（Claude Code 协议不支持实时权限交互）
- 不改变 GuardProfile 的 allow/deny 模型
- 不处理 Codex/OpenCode agent 的审批逻辑

## guard-bash.js hook 移除

### 问题

`.meta/hooks/guard-bash.js` 作为 Claude Code PreToolUse hook，在 GuardProfile 翻译之外额外添加了语义分析行为（如区分 sqlite3 读/写操作）。但 ACS GuardProfile 只有 allow/deny 扁平模型，不支持语义规则。这导致：

- 若 deny 包含 `Bash(sqlite3:*)`，Claude Code 在 hook 执行前已拦截所有 sqlite3，hook 冗余
- 若 deny 不包含 sqlite3，hook 添加了 ACS 未定义的安全行为，实际执行与配置策略不一致

因果关系：ACS 是因，Claude 实现是果。实现层不应引入 ACS 未定义的安全行为。

### 修复

- 删除 `.meta/hooks/guard-bash.js`
- 删除 `tests/agent/guard-bash-test.ts`
- 简化 `writeClaudeGuardSettings()`：只写入 permissions 段，不安装 hook、不写入 `guard-profile.json`
- 移除 `filterGuardBashHooks()`、`writeGuardProfileJson()` 函数
- 更新 `guard-config-test.ts`：移除 hook 相关断言

修复后，Claude Code agent 层严格只做 GuardProfile → `settings.local.json` permissions 翻译。

## 设计

### Bug 1 修复

`claude-code.ts` 和 `claude-code-stateful.ts` 的 `handleResultMessage` 中，所有 `permission_denials` 视为既成事实直接忽略（debug 日志记录）。

原因：`permission_denials` 是 Claude Code 执行结果的一部分——工具已被拒绝，Claude Code 已继续执行。Snail Shell 无需再做二次判定。deny 列表中的工具在 `settings.local.json` 层面已被 Claude Code 事前拒绝。

### Bug 2 修复

`server.ts` 的 `createApproveToolHandler` 中，`sendStructuredMessage` 的内层 catch 不再吞掉异常。改为让异常传播到外层 catch，返回 500 错误给前端。

### 非交互工具加入 deny 列表

Claude Code 非交互模式（`-p --permission-mode default`）下，以下工具天然无法支持（需要用户实时交互）：

- `AskUserQuestion`
- `EnterPlanMode`
- `ExitPlanMode`

将这些工具加入 `config/guard-profile.json` 的 deny 列表，使 Claude Code 在尝试之前就知道这些工具不可用，避免无意义的重试。

### permission_denials 处理简化

移除 `isCommandInDenyPatterns` 函数和全部 denial 匹配逻辑。所有 `permission_denials` 视为既成事实（Claude Code 已拒绝、已继续执行），Snail Shell 仅 debug 日志记录，不做二次判定。

移除的相关代码：`TrackedToolCall` 接口、`currentGuardProfile` / `emittedToolCalls` 字段、`isCommandInDenyPatterns` 函数。

## 生效路径

- `config/guard-profile.json`：deny 列表新增 `AskUserQuestion`、`EnterPlanMode`、`ExitPlanMode`
- `src/agent/claude-code.ts`：`handleResultMessage` 简化为忽略所有 denials，移除 `isCommandInDenyPatterns`
- `src/agent/claude-code-stateful.ts`：同上
- `src/interaction-entry/api/server.ts`：`createApproveToolHandler` 错误处理
- `src/agent/guard-config.ts`：移除 `filterGuardBashHooks`、`writeGuardProfileJson`，简化 `writeClaudeGuardSettings`
- `.meta/hooks/guard-bash.js`：删除
- `tests/agent/guard-bash-test.ts`：删除
