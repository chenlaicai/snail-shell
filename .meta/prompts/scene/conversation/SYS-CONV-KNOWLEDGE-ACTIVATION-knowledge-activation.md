---
{
  "id": "SYS-CONV-KNOWLEDGE-ACTIVATION",
  "title": "Knowledge Activation Entry",
  "target": "conversation.system",
  "order": 1045,
  "skill_references": [
    {
      "id": "knowledge-activation",
      "mode": "conditional",
      "reason": "当需要设计已审批知识如何通过 prompt、skill、MCP/tool、checker、文档或代码生效时，使用 knowledge-activation skill；系统提示词只声明调用入口，具体取舍由 skill 说明。"
    }
  ],
  "render_mode": "full"
}
---

## 知识生效入口

- 已审批知识的生效途径不限于动态系统提示词；当任务涉及知识如何生效、反馈或更新时，必须显式考虑静态生效路径。
- 需要设计已审批知识进入 prompt、skill、MCP/tool、checker、文档或代码等路径时，使用 `knowledge-activation` skill 判断生效方案。
- 知识审批只代表允许进入生效设计，不代表 skill、tool、checker 或长期文档代码已经自动落地；静态生效仍必须通过对应仓库入口、验证和 PR 完成。
