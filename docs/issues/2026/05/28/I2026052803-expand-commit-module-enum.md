---
id: I2026052803
title: expand-commit-module-enum
from_ids: []
tags: [commit-template, git-hook, module]
modules: [project_management]
doc_kind: spec
---

# I2026052803 [commit-template] 放开 commit/PR 模板 module 取值限制

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

commit/PR 标题模板中的 `[module]` 字段目前只允许 `project_management` | `knowledge_governance` 两个值。由于几乎所有开发都在 `project_management` 项目下，该字段在实践中恒为 `project_management`，失去了标记变更功能区域的区分意义。

## 目标

放开 module 取值限制，使其能自由标记变更的功能区域，让 commit 历史中的 module 标签真正有区分度。

### P1 — 从固定枚举改为模式约束

- module 格式：小写中划线（`[a-z-]+`），由 AI 根据实际 diff 内容自行填写
- 常见参考值（非穷举）：`prompt`、`project-management`、`knowledge-governance`、`persistence`、`workflow`、`web`、`agent`、`integrations`、`scripts`
- 更新 git hook regex、developer-handbook、reviewer-handbook、S-03 系统提示词、prompt-evaluations 测试样本

## 非目标

- 不改变 `Project.module` 数据库字段（那是业务域归属，与 commit module 是不同维度）
- 不改变 feature 文档 frontmatter 的 `modules` 字段（已有更灵活的枚举）

## 设计

### P1 详设

module 取值与功能区域对应关系（参考，非穷举）：

| module | 功能区域 | 典型改动文件 |
|---|---|---|
| `project-management` | 项目管理/流程/工具 | `.githooks/`, `.meta/skills/`, `.meta/prompts/` |
| `knowledge-governance` | 知识治理 | 知识中心相关 |
| `prompt` | 系统提示词 | `.meta/prompts/prompts/` |
| `persistence` | 持久层/数据库 | `src/persistence/`, schema 变更 |
| `workflow` | 工作流引擎 | `src/project-workflow/` |
| `web` | Web UI | `src/web/` |
| `agent` | 智能体相关 | agent runtime 相关 |
| `integrations` | 第三方集成 | Feishu、MCP 等 |
| `scripts` | 脚本/工具 | `.meta/scripts/` |

AI 在写 commit/PR 标题时根据实际 diff 内容自行判断应取哪个 module，不限于上表。

## 生效路径

- `.githooks/commit-msg` — regex 校验
- `.meta/skills/developer-handbook/SKILL.md` — commit 模板说明
- `.meta/skills/reviewer-handbook/SKILL.md` — 检视清单
- `.meta/prompts/prompts/S-03-研发者手册.md` — 系统提示词规则
- `.meta/prompt-evaluations/prompt-behavior-samples.json` — 测试样本

<!-- [design-time] 章节结束 -->

## 改动范围

- `.githooks/commit-msg` — regex 扩展 + 错误提示
- `.meta/skills/developer-handbook/SKILL.md` — module 取值说明
- `.meta/skills/reviewer-handbook/SKILL.md` — 检视清单 module 取值
- `.meta/prompts/prompts/S-03-研发者手册.md` — 系统提示词 module 取值
- `.meta/prompt-evaluations/prompt-behavior-samples.json` — 测试样本

## 验证

### P1

- [ ] git hook 接受小写中划线格式的任意 module（如 `prompt`、`project-management`、`integrations`）
- [ ] git hook 拒绝非法格式（大写、下划线、空值等）
- [ ] 所有文档说明一致（模式约束 + 参考示例）

## 关联

- **相关**: I2026052601（引入 commit 模板 [module] 字段）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | module 枚举是否应与 Project.module 解耦 | 是，两者是不同维度；commit module 标记功能区域，Project.module 标记业务域归属 | 2026-05-28 |
| 2 | module 应固定枚举还是开放模式 | 开放模式（`[a-z-]+`），固定枚举过于局限，每次新增值需改 5 个文件 | 2026-05-28 |
| 3 | module 格式用下划线还是中划线 | 中划线，与常见 kebab-case 惯例一致 | 2026-05-28 |
