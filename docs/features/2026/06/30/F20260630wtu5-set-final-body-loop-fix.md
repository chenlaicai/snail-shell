---
id: F20260630wtu5
title: set_final_body 重复调用死循环修复
from_ids: [F2026060102, F20260629jfv5, F20260630m8ia]
tags: [mcp, agent-behavior, loop, prompt, dedup]
modules: [snail-mcp-server, collaboration, prompt]
doc_kind: spec
---

# F20260630wtu5 [mcp] set_final_body 重复调用死循环修复

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

Agent 在单次调用中反复交替调用 `set_final_body` 和 `list_messages`，形成伪死循环。同一 message 被 `set_final_body` 写入多次，浪费 token 和延迟。

**已观测到的调用模式**：

```
set_final_body · 1933       → { ok: true }
list_messages · d610df8a    → { messages: [...] }
set_final_body · 1933       → { ok: true }   ← 重复
list_messages · d610df8a    → { messages: [...] } ← 重复
set_final_body · 1933       → { ok: true }   ← 重复
...（循环 4+ 次）
```

### 历史背景

`set_final_body` 经历了 8 个 feature 的迭代修复（F2026052605 → F20260630m8ia），覆盖了工具可用性、环境变量注入、路由目标、信号通道等问题。其中 F2026060102 将注入指令从建议性（"when you are ready"）提升为 `[HARD]` 级（"必须调用"），解决了 agent 忽略调用的问题，但引入了新的副作用：**过强的"必须"指令导致 LLM 产生强迫性重试行为**。

### 根因分析

**根因 1：工具描述缺少终止语义**

`set_final_body` 的工具描述（`snail-final-response.ts:18-21`）和 system prompt 注入（`collaboration.ts:572-574`）都只说了"必须调用"，但没有说"调完之后本轮结束"。LLM 收到 `{ ok: true }` 后，将其视为普通工具结果，继续执行后续推理，可能自发调用 `list_messages` 来"理解上下文"，然后觉得需要再次回应，再次调用 `set_final_body`。

**根因 2：`{ ok: true }` 返回值过于中性**

当前 handler 返回 `{ ok: true }`，这是一个通用的成功响应，不携带任何终止信号。LLM 无法从中推断"我的任务已完成"。

**根因 3：handler 无幂等保护**

`set_final_body` 的 handler 每次调用都无条件执行 `messagePort.setContext(messageId, "mcp_final_body", text)`，即使同一 message 已经写入过 final body。这使得重复调用在语义上"合法"——没有错误、没有警告，LLM 认为这是正常行为。

**根因 4：`list_messages` 作为"理解上下文"的默认动作**

`list_messages` 是纯只读工具，没有指令告诉 LLM 何时应该或不应该调用它。当 LLM 不确定当前状态时，调用 `list_messages` 是一种常见的"确认上下文"行为。这本身不是问题，但在缺少终止语义的情况下，它成为循环的一环。

**关键排除**：此问题发生在 **单次 agent invocation 内部**（Claude Code 子进程内），不涉及 collaboration dispatch 循环。dispatch 循环的 `maxCollaborationRounds`（30 轮）只控制跨 invocation 的 agent 重调度，无法保护单 invocation 内的工具调用循环。

### 影响链路

```
set_final_body handler (无幂等保护)
  ↓ 无条件覆写 mcp_final_body
返回 { ok: true } (无终止信号)
  ↓ LLM 当作普通工具结果
LLM 自发调用 list_messages ("理解上下文")
  ↓ 返回消息列表
LLM 觉得需要回应 → 再次调用 set_final_body
  ↓ 回到第一步
```

## 目标

消除 `set_final_body` 在单次 agent invocation 内的重复调用循环。

### P1 — 终止语义注入

- 工具描述明确告知 LLM：调用 `set_final_body` 后本轮发言结束，不得再调用其他工具
- system prompt 注入补充终止约束

### P2 — 幂等防护

- handler 对同一 message 的重复调用返回区分性响应，不覆写已有的 final body
- 区分性响应携带终止提示，引导 LLM 停止

## 非目标

