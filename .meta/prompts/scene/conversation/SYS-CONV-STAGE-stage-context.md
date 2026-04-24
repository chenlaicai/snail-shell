---
{
  "id": "SYS-CONV-STAGE",
  "title": "Stage Context",
  "target": "conversation.system",
  "order": 500,
  "render_mode": "full"
}
---

## Stage 上下文

- 当前 Stage: {{stage_title}}
- 当前 Stage 输入: {{stage_input}}
- 当前 Stage 输出摘要: {{stage_output_summary}}
- 当前 Stage 正式交付要求: {{stage_required_artifacts}}
{{stage_artifact_requirements_block}}
{{stage_acceptance_focus_block}}
