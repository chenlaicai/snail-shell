---
id: F20260630dy6x
title: fix-to-speakers-routing
from_ids: [F20260630m8ia]
tags: [collaboration, routing, prompt, identity]
modules: [collaboration, snail, prompt]
doc_kind: spec
---

# F20260630dy6x [collaboration] 修复 to_speakers 路由目标错误

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

Agent 调用 `set_final_body` 时，`to_speakers` 参数频繁填入错误值，导致协作链断裂。

**已观测到的错误模式**：

| 错误取值 | 来源 | 实例 |
|---------|------|------|
| snail key/名称 | identity 块的 `Key`/`名称` 字段 | `"claude-code-stateful"` |
| role name 英文翻译 | identity 块"你是架构师"→ agent 自行翻译 | `"architect-1"` |
| role key | SOP 中 `role.key` 字段 | `"designer"` |

合法值应为 role instance name（如 `"架构师-2"`）或 `"user"`。

**影响链**：错误的 `to_speakers` 写入 `McpMessageStore` → `resolveReplies` 中 `isValidReplyMention` 校验失败 → `mcpTargets` 被过滤为空 → 回退到 priority 2（@mentions）也为空 → `updateMessageTargets(messageId, [])` → `route()` 直接 return → 协作链断裂，后续 agent 或 user 不会被触发。

### 根因分析

**根因 1：system prompt 中两层身份混淆**

`identity-block.ts` 生成的 `<identity>` 块中，Snail 身份（`Key`、`名称`）排在前面且带醒目标签，角色身份（`角色实例`）排在后面。Agent 看到 context 中"声明目标角色"时，容易将 Snail 的 `Key`/`名称` 当作"角色标识"使用。

**根因 2：context 块未定义 `to_speakers` 的合法格式**

`buildContextBlock` 生成的最终答复规则只说"在 `set_final_body` 的 `to_speakers` 参数中声明目标角色"，但没有说明格式是什么、有哪些可选值。

**根因 3：合法路由目标从未暴露给 agent**

`isValidReplyMention` 定义了合法值（`"user"` + 当前 stage 中除自己外的所有 role instance），但这些值从未出现在 agent 的 system prompt 中。`stage.role_instances` 是后端数据结构，`expandRoleInstances` 使用 `role.name`（中文）+ 序号拼接，结果从未注入 system prompt。

**根因 4：环境变量 key 三层不一致**

两条注入路径均无法产出工具描述要求的 key：

| 路径 | 实际注入的 env key | 工具描述指引的 key |
|------|-------------------|-------------------|
| first-call | `SNAIL_CTX_stage_id`（小写） | `SNAIL_CTX_STAGE_ID`（大写） |
| resume | `stage_id`（无前缀） | `SNAIL_CTX_STAGE_ID`（大写） |

first-call 路径：`collaboration.ts:314` 的 context 对象使用小写 snake_case key（`stage_id`、`message_id`），经过 `buildContextEnv` 加 `SNAIL_CTX_` 前缀后变成 `SNAIL_CTX_stage_id`。但 `CONTEXT_KEYS` 定义的是大写 `SNAIL_CTX_STAGE_ID`，工具描述也指引 agent 读大写版本。

resume 路径：`adapter.ts:185-187` 直接使用无前缀的 `message_id` / `stage_id`。

**结果：无论 first-call 还是 resume，agent 都读不到正确的 `message_id`。**

### 设计演进

本 issue 的根因跨越 prompt 层（identity block、context block）和 adapter 层（环境变量注入），修复方案必须覆盖完整链路，不得仅修其中一层。

## 目标

消除 agent 在填写 `to_speakers` 时的猜测空间，使路由目标填写正确率从"碰运气"变为"确定性正确"。

### P1 — prompt 层修复：暴露合法路由目标

- 在 `buildContextBlock` 生成的 context 块中，显式列出当前 stage 的可用路由目标（`stage.role_instances` + `"user"`）
- 明确定义 `to_speakers` 的合法格式：必须是上述列表中的精确名称，不是 snail key，不是英文翻译

### P2 — 环境变量 key 全链路对齐

- `collaboration.ts` 的 first-call context 对象使用 `CONTEXT_KEYS` 常量作为 key（大写），使 `buildContextEnv` 产出 `SNAIL_CTX_MESSAGE_ID`、`SNAIL_CTX_STAGE_ID`
- `adapter.ts` 的 `doInvokeResume` 同样使用 `CONTEXT_KEYS` 常量，消除无前缀 key

## 非目标

