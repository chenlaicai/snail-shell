---
title: Workflow Rollback Rules
change_type: Feature-Update
document_type: decision_record
status: active
created_at: 2026-04-03
updated_at: 2026-04-03
related_sessions: []
related_docs:
  - ../workflow.md
  - ../implementation-plan-v1.md
supersedes: []
---

# 工作流回滚规则

## 问题

如果软件研发流程允许下游阶段不断绕过上游错误、只靠局部补丁往前推进，那么 requirement、product design、technical design、implementation、acceptance 之间的对应关系很快就会失真。

在 agent-native 系统里，这个问题会更严重，因为 agent 很擅长给出“看起来局部成立”的修补方案，但这些方案未必能修正整个项目链条的真实失配。

## 决策

Snail Shell 采用严格审批制工作流，并且引入基于根因分析的正式回滚机制。

规则如下：

1. 每个阶段必须经过显式审批才能进入下一阶段
2. 后续阶段一旦发现问题，必须先做 root cause 分析
3. 如果根因属于更早阶段，必须回滚到该阶段
4. 下游阶段记录会被标记为失效，需要重新生成或修订

## 为什么做这个决策

这不是为了制造流程负担，而是为了保持项目链条的一致性。

如果 product design 错了，就不能让 implementation 单独补过去；如果 technical design 错了，也不能在 acceptance 阶段假装项目仍然和原始设计保持一致。

回滚机制的作用，是确保项目记录仍然是真实可信的。

## 被否定的方案

### 1. 灵活前向修补

放弃原因：它会制造跨阶段的隐性漂移。

表面上项目在继续推进，但 requirements、design、implementation 之间的链条已经不再可信。

### 2. 允许非正式回滚，但不记录

放弃原因：这会破坏可追溯性。

回滚不是一次内部操作，而是项目历史的一部分，必须显式记录下来。

## 带来的影响

这个决策要求系统必须显式表示：

1. stage state
2. approval action
3. rollback record
4. invalidated downstream history

也就是说，workflow 状态不能只是界面上的装饰，而必须成为真实业务模型的一部分。

## 长期有效的设计真相

Snail Shell 宁愿牺牲表面上的推进速度，也要保证项目演进链条的真实一致性。
