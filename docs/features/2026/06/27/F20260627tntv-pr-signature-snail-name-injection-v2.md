---
id: F20260627tntv
title: pr-signature-snail-name-injection-v2
from_ids: [F2026051912, F2026060101, F2026062305]
tags: [fix, prompt, signature]
modules: [snail, skill, collaboration]
doc_kind: spec
change_type: bugfix
---

# F20260627tntv [snail][BugFix] PR 签名 Snail 名称注入重建 + 签名模板格式修正

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

PR 评论签名要求格式为 `by <role_instance>（<snail_name>）`，其中 `<snail_name>` 为当前 Snail 在 `snails.json` 中的 `name` 字段值。但 agent 签名时频繁出现错误值（Orca、snail-shell、opencode、Snail 等）。

**根因链**：

1. F2026060101 曾实现 Snail 名称注入链路（`snails.json → SnailDen → CollaborationOptions → PromptBuildContext → buildRole() → {{snail_display_name}} → S-01 系统提示词`）
2. F2026060901 v2 全链路重构删除了 `src/prompt-center/` 和 `.meta/prompts/`，整条注入链路断裂
3. F2026062305 重建了签名规则文件（6 条规则），但模板 `by 审查者（<Snail 名称>）` 缺少角色实例后缀，且注入链路未恢复
4. 当前 `adapter.buildSystemPrompt()` 只拼接 tenet prompts，不注入任何 Snail 元数据
5. agent 无信息源，只能从上下文（GitHub 用户名、仓库名、runtime 名）猜测

**附带问题**：签名模板写的是 `by 审查者（<Snail 名称>）`，但实际预期格式是 `by 审查者-1（<snail_name>）`——角色实例带后缀是正确行为，模板未反映这一点。

## 目标

1. 将 snail name 注入到系统提示词，使 agent 签名时有准确信息源
2. 修正 pr-signature.md 模板格式，与实际预期的 `by <role_instance>（<snail_name>）` 对齐

## 非目标

- 不修改 snails.json 的 name 字段（当前值 `claude-code-stateful` 即为 snail name）
- 不做运行时签名校验
- 不做 name 为空时的回退策略（snails.json 是人工维护配置，配置错误应暴露而非兜底）
- 不改变签名的强制力等级（仍为 required）

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当 agent 签名 PR 评论时 | snail name 从系统提示词中"当前 Snail 名称"注入段读取，不猜测或构造 | |
| B2 | 当 `count: 2` 的角色（如审查者）签名时 | 角色名带实例后缀，如 `审查者-1`、`审查者-2` | |
| B3 | 当 agent 看到 identity block 的"角色实例"字段时 | 理解角色实例标识符（如 `架构师-1`）包含实例后缀，这是签名中角色名的正确形式 | |

## 设计

### 1. 注入层：Snail 名称注入到系统提示词

**问题**：`adapter.doInvokeFirstCall()` 构建系统提示词时，只拼接 tenet prompts，不包含任何 Snail 元数据。agent 无法从系统提示词中获取 snail name。

**方案**：在 `doInvokeFirstCall()` 中，将 snail name 内联拼接到系统提示词末尾。

**注入位置**：`doInvokeFirstCall()` 而非 `buildSystemPrompt()`。理由：
- `buildSystemPrompt()` 职责是拼接 tenet prompts，不应承担变量注入
- snail name 是 per-snail 配置，属于静态系统提示词的一部分（整场不变，可被 LLM 缓存）
- 在调用方拼接保持方法职责单一

**注入内容**：

```
## 当前 Snail 名称

你的 Snail 名称是「<snail.name>」。PR 评论签名时使用此值，不得自行猜测或构造。
```

其中 `<snail.name>` 替换为 snails.json 中该 snail 的 name 字段值（如 `claude-code-stateful`）。

### 2. 规则层：pr-signature.md 模板格式修正

**问题**：当前模板为 `by 审查者（<Snail 名称>）`，缺少角色实例后缀。实际预期是 `by 审查者-1（<snail_name>）`。

**方案**：修正 pr-signature.md 的模板和规则：

**模板修正**：

```
开发者 PR 普通评论：

    <评论正文>

    by <role_instance>（<snail_name>）

审查者 PR 普通评论（以审查者-1 为例）：

    <评论正文>

    by 审查者-1（<snail_name>）
```

**规则修正**（现有 6 条调整 + 新增 1 条）：

- 规则 2：`<snail_name>` 使用系统提示词中"当前 Snail 名称"注入段的值。该值由系统自动注入，不得自行猜测或构造。（原 `<Snail 名称>` 占位符统一改为 `<snail_name>`）
- 规则 3：签名行格式更新为 `by <role_instance>（<snail_name>）`（原 `by <角色>（<Snail 名称>）`）
- 规则 7（新增）：`<role_instance>` 使用 code-delivery.yaml 中定义的角色 `name` 值。当角色的 `count > 1` 时，角色名带实例后缀（如"审查者-1"、"审查者-2"）。角色实例标识符（如 identity block 中的"角色实例"字段）即为签名中的角色名。

## 生效路径

| 变更点 | 说明 |
|--------|------|
| adapter 层 | `doInvokeFirstCall()` 中拼接 snail name 到系统提示词 |
| pr-signature.md | 模板格式修正 + 规则 2/3 调整 + 规则 7 新增 |

## 设计约束摘要

- **snail name 来源**：snails.json 的 name 字段，当前值为 `claude-code-stateful`，不需要修改
- **注入位置**：adapter 的 `doInvokeFirstCall()` 中，保持 `buildSystemPrompt()` 职责单一
- **角色实例后缀**：`count > 1` 的角色，签名时角色名带实例后缀，这是正确行为
- **配置纪律**：snails.json 是人工维护配置，name 字段语义为 snail 标识名，配置错误应暴露而非兜底

