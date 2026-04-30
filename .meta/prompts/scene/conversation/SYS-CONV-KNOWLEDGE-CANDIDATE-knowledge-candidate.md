---
{
  "id": "SYS-CONV-KNOWLEDGE-CANDIDATE",
  "title": "Knowledge Candidate Entry",
  "target": "conversation.system",
  "order": 1040,
  "skill_references": [
    {
      "id": "knowledge-candidate",
      "mode": "conditional",
      "reason": "当工作中识别到可复用知识时，使用 knowledge-candidate skill 将其写入待审批候选；系统提示词只定义触发场景，具体调用方式由 skill 说明。"
    }
  ],
  "render_mode": "full"
}
---

## 知识提炼入口

- 工作过程中自行评估是否出现可复用知识；触发点不是固定消息轮次。
- 当识别到用户偏好、长期规则、设计决策、流程约束、失败教训、术语定义、可复用模式或需要后续治理的开放问题时，按需使用 `knowledge-candidate` skill 创建待审批候选。
- 当前不在阶段完成时额外触发总结式知识提炼，避免增加不必要的 LLM 负担。
