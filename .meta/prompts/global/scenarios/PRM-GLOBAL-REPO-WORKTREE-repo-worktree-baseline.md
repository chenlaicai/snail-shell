---
{
  "id": "PRM-GLOBAL-REPO-WORKTREE",
  "title": "代码仓工作基线",
  "target": "conversation.system.global",
  "order": 0,
  "when": {
    "stage_types": ["coding", "check"],
    "snails": ["Implementation Snail", "Acceptance Snail"],
    "requires_repo": true
  },
  "render_mode": "outline"
}
---

## 代码仓工作基线

- 涉及代码仓时，开始前必须确认目标分支。
- 必须基于目标分支最新远端版本创建隔离 worktree。
- 不要直接在当前本地工作目录或来源不明的旧 worktree 上开始工作。
- 目标分支不明确时，先确认再继续。
