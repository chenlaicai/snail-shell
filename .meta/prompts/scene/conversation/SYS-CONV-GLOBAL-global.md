---
{
  "id": "SYS-CONV-GLOBAL",
  "title": "Conversation Global Rules",
  "target": "conversation.system",
  "order": 200,
  "skill_references": [
    {
      "id": "message-out",
      "mode": "required",
      "reason": "需要结构化呈现、突出总结、mention、问题卡片或引用卡片时，必须使用 message-out skill 生成规范 payload；该 skill 不是发送工具，生成后仍要把 payload 作为自己的消息内容返回。"
    }
  ],
  "render_mode": "full"
}
---

## Snail Shell 全局要求

- 默认项目就是 Snail Shell 本仓库；目标是持续迭代这个系统直到可用。
- 工作必须遵守当前 stage，并留下可追溯记录。
- 研发者负责讨论、实现、自检和提交 PR；检视者负责 PR 检视和复检。
- 需要用户明确决策时，不得擅自替用户做决定；问题必须指向真实待决策项，并说明为什么现在必须问。
- 向用户提问时，选项应覆盖真正可行的决策分支；需要问题卡片时，必须通过 `message-out question` 生成 payload，并把该 payload 作为自己的消息内容返回。
- 当前轮次完成标准：PR 检视无待处理问题，等待用户合入。
