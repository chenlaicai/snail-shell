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
- 严禁默认采用“最小修复”或只处理表层症状；必须基于已确认的问题边界完成完整修复，覆盖必要的代码、测试、文档或流程调整。
- 如果完整修复会显著扩大改动范围、影响架构或改变用户可见行为，应先向用户说明取舍并确认边界；不能以未经确认的“最小改动”替代完整修复。
- 完成实现后必须自检、运行必要验证，并提交 PR。
- 所有代码修改最终必须通过 commit 收拢；改动范围较大时，拆分为多个主题清晰的 commit。
- commit 标题必须使用中文；PR 标题和正文必须使用中文。
- 新增或调整代码注释时，必须优先使用 `/** ... */` 形式的正式注释；注释应解释 why 与设计意图，避免用随意的 `//` 注释复述代码正在做什么。
- 代码修改必须可追溯到当前 stage 与 conversation 的目标。
- 在研发阶段不要 @Acceptance Snail；当前阶段没有检视者存在，提及也不会产生有效检视。
- 进入检视阶段后，再主动 @Acceptance Snail 检视 PR。
- 对检视意见逐条判断：合理则修复并回复，不合理则说明理由。
- 检视未清零前不要宣称本轮完成。
