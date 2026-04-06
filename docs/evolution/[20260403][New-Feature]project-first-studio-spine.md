---
title: Project First Studio Spine
change_type: New-Feature
document_type: decision_record
status: active
created_at: 2026-04-03
updated_at: 2026-04-03
related_sessions: []
related_docs:
  - ../blueprint.md
  - ../domain-model.md
  - ../implementation-plan-v1.md
supersedes: []
---

# 以 Project 为最外层的工作室主脊柱

## 问题

Snail Shell 最初的实现是以 session 为中心的。

这种结构足以支撑一个轻量级的本地 chat shell，但不足以承载当前已经明确下来的产品方向。当前产品方向不是“聊天工具”，而是“全员 agent 的软件生产工作室”。

在一个软件生产工作室里，最外层组织单元不能是对话线程，而必须是一个完整的软件工作对象，也就是项目本身。

## 决策

Snail Shell 的最外层结构改为 `Project`。

对话仍然重要，但对话不再是顶层对象，而是归属于某个 project 之下。

整体层级变为：

`Project -> Conversations -> Messages`

与此同时，project 还应承载：

- workflow stages
- artifacts
- approvals
- rollback records

## 为什么做这个决策

因为 session 无法正确承载完整的软件生产语义。

一个软件项目至少需要：

1. 稳定边界
2. 阶段推进
3. 稳定产物
4. 多个对话线程
5. 文档、代码、git、交付之间的追溯关系

session 只能表达一段工作线程，不能表达完整的软件生产上下文。

而 project 可以成为一个真正的软件工作容器，把意图、对话、阶段状态、产物、交付记录组织在一起。

## 考虑过但放弃的方案

### 1. 继续让 Session 作为顶层对象

放弃原因：会让 workflow 和 artifact 都变成“附着在聊天线程上的额外结构”，而不是系统的核心业务对象。

这样会使系统越来越像“加了很多附加功能的聊天工具”，而不是软件生产工作室。

### 2. 只是把 Session 改名成 Workspace

放弃原因：这只是改名，不是解决建模问题。

真正的问题不是命名，而是最外层对象必须代表“软件工作本身”，而不是“聊天承载容器”。

## 带来的影响

这个决策会直接改变 Snail Shell 的多个层面：

1. UI 从 session 入口转向 project 入口
2. 存储层需要引入 project 一等公民
3. workflow 状态挂在 project 上
4. artifact 归属 project 与 stage
5. session 在产品语义上降级为 conversation

## 实现策略

第一轮实现采用增量迁移策略，而不是推倒重来。

具体做法是：

1. 保留当前 session 的运行时能力
2. 在产品语义上把 session 解释为 conversation
3. 在其上新增 project
4. 再逐步把 stage、artifact、review spine 接上

这样既能避免一次性重构带来的风险，又能让系统尽快对齐工作室模型。

## 长期有效的设计真相

Snail Shell 不是一组聊天线程的集合。

它是一个软件生产工作室系统，而它的最外层工作单元必须是 project。
