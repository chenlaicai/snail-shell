---
name: coding-workflow
title: Coding Workflow
type: rule-skill
scope:
  stage_types: [coding]
  snails: [implementation_agent, design_agent]
activation:
  inject_into: system
  condition: temporary-always
---

# Coding Workflow

## Purpose

这个 skill 用于约束编码阶段的工作流程，使编码工作不是随意修改代码，而是在可追溯、可收拢、可交付的流程下进行。

## When To Use

它本应主要用于 `coding` 阶段。

当前阶段先临时注入到系统提示词中，后续应调整为仅在 `coding` 阶段触发。

## Rules

1. 在开始实际编码前，必须创建独立 worktree 作为本次工作的独立工作区域。
2. 所有代码修改最终必须通过 commit 收拢，不能让修改长期悬空停留在工作区中。
3. 如果本次改动范围较大，必须拆分为多个主题清晰的 commit，而不是把无关修改混在同一个 commit 中。
4. commit 必须能够反映清晰的修改主题，并且应当有明确的工作语义。
5. 在编码过程中，必须保证代码修改能够追溯到当前 stage 与 conversation 的目标。
6. 如果当前编码工作尚未形成可交付的代码类产物，不应将该阶段视为完成。

## Expected Outputs

1. 清晰收拢的代码提交结果
2. 可追溯的代码变更记录
3. 满足当前 coding 阶段正式交付要求的代码类 artifact
