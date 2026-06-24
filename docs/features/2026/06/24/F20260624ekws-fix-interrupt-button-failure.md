---
id: F20260624ekws
title: fix-interrupt-button-failure
from_ids: [F2026050703]
tags: [interrupt, startup-recovery, streaming, websocket]
modules: [collaboration, web]
doc_kind: spec
---

# F20260624ekws [collaboration][web] 修复中断按钮失效

## 背景

中断按钮（Stop）在两种场景下失效：

1. **重启后永久失效**：服务重启后，内存中的 `activeInvocations` Map 丢失，但数据库中消息仍为 `status = "streaming"`。`startupRecovery` 只处理 `CallSignal`，不处理孤儿 streaming 消息。前端通过 WebSocket 重连或 API 拉取到 "streaming" 状态，显示 Stop 按钮，但点击后 `interruptMessage` 找不到 AbortController，返回 `false`。API 返回 200 + `{ interrupted: false }`，前端丢弃返回值，用户得到零反馈。消息永远卡在 "streaming" 状态。

2. **正常运行中"点了没反应"**：前端 `handleInterrupt` 调用 API 后无 UI 反馈。进程终止需要时间（SIGINT 15s → SIGTERM 5s → SIGKILL 2s），期间前端仍显示 "streaming" + Stop 按钮。用户认为中断无效再次点击，第二次命中 `status !== "streaming"` 校验返回 409。此外 agent 自然完成与用户中断之间存在竞争窗口，导致 API 返回 409 但用户看到的是 AI 已完成。

F2026050703 已在 v1 架构（`ProjectManager` + `ConversationStore`）下设计了孤儿 streaming 消息恢复方案，但从未 port 到当前 v2 架构（`IssueCollaboration` + `MessagePort`）。

## 目标

1. 服务重启后，孤儿 streaming 消息自动收敛为 `interrupted` 终态，解除 UI 阻塞
2. 用户点击 Stop 后立即看到"正在中断"反馈，而非无响应
3. `interruptMessage` 对 streaming 消息始终保证收敛（实时中断或兜底收敛），前端只需处理成功/失败两种路径
4. 清理 `interruptMessage` 中的冗余 delete 操作

## 非目标

1. 不恢复或继续执行重启前的 agent 子进程
2. 不改变正常运行中的中断协议（仍以 AbortController 为实时中断边界）
3. 不实现分布式运行租约或多服务实例协同
4. 不改变 `drainStage` 的并行 speaker 独立执行模型

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当服务重启后存在 `status = "streaming"` 的孤儿消息时 | 启动恢复应将其状态更新为 `interrupted`，追加 `message_interrupted` signal 和可追溯的终态 context | |
| B2 | 当用户点击 Stop 且 agent 正在运行时 | 前端应立即显示"正在中断"过渡态；API 成功后等待 WebSocket 推送终态 | |
| B3 | 当用户点击 Stop 但 agent 已自然完成时（API 返回 409） | 前端应显示"该消息已完成"提示，而非"中断失败" | |
| B4 | 当用户点击 Stop 但消息为孤儿（无活跃 AbortController）时 | `interruptMessage` 应兜底收敛：将消息标记为 `interrupted`，推送 WebSocket 终态，返回 `true`；前端保持 interrupting 等待 WebSocket 推送 | |
| B5 | 当用户在中断处理中重复点击 Stop 时 | 前端应忽略重复点击，不发送额外 API 请求 | |

## 设计

### P1 详设：启动恢复 — 孤儿 streaming 消息收敛

**设计来源**：F2026050703 v1 方案，port 到 v2 架构。

`startupRecovery` 扩展职责：除了现有的 `CallSignal` 恢复外，增加孤儿 streaming 消息扫描。

恢复范围：`from_speaker !== "user"` 且 `status = "streaming"` 的消息。user 消息由同步流程即时完成，若出现异常应单独分析。

对每条孤儿消息：
1. 追加 `message_interrupted` 终态 signal（终止原因标识为服务启动恢复）
2. 通过 `extractTerminalContext` 构建终态 context（已有文本输出则保留，否则生成事件摘要）
3. 更新消息状态为 `interrupted`，设置 `ended_at`

启动恢复发生在 HTTP server 开始监听之前，此时无 WebSocket 连接，不推送事件。前端通过 WebSocket 重连后的 `invalidateQueries` 自然获取收敛后的 `interrupted` 状态。

单条消息恢复失败不应阻断服务启动。恢复过程记录失败 message id 和错误日志，继续处理其他孤儿消息。

**`MessagePort` 接口扩展**：新增按状态查询消息的方法，供 `startupRecovery` 使用。

### P2 详设：前端中断状态反馈

**前端状态机扩展**：

在 `ChatMessage` 组件中引入 `interrupting` 本地状态。用户点击 Stop 后：
1. 立即设置 `interrupting = true`，按钮显示 "Stopping..." 并禁用
2. 调用 API，根据返回值处理。`api-client` 对非 2xx 响应 throw，因此 409 走 catch 路径、200 走 try 路径：
   - **try 路径**（200 + `{ interrupted: true }`）：保持 `interrupting`，等待 WebSocket 推送终态。`interruptMessage` 对 streaming 消息始终返回 true（实时中断或兜底收敛），所以 try 路径只有 `true` 分支
   - **catch 路径**（409，消息已完成）：清除 `interrupting`，显示 toast"该消息已完成"
   - **catch 路径**（网络错误）：清除 `interrupting`，显示 toast"中断请求失败"
3. 收到 WebSocket `message_status_changed` 事件后，`interrupting` 状态自然消失（`isStreaming` 变为 false）

**乐观更新**：`interrupting` 是前端本地状态，不依赖 API 返回。API 延迟期间用户仍能看到过渡态。

