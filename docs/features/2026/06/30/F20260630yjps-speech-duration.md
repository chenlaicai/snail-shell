---
id: F20260630yjps
title: speech-duration
from_ids: [d610df8a-067e-47e7-8cab-e9115a73ff67]
tags: [web, ux]
modules: [web]
doc_kind: spec
---

# F20260630yjps [web] 增加发言耗时显示

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

Issue 对话中，每条消息目前只显示"发言开始时间"（`created_at`），用户无法直观感知一次发言花了多长时间。对于 AI agent 的长时发言（可能持续数分钟），缺少耗时信息会让用户难以判断响应是否正常、效率如何。

## 目标

在 Issue 对话的消息头部，为 AI 发言增加"发言耗时"显示：
- **streaming 期间**：实时计时器，每秒更新，显示已过去的时间
- **发言完成后**：静态显示总耗时

## 非目标

- 不修改后端数据模型或 API（`created_at` + `updated_at` 已足够计算耗时）
- 不在数据库中新增 `duration` 字段
- 不修改 WebSocket 协议
- 不为 user 消息显示耗时（用户消息是即时完成的，`created_at ≈ ended_at`，耗时始终为 ~0s，无信息量）
- 不为 system 消息显示耗时
- 不区分重试次数，耗时为累计值（从消息创建到最终完成的总耗时）

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当 assistant 消息正在 streaming 时 | 消息头部显示实时计时器，格式为 `Xm Ys` 或 `Xs`，每秒更新 | |
| B2 | 当 assistant 消息 streaming 完成（status 变为 completed/failed/interrupted/cancelled；`sending` 为前端专用状态，不适用于 assistant 消息）时 | 计时器停止，显示最终耗时，基于 `(ended_at ?? updated_at) - created_at` 计算（优先使用后端精确的 `ended_at`，fallback 到前端近似的 `updated_at`）；重试场景下耗时为累计值（从消息创建到最终完成的总耗时） | |
| B6 | 当 assistant 消息从历史记录加载（页面刷新后通过 REST API 获取，status 已为 completed）时 | 直接显示静态耗时，基于 `(ended_at ?? updated_at) - created_at` 计算，不启动实时计时器 | |
| B3 | 当 assistant 消息的耗时不足 1 分钟时 | 仅显示秒数，格式 `Xs` | |
| B4 | 当 assistant 消息的耗时达到 1 分钟但不足 1 小时时 | 显示 `Xm Ys` 格式 | |
| B5 | 当 assistant 消息的耗时达到 1 小时以上时 | 显示 `Xh Ym` 格式 | |

## 设计

### 数据来源

前端已有的 `MessageDto` 字段足以支撑耗时计算，无需后端改动：

| 字段 | 来源 | 用途 |
|------|------|------|
| `created_at` | 消息创建时写入 DB，通过 API 和 WebSocket placeholder 传递到前端 | 发言开始时间 |
| `ended_at` | 后端 `completeMessage`（`adapter.ts:78`）写入 DB；REST API 通过 `toMessageDto` 的 `...message` 展开传递到前端（历史消息有值）；WebSocket `createPlaceholderMessage` 设为 `null`，EventBatcher 不更新（实时消息始终为 `null`） | 发言结束时间（精确值，仅历史消息可用） |
| `updated_at` | REST API 层计算为 `ended_at ?? created_at`；前端 EventBatcher 在 status 变更时覆盖为 `new Date().toISOString()` | 发言结束时间的 fallback（近似值） |
| `status` | 前端实时更新 | 判断是否 streaming |

**数据可用性差异**：历史消息（REST API 加载）有精确的 `ended_at`；实时消息（WebSocket 推送）的 `ended_at` 始终为 `null`，需依赖 `updated_at` 近似。因此完成时间取值策略为 `ended_at ?? updated_at`。

### 耗时计算逻辑

```
streaming 消息: elapsedMs = Date.now() - new Date(created_at).getTime()
已完成消息:     elapsedMs = new Date(ended_at ?? updated_at).getTime() - new Date(created_at).getTime()
```

**防误用**：streaming 消息**必须**用 `Date.now()` 实时计算，不能用 `ended_at ?? updated_at`（streaming 期间该值持续被覆盖为当前时间，相减结果为 0 或极小值）。两套计算逻辑严格按 `status` 分支，不可混用。

**重试语义**：耗时为累计值——从消息首次创建到最终完成的总耗时，不区分原始尝试和重试。理由：(1) 不引入额外时间基准如 `retry_started_at` (2) 用户关心的是"这条消息等了多久"而非"最后一次尝试花了多久" (3) 重试是异常路径，不应增加正常路径复杂度。

### 实时计时器

streaming 期间使用 `useEffect` + `setInterval(1000)` 驱动本地 `useState` 更新。计时器仅在 `status === "streaming"` 时运行，status 变更后自动清除。

assistant 消息直接以 `streaming` 状态创建（`collaboration.ts:257`），不存在 `sending` → `streaming` 的过渡。`sending` 为前端专用状态，仅用于 user 消息的乐观发送。因此 `sending` 阶段不显示耗时，无需额外处理。

此实现与现有 `ChatMessage` 的 `React.memo` 兼容：计时器更新的是组件内部 state，不改变 props 引用，不会触发父组件重渲染。

### 显示格式

`formatDuration(ms: number): string` 函数：