- 不修改 collaboration dispatch 循环逻辑（跨 invocation 的重调度机制不受影响）
- 不修改 `list_messages` 工具（它是纯只读，问题不在它）
- 不修改 `set_final_body` 的首次调用语义（text 存储、stage_transition 提取、to_speakers 写入不变）
- 不修改 agent adapter 的进程管理（不增加工具调用计数或强制终止）
- 不增加硬终止机制——当前方案是"尽力引导"（prompt 语义 + 幂等防护 + 返回值提示），而非"强制终止"。如果三层防御均被 LLM 忽略，系统依赖 Claude Code 自身的 token 上限和超时机制兜底
- 不改变 F2026060102 的 `[HARD]` 指令级别（"必须调用"的约束仍然需要，只是补充终止语义）

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当 agent 首次调用 `set_final_body` 时 | handler 应存储 final body、提取 stage_transition、写入 to_speakers，并返回 `{ ok: true, proceed: "end_turn" }` | `snail-final-response.test.ts` — "writes mcp_final_body" + signal extraction tests |
| B2 | 当 agent 对同一 message 重复调用 `set_final_body` 时（即使传入不同 text） | handler 应返回幂等响应（不覆写已有 final body，不追加 signal event，不覆写 routing targets），并携带终止提示 | `snail-final-response.test.ts` — "idempotent guard" describe block (4 tests) |
| B3 | 当 agent 收到 `set_final_body` 的工具描述时 | 描述应包含"调用后本轮发言结束"的终止语义 | `snail-final-response.test.ts` — "contains termination semantics in description" |
| B4 | 当 agent 收到 system prompt 时 | 最终答复规则应包含"调用后不得再调用任何工具"的终止约束 | 代码审查：`collaboration.ts:572` |
| B5 | 当 agent 首次调用 `set_final_body` 后 | `{ ok: true }` 响应应携带终止提示（如 `"proceed": "end_turn"`），引导 LLM 停止 | `snail-final-response.test.ts` — 首次调用返回值断言 `toEqual({ ok: true, proceed: "end_turn" })` |

## 设计

### P1 详设：终止语义注入

#### 1. 工具描述补充终止语义

`snail-final-response.ts` 的 `set_final_body` 工具描述从：

```
"提交本次发言的最终答复正文。每次发言结束前必须调用此工具，" +
"传入你希望展示给用户的完整 Markdown 内容。" +
"调用后，此正文将作为消息的主要展示内容，流式过程中的中间分析会被折叠。"
```

变更为：

```
"提交本次发言的最终答复正文。每次发言结束前必须调用此工具，" +
"传入你希望展示给用户的完整 Markdown 内容。" +
"调用后，此正文将作为消息的主要展示内容，流式过程中的中间分析会被折叠。" +
"重要：调用此工具后，你的发言即告结束。不得再调用任何其他工具。"
```

#### 2. system prompt 注入补充终止约束

`collaboration.ts` 的 `buildContextBlock` 中，`## 最终答复规则` 部分从：

```
**必须使用 `set_final_body` MCP 设置最终答复**。每次发言结束前必须调用此工具，传入你希望展示给用户的完整 Markdown 内容。
```

变更为：

```
**必须使用 `set_final_body` MCP 设置最终答复**。每次发言结束前必须调用此工具，传入你希望展示给用户的完整 Markdown 内容。调用后本轮发言结束，不得再调用任何其他工具。
```

### P2 详设：幂等防护

#### 1. handler 增加首次调用追踪

在 `createFinalResponseServer` 的闭包中维护一个 `Set<number>` 记录已提交 final body 的 message ID。

首次调用流程不变：
1. 校验参数
2. `messagePort.setContext(messageId, "mcp_final_body", text)`
3. 提取 stage_transition
4. 写入 to_speakers
5. 记录 messageId 到 Set
6. 返回 `{ ok: true, proceed: "end_turn" }`

重复调用流程（检测到 messageId 已在 Set 中）：
1. 校验参数（保留参数校验，防止静默吞掉错误）
2. 跳过所有写入操作：`messagePort.setContext`（不覆写 final body）、`extractStageTransition` → `appendEvent`（不追加 signal event）、`mcpMessageStore.setMcpRoutingTargets`（不覆写 routing targets）
3. 返回 `{ ok: true, already_submitted: true, hint: "final body already recorded for this message; your response is complete" }`

#### 2. 返回值增加终止提示

首次调用的返回值从 `{ ok: true }` 变为 `{ ok: true, proceed: "end_turn" }`。`proceed: "end_turn"` 是一个语义化提示，LLM 可以从中推断"应该结束本轮"。

重复调用的返回值 `{ already_submitted: true, hint: "..." }` 明确告知 LLM final body 已经提交过，不需要再做任何事。

#### 3. Set 生命周期

`Set<number>` 的生命周期与 MCP server 实例一致（即进程级）。每个 message 的 ID 是全局递增的，不会重复，因此 Set 只增不减不会造成内存问题。当前不需要清理机制——Set 的增长速率等于 message 数量，远低于内存压力阈值。

