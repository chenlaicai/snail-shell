---
id: F2026062305
title: pr-signature-and-review-primary
from_ids: [F2026051912, F2026062208]
tags: [convention, sop]
modules: [sop, skill, collaboration]
doc_kind: spec
change_type: config-sync
---

# F2026062305 [sop] PR 签名规则重建 + review 阶段 is_primary 修复

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

两个配置/规则问题影响 code-delivery SOP 的一致性：

1. **PR 评论签名规则丢失**：签名模板原存在于 `v1/.meta/templates/pr-comment-signature.md`，在 F2026062302（移除 v1 遗留目录）中被删除。当前 `cd-shared/SKILL.md` 仅保留一句话描述，`cd-review-dev/SKILL.md` 引用了不存在的模板文件。详细规则（空行、不得挤同行、不得字面 `\n\n` 等）丢失，导致各 Snails 在 PR 评论中签名格式不统一。

2. **review 阶段 is_primary 配置错误**：`code-delivery.yaml` 中 review 阶段的 `developer` 角色被标为 `is_primary: true`，而 `reviewer` 角色未设置。审查者是 review 阶段的核心执行者（提交检视意见、交叉审视、放行决策），开发者是响应者。当前配置与实际语义矛盾。

## 目标

1. 在 skill 体系内重建完整的 PR 评论签名规则，替代已删除的独立模板文件。
2. 修复 review 阶段的 `is_primary` 配置，使审查者成为该阶段的 primary 角色。
3. 确保签名规则在所有相关 skill 中被正确引用。

## 非目标

1. 不改变 SOP 的 stage/transition/acceptance 机制。
2. 不改变 issue snapshot 机制。
3. 不新增自动格式化工具或评论脚本。
4. 不追溯修改历史 PR 评论。
5. 不改变 `is_primary` 字段的运行时语义（仅修正配置值）。

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当审查者在 PR 上写普通评论时 | 评论最后一行为 `by 审查者（<Snail 名称>）`，与正文之间有空行，不与正文挤同行 | |
| B2 | 当开发者在 PR 上写普通评论时 | 评论最后一行为 `by 开发者（<Snail 名称>）`，格式要求同上 | |
| B3 | 当 agent 加载 cd-shared skill 时 | 能通过 references/pr-signature.md 获取完整签名规则（6 条规则 + 示例） | |
| B4 | 当系统读取 review 阶段配置时 | reviewer 角色的 `is_primary` 为 true，developer 角色不设置 `is_primary` | |

## 设计

### 1. 签名规则重建

**问题**：原模板文件 `v1/.meta/templates/pr-comment-signature.md` 包含完整 6 条规则和示例，已被删除。当前 cd-shared/SKILL.md 仅有一句话摘要。

**方案**：在 `data/file/skills/cd-shared/references/` 下新增 `pr-signature.md`，从原模板迁移完整规则内容。这是 skill references 的标准组织方式，与 `evidence-rules.md`、`feature-numbering.md`、`stage-gate.md` 一致。

**文件内容**（从原模板迁移，不改变规则语义）：

```markdown
# PR 评论签名规则

## 适用范围

本规则适用于开发者和审查者写入 GitHub PR 的普通评论，包括检视意见、检视意见处理结论、复检请求、复检结论和仍需对方响应的说明。

本规则不适用于 message-payload 结构化消息。message-payload 的责任归属和路由由 payload 中的消息元数据与 mentions 字段承担。

## 模板

开发者 PR 普通评论：

    <评论正文>

    by 开发者（<Snail 名称>）

审查者 PR 普通评论：

    <评论正文>

    by 审查者（<Snail 名称>）

## 规则

1. `<评论正文>` 是实际评论内容，不是需要原样保留的占位文本。
2. `<Snail 名称>` 使用系统提示词中"当前 Snail 名称"注入的值。该值由系统自动注入，不得自行猜测或构造。
3. 签名行必须是评论最后一行，格式为 `by <角色>（<Snail 名称>）`。
4. 评论正文与签名行之间必须保留一个真实 Markdown 空行。
5. 签名不得与正文挤在同一行，不得出现在非末行位置。
6. PR 评论必须使用真实 Markdown 换行，不得把 `\n\n` 当作字面文本写入评论。
```

