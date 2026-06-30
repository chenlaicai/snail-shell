---
id: F20260630e2gz
title: mcp-env-key-naming-fix
tags: [bugfix, mcp, snail-adapter]
change_type: bugfix
created: 2026-06-30
status: implemented
related: [F20260629q5gz, F2026060404]
---

# Resume 路径 contextEnv key 命名修复

## 1. 问题描述

resume 路径注入的 `contextEnv` 使用裸名 `message_id` / `stage_id`，而 agent 子进程读取的是 `SNAIL_CTX_MESSAGE_ID` / `SNAIL_CTX_STAGE_ID`，导致 agent 永远无法从环境变量获取当前消息 ID。

此问题是 F20260629q5gz（串台 bugfix）的遗留缺陷，当时作为 follow-up 拆出，至今未修复。

### 1.1 直接证据

| 时间 | 事件 | 说明 |
|------|------|------|
| 2026-06-30 | 本 issue 复现 | agent 调用 `set_final_body` 时 `SNAIL_CTX_MESSAGE_ID` 为 UNDEFINED |
| 2026-06-30 | 活体验证 | 当前 agent 进程环境变量缺失（见下方输出） |

**活体验证输出**：

```
$ echo "SNAIL_CTX_MESSAGE_ID=${SNAIL_CTX_MESSAGE_ID:-UNDEFINED}"
SNAIL_CTX_MESSAGE_ID=UNDEFINED

$ echo "SNAIL_CTX_STAGE_ID=${SNAIL_CTX_STAGE_ID:-UNDEFINED}"
SNAIL_CTX_STAGE_ID=UNDEFINED
```

### 1.2 两条路径对比

| 路径 | contextEnv 构造方式 | message_id key | agent 能否读到 |
|------|---------------------|----------------|----------------|
| first call | `buildContextEnv(request)` | `SNAIL_CTX_MESSAGE_ID` | ✅ |
| resume | 手动构造 + `CONTEXT_KEYS` | `SNAIL_CTX_MESSAGE_ID` | ✅ |

### 1.3 历史溯源

| 时间 | 提交 | 事件 |
|------|------|------|
| 06-04 | `f051856d` F2026060404 | 引入 `buildContextEnv` + `SNAIL_CTX_` 前缀规范，first call 路径正确 |
| 06-29 16:01 | `da0f6068` F20260629q5gz PR#491 | 修复串台 bug，resume 路径手动构造 contextEnv 用裸名（**引入本 bug**） |
| 06-29 17:19 | `8a42a391` F20260629vv5s PR#489 | 增加 snail_key 注入，未修复 key 命名 |
| 至今 | — | Follow-up「统一 SNAIL_CTX_ 前缀」未落地 |

## 2. 根因分析

### 2.1 核心断点：resume 路径 contextEnv key 不匹配

**First call 路径**（正确）：
```
adapter.ts:127   contextEnv = buildContextEnv(request)
context-env.ts:20  envKey = key.startsWith("SNAIL_CTX_") ? key : `SNAIL_CTX_${key}`
→ agent 读取 process.env.SNAIL_CTX_MESSAGE_ID ✅
```

**Resume 路径**（错误）：
```
adapter.ts:186   contextEnv.message_id = request.messageId    // key 是 "message_id"
→ agent 读取 process.env.SNAIL_CTX_MESSAGE_ID → undefined ❌
```

### 2.2 `buildContextEnv` 的前缀逻辑

`context-env.ts` 中 `buildContextEnv` 函数对所有 context key 自动添加 `SNAIL_CTX_` 前缀（已带前缀的不重复添加）。resume 路径绕过了此函数，直接手动构造 contextEnv。

### 2.3 因果链

```
resume 路径手动构造 contextEnv，key 用裸名
  → agent 子进程 env 中 key 为 "message_id" 而非 "SNAIL_CTX_MESSAGE_ID"
    → agent 读 process.env.SNAIL_CTX_MESSAGE_ID → undefined
      → agent 从 session 历史推断或猜测 message_id
        → 猜对 → mcp_final_body 写入错误消息（串台）
        → 猜错 → set_final_body 校验失败，agent 无 mcp_final_body
          → extractTerminalContext 降级为 last text event
            → 用户看到流式输出的最后一段文本，而非 set_final_body 内容
```

### 2.4 为何 stage_id 校验未拦住

F20260629q5gz 增加的 stage_id 归属校验（`snail-final-response.ts:39-47`）是防御层，但：
- agent 猜的 message_id 如果恰好属于同 stage 的另一条消息 → 校验通过 → 串台写入
- agent 猜的 message_id 如果不存在 → 校验拦截，但 agent 无 mcp_final_body → 降级显示

两种情况都导致用户看到错误的最终答复。

## 3. 核心业务行为

