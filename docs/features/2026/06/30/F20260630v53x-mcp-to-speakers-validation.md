---
id: F20260630v53x
title: mcp-to-speakers-validation
from_ids: [F20260630dy6x]
tags: [mcp, routing, validation, collaboration]
modules: [snail-mcp-server, collaboration]
doc_kind: spec
---

# F20260630v53x [mcp] set_final_body to_speakers 参数校验

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

F20260630dy6x 在 prompt 层修复了 `to_speakers` 路由目标错误——system prompt 中显式列出合法路由目标和格式要求，消除 agent 的猜测空间。

但 prompt 层是"建议性"的，agent 仍可能填入错误值。当前 `set_final_body` handler 对 `to_speakers` 参数零校验：任何字符串数组都被盲写入 `McpMessageStore`。非法值在下游 `resolveReplies` → `isValidReplyMention` 中被静默过滤，agent 无法感知路由失败。

**纵深防御缺口**：

| 层 | 现状 | 应有 |
|---|------|------|
| Prompt 层 | ✅ F20260630dy6x 已修复：暴露合法路由目标 | — |
| MCP handler 层 | ❌ 不校验 `to_speakers` 值，永远返回 `{ ok: true }` | 应校验并返回错误 |
| Agent 反馈 | ❌ agent 不知道路由失败，无法自我修正 | MCP 错误响应可触发重试 |

### 现有校验链路分析

`set_final_body` handler 已有的校验模式（`snail-final-response.ts`）：
- `text` 非空（line 34）
- `message_id` 正整数（line 38）
- `message_id` 归属 `stage_id`（line 40-47）

`set_context` handler 的校验模式（`snail-issue-context.ts`）：
- key 格式正则校验（line 47-49）
- 保留 key 检查（line 52-54）
- 校验失败时 `throw new Error(...)` → adapter 捕获返回 `{ isError: true, content: "Error: ..." }`（adapter.ts:85-89）

**已有 pattern：throw Error + 描述性消息。** agent 收到 MCP error 后可读取消息并自我修正。

### 下游校验逻辑

`isValidReplyMention`（`collaboration.ts:393-395`）：
```typescript
return mention === "user" || (mention !== roleInstance && stage.role_instances.includes(mention));
```

合法值集合：`"user"` + `stage.role_instances` 中排除当前发言者。

## 目标

在 MCP handler 层增加 `to_speakers` 参数校验，非法值时返回描述性错误，使 agent 获得即时反馈并可自我修正。

## 非目标

- 不修改 `isValidReplyMention` 的校验逻辑（后端校验保持不变，作为第二道防线）
- 不修改 `resolveReplies` 的消费流程（即使 MCP 层校验通过，下游仍正常过滤）
- 不修改 `McpMessageStore` 的存储机制
- 不修改 prompt 层（F20260630dy6x 已完成）

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | agent 调用 `set_final_body` 且 `to_speakers` 包含合法 role instance name（排除当前发言者自身） | handler 返回 `{ ok: true }`，targets 写入 McpMessageStore | ✅ |
| B2 | agent 调用 `set_final_body` 且 `to_speakers` 包含 `"user"` | handler 返回 `{ ok: true }`，targets 写入 McpMessageStore | ✅ |
| B3 | agent 调用 `set_final_body` 且 `to_speakers` 包含非法值（snail key、role key、英文翻译等） | handler throw Error，列出非法值和合法选项；targets 不写入 McpMessageStore | ✅ |
| B4 | agent 调用 `set_final_body` 且 `to_speakers` 全为合法值但混有非法值 | handler throw Error（任一非法即整体拒绝） | ✅ |
| B5 | agent 调用 `set_final_body` 且 `to_speakers` 为空数组或未提供 | 跳过校验，行为不变（视为"未指定"） | ✅ |

## 设计

### 依赖注入变更

`createFinalResponseServer` 增加 `stagePort: StagePort` 参数：

```
当前：createFinalResponseServer(messagePort, mcpMessageStore)
变更：createFinalResponseServer(messagePort, mcpMessageStore, stagePort)
```

`initor.ts` 注册时传入 `deps.stage`：

```
当前：adapter.registerServer(createFinalResponseServer(deps.message, deps.mcpMessageStore))
变更：adapter.registerServer(createFinalResponseServer(deps.message, deps.mcpMessageStore, deps.stage))
```

