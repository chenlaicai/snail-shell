---
id: F2026062208
title: sop-handbook-to-skill-migration
from_ids: []
tags: []
modules: [sop, skill, collaboration]
doc_kind: spec
change_type: feature
---

# F2026062208 [sop] 研发 SOP Handbook → Skill 迁移

## 背景

当前 code-delivery SOP 的 role handbook 以纯文本形式全量注入 system-reminder，导致每次 agent 调用携带 ~450 行规则文本（shared 95 行 + role 170-350 行）。声明式规则在长对话中注意力衰减严重，无触发机制，无 progressive disclosure。identity 中的 prohibition/self_check 依赖脆弱的 regex 从 markdown 中提取。

Anthropic 内部使用 skills 的经验表明：skill 的核心价值是按需加载 + 渐进披露 + 脚本化执行。ACS 已有完整的 skill 基础设施（symlink 注入、SKILL.md 发现），但尚未用于 SOP 工作流程。

## 目标

### P1 — Handbook 内容迁移为 Skill（本 feature）

将 code-delivery SOP 的 5 个 role handbook + 1 个 shared handbook 迁移为 6 个 skill 文件夹，采用 progressive disclosure 结构。system-reminder 瘦身为 ~60 行（identity + context + skill 索引）。

## 非目标

- 不改变 SOP 的 stage/transition/acceptance 机制
- 不改变 issue snapshot 机制（snapshot 仍然冻结 SOP 定义）
- 不改变 MCP server 配置
- 不做 skill marketplace/plugin 机制
- 其他 SOP 可选择性添加 `skill` 字段使用新机制（本 feature 只改 code-delivery）

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | When agent 被调用 | system-reminder 只包含 identity + context + skill 索引，不包含 handbook 原文 | |
| B2 | When agent 收到 system-reminder | agent 能通过 skill description 发现并触发对应 skill | |
| B3 | When skill 被触发 | SKILL.md 中的 references/ 链接能被 agent 按需读取 | |

## 设计

### P1 详设

#### 1. Skill 文件夹结构

```
data/file/skills/
  cd-shared/SKILL.md + references/{feature-numbering, evidence-rules, stage-gate}.md
  cd-design/SKILL.md + references/{workflow, cross-review}.md
  cd-development/SKILL.md + references/{workflow, testing-rules, code-principles}.md
  cd-review/SKILL.md + references/{workflow, adversarial-check, cross-review}.md
  cd-review-dev/SKILL.md
  cd-merge/SKILL.md
```

每个 SKILL.md 的 description 字段写触发条件（不写摘要），SKILL.md 本体精简为流程索引 + gotchas，详细内容放 `references/`。

#### 2. SOP YAML 字段

删除 `shared_handbook` 和所有 `handbook` 字段，新增 `shared_skill`、`skill`、`prohibition`、`self_check`。

```yaml
shared_skill: cd-shared

roles:
  - key: designer
    skill: cd-design
    prohibition: 不得编写或修改代码，不得越界到实现细节
    self_check: 如果发现自己在说具体修改某个文件的某行，立即停止
```

#### 3. SOP Model 变更

- 删除 `Sop.shared_handbook` 和 `RoleDefinition.handbook`
- 新增 `Sop.shared_skill`、`RoleDefinition.skill`、`RoleDefinition.prohibition`、`RoleDefinition.self_check`

#### 4. buildSystemReminder() 单路径

删除旧的 `buildLegacySystemReminder`、`extractRoleResponsibility`、`extractHandbookItem` 方法。`buildSystemReminder()` 直接从 SOP snapshot 读取结构化字段，输出 ~60 行 identity + context + skill 索引。

`SnailFirstCallRequest.handbook` 重命名为 `systemReminder`。

## 生效路径

- `data/file/skills/cd-*/SKILL.md` — 新增 skill 定义
- `data/file/skills/cd-*/references/*.md` — 新增渐进披露内容
- `data/file/sops/code-delivery/code-delivery.yaml` — 新增 skill/prohibition/self_check/shared_skill 字段
- `src/domain/sop/model.ts` — RoleDefinition 新增字段
- `src/domain/sop/_internal/repository.ts` — 解析新字段
- `src/app/issue-collaboration/collaboration.ts` — buildSystemReminder 双路径

## 设计约束摘要

### 边界
- 只改 code-delivery SOP，其他 SOP 可选择性添加 `skill` 字段使用新机制
- 只改 system-reminder 注入方式，不改 systemPrompt/tenet-prompt 体系
- 不改 issue snapshot 机制

### 关键决策
- **SOP YAML 显式声明 prohibition/self_check**：替代脆弱的 regex 提取
- **skill 按 SOP 阶段拆分**：每个 stage+role 组合一个 skill
- **删除 handbook 相关字段和代码**：不留兼容性残余

### 语义不变量
- SOP 的 stage/transition/acceptance 机制不变
- issue.sop_snapshot 冻结时机和内容不变
- skills 仍然通过 symlink 注入到 `.claude/skills/`

## 改动范围

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `data/file/skills/cd-*/SKILL.md` | 新增 | 6 个 skill 定义 |
| `data/file/skills/cd-*/references/*.md` | 新增 | 8 个渐进披露文件 |
| `data/file/sops/code-delivery/*.handbook.md` | 删除 | 6 个旧 handbook 文件 |
| `data/file/sops/code-delivery/code-delivery.yaml` | 修改 | 删除 handbook 字段，新增 skill 字段 |
| `src/domain/sop/model.ts` | 修改 | 删除 shared_handbook/handbook，新增 skill 字段 |
| `src/domain/sop/_internal/repository.ts` | 修改 | 删除 handbook 解析和 resolveFileRef |
| `src/app/issue-collaboration/collaboration.ts` | 修改 | 删除旧路径，单路径 skill 注入 |
| `src/domain/issue/port.ts` | 修改 | 删除 getRoleHandbook |
| `src/domain/issue/_internal/adapter.ts` | 修改 | 删除 getRoleHandbook 实现 |
| `src/domain/snail/model.ts` | 修改 | handbook → systemReminder |
| `src/domain/snail/_internal/adapter.ts` | 修改 | handbook → systemReminder |
| `src/api-contracts/dto.ts` | 修改 | 更新 DTO 字段 |
| `src/web/types.ts` | 修改 | 更新 web types |

## 验证

- [x] TypeScript 编译通过
- [x] 现有测试全部通过（11 passed，8 个 v1 web 测试因缺少依赖失败，与本次改动无关）
- [x] SOP YAML 解析正确（shared_skill、skill、prohibition、self_check 字段）
- [ ] 创建新 issue → agent 收到 skill 索引的 system-reminder
- [ ] agent 能发现并触发对应 skill

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | Skill 拆分粒度 | 按 stage+role 拆分与 SOP 对齐 | skill 数量多（6个） | 按 stage+role 拆分 | SOP 的 stage 机制是核心编排逻辑 | orca + Claude | 2026-06-22 |
| D2 | 是否保留旧路径 | 双路径兼容旧 issue | 双重维护风险、代码残余 | 删除旧路径，干净迁移 | 不允许残余旧代码 | orca + Claude | 2026-06-23 |
| D3 | prohibition/self_check 存储位置 | YAML 显式声明 vs regex 提取 | YAML 增加维护成本 | YAML 显式声明 | regex 提取脆弱 | orca + Claude | 2026-06-22 |
| D4 | shared 规则注入方式 | shared_skill vs shared_handbook 全量注入 | 新增字段增加复杂度 | shared_skill | 共享规则也应 progressive disclosure | orca + Claude | 2026-06-22 |
