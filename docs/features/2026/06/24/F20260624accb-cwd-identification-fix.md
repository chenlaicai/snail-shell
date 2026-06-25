---
id: F20260624accb
title: cwd 识别问题修复
from_ids: [F2026051409]
tags: [prompt, workflow, worktree]
modules: [acs, collaboration]
---

# F20260624accb — cwd 识别问题修复

## 背景

1. **cwd 错误**：agent 在 worktree 中执行 Bash/git 命令时，cwd 始终是主仓库路径 `/Users/orca/ai/snail-shell`，而不是 worktree 路径。
2. **缺乏验证**：agent 从未用 `pwd` 验证实际执行目录，导致错误未被发现。
3. **两层概念错位**：Snail Shell 的 `workspace_path` 是静态的（Issue 创建时确定），而 agent 的实际工作目录是动态的（EnterWorktree 改变）。
4. **认知偏差**：agent 可能认为上一步 cd 到了 worktree，下一步就直接用相对路径执行命令，而实际上下一步因为独立调用所以目录还是回到了主目录。

## 根因分析

**根因 1：workspace_path 来源是主仓库路径**

`workspaces.json` 注册的是 `/Users/orca/ai/snail-shell`，Issue 创建时直接使用此路径作为 `workspace_path`。agent spawn 时 `cwd` 就被设置为主仓库。

**根因 2：resume 时 cwd 回退**

单次会话内 EnterWorktree 后，Claude Code 内部追踪新 cwd，Bash 工具确实在 worktree 中执行（正常）。但 resume 时重新 spawn 进程，`cwd` 又回到 `issue.workspace_path`（主仓库路径），导致 cwd 断裂。

**根因 3：无验证机制**

系统和 agent 都没有在执行 git 命令前验证 cwd 是否正确。缺少 `pwd` 确认步骤。

**根因 4：认知偏差**

agent 可能认为 cwd 会像普通 shell 一样持久化，但实际上每次 Bash 调用都是独立的，cwd 始终回到 spawn 时设置的路径。

## 目标

1. 纠正 agent 认知：每次 Bash 调用的 cwd 都是主仓库路径，不会持久化
2. 确保 agent 使用绝对路径执行命令，避免 cwd 错位导致操作在错误目录执行

## 非目标

- 不修改 Issue 创建流程（源头治理不适用，因为协作系统不自动创建 worktree）
- 不修改 spawn 时的 cwd 设置逻辑
- 不动态更新 Issue.workspace_path（会引入不可控的副作用）

## 设计

### 1. system prompt 增加 cwd 验证规则

在 agent 的 system prompt 中添加规则：

> **cwd 规则**
>
> 1. **永远使用绝对路径**，不要假设 cwd 会持久化。
> 2. 如果使用了 EnterWorktree，所有路径必须以 worktree 路径开头。worktree 路径可通过 Issue context（key: `worktree_path`）获取。

**生效场景**：
- agent 使用 EnterWorktree 进入 worktree 后
- agent 执行任何命令前

### 2. worktree 路径传递机制

**方案**：复用已有 Issue context 机制，worktree 路径写入 context（key: `worktree_path`）。

**传递方式**：
- agent 使用 EnterWorktree 进入 worktree 后，将 worktree 路径写入 Issue context
- Issue context 会通过 `SNAIL_CTX_*` 环境变量自动注入到 agent 进程
- agent 从 `process.env.SNAIL_CTX_worktree_path` 或 `get_context` 读取

**无需新增代码**：复用已有 `set_context` 机制，不需要修改 EnterWorktree 或协作系统。

### 3. system-reminder 增加 cwd 提示

在 system-reminder 中明确提示：

> **cwd 提示**
>
> 你的 spawn cwd 是主仓库路径 `{issue.workspace_path}`。每次 Bash 调用都是独立的，cwd 不会持久化。
>
> 如果你使用了 EnterWorktree，**必须使用绝对路径**，所有文件操作都以 worktree 路径开头。worktree 路径可通过 Issue context（key: `worktree_path`）获取。

**注入时机**：
- 每次 agent 调用时注入
- 在 system-reminder 的固定位置

**注入内容**：
- 主仓库路径（从 `issue.workspace_path` 动态获取，非硬编码）
- cwd 不持久化的提示
- worktree 路径获取方式（Issue context key: `worktree_path`）
- 必须使用绝对路径

**适用范围**：
- 统一处理 `.claude/worktrees/` 和 `.snail/worktrees/` 两种 worktree 场景

## 改动范围

| 层 | 文件 | 改动 |
|---|---|---|
| 层 1 | system prompt 文件 | 增加 cwd 规则：永远使用绝对路径 |
| 层 1 | system-reminder 注入逻辑（`collaboration.ts` 的 `buildContextBlock`） | 增加 cwd 提示 |
| 层 1 | EnterWorktree 完成后 | 将 worktree 路径写入 Issue context（key: `worktree_path`） |

## 验证

**层 1 验证**：
- 人工验证：
  - 在主仓库中执行命令，确认 agent 使用绝对路径
  - 使用 EnterWorktree 进入 worktree 后执行命令，确认 agent 使用 worktree 路径开头的绝对路径
  - 验证 worktree 路径是否正确写入 Issue context
  - 验证 `.snail/worktrees/` 场景是否同样受保护

## 核心业务行为

1. **当 agent 使用 EnterWorktree 后**，所有路径必须使用绝对路径，以 worktree 路径开头
2. **系统如何传递 worktree 路径**：EnterWorktree 完成后将 worktree 路径写入 Issue context（key: `worktree_path`），通过 `SNAIL_CTX_*` 环境变量自动注入
3. **agent 如何知道 worktree 路径**：从 `process.env.SNAIL_CTX_worktree_path` 或 `get_context` 读取

## 风险与决策记录

**层 1 风险**：
- **软约束**：cwd 验证规则依赖 agent 遵守，是软约束。但明确的指令比模糊的建议更可靠。

**决策记录**：
- 放弃层 2（动态更新 Issue.workspace_path）。理由：`workspace_path` 是 Issue 级别的属性，所有 agent 共享，动态更新会引入不可控的副作用。agent 的 cwd 应该由 agent 自己通过绝对路径来管理。
- 采用"永远使用绝对路径"规则，而非仅"先执行 pwd"。理由：绝对路径规则更直接地解决认知偏差问题，agent 不需要额外的验证步骤。
- 扩大适用范围，统一处理 `.claude/worktrees/` 和 `.snail/worktrees/`。理由：两者都会产生 cwd 错位问题。
- 复用已有 Issue context 机制传递 worktree 路径，不新增环境变量。理由：Issue context 已有 `set_context` + `SNAIL_CTX_*` 注入机制，无需新增代码。
- agent 发现 cwd 不对时自行修正，不报错不等待用户。理由：cwd 错位是 agent 认知问题，不是系统错误，用户无法介入。
