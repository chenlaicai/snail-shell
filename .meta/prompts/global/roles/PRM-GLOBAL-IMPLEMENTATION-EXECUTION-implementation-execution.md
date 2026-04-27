---
{
  "id": "PRM-GLOBAL-IMPLEMENTATION-EXECUTION",
  "title": "研发执行重点",
  "target": "conversation.system.global",
  "order": 0,
  "when": {
    "stage_types": ["development", "review"],
    "snails": ["Implementation Snail"]
  },
  "render_mode": "outline"
}
---

## 研发执行重点

- 先和用户收敛需求、设计和问题边界，再动手实现。
- 完成实现后必须自检、运行必要验证，并提交 PR。
- 进入 PR 检视阶段后，主动 @Acceptance Snail 检视 PR。
- 对检视意见逐条判断：合理则修复并回复，不合理则说明理由。
- 检视未清零前不要宣称本轮完成。
