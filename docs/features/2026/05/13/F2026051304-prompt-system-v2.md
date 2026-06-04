---
id: F2026051304
title: 系统提示词 v2 重构
from_ids: []
tags: [prompt, refactor]
modules: [project_management]
---
# F2026051304 系统提示词 v2 重构

## 背景

当前系统提示词体系存在三个核心问题：

1. 内容散乱——19 个文件中多个文件共享相同受众和触发条件，却按主题拆成独立文件（如 P010204~P010207 共享完全相同的 `when` 条件）
2. AGENTS.md 与 `.meta/prompts/` 双轨并行，90%+ 内容重复，靠人工同步不可持续
3. 信息密度低——理念阐述与行为指令混杂，稀释了有效规则

## 目标

1. 建立 v2 提示词规范：两层模型（Base/Scenario）、B-/S- 模块编号、规则级编号和 scope 声明
2. 将 19 个提示词文件收敛为 9 个模块，消除跨文件重复
3. AGENTS.md 改为轻量索引文件，指向 `.meta/prompts/` 系统提示词，结束双轨
4. 从 AGENTS.md 迁入独有的行为规则（中文交互、stage 推进禁止、开发原则）
5. 更新测试、模板和规范文档，确保 `npm run check` 全通过

## 非目标

1. 不修改 prompt-registry.ts 或 prompt-builder.ts 的应用逻辑（ID 是 opaque string，无需改动）
2. 不改变 `target` 值或 `when` 条件的匹配逻辑
3. 不改变 `render_mode` 的行为（full/outline 渲染逻辑不变）
4. 不修改知识治理系统（prompt-evaluation-registry.ts、skill-registry.ts）

## 设计

### 两层模型

| 层 | 前缀 | 生效模式 | 说明 |
|---|---|---|---|
| Base 层 | `B-` | 始终注入 | AI 身份、不可变契约、系统边界 |
| Scenario 层 | `S-` | 条件注入 | 按上下文按需注入，内部模块平级 |

### 模块清单

**Base 层（3 个模块）：**

| 模块 ID | 来源 | 职责 |
|---|---|---|
| B-01 | P0001 + P0004 + AGENTS.md 迁入 | 身份与责任契约 |
| B-02 | P0002 | 知识治理 |
| B-03 | P0003 | 运行时边界 |

**Scenario 层 — Work Context（2 个模块）：**

| 模块 ID | 来源 | 职责 |
|---|---|---|
| S-01 | P010101~P010106 | 项目上下文（事实注入） |
| S-02 | P010107 | 历史能力 |

**Scenario 层 — Stage Role Playbook（2 个模块）：**

| 模块 ID | 来源 | 职责 |
|---|---|---|
| S-03 | P010201 + P010202 + P010204~P010207 + AGENTS.md 迁入 | 研发者手册 |
| S-04 | P010203 | 检视者手册 |

**Scenario 层 — Task Runtime（2 个模块）：**

| 模块 ID | 来源 | 职责 |
|---|---|---|
| S-05 | P0201 | mention 提取 |
| S-06 | P0202 | 会话摘要 |

### 合并理由

- **B-01（P0001+P0004）**：受众完全相同（所有 AI 调用），触发条件完全相同（始终注入），职责边界高度重叠（都涉及输入可信边界和行为约束）
- **S-01（P010101~P010106）**：全部是事实注入，共享同一 target、受众、渲染模式，运行时总是同时注入
- **S-03（P010201+P010202+P010204~P010207）**：共享同一受众（Implementation Snail），`when` 条件覆盖相同的 stage_types 和 snails 组合，运行时总是同时注入

### AGENTS.md 重构

AGENTS.md 改为轻量索引，只保留：
- 外部 agent 操作指引（worktree 命令、工作流示例）
- 项目参考信息（概述、技术栈、构建命令、阅读顺序）
- 显式指向 `.meta/prompts/` 的引用

迁入提示词系统的内容：
- "与用户交互时使用中文" → B-01
- "Snail 不能自行推进 stage / 完成/归档 Feature" → S-03
- "所有工作必须通过正式产物沉淀"等开发原则 → S-03

### 规则格式

每条规则有模块内编号（R01, R02...），支持规则级 scope 声明。引用格式为 `B-01-R03`。

## 生效路径

1. `.meta/prompts/` — 9 个 v2 提示词模块（运行时系统提示词来源）
2. `AGENTS.md` — 外部 agent 轻量索引
3. `docs/core/prompt-system-structure.md` — v2 规范文档
4. `tests/meta/prompt-assets-test.ts` — 提示词注册和渲染验证

## 改动范围

1. 新建 9 个 v2 提示词文件
2. 重写 `AGENTS.md`
3. 更新 `tests/meta/prompt-assets-test.ts`
4. 更新 `.meta/prompts/prompt.md.template`
5. 更新 `.meta/README.md`
6. 替换 `docs/core/prompt-system-structure.md` 为 v2 内容
7. 删除 19 个旧 P-number 提示词文件
8. 删除 `.meta/prompts/prompt.md copy.template`
9. 删除 `docs/core/prompt-system-structure-v2.md`（合并后）

## 验证

1. `npm run lint` ✓
2. `npm run build` ✓
3. `npm run test` ✓
4. 确认 prompt registry 能正确发现和加载所有 9 个 v2 模块
5. 确认 `listPromptDocumentsForTarget()` 在不同 stage/snail 组合下返回正确的模块集
6. 确认 AGENTS.md 中的外部 agent 指引完整且指向正确的提示词文件

## 风险与决策记录

1. 决策：Base 层和 Work Context 层保持当前粒度，不进一步合并。理由是它们的职责边界已经足够清晰，且每个文件有独立的 `when` 或语义定位。
2. 决策：Stage Role Playbook 层从 7 个文件收敛到 2 个。理由是被合并的文件共享同一受众和触发条件，运行时总是同时注入，按主题拆分不构成独立文件的理由。
3. 决策：prompt-registry.ts 和 prompt-builder.ts 不需要修改。理由是 ID 在代码中是 opaque string，无硬编码引用。
4. 决策：保留 `target` 值不变，只改 `id`。理由是 target 值被场景构造器用于匹配，改变 target 值需要修改应用逻辑，而改变 id 只需要改数据。
