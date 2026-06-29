---
id: F20260629vv5s
title: agent-identity-awareness
from_ids: [F20260627tntv]
tags: [identity, prompt, snail, collaboration]
modules: [snail, collaboration, tenet-prompt, acs]
doc_kind: spec
change_type: feature-update
---

# F20260629vv5s [collaboration][Feature Update] Agent 身份认知：系统归属 + Snail 身份 + 角色统一注入

## 背景

Agent 缺乏自我认知：不知道自己属于什么系统、是哪只 snail、底层跑的什么 runtime/model。身份信息散落在两个注入点：

1. **adapter 层**（system prompt）：只注入了 snail `name` 一个字段
2. **collaboration 层**（system-reminder）：只注入了角色维度（角色名、角色实例、职责、禁止、自检）

Agent 要从两个地方拼凑"我是谁"，且完全缺失系统归属感和 snail 元数据（key、agent_name、model）。

**根因**：

1. tenet prompt 的 `<identity>` 块只有行为准则（"对判断、行动和输出负责"），不是身份描述
2. adapter 拿到了完整的 snail 对象（key、name、agent_name、model），但只注入了 `name`
3. collaboration 的 `buildIdentityBlock` 只有角色维度，没有 snail 维度和系统维度
4. `<identity>` 标签在 tenet prompt 中被行为准则占用，导致无法用于真正的身份定义

## 目标

1. Agent 启动时知道自己属于 Snail Shell 多 Agent 协作系统
2. Agent 知道自己的完整 snail 身份（key、name、agent_name、model）
3. 所有身份信息在一个 `<identity>` 块中，三层子结构（系统→Snail→角色）
4. `<identity>` 只出现在 system-reminder 中，tenet prompt 不占用该标签

## 非目标

- 不修改 agent runtime 实现（claude-code、opencode 等）
- 不修改 SnailPort 接口（`findByKey` 已满足查询需求）
- 不改变 resume 流程（snail 身份是静态的，首次注入后不变）
- 不做 snail 实例 ID 到 env var 的注入（首次调用时实例尚未创建）

## 核心业务行为

| # | 场景 | 预期行为 |
|---|------|----------|
| B1 | 当 agent 启动时 | 从 system-reminder 的 `<identity>` 块获知自己是 Snail Shell 系统中的一只 snail |
| B2 | 当 agent 需要签名时 | 从 `<identity>` → `## Snail` → `**名称**` 读取 snail name |
| B3 | 当 agent 需要知道自己的 runtime 时 | 从 `<identity>` → `## Snail` → `**底层 Agent**` 和 `**模型**` 读取 |
| B4 | 当 agent 扮演特定角色时 | 从 `<identity>` → `## 角色` 读取角色名、职责、禁止、自检 |

## 设计

### 1. Tenet prompt：去掉 `<identity>` 包装

**问题**：tenet prompt 的 `<identity>` 块只有行为准则，语义错误地占用了 `<identity>` 标签。

**方案**：删除 `<identity>` 包装，行为准则内容归入 `<constraints>`。

### 2. Adapter：去掉 snail name 的 system prompt 注入

**问题**：adapter 在 system prompt 中注入 `## 当前 Snail 名称` 段，与 collaboration 的 `<identity>` 块形成两个身份注入点。

**方案**：删除 adapter 中的 snail name 注入。snail 身份信息统一由 collaboration 的 `<identity>` 块承载。

### 3. Collaboration：统一 `<identity>` 块

**问题**：`buildIdentityBlock` 只有角色维度，缺少系统维度和 snail 维度。

**方案**：

1. `executeAgentInvocation` 将 `assignment.snail_key` 传入 `buildSystemReminder`
2. `buildSystemReminder` 通过 `this.deps.snailPort.findByKey(snailKey)` 获取 snail 元数据
3. `buildIdentityBlock` 扩展为三层结构：

```
<identity>
## 系统
你是 Snail Shell 多 Agent 协作系统中的一只 snail，拥有独立的 snail 身份和角色职责。
PR 评论签名时使用 Snail 名称，不得自行猜测或构造。

## Snail
- Key：{snail.key}
- 名称：{snail.name}
- 底层 Agent：{snail.agent_name}
- 模型：{snail.model}

## 角色
# 你是{roleName}
角色实例：{roleInstance}
职责：{description}
禁止：{prohibition}
自检：{self_check}
</identity>
```

