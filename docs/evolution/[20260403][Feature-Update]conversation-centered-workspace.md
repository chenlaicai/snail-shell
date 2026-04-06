---
title: Conversation Centered Workspace
change_type: Feature-Update
document_type: design_rationale
status: active
created_at: 2026-04-03
updated_at: 2026-04-03
related_sessions: []
related_docs:
  - ../blueprint.md
  - ../implementation-plan-v1.md
supersedes: []
---

# 对话居中的工作区

## 问题

当系统最外层从 session 转向 project 后，很容易出现另一个偏差：过度向 project board 风格靠拢，让 workflow、stage、状态卡片占据页面中心，而真正的人与 agent 协作区反而退居次位。

这会让产品方向偏掉。

## 决策

Snail Shell 的工作区保持“对话居中”。

第一版界面结构确定为：

1. 左侧：`Project -> Conversations`
2. 中间：当前对话工作区
3. 右侧：workflow、artifacts、review context panel

## 为什么做这个决策

因为 studio owner 最频繁、最核心的动作，仍然是和 agent 直接协作。

真正推动工作前进的过程仍然发生在：

- 讨论
- 澄清
- 追问
- 修正
- 指令
- 提炼

也就是说，对话不是一个附属视图，而是工作真正发生的主场景。

project、workflow、artifact 当然非常重要，但它们更多是结构化上下文，是持续可见的约束和辅助信息，而不是主工作面本身。

## 被否定的方案

### 把 Project Workspace 做成中间主画布

放弃原因：这会错误地提升“状态展示”的视觉优先级，而削弱“实际协作”的主导地位。

如果页面中心长期是 project board，而对话像一个附属聊天框，系统最终就会越来越偏向“记录管理工具”，而不是“对话驱动的软件生产工作台”。

## 带来的影响

这个决策固定了几个界面原则：

1. 中间必须是最大的对话工作区
2. 左侧承担结构化导航
3. 右侧承担 workflow / artifacts / review 的持续可见上下文
4. 审批与回滚必须能在不离开对话工作区的情况下完成

## 长期有效的设计真相

Snail Shell 应该首先让人感觉自己在“通过对话驱动软件生产”，而不是在“看一个项目看板顺手带个聊天框”。
