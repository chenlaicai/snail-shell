---
name: coding-workflow
description: 编码交付工作流规范。用于 coding 阶段涉及代码修改、测试、提交与交付收拢的工作。
---

# Coding Workflow

## Purpose

这个 skill 用于约束编码阶段的工作流程，使编码工作在可追溯、可收拢、可交付的流程下进行。

## Rules

1. 开始实际编码前，必须创建独立 worktree。
2. 所有代码修改最终必须通过 commit 收拢。
3. 改动范围较大时，必须拆分为多个主题清晰的 commit。
4. commit 必须能够反映清晰修改主题。
5. 代码修改必须可追溯到当前 stage 与 conversation 的目标。