## 生效路径

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/domain/snail-mcp-server/_internal/servers/snail-final-response.ts` | 修改 | 工具描述补充终止语义；handler 增加幂等保护（Set 追踪 + 区分性返回值） |
| `src/app/issue-collaboration/collaboration.ts` | 修改 | `buildContextBlock` 最终答复规则补充终止约束 |

## 设计约束摘要

- **边界**：只改 prompt 层（工具描述 + system prompt）和 handler 层（幂等保护），不改 agent adapter 和 dispatch 循环
- **关键决策**：使用 Set 追踪已提交的 messageId（而非在 message 上加标记）——Set 是 handler 闭包内的纯内存结构，不依赖 messagePort 的新 API，最小改动
- **关键决策**：幂等响应不抛错——LLM 对错误的处理不可预测（可能重试更猛烈），用区分性成功响应更安全
- **关键决策**：首次调用返回值增加 `proceed: "end_turn"` 而非只在重复调用时返回区别——首次调用时就引导 LLM 停止，从源头减少重复调用的概率
- **语义不变量**：首次调用的 text 存储、stage_transition 提取、to_speakers 写入逻辑完全不变
- **风险定位**：本方案是"尽力引导"而非"强制终止"。三层防御（工具描述 + system prompt + 返回值提示 + 幂等防护）在大多数情况下有效，极端情况下依赖 Claude Code 自身的 token 上限和超时机制兜底

<!-- [design-time] 章节结束 -->

## 改动范围

1. `src/domain/snail-mcp-server/_internal/servers/snail-final-response.ts` — 工具描述 + handler 幂等保护
2. `src/app/issue-collaboration/collaboration.ts` — `buildContextBlock` 终止约束
3. 相关测试文件（snail-final-response 相关测试）

## 验证

- [x] agent 收到的工具描述包含终止语义
  - 验证方式：代码审查确认工具描述字符串 — `snail-final-response.ts:21` 包含"调用此工具后，你的发言即告结束。不得再调用任何其他工具。"
- [x] agent 收到的 system prompt 包含终止约束
  - 验证方式：代码审查确认 `buildContextBlock` 输出 — `collaboration.ts:572` 包含"调用后本轮发言结束，不得再调用任何其他工具。"
- [x] 首次调用返回 `{ ok: true, proceed: "end_turn" }`
  - 验证命令：`npx vitest run tests/snail-final-response.test.ts` — 18 tests passed
- [x] 重复调用返回 `{ ok: true, already_submitted: true, hint: "..." }` 且不覆写 final body、不追加 signal event、不覆写 routing targets（即使传入不同 text）
  - 验证命令：`npx vitest run tests/snail-final-response.test.ts` — 18 tests passed
- [x] `npm run check` 通过
  - 验证命令：`npm run check` — lint + tsc + vite build 全部通过

## 关联

- **前置**: F2026060102（将注入指令提升为 [HARD] 级，本 feature 补充其缺失的终止语义）
- **前置**: F20260629jfv5（set_final_body to_speakers 路由和环境变量修复，本 feature 复用其 message store 机制）
- **前置**: F20260630m8ia（set_final_body 信号通道，本 feature 不改变信号提取逻辑）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|---------|---------|---------|---------|--------|------|
| D1 | 幂等防护实现方式：Set 追踪 vs message 标记 | Set：纯内存，不依赖 messagePort 新 API | message 标记：持久化，跨进程可见 | Set 追踪 | 单 invocation 内的重复调用问题，不需要跨进程持久化；Set 在 handler 闭包内，生命周期与 MCP server 一致，足够覆盖问题场景 | 架构师-1 | 2026-06-30 |
| D2 | 重复调用响应方式：抛错 vs 区分性成功响应 | 抛错：明确告知"不应该这样做" | 区分性成功响应：LLM 对错误的处理不可预测，可能重试更猛烈 | 区分性成功响应 | LLM 对 `{ ok: true, already_submitted: true }` 的处理比对 `Error` 更可控——它会看到"已经完成"的语义，而非"出错了"的恐慌 | 架构师-1 | 2026-06-30 |
| D3 | 终止语义注入位置：仅工具描述 vs 仅 system prompt vs 两者都改 | 仅工具描述：LLM 在工具选择时就能看到 | 仅 system prompt：全局约束更可靠 | 两者都改 | 工具描述在 LLM 决定是否调用工具时生效（第一道防线）；system prompt 在 LLM 整体推理时生效（第二道防线）。双层覆盖更可靠 | 架构师-1 | 2026-06-30 |
| D4 | 终止保障级别：尽力引导 vs 强制终止 | 尽力引导：成本低，prompt + 幂等 + 返回值三层防御覆盖绝大多数场景 | 强制终止：100% 保障，但需改 agent adapter（工具调用计数 / handler 触发进程停止），侵入性大 | 尽力引导 | 当前问题的触发概率和影响范围（浪费 token 和延迟，非数据错误）不值得引入 agent adapter 层的侵入性改动；Claude Code 自身的 token 上限和超时机制作为最终兜底 | 架构师-1 + 架构师-2 交叉审视 | 2026-06-30 |
