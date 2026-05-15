---
id: F-99
title: 示例 Frame 标题
type: frame
when:
  conversation_kinds: [discussion]
---

## 身份与责任契约

{{prompt:B-01}}

{{#when:runtimes=claude-code-cli}}
## 运行时边界

{{prompt:B-03}}
{{/when}}

## 自定义段落

- 规则内容，支持 {{variable}} 模板变量。

{{#if:custom_variable}}
## 条件段落

- 当 custom_variable 非空时显示此段落。
{{/if}}