**重复点击防护**：`interrupting` 为 true 时，onClick 不触发 `handleInterrupt`。

### P3 详设：interruptMessage 兜底收敛孤儿消息

扩展 `interruptMessage` 方法：当 `activeInvocations.get(messageId)` 返回 undefined（无活跃 AbortController）时，检查消息状态，若仍为 `streaming` 则兜底收敛：
1. 调用 `extractTerminalContext` 构建终态 context
2. 调用 `completeMessage(messageId, "interrupted")` 标记终态
3. 调用 `notifyConsumers` 推送 WebSocket `message_status_changed` 事件
4. 返回 `true`

这样 `interruptMessage` 对 streaming 消息**始终返回 true**（要么实时中断，要么兜底收敛）。API 路由层无需改动。

这解决了两类场景：
1. P1 启动恢复遗漏的孤儿消息（如启动恢复单条失败被跳过）
2. 运行时 `activeInvocations` 因异常丢失但消息仍为 streaming 的边界情况

### P4 详设：清理 interruptMessage 冗余 delete

`interruptMessage` 中 `controller.abort()` 后的 `this.activeInvocations.delete(messageId)` 是冗余的（`invokeAgent` 的 finally 块会清理）。移除此 delete，保持单一清理路径。

## 生效路径

1. `startupRecovery` 扩展 → 启动时自动收敛孤儿 streaming 消息
2. `MessagePort` 接口新增按状态查询方法
3. 前端 `ChatMessage` 组件中断状态机变更
4. 前端 `handleInterrupt` 返回值处理

## 设计约束摘要

- **边界**：启动恢复只处理 `from_speaker !== "user"` 的 streaming 消息；不恢复 agent 子进程
- **关键决策**：孤儿消息收敛为 `interrupted` 而非 `failed`（运行被服务进程生命周期打断，非 agent 执行失败）
- **非目标约束**：不改变 `drainStage` 并行模型；不实现分布式协同
- **语义不变量**：`completeMessage` 是消息状态转终态的唯一写入路径；启动恢复复用此路径

## 改动范围

1. `src/app/issue-collaboration/startup-recovery.ts` — 扩展孤儿 streaming 消息扫描与收敛
2. `src/domain/message/port.ts` — 新增按状态查询消息的接口方法
3. `src/domain/message/_internal/adapter.ts` — 实现按状态查询
4. `src/domain/message/_internal/repository.ts` — SQLite 查询层
5. `src/app/issue-collaboration/collaboration.ts` — interruptMessage 扩展兜底收敛 + 清理冗余 delete
6. `src/web/components/ChatMessage.tsx` — interrupting 过渡态 + 按钮状态
7. `src/web/pages/IssueConversation.tsx` — handleInterrupt 返回值处理

## 验证

### P1

- [ ] 构造残留 streaming 消息，重启服务后确认状态变为 `interrupted`
- [ ] 确认恢复消息包含 `message_interrupted` signal 和可用于展示的 context
- [ ] 确认没有孤儿消息时启动恢复不写入新事件
- [ ] 确认单条恢复失败不阻断服务启动

### P2

- [ ] 点击 Stop 后按钮立即变为 "Stopping..." 过渡态
- [ ] 重复点击 Stop 不发送额外 API 请求
- [ ] WebSocket 推送终态后按钮消失

### P3

- [ ] 构造孤儿 streaming 消息（无 AbortController），调用 `interruptMessage` 后确认消息状态变为 `interrupted` 且返回 `true`
- [ ] 确认 `notifyConsumers` 被调用，WebSocket 推送 `message_status_changed` 事件
- [ ] 确认有 AbortController 的消息走正常中断路径不受影响

### 通用

- [ ] `npm run test` 通过
- [ ] `npm run build` 通过

## 关联

- **前置**: F2026050703（启动时收敛孤儿运行消息 — v1 设计，本 feature 将其 port 到 v2）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | 孤儿消息收敛为 interrupted vs failed | 运行被服务进程生命周期打断，非 agent 执行失败；与正常中断语义一致 | interrupted 暗示用户主动中断，但孤儿消息是被动中断 | 收敛为 interrupted | 保持与 F2026050703 一致的设计决策；用户视角是"运行被打断"而非"运行失败" | 架构师-1, 架构师-2 | 2026-06-24 |
| D2 | F2026050703 v2 port 是否作为本 feature 一部分 | 重启场景是中断失效的主要根因之一；不解决则中断按钮在重启后永远失效 | 可作为独立 feature 处理，避免本 feature 范围过大 | 作为本 feature 一部分 | 两个问题共享根因（streaming 僵尸消息），拆分会导致依赖链 | 架构师-1, 架构师-2 | 2026-06-24 |
| D3 | 前端 interrupting 状态为本地状态 vs 服务端状态 | 本地状态实现简单、即时反馈；不增加服务端复杂度 | 本地状态在 WebSocket 断连时可能与服务端不一致 | 本地状态 | 即时反馈是核心需求；WebSocket 断连时 invalidateQueries 会同步状态 | 架构师-1, 架构师-2 | 2026-06-24 |
| D4 | 兜底收敛位置：API 路由层 vs collaboration 层 | collaboration 层有 `notifyConsumers` 引用，可推送 WebSocket 事件；路由层保持薄层 | collaboration 层职责扩展，`interruptMessage` 语义变化 | 在 `interruptMessage` 方法内扩展兜底收敛逻辑 | 路由层无 `notifyConsumers`，在路由层收敛会导致 WebSocket 事件丢失；collaboration 层扩展更简洁（不新增方法、不改路由），且 `interruptMessage` 语义更清晰：对 streaming 消息始终保证收敛 | 架构师-1, 架构师-2 | 2026-06-24 |
