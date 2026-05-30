---
id: F2026053001
title: OpenCode & Codex 安全策略实现
from_ids: [F2026052910, F2026052604]
tags: [agent, security, guard-profile]
modules: [agent]
doc_kind: spec
---

# F2026053001 [agent] OpenCode & Codex 安全策略实现

## 背景

F2026052910 完成了 Claude Code 的 ACS GuardProfile 安全策略实现（denylist-only + allow-all 策略）。当前需要为 OpenCode 和 Codex 实现完整的 GuardProfile 翻译链路，确保三个 agent 的安全策略行为一致。

### 当前状态

| Agent | 安全策略状态 | 配置机制 |
|-------|-------------|----------|
| Claude Code | ✅ 已完成 | `.claude/settings.local.json` permissions 段 |
| Codex | ⚠️ 部分实现 | `.codex/config.toml` sandbox_mode |
| OpenCode | ❌ 未实现 | 仅移除 `--dangerously-skip-permissions` |

### 各 Agent 能力边界

**Claude Code**：
- 支持 `permissions.allow` / `permissions.deny` 扁平模型
- deny 优先级高于 allow
- 非交互模式下启发式判断未命中命令

**Codex**：
- 仅支持 `sandbox_mode`（filesystem 层级）
- 无 PreToolUse hooks，无法执行参数级语义检查
- macOS Seatbelt / Linux Landlock+seccomp 沙箱

**OpenCode**：
- 全局配置 `~/.config/opencode/opencode.jsonc`
- 无 per-project 配置入口
- 无内置 sandbox
- 无 PreToolUse hooks

## 目标

1. 为 OpenCode 实现 GuardProfile → 全局配置翻译链路
2. 完善 Codex GuardProfile 翻译逻辑
3. 统一三个 agent 的安全策略行为边界说明

## 非目标

- 不改变 Claude Code 已完成的 denylist-only + allow-all 策略
- 不为 OpenCode/Codex 实现实时权限审批（需 agent 原生支持）
- 不引入 ACS 未定义的安全行为

## 设计

### OpenCode 安全策略

**配置机制**：
- OpenCode 全局配置位于 `~/.config/opencode/opencode.jsonc`
- 不支持 per-project 配置覆盖
- 安全机制：移除 `--dangerously-skip-permissions` 恢复默认权限模式

**GuardProfile 翻译**：
- 将 GuardProfile.deny 中的危险命令模式写入 OpenCode 全局配置
- OpenCode 权限格式：`permission` 字段，支持 `allow`/`deny`/`ask` 三种动作
- Bash 命令模式：`Bash(sqlite3:*)` → `sqlite3*`（通配符，无空格）
- 工具名称映射：`AskUserQuestion` → `question`

**能力缺口**：
- database/filesystem/git/network 全部四个 domain 均无参数级拦截
- 无 OS sandbox、无 PreToolUse hooks

### Codex 安全策略

**配置机制**：
- `CODEX_HOME` 环境变量指向 `.codex/` 目录
- 从 `$CODEX_HOME/config.toml` 加载配置
- 仅支持 `sandbox_mode` 配置项

**GuardProfile 翻译**：
- 检测 deny 列表中的文件系统危险模式（`rm -rf`、`chmod 777`、`chmod SUID`）
- 存在危险模式 → `sandbox_mode = "read-only"`
- 否则 → `sandbox_mode = "workspace-write"`

**能力缺口**：
- 仅 sandbox_mode 生效（filesystem domain）
- database/git/network domain 无参数级拦截

## 改动范围

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `docs/features/2026/05/30/F2026053001-opencode-codex-security-policy.md` | 新增 | 本文档 |
| `src/agent/guard-config.ts` | 修改 | 新增 OpenCode GuardProfile 翻译函数 |
| `src/agent/opencode.ts` | 修改 | 调用 GuardProfile 翻译写入配置 |
| `tests/agent/guard-config-test.ts` | 修改 | 新增 OpenCode/Codex 翻译测试 |

## 验证

1. 类型检查：`npx tsc --noEmit` 通过
2. 测试通过：`npx tsx tests/agent/guard-config-test.ts`（28/28）
3. 人工验证：
   - OpenCode 全局配置文件正确写入
   - Codex sandbox_mode 根据 deny 列表正确切换

## 风险与记录

- **Codex 能力有限**：仅 sandbox_mode 生效，无法拦截数据库 CLI、git 危险操作等
- **三个 agent 安全策略不等价**：Claude Code 支持最完整的 deny/allow 模型，OpenCode/Codex 受限于原生能力
