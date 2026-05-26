---
id: F2026051306
title: 研发者/检视者手册 checklist 重构与系统提示词注入
from_ids: []
tags: [refactor, checklist, design]
modules: [project_management]
---
# F2026051306 研发者/检视者手册 checklist 重构与系统提示词注入

## 背景

日常运行中发现检视者容易遗漏关键检查步骤（如确认是否基于最新代码、feature 文档编号是否冲突）。根因有两个：

1. S-03 和 S-04 的规则按主题分类而非按执行顺序组织，agent 跨区块组装时容易遗漏
2. AGENTS.md 的系统提示词是"指针"（"加载 S-03"）而非实际内容，且 `@` 引用不支持嵌套——只有 CLAUDE.md 里的 `@` 才生效。结果是 Claude Code 从未加载过任何 prompt 模块

## 目标

- 将 S-03（研发者手册）和 S-04（检视者手册）的规则重组为按执行顺序的 checklist
- 让 Claude Code 通过 CLAUDE.md 的 `@` 引用自动注入全部系统提示词模块
- CLAUDE.md 和 AGENTS.md 使用相同的 `@` 引用内容，单一来源维护

## 非目标

- 不修改任何规则内容本身，仅改变组织形式
- 不新增或删除规则

## 设计

### S-03/S-04 checklist 重构

- 职责原则保留为独立段落（立场声明，非执行步骤）
- 工作流相关规则打散嵌入按执行顺序排列的 checklist
- 原来的"代码仓工作基线""Feature 文档治理""代码与 PR 规则""专项检查"等主题区块取消，规则按执行顺序重新编排
- 易遗漏的关键步骤用粗体标记

### CLAUDE.md/AGENTS.md 系统提示词注入

- CLAUDE.md 和 AGENTS.md 内容一致（仅标题不同）
- 使用 `@` 引用直接注入 9 个 prompt 模块（B-01~B-03、S-01~S-06）
- Claude Code 读 CLAUDE.md 时自动解析 `@` 引用
- 其他 agent 读 AGENTS.md 时看到 `@` 引用作为文件路径指引

## 生效路径

- `.meta/prompts/` 中的 S-03 和 S-04 文件本身
- CLAUDE.md 和 AGENTS.md 通过 `@` 引用注入

## 改动范围

- `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/S-03-研发者手册.md`
- `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/S-04-检视者手册.md`
- `CLAUDE.md`
- `AGENTS.md`
- `.meta/skills/record-feature-repo-context/SKILL.md`（新增）
- `.meta/skills/record-feature-repo-context/record-feature-repo-context`（从 `.meta/scripts/` 迁移）
- `scripts/build-dist.ts`（更新脚本源路径）
- `tests/meta/prompt-assets-test.ts`（更新测试用例匹配新 checklist 格式）
- `tests/project/repo-cleanup-test.ts`（更新脚本路径引用）

## 验证

- `npm run check`（lint + build + test）
- 下次新会话验证 Claude Code 是否正确加载了 prompt 模块内容

## 风险与决策记录

- `@` 引用不支持递归嵌套：AGENTS.md 里的 `@` 对其他 agent 不会自动解析，但作为文件路径指引仍有价值
- 全量注入 9 个模块约 500 行，在上下文窗口可接受范围内
- CLAUDE.md 和 AGENTS.md 为两个独立副本（非 `@AGENTS.md` 引用），修改时需同步两处。取舍原因：`@` 不支持嵌套，无法通过 `@AGENTS.md` 间接注入 prompt 模块；相比维护引用机制的复杂度，双副本的同步成本更低

## 范围变更记录

无