`deps.stage`（`StagePort`）已在 `SnailMCPServerDeps` 中定义（initor.ts:26），无需新增依赖声明。

### handler 校验逻辑

在现有 `to_speakers` 写入逻辑（line 59-64）之前，插入校验：

```
现有代码（line 58-64）：
  /** to_speakers 非空数组时写入 store；空数组视为"未指定"，不写入 */
  if (Array.isArray(params.to_speakers) && params.to_speakers.length > 0) {
    const targets = (params.to_speakers as unknown[]).filter((t): t is string => typeof t === "string");
    if (targets.length > 0) {
      mcpMessageStore.setMcpRoutingTargets(messageId, targets);
    }
  }

变更后：
  // 注意：归属校验阶段（line 42）已调用 messagePort.getMessage(messageId)，
  // 实现时应复用该结果提取 currentSpeaker，避免重复调用。
  if (Array.isArray(params.to_speakers) && params.to_speakers.length > 0) {
    const targets = (params.to_speakers as unknown[]).filter((t): t is string => typeof t === "string");
    if (targets.length > 0) {
      const stage = stagePort.findStage(stageId);
      if (stage) {
        const currentSpeaker = message?.from_speaker ?? null;  // 复用归属校验阶段的 message
        const validTargets = stage.role_instances.filter(i => i !== currentSpeaker);
        const invalid = targets.filter(t => t !== "user" && !validTargets.includes(t));
        if (invalid.length > 0) {
          throw new Error(
            `Invalid to_speakers: [${invalid.join(", ")}]. Valid targets: [${validTargets.join(", ")}] or "user".`
          );
        }
      }
      mcpMessageStore.setMcpRoutingTargets(messageId, targets);
    }
  }
```

**关键设计决策**：

1. **throw Error（不是静默过滤）** — 与 `set_context` 的校验模式一致。agent 收到 MCP error 后可读取错误消息并自我修正。如果只是静默过滤，agent 不知道自己填错了，无法改进。

2. **任一非法即整体拒绝** — 不做部分成功。如果 `to_speakers = ["架构师-2", "claude-code-stateful"]`，整体拒绝而非只保留合法值。原因：agent 的路由意图是完整的，部分保留可能导致遗漏关键路由目标。

3. **`stage` 查找失败时跳过校验** — `findStage` 返回 `undefined` 理论上不应发生（stage_id 已通过归属校验），但作为防御性编程，跳过校验而非阻断。此时下游 `isValidReplyMention` 仍会兜底过滤。

4. **校验逻辑复用 `isValidReplyMention` 的语义** — `"user"` 始终合法；其余必须在 `stage.role_instances` 中且不是当前发言者。

### 错误消息格式

```
Invalid to_speakers: [claude-code-stateful]. Valid targets: [架构师-2, 开发者] or "user".
```

包含：
- 非法值列表 — agent 知道哪些值填错了
- 合法值列表 — agent 知道应该用什么值（来自 `stage.role_instances` 排除自身）
- `"user"` 提示 — 始终可用的特殊目标

