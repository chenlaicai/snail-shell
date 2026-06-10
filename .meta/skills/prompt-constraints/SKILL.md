---
name: prompt-constraints
description: 查询 .meta/prompts/reference/ 目录中的参考约束（非核心提示词补充）。角色手册仅包含 [HARD]/[STD] 核心行为边界；详细操作规则以独立文件存放在 reference 目录中，按需查阅。
---

# 参考约束查询

## Purpose

`.meta/prompts/reference/` 目录存放非核心系统提示词的参考约束——不直接注入 system prompt，而是由角色手册触发 AI 按需查阅。

角色手册（S-03/S-04/S-08）只包含 [HARD]/[STD] 核心行为边界。当核心规则不足以覆盖当前决策场景时，通过本 skill 查阅对应类别的参考约束文件。

## When To Use

- 进入设计、实现、测试、提交或检视阶段前
- 角色手册中的核心规则无法覆盖当前决策场景时

## 查阅方式

使用 Glob 列出 `.meta/prompts/reference/` 目录下的文件，用 Read 读取相关文件：

```
Glob: .meta/prompts/reference/*.md
Read: .meta/prompts/reference/<文件名>.md
```

## 文件索引

| 文件 | 覆盖阶段 | 内容 |
|------|----------|------|
| `设计分析.md` | 需求收敛与设计 | 全链路影响分析规则、可视化对齐触发条件 |
| `实现.md` | 实现 | DB schema/migration 约束、不兼容变更处理 |
| `测试.md` | 验证 | 测试质量规则、diff 范围校验 |
| `提交.md` | 提交 PR | 收口 checklist、Review 修复验证、完成判定 |
| `检视.md` | PR 检视 | 代码结构检查、Feature 文档检查、commit/PR 模板检查、模块边界、测试质量审查、复检步骤 |
| `演进治理.md` | 演进治理 | 演进项创建、产物类型决策、PR 创建边界、查重规则 |
| `提示词治理.md` | 提示词调整 | 归属判断规则、跨层污染避免、3+3 架构约束 |
| `通用指南.md` | 全阶段 | [GUIDE] 级别原则：分步原则、排障优先、持续执行 |