- 不修改 `isValidReplyMention` 的校验逻辑（后端校验是正确的）
- 不修改 `McpMessageStore` 的存储和消费机制
- 不修改 `identity-block.ts` 的结构（Snail 身份和角色身份的分层是正确的设计，问题在于 context 块缺少补充信息）
- 不改变 agent 的输出行为（agent 继续调用 `set_final_body`，只是参数值更准确）

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当 agent 调用 `set_final_body` 且 `to_speakers` 包含当前 stage 的合法 role instance name 时 | 系统应将消息路由到对应 role instance | |
| B2 | 当 agent 调用 `set_final_body` 且 `to_speakers` 包含 `"user"` 时 | 系统应将消息路由到用户 | |
| B3 | 当 agent 调用 `set_final_body` 且 `to_speakers` 包含 snail key（如 `"claude-code-stateful"`）时 | `isValidReplyMention` 应过滤掉该值（已有行为，不变） | |
| B4 | 当 agent 在 first-call 或 resume 路径下调用 `set_final_body` 时 | `SNAIL_CTX_MESSAGE_ID` 和 `SNAIL_CTX_STAGE_ID` 环境变量应正确注入（大写 key），`set_final_body` 能读到正确的 message_id | |
| B5 | 当 agent 收到 system prompt 时 | context 块应包含当前 stage 的可用路由目标列表和格式说明 | |

## 设计

### P1 详设：prompt 层修复

#### 1. `buildContextBlock` 增加路由目标信息

在 `collaboration.ts` 的 `buildContextBlock` 方法中，`## 最终答复规则` 部分增加可用路由目标列表。

当前输出：
```
## 最终答复规则
**路由目标声明**：如果需要其他角色继续处理，必须在 `set_final_body` 的 `to_speakers` 参数中声明目标角色。
```

变更后输出：
```
## 最终答复规则
**路由目标声明**：如果需要其他角色继续处理，必须在 `set_final_body` 的 `to_speakers` 参数中声明目标角色。
**可用路由目标**：`user`、`架构师-2`（当前 stage 中除自己外的所有参与者）
**格式要求**：必须使用上述精确名称。不要使用 snail key（如 claude-code-stateful）、role key（如 designer）或英文翻译（如 architect-1）。
```

路由目标列表的数据来源：`stage.role_instances.filter(i => i !== roleInstance)` 加上 `"user"`。

#### 2. 路由目标列表的生成逻辑

在 `buildContextBlock` 中接收 `roleInstance` 参数（当前已有），从 `stage.role_instances` 中排除自己，拼接 `"user"`，生成逗号分隔的列表。

### P2 详设：环境变量 key 全链路对齐

问题本质：context 对象的 key 是小写 snake_case（`stage_id`、`message_id`），经过 `buildContextEnv` 加 `SNAIL_CTX_` 前缀后变成 `SNAIL_CTX_stage_id`（小写），但 `CONTEXT_KEYS` 和工具描述都使用大写 `SNAIL_CTX_STAGE_ID`。修复点在 context 对象的 key 定义处，而非 `buildContextEnv`（加前缀逻辑本身正确）。

#### 1. `collaboration.ts` first-call context 对象 key 对齐

将 `executeAgentInvocation` 中的 context 对象 key 从硬编码小写改为使用 `CONTEXT_KEYS` 常量：

```typescript
// 当前（小写 key → buildContextEnv 产出 SNAIL_CTX_stage_id）
context: { issue_id: issue.id, stage_id: stage.id, message_id: String(agentMessage.id), ... }

// 变更后（使用 CONTEXT_KEYS 常量 → buildContextEnv 产出 SNAIL_CTX_STAGE_ID）
import { CONTEXT_KEYS } from "@infra/acs/context-keys";
context: {
  [CONTEXT_KEYS.ISSUE_ID]: issue.id,
  [CONTEXT_KEYS.STAGE_ID]: stage.id,
  [CONTEXT_KEYS.MESSAGE_ID]: String(agentMessage.id),
  stage_key: stage.key,
  role_instance: roleInstance,
  ...issue.context,
  snail_key: assignment.snail_key,
}
```

注意：`stage_key`、`role_instance`、`snail_key` 不在 `CONTEXT_KEYS` 中（它们不是工具描述要求的参数），保持小写即可。`buildContextEnv` 对已有 `SNAIL_CTX_` 前缀的 key 不重复添加，所以 `CONTEXT_KEYS` 常量（已带前缀）能正确通过。

#### 2. `adapter.ts` resume 路径 key 对齐

`doInvokeResume` 方法中，将：
```typescript
if (request.messageId != null) contextEnv.message_id = request.messageId;
if (request.stageId != null) contextEnv.stage_id = request.stageId;
```

变更为使用 `CONTEXT_KEYS` 常量：
```typescript
if (request.messageId != null) contextEnv[CONTEXT_KEYS.MESSAGE_ID] = request.messageId;
if (request.stageId != null) contextEnv[CONTEXT_KEYS.STAGE_ID] = request.stageId;
```

