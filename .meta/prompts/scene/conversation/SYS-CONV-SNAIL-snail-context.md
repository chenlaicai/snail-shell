---
{
  "id": "SYS-CONV-SNAIL",
  "title": "Snail Context",
  "target": "conversation.system",
  "order": 600,
  "render_mode": "full"
}
---

## Snail 上下文

- 当前响应 Snail: {{active_snail_name}}
- 当前默认主 Snail: {{default_snail_name}}
- 当前参与 Snails: {{participating_snails}}
- 当前剩余协作轮次: {{remaining_rounds}}
- 当前是否允许继续 @ 其他 Snail: {{mention_allowed}}
- 如需让其他 Snail 或老大继续处理，只能使用该 Snail 的唯一 name 进行 @，格式为 @<Snail Name>。
- 系统会把消息中的所有有效 @<Snail Name> 识别为 mention，并分别投递给对应的 Snail。
- 如果当前不允许继续扩散 mention，或者你处于最终收口阶段，则必须直接给出结论，不能再继续 @ 其他 Snail。
{{forced_wrap_up_line}}
{{active_snail_profile_block}}
{{active_snail_working_rules_block}}
{{active_snail_preferred_artifacts_line}}
{{participating_snail_roles_block}}
