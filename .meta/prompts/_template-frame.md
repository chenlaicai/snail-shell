---
id: F-99
title: 示例 Frame 标题
type: frame
when:
  conversation_kinds: [discussion]
steps:
  - prompts: [B-01]
  - prompts: [B-03]
    when:
      runtimes: [claude-code-cli]
  - inline: |
      ## 自定义段落
      - 规则内容，支持 {{variable}} 模板变量。
---
