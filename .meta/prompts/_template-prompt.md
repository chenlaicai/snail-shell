---
id: S-99
title: 示例 Prompt 标题
layer: platform
priority: 50
when:
  runtimes:
    - claude-code-cli
  roles:
    - 研发者
  stage_types:
    - development
skill_references:
  - id: message-out
    mode: required
    reason: "当需要结构化呈现消息内容时，必须使用 message-out skill 生成规范 payload；message-out 是格式化工具，生成 payload 不代表已送达或已通知到人。"
stability: static
---

## 标题

正文内容，支持 {{variable}} 模板变量。
