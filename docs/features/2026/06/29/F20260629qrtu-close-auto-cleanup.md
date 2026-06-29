---
id: F20260629qrtu
title: Close Issue 自动清理关联资源
status: implemented
created_at: 2026-06-29
---

# F20260629qrtu — Close Issue 自动清理

## 概述

Issue 关闭时自动清理关联的 Git 资源和 PR，避免资源残留。

## 核心业务行为

1. **当** 用户关闭 Issue 时，**应该** 自动删除关联的 worktree、本地分支、远端分支和 PR
2. **当** 资源清理失败时，**应该** 继续清理其他资源，记录失败项
3. **当** 关联资源不存在时，**应该** 幂等处理，不报错
4. **当** 安全校验失败时，**应该** 拒绝清理并返回错误

## 设计方案

### 清理范围

从 `issue.context` 读取以下字段：

| 字段 | 来源 | 清理方式 |
|------|------|----------|
| `worktree_path` | Agent 通过 `set_context` 写入 | `git worktree remove <path>` |
| `branch_name` | Agent 通过 `set_context` 写入 | `git branch -d <branch>` |
| `pr_url` | Agent 通过 `set_context` 写入 | `gh pr close <url>` |

### 安全校验

**分支名校验**（在执行清理前校验）：

| 规则 | 说明 |
|------|------|
| 保留分支 | 拒绝删除 `main`、`master` |
| 远端引用 | 拒绝 `origin/` 前缀 |
| 非法字符 | 拒绝含 `..`、空格的分支名 |
| 格式校验 | 使用 `git check-ref-format --branch` 验证 |

**Worktree 路径校验**（在执行清理前校验）：

| 规则 | 说明 |
|------|------|
| 主目录保护 | 拒绝删除仓库主目录 |
| 白名单 | 只允许 `.claude/worktrees/` 或 `.snail/worktrees/` 下的路径 |
| 符号链接 | 使用 `realpathSync` 处理 macOS `/var` → `/private/var` |

**校验失败处理**：返回 `failed`，记录错误原因，继续清理其他资源。

### 清理时机

在 `IssueCollaboration.closeIssue` 中，数据库事务提交后**同步**执行资源清理：

```
1. 执行数据库事务（设置 closed_at、left_at）
2. 安全校验（分支名 + worktree 路径）
3. 清理资源（best-effort）
4. 返回清理结果
```

**超时处理**：设置 30 秒超时，超时后返回 `failed`。

### 清理策略

- **Best-effort**：尽量清理，不因单个资源清理失败阻断整个流程
- **幂等处理**：资源不存在时忽略错误
- **结果记录**：返回每个资源的清理状态（成功/失败/跳过）

### 清理顺序

```
1. 关闭 PR（gh pr close）
2. 删除 worktree（git worktree remove）
3. 删除本地分支（git branch -d）
4. 删除远端分支（git push origin --delete）
```

**设计决策**：先关闭 PR 再删除分支，因为 PR 关联分支，分支删除后 PR 可能无法正常关闭。

### 接口设计

```typescript
interface CleanupResult {
  pr: { status: "success" | "failed" | "skipped"; error?: string };
  worktree: { status: "success" | "failed" | "skipped"; error?: string };
  localBranch: { status: "success" | "failed" | "skipped"; error?: string };
  remoteBranch: { status: "success" | "failed" | "skipped"; error?: string };
}

// closeIssue 返回值扩展
closeIssue(issueId: string): { issue: Issue; cleanup: CleanupResult };
```

### 错误处理

| 场景 | 处理方式 |
|------|----------|
| 安全校验失败 | 返回 `failed`，记录错误原因 |
| worktree 有未提交更改 | 返回 `failed`，提示用户手动处理 |
| 分支未合入 | 返回 `failed`，提示用户手动处理 |
| worktree 目录不存在 | 跳过，记录 `skipped` |
| 分支不存在 | 跳过，记录 `skipped` |
| PR 已关闭/不存在 | 跳过，记录 `skipped` |
| git/gh 命令执行失败 | 记录 `failed`，继续清理其他资源 |
| 远端分支不存在 | 跳过，记录 `skipped` |
| 操作超时（>30秒） | 返回 `failed`，继续清理其他资源 |