## 生效路径

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/domain/snail-mcp-server/_internal/servers/snail-final-response.ts` | 修改 | handler 增加 `to_speakers` 校验逻辑；函数签名增加 `stagePort` 参数 |
| `src/domain/snail-mcp-server/_internal/initor.ts` | 修改 | 注册时传入 `deps.stage` |
| `tests/snail-final-response.test.ts` | 修改 | 增加 `to_speakers` 校验测试用例 |

## 设计约束摘要

- **边界**：MCP handler 层做参数校验（快速失败 + 错误反馈），下游 `resolveReplies` 保持不变（兜底过滤）——常态下 MCP 层拦截非法值；`findStage` 返回 `undefined` 时（异常路径，stageId 已通过归属校验理论上不会发生）MCP 层跳过校验，下游兜底过滤
- **关键决策**：throw Error 而非静默过滤 — agent 需要即时反馈才能自我修正
- **关键决策**：任一非法即整体拒绝 — 保持 agent 路由意图的原子性
- **关键决策**：`stage` 查找失败时跳过校验而非阻断 — 防御性编程，下游兜底
- **语义不变量**：`isValidReplyMention` 的校验逻辑和合法值集合不变

### 实现指引

1. **复用 `message` 对象**：归属校验阶段（line 42）已调用 `messagePort.getMessage(messageId)`，`to_speakers` 校验应复用该结果提取 `currentSpeaker`，避免重复调用。
2. **`validTargets` 为空时的错误消息**：当 stage 只有当前发言者一个角色实例时，`validTargets` 为空数组，错误消息变为 `Valid targets: [] or "user".`。语义略怪但可接受——`"user"` 始终可用，agent 能理解。
3. **`message.from_speaker` 为 `null` 的情况**：系统消息（`from_speaker: null`）理论上不会调用 `set_final_body`，但若发生，`currentSpeaker` 为 `null`，`filter(i => i !== null)` 不影响 `role_instances`（都不等于 `null`），所有 role instance 均为合法目标。

<!-- [design-time] 章节结束 -->

## 改动范围

1. `src/domain/snail-mcp-server/_internal/servers/snail-final-response.ts` — 函数签名增加 `stagePort`，handler 增加 `to_speakers` 校验
2. `src/domain/snail-mcp-server/_internal/initor.ts` — 传入 `deps.stage`
3. `tests/snail-final-response.test.ts` — 增加校验测试用例

## 验证

### 测试覆盖映射

| 行为 | 测试场景 | 验证方式 |
|------|---------|----------|
| B1 | `to_speakers` 包含合法 role instance name（排除自身）→ `{ ok: true }` | 单元测试 |
| B2 | `to_speakers` 包含 `"user"` → `{ ok: true }` | 单元测试 |
| B3 | `to_speakers` 包含 snail key（如 `"claude-code-stateful"`）→ throw Error | 单元测试 |
| B4 | `to_speakers` 混合合法/非法值 → 整体 throw Error | 单元测试 |
| B5 | `to_speakers` 为空数组 → 跳过校验，`{ ok: true }` | 单元测试 |
| 补充 | `to_speakers` 包含当前发言者自身 → throw Error | 单元测试（自路由拒绝） |
| 补充 | `to_speakers` 未提供 → 跳过校验，`{ ok: true }` | 单元测试（现有行为不变） |

## 关联

- **前置**: F20260630dy6x（prompt 层修复，本 feature 在其基础上增加 MCP handler 层校验）
- **相关**: F20260630m8ia（set_final_body 信号通道）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|---------|---------|---------|---------|--------|------|
| D1 | 非法 to_speakers 处理方式：throw Error vs 静默过滤 | throw Error：agent 收到 MCP error 可自我修正，与 `set_context` 校验模式一致 | 静默过滤：不阻断 agent 执行，下游 `isValidReplyMention` 已兜底 | throw Error | 用户明确要求"MCP server 校验参数并返回错误消息给 agent"；`set_context` 已有 throw Error 的 pattern；静默过滤时 agent 无法感知路由失败 | 架构师-1 | 2026-06-30 |
| D2 | 部分成功 vs 整体拒绝 | 部分成功：保留合法值，最大化路由覆盖 | 整体拒绝：保持路由意图原子性，agent 重新提交时可重新决策 | 整体拒绝 | 路由目标是 agent 的完整意图声明；部分保留可能导致遗漏关键目标（如 agent 想同时路由给 A 和 B，B 非法时只保留 A 可能不符合 agent 意图） | 架构师-1 | 2026-06-30 |
| D3 | stage 查找失败处理：阻断 vs 跳过校验 | 防御性阻断：stage 不存在时不应继续 | 跳过校验：stage_id 已通过归属校验，findStage 失败是理论边缘 case | 跳过校验 | `findStage` 返回 `undefined` 理论上不应发生（stage_id 已在上方 line 40-47 通过归属校验）；跳过时下游 `isValidReplyMention` 仍兜底 | 架构师-1 | 2026-06-30 |
| D4 | 交叉审视 F1：设计约束措辞修正 | 原措辞"两层各司其职"暗示两层平等 | findStage 失败是异常路径降级，不是常态 | 修正措辞：明确 findStage 失败时 MCP 层跳过校验是异常路径降级，常态下 MCP 层拦截非法值 | 架构师-2 审视发现，架构师-1 接受 | 架构师-1 + 架构师-2 | 2026-06-30 |