## 生效路径

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/app/issue-collaboration/collaboration.ts` | 修改 | `buildContextBlock` 增加路由目标列表和格式说明；`executeAgentInvocation` context 对象 key 改用 `CONTEXT_KEYS` 常量 |
| `src/domain/snail/_internal/adapter.ts` | 修改 | `doInvokeResume` 环境变量 key 改用 `CONTEXT_KEYS` 常量 |

## 设计约束摘要

- **边界**：prompt 层提供信息，后端校验不变——职责分离保持
- **关键决策**：在 context 块中显式列出路由目标（而非修改 identity 块结构）——最小改动，不影响 identity 的分层设计
- **关键决策**：修复 context 对象的 key 定义（而非修改 `buildContextEnv` 加前缀逻辑）——加前缀逻辑本身正确，问题在于输入 key 大小写不匹配
- **语义不变量**：`isValidReplyMention` 的校验逻辑不变，合法值集合不变，只是 prompt 层现在也展示了同样的信息

<!-- [design-time] 章节结束 -->

## 改动范围

1. `src/app/issue-collaboration/collaboration.ts` — `buildContextBlock` 方法（增加路由目标列表）+ `executeAgentInvocation` 方法（context 对象 key 改用 `CONTEXT_KEYS`）
2. `src/domain/snail/_internal/adapter.ts` — `doInvokeResume` 方法（env key 改用 `CONTEXT_KEYS`）
3. 相关测试文件（如有对应的 prompt 输出测试或环境变量注入测试）

## 验证

- [x] agent 收到的 system prompt 中包含当前 stage 的可用路由目标列表
  - 验证命令：`npx vitest run tests/routing-targets.test.ts`
  - 测试用例：`should include available routing targets excluding self in system prompt`
  - 结果：system prompt 包含 `**可用路由目标**` 和正确的 role instance 列表（排除自身）
- [x] agent 调用 `set_final_body` 时 `to_speakers` 使用合法 role instance name
  - 验证方式：代码审查确认 `buildContextBlock` 输出包含格式说明和精确名称列表
  - 结果：system prompt 包含 `**格式要求**` 和 `不要使用 snail key（如 claude-code-stateful）`
- [x] first-call 路径下 `SNAIL_CTX_MESSAGE_ID` 和 `SNAIL_CTX_STAGE_ID` 环境变量正确注入（大写 key）
  - 验证命令：`npx vitest run tests/routing-targets.test.ts`
  - 测试用例：`should use CONTEXT_KEYS constants in first-call context`
  - 结果：context 对象使用 `CONTEXT_KEYS.ISSUE_ID`、`CONTEXT_KEYS.STAGE_ID`、`CONTEXT_KEYS.MESSAGE_ID` 作为 key
- [x] resume 路径下 `SNAIL_CTX_MESSAGE_ID` 和 `SNAIL_CTX_STAGE_ID` 环境变量正确注入（大写 key）
  - 验证命令：`npx vitest run tests/routing-targets.test.ts`
  - 测试用例：`should use CONTEXT_KEYS constants in resume context`
  - 结果：`adapter.ts:185-187` 使用 `CONTEXT_KEYS.MESSAGE_ID` 和 `CONTEXT_KEYS.STAGE_ID`
- [x] `npm run check` 通过
  - 验证命令：`npm run check`
  - 结果：✓ built in 801ms（编译通过）
- [x] 相关测试通过
  - 验证命令：`npx vitest run tests/routing-targets.test.ts tests/snail-final-response.test.ts tests/signal-chain.test.ts`
  - 结果：3 passed, 20 tests

## 关联

- **相关**: F20260630m8ia（set_final_body 信号通道，本 feature 修复同一工具的路由参数问题）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|---------|---------|---------|---------|--------|------|
| D1 | 修复位置：修改 identity 块 vs 在 context 块补充 | 修改 identity 块：从源头消除混淆 | context 块补充：最小改动，不影响 identity 分层设计 | context 块补充 | identity 块的 Snail/角色分层是正确设计；问题在于 context 块没有补充路由格式信息，补上即可 | 架构师-1 | 2026-06-30 |
| D2 | 环境变量 key 修复位置：修改 context 对象 key vs 修改 `buildContextEnv` | 修改 context 对象 key：源头修正，key 定义与 `CONTEXT_KEYS` 一致 | 修改 `buildContextEnv`：自动处理大小写转换 | 修改 context 对象 key | `buildContextEnv` 的加前缀逻辑本身正确（已有 `SNAIL_CTX_` 前缀的 key 不重复添加），问题在于 context 对象使用小写 key（`stage_id`）导致产出 `SNAIL_CTX_stage_id`，与 `CONTEXT_KEYS` 定义的 `SNAIL_CTX_STAGE_ID` 不匹配。在 context 对象处使用 `CONTEXT_KEYS` 常量是最小改动 | 架构师-1 + 架构师-2 交叉审视 | 2026-06-30 |
| D3 | P2 范围：仅修 resume 路径 vs 两条路径都修 | 两条路径都修：first-call 路径同样有大小写问题 | 仅修 resume：first-call 路径是主路径，优先保证 | 两条路径都修 | 交叉审视发现 first-call 路径的 context 对象 key 是小写（`stage_id`），经 `buildContextEnv` 后产出 `SNAIL_CTX_stage_id`（小写），与工具描述的 `SNAIL_CTX_STAGE_ID`（大写）不匹配。两条路径都无法正确注入，必须同时修复 | 架构师-2 审视发现，架构师-1 接受 | 2026-06-30 |
