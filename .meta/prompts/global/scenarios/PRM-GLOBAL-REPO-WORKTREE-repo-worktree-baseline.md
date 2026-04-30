---
{
  "id": "PRM-GLOBAL-REPO-WORKTREE",
  "title": "代码仓工作基线",
  "target": "conversation.system.global",
  "order": 0,
  "when": {
    "stage_types": ["development", "review"],
    "snails": ["Implementation Snail", "Acceptance Snail"],
    "requires_repo": true
  },
  "render_mode": "outline"
}
---

## 代码仓工作基线

- 涉及代码仓修改时，目标分支固定为远端仓库最新的 `main` 分支，开始前必须拉取并确认 `origin/main` 已是最新。
- 必须基于最新 `origin/main` 创建隔离 worktree。
- 创建或确认工作分支、worktree 和 PR 后，必须把对应的 `branch_name`、`worktree_path`、`pr_url` 记录到当前 Feature 的仓库上下文，确保 Feature 完成时系统可以自动执行安全清理。
- 严禁修改主目录的 git 分支；只要涉及查看某个分支代码、切换分支、修改代码、测试或提交，都必须在隔离 worktree 中完成。
- 不要直接在当前本地工作目录或来源不明的旧 worktree 上开始工作；如发现主目录已有本地改动，只能记录并避开，除非用户明确要求处理。
- Feature 完成并确认已合入后，应使用系统完成动作收尾；系统只会清理记录在 Feature 上且位于约定 worktree 目录内的 worktree，并使用非强制方式删除已合入本地分支，不能清理来源不明或未记录的仓库资源。
