---
title: Foundation Blueprint Phase
change_type: Feature-Update
document_type: milestone_record
status: active
created_at: 2026-04-03
updated_at: 2026-04-03
related_sessions: []
related_docs:
  - ../blueprint.md
  - ../workflow.md
  - ../domain-model.md
  - ../mvp-scope.md
  - ../storage-model.md
  - ../implementation-plan-v1.md
  - ../coding-checklist-v1.md
supersedes: []
---

# 基础蓝图阶段

## 阶段概述

这一阶段完成了 Snail Shell 的第一轮产品级定向。

在此之前，代码仓已经有一套轻量级的本地 shell/chat 骨架；在这一阶段中，这套骨架被重新定义和扩展，逐步明确为“agent-native 的软件生产工作室”。

## 这一阶段确定的关键结果

### 1. 产品定义被重新明确

Snail Shell 被正式定义为：

`一个全员 agent 的软件生产工作室`

这意味着产品不再被理解为单纯的 shell 或聊天工具，而是一个用于组织软件生产全过程的系统。

### 2. 最外层结构被重新定义

系统从 session-centric 思维转向 project-first 思维。

### 3. 软件生产工作流被明确

MVP 工作流被定义为：

1. initiative
2. requirement discussion
3. product design
4. software design
5. implementation
6. delivery acceptance

### 4. 严格审批与根因回滚被正式引入

工作流不再是自由推进，而是采用显式审批制，并允许基于根因分析进行正式回滚。

### 5. Artifact 中心化被建立

Snail Shell 被明确要求不能只保存 chat history，而要把稳定产物作为核心工作对象。

### 6. 第一版界面主结构被确定

第一版界面结构确定为：

1. 左侧：projects 与 conversations
2. 中间：conversation workspace
3. 右侧：workflow、artifacts、review context

## 为什么这一阶段重要

这一阶段的重要性不只是“写出了几份规划文档”，而是它第一次把 Snail Shell 的产品真相固定下来。

这个阶段明确了系统最应该优化的方向：

1. 保持对话为主动工作面
2. 保持 project 为最外层结构边界
3. 保持 artifact 为稳定工作产物
4. 保持讨论与文档之间的追溯关系

## 这一阶段产出的核心文档

这一阶段产出了第一批主蓝图文档：

1. `blueprint.md`
2. `workflow.md`
3. `domain-model.md`
4. `mvp-scope.md`
5. `storage-model.md`
6. `implementation-plan-v1.md`
7. `coding-checklist-v1.md`

## 长期有效的设计真相

基础蓝图阶段最终确立了：Snail Shell 应该被构建为一个纪律化的软件工作室系统，而不是一个不断外挂功能的聊天界面。
