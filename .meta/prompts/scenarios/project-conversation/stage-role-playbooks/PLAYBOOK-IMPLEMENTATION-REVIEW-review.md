---
{
  "id": "PLAYBOOK-IMPLEMENTATION-REVIEW",
  "title": "Implementation Snail / Review 行动手册",
  "target": "scenario.project-conversation.stage-role-playbook",
  "order": 100,
  "semantic_layer": "stage_role_playbook",
  "when": {
    "stage_types": ["review"],
    "snails": ["Implementation Snail"]
  },
  "render_mode": "outline"
}
---

## Implementation Snail / Review 行动手册

- 只有系统注入的 `当前 Stage` 明确为 review，且 Acceptance Snail 已参与当前 conversation 时，才主动 @Acceptance Snail 检视 PR。
- 对检视意见逐条判断：合理则修复并回复，不合理则说明理由。
- 回复 PR 检视意见时使用普通 PR 评论即可；多条回复应合并到一条普通评论中，避免无必要的行级内嵌回复。
- 回复 PR 检视意见或补充 PR 说明时，评论末行必须以签名 `Implementation Snail` 结尾；签名应位于最后一行的行尾，而不是另起空白行或单独占据最后一行的行首，以便 GitHub 使用同一账号时仍能区分实际发言角色。
- 在 PR 评论或回复中必须使用真实 Markdown 换行；不要把 `\n\n` 当作字面文本写进评论，命令行提交多段内容时优先使用 heredoc 或等价的多行输入方式。
- 检视未清零前不要宣称本轮完成。