| ID | 当 X 时 | 应该 Y |
|----|---------|--------|
| B1 | resume 路径调用 agent | 子进程环境变量中 `SNAIL_CTX_MESSAGE_ID` 有值，等于当前 invocation 创建的消息 ID |
| B2 | resume 路径调用 agent | 子进程环境变量中 `SNAIL_CTX_STAGE_ID` 有值，等于当前 stage ID |
| B3 | first call 和 resume 路径均可用 | 两条路径的 contextEnv key 命名一致，均使用 `SNAIL_CTX_` 前缀 |
| B4 | agent 调用 `set_final_body` | `mcp_final_body` 写入当前 invocation 的消息，不串台 |
| B5 | agent 完成且已调用 `set_final_body` | `extractTerminalContext` 返回 `mcp_final_body`，用户看到 agent 显式提交的内容 |

## 4. 设计方案

### 4.1 变更 1：resume 路径使用 `buildContextEnv` 或 `CONTEXT_KEYS` 常量

**决策**：resume 路径的 contextEnv key 统一使用 `CONTEXT_KEYS` 常量，保证 `SNAIL_CTX_` 前缀。

**正方**：
- 消除根因，agent 在两条路径下都能读到 `SNAIL_CTX_MESSAGE_ID` 和 `SNAIL_CTX_STAGE_ID`
- 与 first call 路径行为一致，消除路径分叉
- `CONTEXT_KEYS` 常量已存在（`context-keys.ts`），直接复用

**反方**：
- `buildContextEnv` 接收 `SnailFirstCallRequest` 类型，resume 路径的 `SnailResumeRequest` 类型不同，需要适配
- 直接使用 `CONTEXT_KEYS` 常量比调用 `buildContextEnv` 更轻量

**决策**：采用 `CONTEXT_KEYS` 常量直接构造。理由：resume 路径只需注入 `message_id` 和 `stage_id` 两个值（加上已有的 `WORKSPACE_PATH` 和 `snail_key`），不值得为此扩展 `buildContextEnv` 的输入类型。与 F20260629q5gz 决策一致——当时选择「在 `doInvokeResume` 中直接构造 contextEnv」，只是 key 名用错了。

### 4.2 变更 2：`snail_key` key 命名一致性（附带修复）

当前 resume 路径的 `snail_key` 也是裸名。虽然 agent 通过 system prompt 而非环境变量获取 snail_key，但为一致性应统一。

**决策**：`snail_key` 改为使用 `CONTEXT_KEYS.SNAIL_KEY` 常量。在 `context-keys.ts` 中新增 `SNAIL_KEY: "SNAIL_CTX_SNAIL_KEY"` 常量，resume 路径使用 `[CONTEXT_KEYS.SNAIL_KEY]: instance.snail_key`。

### 4.3 stageId 为 null 的边界场景

`adapter.ts:187` 有 `if (request.stageId != null)` 守卫。如果 stageId 为 null，修复后 `SNAIL_CTX_STAGE_ID` 仍不注入。

**分析**：resume 路径的 `stageId` 来源于 `collaboration.ts:316`，值为 `stage.id`，其中 `stage` 通过 `mustGetStage(stageId)` 获取（找不到则抛异常）。**stageId 保证非空**，`if` 守卫为防御性编程，不影响实际行为。

## 5. 设计决策记录

| 决策 | 选择 | 正方 | 反方 | 结论 |
|------|------|------|------|------|
| key 命名方式 | `CONTEXT_KEYS` 常量 | 复用已有常量，轻量 | 需手动拼接 | 采用 |
| `buildContextEnv` vs 手动构造 | 手动构造 + `CONTEXT_KEYS` | resume 路径输入类型不同，不值得扩展 `buildContextEnv` | 两条路径构造逻辑分叉 | 采用（与 F20260629q5gz 决策一致） |
| `snail_key` 命名 | `CONTEXT_KEYS.SNAIL_KEY` | 全局统一，消除裸名残留 | 无 | 采用 |

## 6. 验证场景

| # | 场景 | 预期结果 |
|---|------|---------|
| 1 | Resume 路径调用 agent，agent 调用 `set_final_body` | `SNAIL_CTX_MESSAGE_ID` 有值，`mcp_final_body` 写入当前消息 |
| 2 | First call 路径调用 agent（回归） | 行为不变，`SNAIL_CTX_MESSAGE_ID` 有值 |
| 3 | Resume 路径 agent 完成后检查 message_context | 当前消息的 `kind` 为 `mcp_final_body`，内容为 agent 显式提交的文本 |
| 4 | 验证环境变量 key | `grep -o "SNAIL_CTX_MESSAGE_ID" adapter.ts` 在 resume 路径相关代码中匹配 |

## 7. 影响面

| 组件 | 变更类型 | 说明 |
|------|---------|------|
| `adapter.ts` | bugfix | resume 路径 contextEnv key 从裸名改为 `CONTEXT_KEYS` 常量 |
| 其他组件 | 不变 | `snail-final-response.ts`、`collaboration.ts`、`context-keys.ts` 均不需要修改 |

## 8. Follow-up

无。本特性为 F20260629q5gz follow-up「统一 SNAIL_CTX_ 前缀」的落地修复。
