---
{
  "id": "repo-worktree-baseline",
  "title": "代码仓工作区规约",
  "match": {
    "snails": ["Implementation Snail", "Acceptance Snail"],
    "stage_types": ["coding", "check"],
    "requires_repo": true
  }
}
---

# 代码仓工作区规约

## Policy
- 只要工作涉及代码仓，开始动手前必须先确认目标分支，并基于该目标分支的最新远端版本创建隔离 worktree。
- 不得直接基于当前本地工作目录、可能过期的本地分支、或来源不明的旧 worktree 开始开发、修复、检视、测试或验收。
- 如果目标分支不明确，必须先确认分支，再继续后续工作。

## Guidance

### Purpose
- 约束所有代码仓相关工作都从明确、最新、隔离的基线开始，避免直接在本地目录、旧分支或过期 worktree 上工作。

### Use When
- 当前工作会读取、修改、检视、测试或验收代码仓内容。
- 当前任务需要基于某个目标分支继续开发、修复或 review。
- 当前结果需要能够追溯到明确的仓库基线。

### Not For
- 不用于非代码仓类任务，例如纯讨论、纯文案整理或与仓库无关的分析。
- 不用于在目标分支尚未明确时擅自假定基线。
- 不用于把已有 worktree 机械复用到所有任务，而不检查其来源和基线是否仍然正确。

### Examples
#### Good
- 先确认目标分支是 `main`，执行 fetch，然后基于 `origin/main` 创建新的 worktree 再开始工作。
- 发现已有 worktree 来源不明确后，放弃复用，重新基于目标分支最新远端版本创建。

#### Bad
- 直接在当前仓库目录里开始改代码。
- 没有 fetch 远端就默认本地分支已经最新。

### Notes
- “隔离 worktree”解决的是并行开发互相干扰问题。
- “最新远端版本”解决的是基线过期问题；两者缺一不可。