### 2. cd-shared/SKILL.md 更新

当前签名章节（第 25-26 行）：

```markdown
### PR 评论签名

评论最后一行：`by <角色名>（<Snail 名称>）`。Snail 名称使用系统提示词注入的值，不得自行猜测。
```

更新为引用完整规则文件：

```markdown
### PR 评论签名

评论最后一行：`by <角色名>（<Snail 名称>）`。Snail 名称使用系统提示词注入的值，不得自行猜测。详见 `references/pr-signature.md`。
```

### 3. cd-review/SKILL.md 补充签名引用

当前 cd-review/SKILL.md 没有显式提及签名规则。在"关键约束"章节末尾补充：

```markdown
- PR 评论按签名规则收尾（规则见 cd-shared 的 `references/pr-signature.md`）
```

### 4. cd-review-dev/SKILL.md 修复引用

当前第 25 行：

```markdown
4. **签署 PR 评论**：按签名模板收尾
```

更新为：

```markdown
4. **签署 PR 评论**：按签名规则收尾（规则见 cd-shared 的 `references/pr-signature.md`）
```

### 5. review 阶段 is_primary 修复

`data/file/sops/code-delivery/code-delivery.yaml` review 阶段 roles 修改：

**修改前**：
```yaml
roles:
  - key: developer
    name: 开发者
    description: 在审查阶段回应检视意见、修复代码并推动检视清零。
    is_primary: true
    skill: cd-review-dev
  - key: reviewer
    name: 审查者
    description: 负责对 PR 做对抗性代码检视，两位审查者交叉审视，在 PR 上留下可追溯评论。
    count: 2
    skill: cd-review
    prohibition: 不得使用低风险标签跳过问题，不得替开发者做决定
    self_check: 如果发现自己在说这个问题不重要，立即停止
```

**修改后**：
```yaml
roles:
  - key: developer
    name: 开发者
    description: 在审查阶段回应检视意见、修复代码并推动检视清零。
    skill: cd-review-dev
  - key: reviewer
    name: 审查者
    description: 负责对 PR 做对抗性代码检视，两位审查者交叉审视，在 PR 上留下可追溯评论。
    is_primary: true
    count: 2
    skill: cd-review
    prohibition: 不得使用低风险标签跳过问题，不得替开发者做决定
    self_check: 如果发现自己在说这个问题不重要，立即停止
```

变更点：
- developer 移除 `is_primary: true`
- reviewer 添加 `is_primary: true`

**语义一致性验证**：

| Stage | Primary Role | 语义 |
|---|---|---|
| design | designer（架构师） | 驱动需求对齐与设计 |
| development | developer（开发者） | 驱动研发实现 |
| review | reviewer（审查者） | 驱动检视与放行 |
| merge | merger（维护者） | 驱动合入检查 |

修复后各阶段 primary 角色语义一致：均为该阶段的核心驱动者。

## 生效路径

1. `data/file/skills/cd-shared/references/pr-signature.md`：完整签名规则文件（新增）。
2. `data/file/skills/cd-shared/SKILL.md`：签名章节引用完整规则文件。
3. `data/file/skills/cd-review/SKILL.md`：关键约束章节补充签名引用。
4. `data/file/skills/cd-review-dev/SKILL.md`：修复对已删除模板的引用。
5. `data/file/sops/code-delivery/code-delivery.yaml`：review 阶段 is_primary 配置修正。

## 设计约束摘要

- **签名规则完整性**：6 条规则必须全部迁移，不得遗漏任何一条。规则语义不得与原模板 F2026051912 有偏差。
- **签名强制力边界**：签名规则是约定而非强制，合规性完全依赖 agent 自律。当前无自动校验机制，rev-03 检查项为 `required: false`。开发者不应假设签名有自动保障。
- **is_primary 语义**：primary 角色 = 该阶段的核心驱动者/执行者。review 阶段的 primary 必须是 reviewer。
- **配置一致性**：`code-delivery.yaml` 的 `data/file/sops/` 和（已移除的）`v1/config/sop/` 两个版本。v1 已移除，只需修改 `data/file/sops/` 版本。
- **skill 组织规范**：详细规则放 `references/` 子目录，SKILL.md 本体只放流程索引和 gotchas。

