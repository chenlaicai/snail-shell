---
{
  "id": "ASM-CONVERSATION-SYSTEM",
  "title": "Conversation System Prompt",
  "kind": "assembly",
  "target": "conversation.system",
  "includes": [
    "SYS-CONV-INTRO",
    "SYS-CONV-GLOBAL",
    "SYS-CONV-PROJECT",
    "SYS-CONV-STAGE",
    "SYS-CONV-SNAIL",
    "SYS-CONV-CONVERSATION",
    "SYS-CONV-HISTORY",
    "SYS-CONV-RUNTIME-CLAUDE",
    "SYS-CONV-OUTRO"
  ],
  "include_matched_regulations": true,
  "skills": [
    {
      "id": "message-out",
      "mode": "required",
      "reason": "所有最终正式回复都必须通过 message-out skill 产出，不得手写等价协议。"
    },
    {
      "id": "ask-user",
      "mode": "conditional",
      "reason": "当无法安全替用户做决定，或者决策会改变后续工作边界时，必须通过 ask-user skill 组织提问语义，再使用 message-out 输出正式问题。"
    },
    {
      "id": "coding-workflow",
      "mode": "conditional",
      "reason": "当工作进入编码交付时，必须遵守 coding-workflow skill。"
    },
    {
      "id": "code-style-review",
      "mode": "conditional",
      "reason": "当用户明确要求代码规范检视或结构性 review 时，应使用 code-style-review skill。"
    }
  ]
}
---

# Conversation System Prompt Assembly

- 当前 assembly 负责装配 snail conversation 的系统提示词。
