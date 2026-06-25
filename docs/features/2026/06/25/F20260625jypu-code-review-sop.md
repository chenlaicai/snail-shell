---
id: F20260625jypu
title: code-review-sop
from_ids: [F2026062208, F20260624zu5p]
tags: [sop, review, code-review, external-pr]
modules: [sop]
doc_kind: spec
---

# F20260625jypu [sop] 新增独立代码检视 SOP

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

当前代码检视只能作为 code-delivery 研发流程的一部分（design → development → review → merge），无法独立触发。当需要检视外部提交的 PR（如同一 workspace 项目中别人提交的 PR）时，没有对应的 SOP 支持。

### 问题分析

1. **场景缺失**：外部 PR 检视场景没有对应的 SOP
2. **流程冗余**：检视外部 PR 不需要经过设计和开发阶段
3. **角色冗余**：外部 PR 检视不需要开发者角色（开发者不在本系统中）

## 目标

1. 新增独立的 `code-review` SOP，支持单独触发代码检视
2. 复用已有的检视相关 skills，避免重复维护
3. 保持与 code-delivery review 阶段一致的检视质量标准

## 非目标

- 不修改现有的 code-delivery SOP
- 不修改已有的 cd-review、cd-shared skills
- 不引入新的检视规则或流程变更

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当用户选择 code-review SOP 创建 issue 时 | 系统创建单 stage（review）的 issue，直接进入检视流程 | 验证 FileSopRepository 能正确加载 code-review.yaml |
| B2 | 当检视阶段开始时 | 两位审查者按照 cd-review skill 执行对抗性检视，交叉审视 | 验证 skill 引用名称正确，运行时能正确注入 agent context |
| B3 | 当检视完成时 | 两位审查者均已在 PR 上留下结论后，stage 完成 | 验证 stage 完成逻辑正确 |

## 设计

### SOP 定义

- **文件位置**：`data/file/sops/code-review/code-review.yaml`
- **first_stage**：`review`（单 stage 入口）
- **shared_skill**：`cd-shared`（复用特性编号、PR 签名、证据规则）
- **transitions**：`[]`（无转移边，完成即结束）

### 角色定义

| 角色 | key | count | skill | is_primary |
|------|-----|-------|-------|------------|
| 审查者 | reviewer | 2 | cd-review | true |

### 复用策略

直接复用已有 skills，不新建 skill 文件：

- `cd-shared`：通过 `shared_skill` 字段引用，提供特性编号、PR 签名、证据规则、Stage Gate
- `cd-review`：通过 role 的 `skill` 字段引用，提供审查者工作流程、对抗性检查、交叉审视

### 验收清单

| ID | 描述 | required |
|----|------|----------|
| rev-01 | 所有检视意见已逐条处理 | true |
| rev-02 | 根据变更类型独立执行验证命令，实际输出作为检视证据写入 gate_evidence | true |
| rev-03 | PR 评论已按签名模板收尾 | true |

## 生效路径

1. 创建 `data/file/sops/code-review/code-review.yaml`
2. 无需修改其他文件，直接复用已有 skills

## 变更影响

- **影响范围**：新增 SOP 定义，不影响现有功能
- **向后兼容**：完全兼容，纯新增
- **前端影响**：无
- **数据库影响**：无
