---
id: F20260624d5pg
title: issue-context-usage-boundary
from_ids:
  - F2026062310
tags: []
modules: []
doc_kind: spec
---

# F20260624d5pg [workflow] Issue Context 用途边界：MCP 工具描述优化

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

F2026062310 实现了 Issue 级别统一上下文（MCP 方案）。上线后发现 context 被滥用：大量检视计划、方案修改全文、设计讨论记录等大段内容被塞入 context value，偏离了"跨 Stage 指针/元数据存储"的设计定位。

根因：`set_context` 工具描述仅说明了"设置上下文（merge 语义）"，未说明用途边界，Agent 无从判断什么该放、什么不该放。

## 目标

优化 `set_context` 的 MCP 工具描述，在工具入口处明确 context 的用途边界。

## 设计

修改 `set_context` 的三处描述文案：

**`description`**：
- 前："设置 Issue 级别的上下文（merge 语义）"
- 后："设置 Issue 级别的上下文（merge 语义）。用于存储跨 Stage 传递的指针和元数据（文件路径、分支名、PR URL、状态标记）。禁止存放大段文本、检视计划、方案内容 — 这些应写入文件，context 只存文件路径。"

**`key.description`**：
- 前："上下文 key（建议格式：{stage_key}.{artifact_name}）"
- 后："上下文 key（建议格式：{stage_key}.{artifact_name}，如 design.feature_doc_path）"

**`value.description`**：
- 前："上下文 value"
- 后："上下文 value（应为短文本：路径、URL、状态标记等，禁止大段内容）"

## task_anchor

- **change_type**: feature
- **verification_commands**: 通过 MCP 工具调用 `set_context`，确认工具描述已更新

## 改动范围

| 文件 | 变更类型 |
|------|----------|
| `src/domain/snail-mcp-server/_internal/servers/snail-issue-context.ts` | 修改（工具描述） |

## 关联

- **前置**: F2026062310（Issue 级别统一上下文 MCP 方案）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | 约束方式：工具描述 vs 代码校验 vs 渲染截断 | 工具描述最小化改动，单点变更；代码校验和截断分散多处，引入霰弹 | 工具描述依赖 Agent 遵守，无硬约束 | 仅优化工具描述 | 最小化变更，避免霰弹 | 架构师-1, 用户 | 2026-06-24 |

<!-- [design-time] 章节结束 -->
