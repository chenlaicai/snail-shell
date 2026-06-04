---
id: F2026052901
title: guard-config-hook-format
from_ids: []
tags: []
modules: [agent]
doc_kind: spec
---

# F2026052901 [agent] Guard Config Hook 格式修复

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

`writeClaudeGuardSettings`（`src/agent/guard-config.ts`）在生成 `.claude/settings.local.json` 时，注入的 PreToolUse hook 条目格式错误：

```json
{ "matcher": "Bash", "command": "node .../guard-bash.js" }
```

Claude Code 要求的格式是：

```json
{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "node .../guard-bash.js" }] }
```

格式错误导致 Claude Code 启动时报错 `hooks: Expected array, but received undefined`，整个 settings.local.json 被跳过，安全策略和权限配置全部失效。

此外，过滤逻辑（第 176 行）只检查 `entry.command`，无法识别已有的正确格式条目，导致每次运行都注入新的错误格式条目，形成累积。

## 目标

修复 hook 注入格式和过滤逻辑，使 Claude Code 能正常读取 settings.local.json，安全策略生效。

## 非目标

- 不改变 guard-profile.json 的策略内容
- 不改变 permissions allow/deny 的翻译逻辑
- 不处理其他 agent（Codex、OpenCode）的配置格式

## 设计

### P1 详设

1. **修复 hook 注入格式**：第 170 行 `shellGuardHook` 改为 `{ matcher: "Bash", hooks: [{ type: "command", command: ... }] }`
2. **修复过滤逻辑**：第 175-177 行过滤条件需同时检查：
   - `entry.command` 直接包含 guard-bash.js（兼容旧错误格式）
   - `entry.hooks` 数组中某个元素的 `command` 包含 guard-bash.js（正确格式）

## 生效路径

- 代码修复：`src/agent/guard-config.ts`
- 测试更新：`tests/agent/guard-config-test.ts`
- 运行时产物：`.claude/settings.local.json`（由代码生成，不入库）

<!-- [design-time] 章节结束 -->

## 改动范围

- `src/agent/guard-config.ts` — 修复 hook 格式、过滤逻辑，新增 `filterGuardBashHooks` 辅助函数
- `tests/agent/guard-config-test.ts` — 更新测试验证正确格式，新增混合 hook 场景覆盖

## 验证

### P1

- [x] 单元测试通过：`writeClaudeGuardSettings` 生成的 PreToolUse 条目符合 Claude Code 要求的 `{ matcher, hooks: [{ type, command }] }` 格式
- [x] 重复调用不会产生累积的 hook 条目
- [ ] 手动验证：在主目录启动 Claude Code 不再报 format 错误

### P2（检视意见修复）

- [x] 混合 hook 场景：同一 entry 内混有用户 hook + guard-bash.js 时，用户 hook 被保留
- [x] 过滤后 entry 的 hooks 数组变空则移除整个 entry
- [x] 过滤后 entry 仍有其他 hooks 则保留 entry（用过滤后的 hooks 替换）

## 关联

- **前置**: F2026052503（agent guard profile 原始设计）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | 格式错误导致 settings.local.json 整体被跳过 | 确认为 bug，需修复 | 2026-05-28 |
| 2 | 检视意见：过滤逻辑可能误删同一 entry 内的用户 hook | 确认为 bug，新增 `filterGuardBashHooks` 辅助函数修复 | 2026-05-29 |
| 3 | Feature 文档编号应按创建日期 | 修正为 F2026052901 | 2026-05-29 |

## 检视记录

- **PR**: #304
- **状态**: 检视通过，等待用户合入
- **检视结论**: 代码层面无缺陷，PR 标题/squash commit/feature 文档编号统一为 F2026052901，基于最新 origin/main (ef45a53)
- **剩余风险**: 未在主目录手动启动 Claude Code 验证