## 改动范围

| 文件 | 变更类型 | 说明 |
|---|--------|------|
| `src/domain/snail/_internal/adapter.ts` | 修改 | `doInvokeFirstCall()` 中内联拼接 snail name 段到系统提示词 |
| `data/file/skills/cd-shared/references/pr-signature.md` | 修改 | 模板格式修正 + 规则 2/3 调整 + 规则 7 新增 |

## 验证

```bash
# V1: adapter.ts 包含 snail name 注入逻辑
grep -o "snail\.name" src/domain/snail/_internal/adapter.ts | wc -l
# 预期: ≥1

# V2: pr-signature.md 包含 7 条规则
grep -c "^[0-9]\." data/file/skills/cd-shared/references/pr-signature.md
# 预期: 7

# V3: pr-signature.md 模板包含 role_instance 占位符
grep "role_instance" data/file/skills/cd-shared/references/pr-signature.md
# 预期: 包含该占位符的行

# V4: pr-signature.md 模板不再使用不带后缀的"审查者"作为唯一示例
grep "审查者-1" data/file/skills/cd-shared/references/pr-signature.md
# 预期: 包含带后缀的示例
```

## 关联

- **前置**: F2026051912（PR 评论签名模板原始设计）
- **前置**: F2026060101（签名漂移修复：注入 Snail 显示名 — v1 实现已在 F2026060901 中被删除）
- **前置**: F2026062305（PR 签名规则重建到 skill references — 本 feature 修正其模板格式）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|---------|---------|---------|---------|--------|------|
| D1 | 注入位置：`buildSystemPrompt()` vs `doInvokeFirstCall()` | `doInvokeFirstCall()` 保持 `buildSystemPrompt()` 职责单一（只拼接 tenet prompts） | `buildSystemPrompt()` 是唯一的系统提示词构建点，改动更集中 | `doInvokeFirstCall()` 中拼接 | 单一职责原则；snail name 属于 per-snail 静态配置，与 tenet prompts 是不同关注点 | 架构师-1, 架构师-2 | 2026-06-27 |
| D2 | 是否修改 snails.json 的 name 字段 | 当前值 `claude-code-stateful` 就是 snail name，语义正确 | 改为更友好的显示名（如 "Snail Shell"）可读性更好 | 不改 | 用户明确：`claude-code-stateful` 就是 name，"Snail Shell" 才是人不可读的 | 架构师-2, 用户 | 2026-06-27 |
| D3 | 是否需要运行时签名校验 | 可在发布前校验签名格式 | 增加复杂度，当前无发布 API | 不做 | 数据修正 + 注入链路修复后，签名规则已约束 agent 行为 | 架构师-1, 架构师-2 | 2026-06-27 |
| D4 | 是否需要 name 回退策略 | 可在 name 为空或与 key 相同时用 agent_name 兜底 | snails.json 是人工维护配置，配置错误应暴露而非兜底 | 不做回退 | 为人工配置错误设计运行时回退属于过度设计 | 架构师-1, 架构师-2 | 2026-06-27 |
| D5 | 角色名是否带实例后缀 | 角色实例标识符（如 `审查者-1`）是系统分配的标识，应作为签名角色名 | 应使用 code-delivery.yaml 的 name 值（如 `审查者`），不带后缀 | 带后缀 | 用户明确：预期格式为 `by <role_instance>（<snail_name>）`，role_instance 包含后缀 | 架构师-2, 用户 | 2026-06-27 |
| D6 | 是否新增 `buildSnailNameBlock()` 方法 | 独立方法职责清晰、可测试 | 3 行字符串拼接不需要单独抽方法 | 不新增，内联拼接 | 过度设计；无复杂逻辑，测试价值低 | 架构师-1 | 2026-06-27 |
| D7 | 规则 2 和规则 8 是否合并 | 两条规则说的是同一件事（snail name 来源），只是占位符名称不同 | 分开写更明确 | 合并，规则 2 统一使用 `<snail_name>` 占位符 | 避免冗余；规则总数从 8 条减为 7 条 | 架构师-1 | 2026-06-27 |
| D8 | 模板占位符风格 | 保持现有尖括号风格 `<role_instance>`、`<snail_name>` | 花括号 `{role_instance}` 更常见 | 尖括号 | 与现有模板风格一致，减少不必要的风格变化 | 架构师-1 | 2026-06-27 |

<!-- [design-time] 章节结束 -->

<!-- [dev-time] 开发实现记录 -->

## 实现记录

### 变更文件

| 文件 | 变更说明 |
|---|--------|
| `src/domain/snail/_internal/adapter.ts` | `doInvokeFirstCall()` 中内联拼接 snail name 段到系统提示词末尾 |
| `data/file/skills/cd-shared/references/pr-signature.md` | 模板格式修正（`<role_instance>` + `<snail_name>` 占位符）+ 规则 2/3 调整 + 规则 7 新增 |

### 验证结果

```
V1: grep -o "snail\.name" src/domain/snail/_internal/adapter.ts | wc -l → 1 ✅
V2: grep -c "^[0-9]\\." data/file/skills/cd-shared/references/pr-signature.md → 7 ✅
V3: grep "role_instance" data/file/skills/cd-shared/references/pr-signature.md → 命中 3 行 ✅
V4: grep "审查者-1" data/file/skills/cd-shared/references/pr-signature.md → 命中 3 行 ✅
```

- 类型检查：`tsc --noEmit` 无错误
- 测试：无测试文件（仓库现有状态，非回归）
