---
id: F20260625u92e
title: cwd 识别问题修复
from_ids: [F2026051409]
tags: [prompt, workflow, worktree]
modules: [acs, collaboration]
---

# F20260625u92e — cwd 识别问题修复

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
- agent 从环境变量或 `get_context` 读取（环境变量名取决于 set_context 的 key）

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
| 层 1 | EnterWorktree 完成后（agent 职责，软约束） | 将 worktree 路径写入 Issue context（key: `worktree_path`） |

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
3. **agent 如何知道 worktree 路径**：从环境变量或 `get_context` 读取（环境变量名取决于 set_context 的 key）

## 风险与决策记录

**层 1 风险**：
- **软约束**：cwd 验证规则依赖 agent 遵守，是软约束。但明确的指令比模糊的建议更可靠。

**决策记录**：
- 放弃层 2（动态更新 Issue.workspace_path）。理由：`workspace_path` 是 Issue 级别的属性，所有 agent 共享，动态更新会引入不可控的副作用。agent 的 cwd 应该由 agent 自己通过绝对路径来管理。
- 采用"永远使用绝对路径"规则，而非仅"先执行 pwd"。理由：绝对路径规则更直接地解决认知偏差问题，agent 不需要额外的验证步骤。
- 扩大适用范围，统一处理 `.claude/worktrees/` 和 `.snail/worktrees/`。理由：两者都会产生 cwd 错位问题。
- 复用已有 Issue context 机制传递 worktree 路径，不新增环境变量。理由：Issue context 已有 `set_context` + `SNAIL_CTX_*` 注入机制，无需新增代码。
- agent 发现 cwd 不对时自行修正，不报错不等待用户。理由：cwd 错位是 agent 认知问题，不是系统错误，用户无法介入。

## 决策过程

### 第 1 轮：初始设计（3 项改动）

**初始方案**：
1. system prompt 增加 `<cwd>` 规则块（5 条规则）
2. collaboration.ts 的 buildContextBlock 增加 cwd 提示（详细说明）
3. EnterWorktree 完成后将 worktree 路径写入 Issue context（agent 职责，软约束）

**审查者-1 反馈**：
- Feature 文档要求第 3 项改动缺失（PR body 声称"无需新增代码"）
- PR body 与 Feature 文档不一致

**修复**：
- 修正 PR body，明确说明是软约束方案
- 修正 Feature 文档，明确第 3 项是 agent 职责（软约束）

---

### 第 2 轮：环境变量名修正

**审查者-2 反馈**：
- 环境变量名错误：`SNAIL_CTX_worktree_path` → `worktree_path`（buildContextEnv 直接展开 key，不加前缀）
- tenet prompt 与 system-reminder 内容重复
- PR body 验证方式不可靠

**修复**：
- 修正环境变量名
- 删除 collaboration.ts 中的重复提示
- 更新 PR body 验证方式

---

### 第 3 轮：用户反馈——不要指定 key

**用户反馈**：
> 不要指定 key，key 写入时本来就是不确定，给 AI 一定的灵活空间

**修复**：
- Feature 文档中删除具体 key 引用，改为通用描述："从环境变量或 `get_context` 读取（环境变量名取决于 set_context 的 key）"

---

### 第 4 轮：简化——只新增一句 tenet prompt

**用户反馈**：
> 还是过于啰嗦，我感觉只是在浪费上下文而已。我要求你只新增一句 tenet prompt！其余都移除！

**审查者-2 修订**：
- 只保留 `T-01-行为准则.md` 中的 `<cwd>` 规则块
- 移除 `collaboration.ts` 中的 cwd 提示
- 简化 PR body

**修复后规则**：
```
<cwd>
- 每次 Bash 调用 cwd 都回到 spawn 路径，必须使用绝对路径
</cwd>
```

---

### 第 5 轮：规则描述不准确

**用户反馈**：
> 那 agent 在一次流式过程中，多次调用 bash，那其实目录是继承的

**审查者-2 修订**：
- 当前规则"每次 Bash 调用 cwd 都回到 spawn 路径"不准确
- 单次会话内，多次 Bash 调用 cwd 是继承的
- 跨会话（resume）时，cwd 才会回到 spawn 路径

**用户进一步反馈**：
> 一定是 worktree？直接使用 bash 就没问题了？agent 知道什么是 resume 吗？主仓库又是什么？

**最终决策**：
- 删除所有概念性描述（worktree、resume、主仓库）
- 简化为一句话行为规则

---

### 最终方案

```
<cwd>
- 文件操作必须使用绝对路径
</cwd>
```

**设计原则**：
- 不引入任何系统概念（worktree、resume、主仓库）
- 不解释为什么，只说明做什么
- 适用于所有场景（worktree、主仓库、任何目录）
- 最小改动，最少上下文消耗

**移除内容**：
- collaboration.ts 中的 cwd 提示（删除）
- PR body 中的冗余描述（简化）
- Feature 文档中的具体 key 引用（改为通用描述）

**保留内容**：
- system prompt 中的一句规则
- Feature 文档（设计记录）