### 前端展示

Close Issue 操作完成后，展示清理结果：

```
Issue 已关闭
- PR #123: 已关闭
- Worktree: 已删除
- 本地分支: 已删除
- 远端分支: 已删除
```

如果有失败项：

```
Issue 已关闭
- PR #123: 已关闭
- Worktree: 删除失败（有未提交更改，请手动处理）
- 本地分支: 删除失败（分支未合入，请手动处理）
- 远端分支: 已删除
```

## 关键设计取舍

### 取舍 1：清理时机

**选项 A**：事务内清理
- 优点：原子性
- 缺点：git 操作可能很慢，阻塞数据库事务

**选项 B**：事务外清理（当前选择）
- 优点：不阻塞事务，git 操作失败不影响数据库状态
- 缺点：可能出现数据库已关闭但资源未清理的不一致状态

**决策**：选择事务外清理，因为：
1. git 操作延迟不可控
2. 资源清理失败不影响 Issue 关闭的核心语义
3. 可以通过日志和 UI 反馈让用户手动处理

### 取舍 2：PR 关闭方式

**选项 A**：`gh pr close`
- 优点：保留 PR 记录，可重新打开
- 缺点：PR 仍然存在

**选项 B**：`gh pr close --comment "Issue closed"`
- 优点：留下关闭原因
- 缺点：可能产生不必要的通知

**决策**：选择选项 A，保持简洁。PR 关闭原因可以从 Issue 关闭记录推导。

### 取舍 3：远端分支删除

**选项 A**：删除远端分支
- 优点：彻底清理
- 缺点：可能影响其他协作者

**选项 B**：不删除远端分支
- 优点：安全
- 缺点：需要手动清理

**决策**：删除远端分支，因为：
1. Snail Shell 是单人工作模式
2. 分支是 feature 分支，不影响主分支
3. 用户明确要求"自动移除远端分支"

### 取舍 4：Worktree 删除策略（v1 遗留问题）

**选项 A**：不使用 `--force`（当前选择）
- 优点：保护未提交的代码
- 缺点：删除失败需要用户手动处理

**选项 B**：使用 `--force`
- 优点：强制删除，无残留
- 缺点：静默丢失未提交代码

**决策**：选择选项 A，因为：
1. 保护用户未提交的代码
2. 删除失败返回 `failed`，让用户手动处理
3. 与 v1 行为一致

### 取舍 5：分支删除策略（v1 遗留问题）

**选项 A**：使用 `-d` 安全删除（当前选择）
- 优点：保护未合入的分支
- 缺点：删除失败需要用户手动处理

**选项 B**：使用 `-D` 强制删除
- 优点：强制删除，无残留
- 缺点：删除未合入分支

**决策**：选择选项 A，因为：
1. 保护未合入的分支
2. 删除失败返回 `failed`，让用户手动处理
3. 与 v1 行为一致

### 取舍 6：同步 vs 异步清理

**选项 A**：同步清理（当前选择）
- 优点：实现简单，用户立即看到结果
- 缺点：阻塞 HTTP 响应，可能耗时数秒

**选项 B**：异步清理
- 优点：不阻塞响应，体验好
- 缺点：实现复杂，需要 WebSocket/轮询通知

**决策**：选择选项 A，因为：
1. close issue 操作不频繁
2. 本地 git 操作通常在几秒内完成
3. 用户可以立即看到结果
4. 实现简单

## 实现约束

1. **不阻断关闭流程**：资源清理失败不应阻止 Issue 关闭
2. **幂等性**：重复调用应产生相同结果
3. **可观测性**：清理结果必须记录日志并反馈给用户
4. **安全性**：只清理关联资源，不误删其他资源
5. **安全校验**：必须校验分支名和 worktree 路径，防止误删
