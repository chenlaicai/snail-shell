---
id: F2026062306
title: sop-handbook-to-skill-remaining
from_ids: [F2026062208]
tags: []
modules: [sop, skill, collaboration]
doc_kind: spec
change_type: feature
---

# F2026062306 [sop] general-assistant 与 evolution SOP Handbook → Skill 迁移

## 背景

PR419（F2026062208）完成了 code-delivery SOP 的 handbook → skill 迁移，但 repo 中还有两个 SOP 未覆盖：
- **general-assistant**：仍使用 `handbook: "@chat#assistant.handbook.md"` 字段（parser 静默忽略，runtime skill 为 null）
- **evolution**：executor 角色没有任何 skill，治理规则散落在 v1 遗留文档中

## 目标

将剩余两个 SOP 统一迁移到 skill 机制，消除 repo 中所有 handbook 残留。

## 非目标

- 不改变 TypeScript 代码（parser、model、collaboration 已在 PR419 中全部切换到 skill 字段）
- 不改变 SOP 的 stage/transition/acceptance 机制
- 不为 evolution-candidate skill 增加运行时依赖强制执行机制

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | When general-assistant SOP 的 assistant 角色被激活 | agent 通过 skill tool 加载 ga-assistant skill，获得意图理解、追问策略、网络搜索等规则 | N/A — 格式迁移，不改变运行时行为 |
| B2 | When evolution SOP 的 executor 角色被激活 | agent 通过 skill tool 加载 evo-executor skill，获得治理工作流、查重规则、裁决策略 | N/A — 格式迁移，不改变运行时行为 |
| B3 | When repo 中搜索 handbook 关键词 | 无任何 .handbook.md 文件或 handbook YAML 字段残留 | |

## 设计

### 1. ga-assistant skill

将 `chat#assistant.handbook.md` 内容按 SKILL.md 模板重写：

```
data/file/skills/ga-assistant/SKILL.md
```

内容保留原始 5 个章节（意图理解、追问策略、网络搜索、梳理归纳、行为边界），新增 Gotchas 部分。单文件，不需要 references/ 子目录。

### 2. evo-executor skill

基于 v1 遗留文档（`v1/.meta/prompts/reference/演进治理.md`）和 F2026052903 设计文档创建：

```
data/file/skills/evo-executor/
  SKILL.md                    — 工作流程索引 + 关键约束 + 完成标准
  references/workflow.md      — 五阶段详细流程
  references/artifact-decision.md — 裁决去向决策矩阵
```

前置依赖：内联 evolution-candidate skill 的关键字段速查，减少外部依赖。

### 3. SOP YAML 变更

- `general-assistant.yaml`：`handbook: "@chat#assistant.handbook.md"` → `skill: ga-assistant`
- `evolution.yaml`：executor role 新增 `skill: evo-executor`

### 4. 清理

删除最后一个 handbook 文件：`data/file/sops/general-assistant/chat#assistant.handbook.md`

## 生效路径

- `data/file/skills/ga-assistant/SKILL.md` — 新增
- `data/file/skills/evo-executor/SKILL.md` — 新增
- `data/file/skills/evo-executor/references/workflow.md` — 新增
- `data/file/skills/evo-executor/references/artifact-decision.md` — 新增
- `data/file/sops/general-assistant/general-assistant.yaml` — 修改
- `data/file/sops/evolution/evolution.yaml` — 修改
- `data/file/sops/general-assistant/chat#assistant.handbook.md` — 删除

## 改动范围

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `data/file/skills/ga-assistant/SKILL.md` | 新增 | general-assistant 助理 skill |
| `data/file/skills/evo-executor/SKILL.md` | 新增 | evolution 治理执行者 skill |
| `data/file/skills/evo-executor/references/workflow.md` | 新增 | 五阶段详细流程 |
| `data/file/skills/evo-executor/references/artifact-decision.md` | 新增 | 裁决去向决策矩阵 |
| `data/file/sops/general-assistant/general-assistant.yaml` | 修改 | handbook → skill 字段 |
| `data/file/sops/evolution/evolution.yaml` | 修改 | executor 新增 skill 字段 |
| `data/file/sops/general-assistant/chat#assistant.handbook.md` | 删除 | 最后一个 handbook 残留 |

## 验证

- [x] TypeScript 编译通过
- [x] YAML 格式验证通过
- [x] 旧 handbook 文件已删除
- [x] 新 skill 目录结构完整
- [x] 合并最新 main 后 build 通过
