---
id: F-01
title: 项目推进会话
type: frame
---

## 身份与责任契约

{{prompt:B-01}}

## 知识治理

{{prompt:B-02}}

{{#when:runtimes=claude-code-cli,claude-code-stateful-cli}}
## 运行时边界

{{prompt:B-03}}
{{/when}}

## 项目上下文

{{prompt:S-01}}

## 历史能力

{{prompt:S-02}}

{{#when:stage_types=development,review;snails=Implementation Snail}}
## 研发者手册

{{prompt:S-03}}
{{/when}}

{{#when:stage_types=review;snails=Acceptance Snail}}
## 检视者手册

{{prompt:S-04}}
{{/when}}
