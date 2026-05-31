---
id: F2026053101
title: guard-bypass-permissions
from_ids: [F2026052910]
tags: []
modules: [agent]
doc_kind: spec
---

# F2026053101 [agent] Claude Code 权限策略：bypassPermissions + disallowedTools

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

F2026052910 实现了 denylist-only + allow-all 策略：`translateToClaudeSettings` 返回 `allow: ["*"]` + `deny: [...guard.deny]`，配合 `--permission-mode default`。

实际运行发现 `allow: ["*"]` **无法覆盖 Claude Code Bash 工具的内置启发式**：
- `git stash`、`git worktree add` 等命令不在 deny list 中，但仍被 Claude Code 自身拦截
- `git status`、`git log` 等只读命令被 Claude Code 内置规则自动放行
- `git fetch`（在 guard-profile.json 白名单中）也被拦截

根本原因：Claude Code 的 Bash 工具有独立于 settings.local.json 的安全启发式，`allow: ["*"]` 不覆盖这些启发式。

## 目标

实现"黑名单拦截、其余全放行"的权限策略：
- 匹配 deny list 的命令 → 100% 拦截
- 不匹配 deny list 的命令 → 100% 放行（无启发式干扰）

## 非目标

- 不实现"非白名单即审批"（Claude Code 协议不支持实时权限交互）
- 不改变 GuardProfile 的 allow/deny 模型
- 不处理 Codex/OpenCode agent 的权限策略

## 设计

### bypassPermissions + disallowedTools 策略

Claude Code CLI 支持：
- `--permission-mode bypassPermissions`：跳过 Claude Code 全部权限检查（含启发式、settings.local.json）
- `--disallowedTools <tools...>`：CLI 层面独立执行黑名单拦截

关键发现：`bypassPermissions` **不跳过** `--disallowedTools`（已验证）。

行为：
- 命中 `--disallowedTools` 的命令 → CLI 层拦截，写入 `permission_denials`
- 不命中的命令 → `bypassPermissions` 放行，无启发式干扰
- 没有第三种状态

### 验证结果

边界1（拦截）：sqlite3、rm -rf、git stash、git checkout、git reset、git commit、chmod 777 → 3/3 全部拦截

边界2（放通）：git status、git log、git diff、git fetch、echo、ls、node、mkdir → 3/3 全部放行

### 模式匹配行为

`--disallowedTools` 支持 `Bash(command:*)` 模式格式（与 settings.local.json deny 格式一致）。

验证的匹配规则：
- `Bash(sqlite3:*)` → 拦截 `sqlite3 ...` ✓
- `Bash(git stash:*)` → 拦截 `git stash ...` ✓
- `Bash(git checkout:*)` → 拦截 `git checkout ...` ✓
- `Bash(git reset:*)` → 拦截 `git reset ...` ✓
- `Bash(git commit:*)` → 拦截 `git commit ...` ✓
- `Bash(rm -rf:*)` → 拦截 `rm -rf ...` ✓
- `Bash(chmod 777:*)` → 拦截 `chmod 777 ...` ✓

### settings.local.json 变化

`bypassPermissions` 模式下不读取 settings.local.json 权限配置。`translateToClaudeSettings` 返回空 allow/deny，`writeClaudeGuardSettings` 仍写入 settings.local.json（保留兼容性，但内容不再影响权限行为）。

### extraAllow 机制变化

`extraAllow`（retry 场景下用户审批通过的工具）在 `bypassPermissions` 模式下不再生效——deny list 在 CLI 层面静态传入，无法通过 settings.local.json 动态覆盖。此机制保留代码但当前不触发。

## 生效路径

- `src/agent/guard-config.ts`：新增 `buildDisallowedToolsArgs`，更新 `translateToClaudeSettings`
- `src/agent/claude-code.ts`：`--permission-mode bypassPermissions` + `--disallowedTools`
- `src/agent/claude-code-stateful.ts`：同上

<!-- [design-time] 章节结束 -->

## 改动范围

- `src/agent/guard-config.ts`：新增 `buildDisallowedToolsArgs`，更新 `translateToClaudeSettings` 注释和返回值
- `src/agent/claude-code.ts`：`invokeStateless` 使用 bypassPermissions + disallowedTools
- `src/agent/claude-code-stateful.ts`：`buildArgs` 使用 bypassPermissions + disallowedTools
- `tests/agent/guard-config-test.ts`：更新 translateToClaudeSettings 测试

## 验证

### 通用
- [ ] 全量测试通过（`npm test`）
- [ ] 编译通过（`npx tsc --noEmit`）

### 边界验证
- [ ] deny list 中的命令被拦截（已验证：sqlite3、rm -rf、git stash、git checkout、git reset、git commit、chmod 777）
- [ ] 不在 deny list 的命令被放行（已验证：git status、git log、git diff、git fetch、echo、ls、node、mkdir）

## 关联

- **前置**: F2026052910（denylist-only + allow-all 策略实现）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | bypassPermissions 是否跳过 disallowedTools | 不跳过（已验证） | 2026-05-31 |
| 2 | allow:["*"] 能否覆盖 Bash 启发式 | 不能（已验证） | 2026-05-31 |
| 3 | extraAllow 在新策略下是否生效 | 不生效（deny 在 CLI 层静态传入） | 2026-05-31 |
