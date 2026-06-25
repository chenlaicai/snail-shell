---
id: F20260625qx4i
title: fix-worktree-enforcement
from_ids: []
tags: [infra, prompt-engineering, worktree, bugfix]
modules: [collaboration, sop]
doc_kind: spec
---

# F20260625qx4i [infra] 修复架构师跳过 worktree 直接在主目录写文件的问题

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

code-delivery SOP 的设计阶段（design）要求架构师先进入 worktree 再写特性文档，但实际运行中架构师 Agent 总是直接在主目录开始写文件，完全跳过了 worktree 创建步骤。

### 问题分析

1. **约束埋得太深**：worktree 硬约束只存在于 `cd-design/references/workflow.md` 的 GATE-1 中，Agent 必须先加载 cd-design skill，再读取 workflow.md reference 才能看到
2. **SKILL.md 无硬约束**：cd-design 的 SKILL.md 只在工作流程索引中有一行"环境准备 — worktree 创建"的提及，没有 [HARD] 级别的禁止项
3. **cd-shared 无 worktree 规则**：作为所有 code-delivery 角色的前置依赖，cd-shared 完全没有 worktree 相关内容
4. **上下文注入无提醒**：`buildContextBlock` 的协作规则中没有 worktree 约束，Agent 在 skill 加载前看不到任何 worktree 提示

## 目标

1. 将 worktree 纪律提升为跨角色共享规则（cd-shared）
2. 在 SKILL.md gotchas 中加入 [HARD] 级别硬约束

## 非目标

- 不修改 worktree 创建的运行时逻辑
- 不添加代码级别的强制校验（如 hook 拦截）
- 不修改 SOP YAML 定义

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当 Agent 加载 cd-shared skill 时 | gotchas 和核心规则中均包含 worktree 纪律 | 验证 SKILL.md 和 references/worktree-discipline.md 内容 |
| B2 | 当 Agent 加载 cd-design skill 时 | gotchas 第一条为 worktree [HARD] 约束 | 验证 SKILL.md gotchas 首条 |

## 设计

### 两层加固策略

**第 1 层：cd-shared 共享规则**

- `cd-shared/SKILL.md` gotchas 新增 `[HARD] 文件修改前必须先进 worktree`
- `cd-shared/SKILL.md` 核心规则新增 `Worktree 纪律` 子节
- 新建 `cd-shared/references/worktree-discipline.md`，包含完整规则和执行流程（仅适用于 design/development 阶段）

**第 2 层：cd-design SKILL.md gotchas**

- gotchas 列表顶部新增 `[HARD] 第一步必须进入 worktree`，指定 `git worktree add` 命令

### 设计取舍

选择提示词加固而非代码级强制校验，原因：
1. 提示词加固覆盖面更广，Agent 的所有行为路径都能触达
2. 代码级校验（如 hook 拦截文件写入）实现复杂度高，且容易误伤正常操作
3. 当前问题本质是提示词层级设计问题，不是运行时缺陷

不采用 buildContextBlock 全量注入，原因：
1. worktree 约束仅对 design/development 阶段有意义，全量注入对 review/merge 阶段产生噪音
2. cd-shared 作为前置依赖已覆盖所有 code-delivery 角色，无需重复注入

## 生效路径

1. 修改 `data/file/skills/cd-shared/SKILL.md` — 新增 worktree 纪律子节和 gotcha
2. 新建 `data/file/skills/cd-shared/references/worktree-discipline.md` — 完整 worktree 规则（design/development only）
3. 修改 `data/file/skills/cd-design/SKILL.md` — gotchas 加入 [HARD] 约束

## 变更影响

- **影响范围**：提示词层面，不影响运行时逻辑
- **向后兼容**：完全兼容，纯新增约束
- **前端影响**：无
- **数据库影响**：无