## 改动范围

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `data/file/skills/cd-shared/references/pr-signature.md` | 新增 | 完整签名规则（从原模板迁移） |
| `data/file/skills/cd-shared/SKILL.md` | 修改 | 签名章节补充 references 引用 |
| `data/file/skills/cd-review/SKILL.md` | 修改 | 关键约束章节补充签名引用 |
| `data/file/skills/cd-review-dev/SKILL.md` | 修改 | 修复对已删除模板的引用，改为引用 cd-shared 的 references |
| `data/file/sops/code-delivery/code-delivery.yaml` | 修改 | review 阶段 is_primary 从 developer 移到 reviewer |

## 验证

验证命令（`config-sync` 类型）：

```bash
# V1: pr-signature.md 存在且包含 6 条规则
test -f data/file/skills/cd-shared/references/pr-signature.md && grep -c "^[0-9]\." data/file/skills/cd-shared/references/pr-signature.md
# 预期输出: 6

# V2: cd-shared/SKILL.md 引用 pr-signature.md
grep "references/pr-signature.md" data/file/skills/cd-shared/SKILL.md
# 预期输出: 包含该引用的行

# V3: cd-review/SKILL.md 引用 pr-signature.md
grep "references/pr-signature.md" data/file/skills/cd-review/SKILL.md
# 预期输出: 包含该引用的行

# V4: cd-review-dev/SKILL.md 不再引用"签名模板"
grep -c "签名模板" data/file/skills/cd-review-dev/SKILL.md
# 预期输出: 0

# V5: cd-review-dev/SKILL.md 引用 pr-signature.md
grep "references/pr-signature.md" data/file/skills/cd-review-dev/SKILL.md
# 预期输出: 包含该引用的行

# V6: reviewer 有 is_primary
grep -A2 "key: reviewer" data/file/sops/code-delivery/code-delivery.yaml | grep "is_primary: true"
# 预期输出: is_primary: true

# V7: developer 无 is_primary（在 review 阶段上下文中）
# 提取 review 阶段的 developer 定义块，确认无 is_primary
awk '/^- key: review/,/^- key: merge/' data/file/sops/code-delivery/code-delivery.yaml | awk '/- key: developer/,/- key: reviewer/' | grep -c "is_primary"
# 预期输出: 0
```

## 关联

- **前置**: F2026051912（PR 评论签名模板原始设计，本 feature 迁移其规则内容）
- **前置**: F2026062208（SOP Handbook → Skill 迁移，签名模板文件在该 feature 的 v1 清理中被删除，是本 feature 的直接根因）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|---|---|---|---|---|---|---|
| D1 | 签名规则的存放位置 | 放在 `cd-shared/references/pr-signature.md`，与 evidence-rules、feature-numbering、stage-gate 保持一致的组织方式 | 可以直接写在 cd-shared/SKILL.md 中，减少文件数量 | 放在 references/ 子目录 | SKILL.md 本体应精简为流程索引 + gotchas，详细规则放 references/，符合 F2026062208 的 skill 组织规范 | 架构师-1, 架构师-2 | 2026-06-23 |
| D2 | review 阶段 developer 是否保留 is_primary: false | 保留显式 false 语义更明确 | 与其他阶段非 primary 角色的省略写法不一致 | 移除 developer 的 is_primary 字段 | 保持与 design/development/merge 阶段一致的模式：只有 primary 角色显式设置 is_primary | 架构师-1, 架构师-2 | 2026-06-23 |
| D3 | 新文件标题用语从"模板"改为"规则" | "规则"强调约束语义，与 references 目录下的 evidence-rules、feature-numbering、stage-gate 风格一致 | "模板"强调格式示例，与原文件标题一致便于溯源 | 使用"规则" | references 组织规范统一使用规则导向命名，且文件仍保留模板示例 section，兼顾约束和格式 | 架构师-1, 架构师-2 | 2026-06-23 |
