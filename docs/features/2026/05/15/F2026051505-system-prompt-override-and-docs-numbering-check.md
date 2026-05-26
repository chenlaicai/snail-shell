---
id: F2026051505
title: Claude 系统提示词覆盖模式 + docs 编号冲突校验
from_ids: []
tags: [prompt, convention]
modules: [project_management]
---
# F2026051505 Claude 系统提示词覆盖模式 + docs 编号冲突校验

## 背景

两个独立问题：

1. Claude Code agent 使用 `--append-system-prompt` 追加系统提示词，Snail Shell 自定义的角色定义与 Claude Code 内置提示词（工具使用约定、安全策略等）共存，导致指令冲突或行为稀释。
2. `docs/features` 的 `FYYYYMMDDNN` 编号在并行分支中可能重复创建，当前仅靠 agent 提示词中的软约束（S-03/S-04 手册）防范，缺少代码层面的硬拦截。

## 目标

1. Claude Code agent（stateless/stateful）使用 `--system-prompt` 覆盖 Claude 内置提示词，Snail Shell 完全控制 agent 角色定义。
2. pre-commit hook 新增 `docs/features` 编号冲突硬校验，拦截并行分支创建相同 `FYYYYMMDDNN` 编号文件的情况。
3. 新增 CLI 参数单测，锁定 `--system-prompt` 行为不被未来改动回退。

## 非目标

- 不修改 OpenCode/Codex 的系统提示词注入方式（CLI 不支持独立系统提示词参数）。
- 不实现自动编号分配脚本。

## 设计

### 系统提示词覆盖

将 `--append-system-prompt` 改为 `--system-prompt`，覆盖 Claude Code 内置提示词。Snail Shell 的 `conversation` 系统提示词已包含完整的 agent 角色、行为规范和工具使用指导，不需要 Claude 内置的冗余指令。

覆盖点：
- `src/agent/claude-code.ts` stateless 变体：每次调用均传递 `--system-prompt`
- `src/agent/claude-code-stateful.ts` stateful 变体：仅首次调用（bootstrap）传递，resume 时不传（会话已持久化）

### 编号冲突校验

在 `.githooks/pre-commit` 中新增硬约束，逻辑如下：

1. 获取暂存区中所有 `docs/features/` 变更文件（`--diff-filter=ACMR`，覆盖新增/复制/重命名/修改）
2. 提取每个文件的 `FYYYYMMDDNN` 前缀，解析日期目录和序号
3. 检查暂存区内是否有同序号不同名的文件（区内冲突）
4. 检查磁盘上该日期目录中同序号文件数量，>1 则冲突
5. 冲突时 `exit 1` 阻塞提交

## 生效路径

- `--system-prompt` 行为通过 `src/agent/claude-code.ts` 和 `src/agent/claude-code-stateful.ts` 代码生效
- 编号校验通过 `.githooks/pre-commit` 生效（`git config core.hooksPath .githooks`）
- CLI 参数行为通过 `tests/agent/claude-code-test.ts` 和 `tests/agent/claude-code-stateful-test.ts` 锁定

## 改动范围

- `src/agent/claude-code.ts` — `--append-system-prompt` → `--system-prompt` + 注释
- `src/agent/claude-code-stateful.ts` — 同上 + JSDoc/行内注释更新
- `.githooks/pre-commit` — 新增编号冲突校验逻辑
- `tests/agent/claude-code-test.ts` — 新增 `testStatelessUsesSystemPromptOverride`
- `tests/agent/claude-code-stateful-test.ts` — 新增 bootstrap/resume 两个测试
