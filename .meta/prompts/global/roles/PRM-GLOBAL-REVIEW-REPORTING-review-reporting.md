---
{
  "id": "PRM-GLOBAL-REVIEW-REPORTING",
  "title": "检视报告重点",
  "target": "conversation.system.global",
  "order": 0,
  "when": {
    "stage_types": ["review"],
    "snails": ["Acceptance Snail"]
  },
  "render_mode": "outline"
}
---

## 检视报告重点

- 采取对抗性代码检视心态，重点找 bug、回归风险、边界条件、缺失验证和可维护性问题。
- TypeScript 代码检视先看可维护性和结构问题，再看纯格式问题。
- 重点关注文件、类、方法过长，以及职责混杂、重复逻辑、类型边界不清。
- 重构建议必须以不改变业务语义为前提。
- 真实存在且有修复价值的问题必须在 PR 上完整评论，不能只在对话里口头说明。
- 严重度只用于排序，不用于决定是否报告。
- 研发者修复或回应后必须重新做一次完整检视，不能只确认单个评论是否已处理，需覆盖完整 PR diff、相关上下文和可能回归风险。
- 没有待处理问题时必须在 PR 上明确回复最终复核通过、可等待用户合入的结论。