| 时长范围 | 格式 | 示例 |
|----------|------|------|
| < 60s | `Xs` | `5s`, `45s` |
| 1m ~ 60m | `Xm Ys` | `2m 30s`, `59m 0s` |
| >= 1h | `Xh Ym` | `1h 5m`, `2h 0m` |

### 显示位置

在 ChatMessage 头部，紧跟在 `formatDateTime(message.created_at)` 之后，context usage 之前。排列顺序：时间戳 → 耗时 → context usage。仅对 assistant（非 user、非 system）消息显示。

```
[AI] 2026-06-30 14:30:05 · 2m 30s [45k/200k (23%)]
```

streaming 期间耗时文本使用 `text-shell-400` 颜色（与 streaming 指示器一致），完成后切换为 `text-text-muted`（与时间戳一致）。

### 受影响文件

| 文件 | 改动 |
|------|------|
| `src/web/lib/format.ts` | 新增 `formatDuration` 函数 |
| `src/web/components/ChatMessage.tsx` | 新增 `useLiveTimer` hook；在 assistant 消息头部渲染耗时 |

## 生效路径

改动完全在前端，通过 ChatMessage 组件的渲染逻辑生效。`formatDuration` 作为纯函数可在其他需要时间格式化的地方复用。

## 设计约束摘要

- **边界**：纯前端改动，不涉及后端、数据库、WebSocket 协议或 API 契约变更
- **关键决策**：完成时间优先使用后端精确的 `ended_at`，fallback 到前端近似的 `updated_at`（即 `ended_at ?? updated_at`），充分利用已有字段
- **非目标约束**：不为 user/system 消息显示耗时
- **语义不变量**：耗时始终基于 `created_at`（消息创建 = 发言开始），不引入额外的时间基准

<!-- [design-time] 章节结束 -->

## 改动范围

- `src/web/lib/format.ts` — 新增 `formatDuration` 函数
- `src/web/components/ChatMessage.tsx` — 新增实时计时器逻辑，在 assistant 消息头部渲染耗时

## 验证

### 通用

- [x] assistant 消息 streaming 期间，耗时每秒更新（`useLiveTimer` + `setInterval(1000)`）
- [x] assistant 消息完成后，耗时为静态值（`useLiveTimer` 在非 streaming 时直接从 `ended_at ?? updated_at` 计算）
- [x] 历史消息（页面刷新后加载）直接显示静态耗时（同上，非 streaming 路径）
- [x] user 消息不显示耗时（`!isUser` 条件守卫）
- [x] system 消息不显示耗时（system 消息提前 return，不进入耗时渲染路径）
- [x] 耗时格式正确：短时 `Xs`、中时 `Xm Ys`、长时 `Xh Ym`（`formatDuration` 纯函数）
- [x] 耗时显示在时间戳之后、context usage 之前（JSX 顺序：timestamp → duration → contextUsage）
- [x] 耗时显示不影响消息头部其他元素的布局（使用 `span` 内联元素，无绝对定位）

## 关联

无前置或相关 feature。

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | 完成时间取值策略 | `ended_at ?? updated_at`：优先使用后端精确值（REST API 历史消息），fallback 到前端近似值（WebSocket 实时消息）；不修改后端，仅更充分利用已有字段 | 前端 `updated_at` 是近似值（含 WebSocket 传输延迟），精度不如后端直接记录的 `ended_at` | `ended_at ?? updated_at` | 历史消息有精确 `ended_at`，实时消息只有近似 `updated_at`；分层取值在不增加后端复杂度的前提下最大化精度 | 架构师-1, 架构师-2 | 2026-06-30 |
| D2 | 哪些消息类型显示耗时 | 仅 assistant 消息有实际耗时意义（user 消息即时完成，system 消息无发言过程） | 所有消息类型统一显示耗时更一致 | 仅 assistant 消息 | user 消息耗时恒为 ~0s 无信息量，显示反而干扰；system 消息同理 | 架构师-1 | 2026-06-30 |
| D3 | 实时计时器实现方式 | `setInterval(1000)` + 本地 state，与 React.memo 兼容 | 依赖 `_lastEventAt` 变化驱动更新（已有机制） | `setInterval` | `_lastEventAt` 更新频率不固定（依赖事件到达），无法保证每秒更新；独立 timer 更可靠 | 架构师-1 | 2026-06-30 |
| D4 | 重试场景下耗时语义 | 累计语义：从消息创建到最终完成的总耗时，不区分原始尝试和重试 | 仅最近一次：需要额外时间基准如 `retry_started_at`，增加数据模型复杂度 | 累计语义 | (1) 不引入额外时间基准 (2) 用户关心"这条消息等了多久"而非"最后一次尝试花了多久" (3) 重试是异常路径，不应增加正常路径复杂度 | 架构师-1, 架构师-2 | 2026-06-30 |

## 范围变更记录

| # | 变更 | 原因 | 确认状态 |
|---|------|------|----------|
| C1 | 完成时间取值从 `updated_at` 改为 `ended_at ?? updated_at` | 架构师-2 交叉审视：历史消息（REST API 加载）有精确 `ended_at`，应优先使用 | 已确认 |
| C2 | 新增 B6 历史消息加载场景 | 架构师-2 交叉审视：核心业务行为缺少此场景的显式条目 | 已确认 |
| C3 | 明确重试场景为累计耗时语义 | 架构师-2 交叉审视：重试场景下耗时语义未定义 | 已确认 |
| C4 | 新增 D4 决策记录（重试语义） | 配合 C3，记录决策过程 | 已确认 |
