---
id: F20260626bth6
title: 消息中断/失败原因可观测性
from_ids: []
tags: [observability, ux, collaboration]
modules: [collaboration, startup-recovery]
---

# F20260626bth6 — 消息中断/失败原因可观测性

## 背景

用户看到 `"用户中断了本次回复"` 但并未点击 Stop，无法判断原因。排查后发现有三种场景会触发此文案：

1. **服务重启**：`startup-recovery.ts` 回收遗留的 streaming 消息
2. **孤儿消息**：agent 进程已退出但消息未收敛（无 AbortController）
3. **用户主动中断**：点击 Stop 按钮

三种场景共享同一个硬编码兜底文案，且结构化的 `reason`/`error` 只存入了 DB 的 signal event payload，从未流入 `MessageContext` → WebSocket → UI 链路。

## 根因分析

`extractTerminalContext` 接收 `status` 但不接收 `reason`，兜底文案为固定字符串。

信息流断裂点：

| 阶段 | 原因信息 | 可见性 |
|---|---|---|
| `completeMessage` 调用处 | `signalPayload`（如 `{ reason: "service_restart" }`） | 存入 DB |
| `MessageContext` | 硬编码兜底文案 | 丢失结构化原因 |
| WebSocket `message_status_changed` | 只传 `context` | 原因不在 payload 中 |
| 前端 UI | 显示 `context.context` 文本 | 看不到原因 |

## 方案

给 `extractTerminalContext` 新增可选 `reason` 参数，将实际原因编码进兜底文案的括号中：

- `"用户中断了本次回复"` → `"用户中断了本次回复（进程已退出）"`
- `"用户中断了本次回复"` → `"用户中断了本次回复（服务重启）"`
- `"任务执行失败"` → `"任务执行失败（Connection timeout）"`

零协议改动，原因通过现有 `MessageContext.context` 字符串贯穿全链路。

## 改动点

### `collaboration.ts`

1. `extractTerminalContext` 签名新增 `reason?: string`
2. 兜底文案：有 reason 时拼接 `（${reason}）`，无 reason 时保持原样
3. `interruptMessage` 孤儿兜底路径：传 `"进程已退出"`
4. `invokeAgent` catch block：传 `error.message` 作为 reason，复用 `errorReason` 变量

### `startup-recovery.ts`

1. 服务重启兜底文案：改为 `"用户中断了本次回复（服务重启）"`

## 验证

- TypeScript 编译通过（`tsc --noEmit`）
- 三种场景的文案差异可区分：进程退出、服务重启、用户中断