### 4. Context env：注入 snail_key

**问题**：agent 的脚本和 MCP 工具无法通过 `process.env` 感知当前 snail。

**方案**：在 `executeAgentInvocation` 的 context 对象中追加 `snail_key`（置于 `...issue.context` 之后，防止被覆盖），通过 `buildContextEnv` 自动注入为环境变量。Resume 路径在 adapter 的 `doInvokeResume` 中直接构造 `contextEnv` 注入 `snail_key`。

### 5. PR 签名规则：更新指引路径

**问题**：pr-signature.md 引用"系统提示词中'当前 Snail 名称'注入的值"，该路径已不存在。

**方案**：更新为 `<identity>` 块中 `## Snail` → `**名称**` 注入的值。

## 生效路径

| 变更点 | 说明 |
|--------|------|
| tenet prompt | `<identity>` 删除，行为准则归入 `<constraints>` |
| adapter | system prompt 不再注入 snail name 段 |
| collaboration | `buildIdentityBlock` 扩展为系统+Snail+角色三层结构 |
| context env | `snail_key` 注入为环境变量 |
| pr-signature.md | 签名指引更新为 `<identity>` → `## Snail` → `**名称**` |

## 设计约束摘要

- **唯一 `<identity>`**：只出现在 system-reminder 中，由 collaboration 统一组装
- **三层子结构**：系统归属（静态文字）→ Snail 元数据（从 findByKey 查询）→ 角色定义（从 SOP 读取）
- **snail 元数据来源**：`SnailPort.findByKey(snailKey)`，已有接口，无需新增
- **adapter 职责收窄**：只负责 system prompt（tenet prompts）和 agent 调用，不再注入 snail 身份
- **context key 命名**：沿用现有短名风格（`snail_key`），`CONTEXT_KEYS.SNAIL_KEY` 常量值与实际 env var 名一致

## 改动范围

| 文件 | 变更类型 | 说明 |
|---|--------|------|
| `data/file/prompts/T-01-行为准则.md` | 修改 | 删除 `<identity>` 包装，行为准则归入 `<constraints>` |
| `src/domain/snail/_internal/adapter.ts` | 修改 | 删除 system prompt 中的 snail name 注入段；resume 路径注入 `snail_key` 环境变量 |
| `src/app/issue-collaboration/collaboration.ts` | 修改 | context 追加 `snail_key`（置于 `...issue.context` 之后）；`buildIdentityBlock` 提取到独立模块 |
| `src/app/issue-collaboration/_internal/identity-block.ts` | 新增 | `buildIdentityBlock` 纯函数，多行模板，三层子结构 |
| `src/infra/acs/context-keys.ts` | 修改 | 移除已废弃的 `SNAIL_KEY`、`SNAIL_INSTANCE_ID` 常量（与现有 CONTEXT_KEYS 保持一致：仅 WORKSPACE_PATH 被引用） |
| `data/file/skills/cd-shared/references/pr-signature.md` | 修改 | 签名指引更新为 `<identity>` → `## Snail` → `**名称**` |

## 验证

```bash
# V1: tenet prompt 不再包含 <identity> 标签
grep "<identity>" data/file/prompts/T-01-行为准则.md
# 预期: 无输出

# V2: adapter 不再注入 snail name 段
grep "Snail 名称" src/domain/snail/_internal/adapter.ts
# 预期: 无输出

# V3: buildIdentityBlock 包含三层结构（已提取到 identity-block.ts）
grep -o "## 系统\|## Snail\|## 角色" src/app/issue-collaboration/_internal/identity-block.ts | wc -l
# 预期: 3

# V4: collaboration context 包含 snail_key
grep "snail_key" src/app/issue-collaboration/collaboration.ts
# 预期: 命中 context 构建行

# V5: pr-signature.md 引用新路径
grep "identity.*Snail.*名称" data/file/skills/cd-shared/references/pr-signature.md
# 预期: 命中

# V6: 类型检查
npx tsc --noEmit
# 预期: 无错误

# V7: ESLint
npx eslint .
# 预期: 无错误

# V8: resume 路径注入 snail_key 环境变量
grep "snail_key" src/domain/snail/_internal/adapter.ts
# 预期: 命中 doInvokeResume 中的 contextEnv 构建
```

## 关联

- **前置**: F20260627tntv（PR 签名 Snail 名称注入重建 — 本 feature 将其注入点从 adapter 迁移到 collaboration）
