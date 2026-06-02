---
id: I2026060105
title: skill-cleanup
from_ids: []
tags: [skill, 整理, 规范]
modules: [skills]
doc_kind: spec
---

# I2026060105 [skills] Skill 机制整理

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

Snail Shell 当前有 12 个 skill，分布在 `.meta/skills/` 目录下。随着系统演进，skill 机制存在以下问题需要整理：

1. **skill 命名与职责边界不清晰**：部分 skill 名称不能准确反映其能力边界（如 `message-out` 实际是内容格式化工具，不是消息发送系统）
2. **skill 分类缺失**：所有 skill 平铺在同一目录，缺乏分类机制，难以快速定位
3. **skill 依赖关系不明确**：部分 skill 之间存在隐式依赖（如 `developer-handbook` 引用 `message-out`）
4. **skill 文档质量参差**：部分 skill 的 `When To Use` 描述过于宽泛或缺失
5. **skill 与 prompt 体系的边界需要澄清**：`.meta/README.md` 中已有说明，但实际使用中仍有混淆

## 目标

整理 Snail Shell 的 skill 机制，使其：

1. 每个 skill 有清晰的职责边界和命名
2. skill 之间的依赖关系显式化
3. skill 文档质量统一
4. skill 与 prompt 体系的边界在实践中清晰

## 非目标

1. 不改变 skill 的底层加载机制（由 Claude Code Agent Skills 规范决定）
2. 不新增 skill（除非整理过程中发现必须拆分的情况）
3. 不改变 skill 的脚本接口（保持向后兼容）

## 设计

### P1 详设：Skill 现状分析

当前 12 个 skill 清单：

| # | skill 名称 | 职责 | 类型 | 文档质量 | 依赖 |
|---|---|---|---|---|---|
| 1 | `conversation-history` | 查询历史消息 | 工具型 | ⚠️ 缺少 When To Use | 无 |
| 2 | `developer-handbook` | 研发者操作流程手册 | 规范型 | ✅ 完整 | `message-out` |
| 3 | `evolution-candidate` | 写入演进候选 | 工具型 | ✅ 完整 | 无 |
| 4 | `feature-chain` | 搜索历史 Feature 文档 | 工具型 | ✅ 完整 | 无 |
| 5 | `knowledge-library` | 查询和管理知识库 | 工具型 | ✅ 完整 | 无 |
| 6 | `message-out` | 内容格式化工具 | 工具型 | ✅ 完整 | 无 |
| 7 | `prompt-constraints` | 查询参考约束 | 工具型 | ✅ 完整 | 无 |
| 8 | `query-current-context` | 查询当前上下文 | 工具型 | ✅ 完整 | 无 |
| 9 | `record-feature-repo-context` | 记录分支/worktree/PR | 工具型 | ✅ 完整 | 无 |
| 10 | `reviewer-handbook` | 检视者操作流程手册 | 规范型 | ✅ 完整 | `message-out` |
| 11 | `set-task-anchor` | 写入任务锚 | 工具型 | ✅ 完整 | 无 |
| 12 | `snail-skill-creator` | 创建/维护 skill | 规范型 | ✅ 完整 | 无 |

**分类**：
- **工具型**（9 个）：提供具体命令或查询能力
- **规范型**（3 个）：提供流程、规则或操作手册

**发现的问题**：
1. `conversation-history` 缺少 `When To Use` 部分
2. `developer-handbook` 和 `reviewer-handbook` 对 `message-out` 的依赖是隐式的（在文档中引用但未声明）
3. 所有 skill 文档格式基本统一，但部分 skill 的 `Output` 部分描述不够详细

### P2 详设：Skill 唯一性约束

**设计决策**：skill name 必须全局唯一（跨平台级和工作区级）。

**理由**：
1. agent 调用 skill 时只传 name（`Skill tool` 传入 name）
2. 如果同名，agent 无法区分调用哪个
3. 静默覆盖会导致平台级 skill 被意外吞掉

**正确行为**：
- 新增 skill 时发现同名 → 报错
- 初始化时发现同名（跨目录） → 报错

**实现方案**：
1. `SkillDefinition` 加 `source` 字段，记录 skill 来源（`"platform"` 或 `"workspace"`）
2. `mergeSkills()` 改为检测冲突并报错，而不是静默覆盖
3. 保持现有注入机制不变（符号链接只创建最终生效版本）

### P3 详设：Skill 可见性范围

**设计决策**：工作区级 skill 仅对该工作区的 agent 可见，其他工作区的 agent 看不到。

**可见性规则**：

| 来源 | 路径 | 可见范围 |
|---|---|---|
| 全局 skill | `.meta/skills/` | 所有工作区 |
| 工作区级 skill | `<workspaceRoot>/.snail/skills/` | 仅该工作区 |

**实现链路**：`src/prompt-center/builder.ts` 调用 `collectActiveSkills(context.workspace.workspace_root)`，每个工作区只加载自己的 `workspace_root` 下的 skill。

**理由**：
1. 工作区级 skill 是该工作区的私有能力包，不应污染其他工作区
2. 如果某个 skill 需要全局共享，应放在 `.meta/skills/` 下
3. 这保证了工作区之间的 skill 隔离性

**与用户澄清**：2026-06-01 在 review 阶段与用户确认了此设计意图。

## 生效路径

1. skill 目录结构：`.meta/skills/<skill-name>/SKILL.md`
2. skill 文档规范：`.meta/skills/SKILL.md.template`
3. skill 与 prompt 边界：`.meta/README.md`

<!-- [design-time] 章节结束 -->

## 改动范围

1. `src/skill-center/registry.ts`：SkillDefinition 加 source 字段，mergeSkills 改为同名报错
2. `src/agent/capability/spec.ts`：SkillCapability 加 source 字段
3. `src/agent/capability/builder.ts`：collectActiveSkills 传递 source 字段
4. `tests/agent/capability-spec-test.ts`：新增同名 skill 报错测试
5. `docs/features/2026/06/01/I2026060105-skill-cleanup.md`：本 feature 文档

## 验证

### P1

- [x] 完成 12 个 skill 的现状分析表格
- [x] 识别出需要整理的具体问题

### P2

- [x] 确定整理方案（方案 A + 同名报错）
- [x] 按方案完成整理

### 通用

- [x] 所有 skill 文档格式统一
- [x] skill 依赖关系显式记录
- [x] 无功能回归（45 个测试全部通过）

## 关联

无

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | 整理方案选择 | 方案 A：只做文档整理 + 修复同名覆盖 bug | 2026-06-01 |
| 2 | skill name 唯一性 | 全局唯一，同名报错（跨平台级和工作区级） | 2026-06-01 |
| 3 | 工作区级 skill 可见性 | 仅对该工作区的 agent 可见，其他工作区看不到；全局共享 skill 应放 `.meta/skills/` | 2026-06-01 |

## 范围变更记录

无
