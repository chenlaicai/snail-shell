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

## 知识库能力

{{prompt:S-07}}

{{#when:stage_types=development,review;roles=研发者}}
## 研发者手册

{{prompt:S-03}}
{{/when}}

{{#when:stage_types=review;roles=检视者}}
## 检视者手册

{{prompt:S-04}}
{{/when}}
