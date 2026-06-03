---
id: I2026052804
title: terminal-message-idempotency
from_ids: []
tags: []
modules: [message-bus, persistence]
doc_kind: spec
---

# I2026052804 [message-bus] finalizeMessageLifecycle 幂等保护

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

Agent 响应被 interrupt 后，message 从 `streaming` 转为 `interrupted`。如果此时服务进程退出（正常重启或崩溃），startup recovery 在下次启动时会尝试将仍在 `streaming` 状态的 message 标记为 `interrupted`。

问题在于：当 agent 在被 interrupt 前已经通过 `finalizeMessageLifecycle` 将 message 标记为 `interrupted`（即 message 已经是终态），而 startup recovery 又尝试对同一条 message 执行 `completeMessageWithEvent` 时，存储层的 `status !== "streaming"` 检查会抛出异常。

更严重的是，当用户在 interrupt 后发送新消息时，`sendStructuredMessage` → `drainMessageBus` → `invokeRoleBatch` 的调用链中，`finalizeMessageLifecycle` 在 catch block 中被调用，如果此时抛出 "Cannot complete terminal message" 异常，会 mask 原始 agent 错误并通过 `MessageBusDrainError` 向上传播，最终阻塞整个消息发送流程。用户看到的是消息一直显示虚线框，无法得到 agent 响应。

日志实证（conversation `6af3b811`，feature "授权交互2"）：
- 05:39:44 UTC — agent interrupt，message 508 标记为 interrupted
- 05:40~05:41 — 服务器反复崩溃重启（EADDRINUSE）
- 06:39:01 — 用户发新消息，触发 "Cannot complete terminal message 508" 错误
- 错误阻塞 send 流程约 1 小时

## 目标

让 `finalizeMessageLifecycle` 具备幂等性：当目标 message 已处于终态时，跳过重复写入，不抛异常，不阻塞 send 流程。

## 非目标

- 不改变 `completeMessageWithEvent` 的存储层严格不变量（仍要求 `streaming` 状态才能写入终态事件）
- 不改变 startup recovery 的恢复逻辑
- 不改变 agent interrupt 的处理流程

## 设计

### 问题根因

`finalizeMessageLifecycle` 依赖 `StreamingContext.messageEnded` 做内存级去重，但无法感知外部路径（如 startup recovery、`updateMessageStatus`）对 message status 的变更。当 DB 中 message 已是终态但 `messageEnded` 仍为 false 时，`completeMessageWithEvent` 抛出异常。

### 修复方案

在 `finalizeMessageLifecycle` 中，调用 `completeMessageWithEvent` 之前，先通过 `getMessage` 读取 message 当前 DB 状态。如果已是终态，跳过事件写入，仅 emit `message_status_changed` 事件保持 UI 一致性。

选择在 `finalizeMessageLifecycle` 层修复而非放松 `completeMessageWithEvent` 的原因：
1. `completeMessageWithEvent` 的 status 检查是正确的存储层不变量，防止意外的双重写入
2. 幂等性是调用方（`finalizeMessageLifecycle`）的责任，不是存储层的责任
3. startup recovery 的恢复逻辑本身正确，不需要修改

### 调用链分析

`completeMessageWithEvent` 的 4 个调用点：
1. `collaboration.ts:126` — 完成 user message（刚创建，必为 streaming）
2. `collaboration.ts:386` — 完成 system notice（刚创建，必为 streaming）
3. `message-protocol.ts:114` — **本次修复点** — `finalizeMessageLifecycle` 中完成 assistant message
4. `startup-recovery.ts:57` — 启动恢复（已有 idempotent 保护）

只有调用点 3 存在竞态风险，且其异常会向上传播阻塞 send 流程。

## 生效路径

本 feature 的幂等保护通过以下代码路径生效：

- **`src/message-bus/message-protocol.ts`** — `finalizeMessageLifecycle` 在调用 `completeMessageWithEvent` 前检查 DB 中 message 是否已处于终态，若已终态则跳过写入并 emit `message_status_changed` 事件
- **`tests/project/collaboration-test.ts`** — 两个新增测试用例覆盖：已终态 message 不抛异常返回 null、正常 streaming message 行为不变

存储层 `completeMessageWithEvent` 的严格不变量（要求 `streaming` 状态）和 startup recovery 逻辑均保持不变。

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 改动 |
|---|---|
| `src/message-bus/message-protocol.ts` | `finalizeMessageLifecycle` 增加 DB 状态检查 |
| `tests/project/collaboration-test.ts` | 新增幂等性测试用例 |

## 验证

- [x] `npm test` 现有测试全部通过（42 个测试文件全部 pass）
- [x] 新增测试：streaming message 被外部标记为 interrupted 后，`finalizeMessageLifecycle` 不 throw，返回 null
- [x] 新增测试：正常 streaming message 的 `finalizeMessageLifecycle` 行为不变
- [ ] 手动验证：在有 interrupted message 的 conversation 中发送新消息，确认不再出现 "Cannot complete terminal message" 错误

## 关联

- **相关**: 授权交互2 conversation `6af3b811` 的实际故障案例

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | 修复层级选择：store 层 vs protocol 层 | 选择 protocol 层（`finalizeMessageLifecycle`），保持 store 层严格不变量 | 2026-05-28 |
