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
- 不要直接在当前本地工作目录或来源不明的旧 worktree 上开始工作。
- 目标分支不明确时，先确认再继续。
