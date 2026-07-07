---
id: F20260706w8hp
title: close-issue-navigation-observability
from_ids: [F20260706x53y]
tags: [bugfix, frontend, observability, diagnostics]
modules: [web]
doc_kind: spec
---

# F20260706w8hp [web] Close Issue 导航可观测性

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景 [required]

Close Issue 后导航离开时触发 HTTP 全量刷新（浏览器刷新进度条）。穷举式代码搜索排除了所有直接触发路径（`window.location`、`<a href>`、ServiceWorker、Vite HMR 等），两个间接假说（EventBatcher cache 写操作、Vite HMR 文件监控）均被排除或缺乏理论依据。

无法从代码分析定位根因。需要添加可观测性埋点，在问题复现时捕获完整导航上下文，使根因可被日志数据直接定位，而非依赖假说。

## 用户意图锚 [required]

| # | 来源 | 用户原话（逐字引用） | 关键修饰语 | 架构师解读 |
|---|------|---------------------|-----------|-----------|
| UA-1 | 用户消息 | "改为优化系统的可观测性能力，如果还有下次，便于你自行查看日志" | 条件：如果还有下次；目的：便于自行查看日志 | 目标是诊断基础设施，不是直接修复；日志需要 agent 可访问 |

## 目标 [required]

添加导航生命周期可观测性，在 HTTP 全量刷新发生时自动捕获刷新前的完整上下文（导航事件、close issue 流程、EventBatcher 状态、WebSocket 状态），使根因可通过日志数据定位。

## 非目标 [required]

- 不修复 HTTP 全量刷新问题本身——根据诊断数据后续单独处理
- 不修改后端 API 或 WebSocket 协议
- 不改变现有 close issue 业务逻辑
- 不构建通用 APM 系统——聚焦导航相关诊断

## 核心业务行为 [required]

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当页面通过 HTTP 全量刷新加载时 | 控制台输出 warning 级别日志，包含上一次导航的完整 trace buffer（导航事件序列、close issue 流程时间线、EventBatcher 状态快照） ← UA-1 | |
| B2 | 当页面通过 SPA 导航加载时 | 控制台输出 debug 级别日志，标注为 SPA 导航，不输出 trace buffer | |
| B3 | 当用户 close issue 后导航离开时 | trace buffer 记录完整的 close issue 流程时间线（onMutate → API 请求 → onSuccess → WS 事件 → batcher flush/dispose → navigate） ← UA-1 | |
| B4 | 当 EventBatcher.dispose() 被调用时 | trace buffer 记录 dispose 时的 pending 事件计数和 scheduled 状态 | |
| B5 | 当页面卸载前（pagehide）时 | trace buffer 记录当前 URL、WebSocket 连接状态、是否有进行中的 mutation | |

## 设计 [required]

### 整体架构

```
┌─────────────────────────────────────────────────────┐
│                   sessionStorage                     │
│           (nav-trace ring buffer, 100 entries)      │
│                                                     │
│  [navigate] [close_issue] [ws_event] [batcher] ... │
└──────────────┬──────────────────┬───────────────────┘
               │                  │
     ┌─────────▼──────┐  ┌───────▼────────┐
     │  pagehide      │  │  page load     │
     │  写入快照       │  │  检查导航类型   │
     │  (URL/WS/mut)  │  │  if "navigate":│
     │                │  │   dump buffer  │
     └────────────────┘  │   + sendBeacon │
                         └────────────────┘
```

### 组件 1：Navigation Trace Buffer

**存储**：`sessionStorage`（在同标签页内存活全量刷新，标签关闭时清除）

**Ring buffer**：最多 100 条记录，超出时丢弃最旧记录

**每条记录格式**：

```typescript
interface NavTraceEntry {
  ts: number;           // Date.now()
  type: string;         // 事件类型（见下表）
  detail?: unknown;     // 事件详情
}
```

**事件类型**：

| type | 触发点 | detail |
|------|--------|--------|
| `navigate` | React Router `navigate()` 调用 | `{ from: string, to: string }` |
| `page_load` | 页面加载 | `{ navType: string, prevUrl?: string }` |
| `pagehide` | 页面卸载前 | `{ url: string, wsStatus: string, hasPendingMutation: boolean }` |
| `close_issue_start` | `closeIssue.mutate()` 调用 | `{ issueId: string }` |
| `close_issue_on_mutate` | `onMutate` 执行完成 | `{ issueId: string }` |
| `close_issue_on_success` | `onSuccess` 执行完成 | `{ issueId: string }` |
| `close_issue_on_error` | `onError` 执行完成 | `{ issueId: string, error: string }` |
| `ws_event` | WebSocket 收到事件 | `{ eventType: string, issueId: string }` |
| `batcher_flush` | `EventBatcher.flush()` 执行 | `{ pendingCounts: Record<string, number> }` |
| `batcher_dispose` | `EventBatcher.dispose()` 执行 | `{ pendingCounts: Record<string, number>, scheduled: boolean }` |

### 组件 2：Page Load 导航类型检测

在 `main.tsx` 入口处，页面加载后立即检查 `performance.getEntriesByType('navigation')[0].type`：

| 导航类型 | 含义 | 行为 |
|----------|------|------|
| `"navigate"` | 全量 HTTP 加载（非 SPA） | **warning 级别**：输出 trace buffer 到控制台 + 通过 `sendBeacon` 上报到 `/api/frontend-log` |
| `"reload"` | 页面刷新（F5 / location.reload） | **warning 级别**：同上 |
| `"back_forward"` | 浏览器前进/后退 | **info 级别**：输出 trace buffer |
| `"prerender"` | 预渲染 | 不处理 |

**关键**：如果检测到 `"navigate"` 或 `"reload"`，说明发生了 HTTP 全量刷新。trace buffer 中记录的最后一条事件就是刷新前的最后一个操作，直接指向触发源。

**上报 schema 适配**：现有 `/api/frontend-log` 端点的 zod schema 要求 `level`（required）和 `metric`（required）字段，`NavTraceEntry` 格式不兼容。发送时需适配为 `PerfEntry` 格式：`level: "warn"`, `type: "nav_trace_dump"`, `metric: "http_reload"`, `reason: JSON.stringify(traceBuffer)`。这样 agent 可通过 `web.log` 读取并解析 trace 数据。

### 组件 3：Pagehide 状态快照

在 `pagehide` 事件中（比 `beforeunload` 更可靠），将以下状态写入 trace buffer：

- 当前 URL
- WebSocket 连接状态（`connected` / `disconnected` / `reconnecting`）
- 是否有进行中的 mutation（通过 `MutationCache` 查询或标志位）

### 组件 4：Close Issue 流程追踪

在以下位置添加 trace 记录：

| 位置 | 记录内容 |
|------|----------|
| `StageActionBar.confirmClose()` | `close_issue_start` |
| `useCloseIssue.onMutate` | `close_issue_on_mutate` |
| `useCloseIssue.onSuccess` | `close_issue_on_success` |
| `useCloseIssue.onError` | `close_issue_on_error` |

### 组件 5：EventBatcher 生命周期追踪

在以下位置添加 trace 记录：

| 位置 | 记录内容 |
|------|----------|
| `EventBatcher.flush()` 开头 | `batcher_flush` + pending 计数 |
| `EventBatcher.dispose()` | `batcher_dispose` + pending 计数 + scheduled 状态 |

### 组件 6：Navigate 调用追踪

在 `TopBar.tsx` 的 `navigate()` 调用处和 `IssueBoard.tsx` 的 `navigate()` 调用处，记录 `navigate` 事件（from/to）。

**覆盖范围说明**：`NavLink`（Sidebar）和浏览器后退按钮不调用 `navigate()`，不会被 trace 记录。`pagehide` 事件在所有导航路径下都会触发，作为兜底——即使缺少导航目标信息，trace buffer 中的 close issue/batcher 事件序列仍能提供诊断数据。

> **[D1]** 使用 `sessionStorage` 而非 `localStorage`。正方：`sessionStorage` 在同标签页内存活全量刷新，且标签关闭时自动清除，不会积累过期数据。反方：用户如果关闭标签再打开，trace buffer 丢失。依据：问题复现在同标签页内发生，`sessionStorage` 足够。

> **[D2]** 不修改 `EventBatcher.dispose()` 的行为。正方：避免在诊断阶段引入行为变更，防止干扰根因定位。反方：如果 dispose 的 flush 确实是根因，诊断期间问题仍会复现。依据：诊断目的就是捕获问题发生时的完整上下文，修改行为会破坏诊断数据的有效性。

### 已排除的替代方案

| 方案 | 排除理由 |
|------|----------|
| 修复 EventBatcher.dispose()（原方案） | 假说缺乏理论依据，"先确认再修" |
| 构建通用 APM 系统 | 过度设计，聚焦导航诊断即可 |
| 仅使用 console.log | 不持久化，全量刷新后丢失 |
| 仅使用后端日志 | 前端导航事件不经过后端，无法捕获 |

## 生效路径 [required]

- 代码：`src/web/lib/nav-trace.ts`（新增）、`src/web/main.tsx`、`src/web/hooks/useWebSocket.ts`、`src/web/mutations/issue.mutations.ts`、`src/web/components/TopBar.tsx`、`src/web/pages/IssueBoard.tsx`
- 诊断输出：浏览器控制台（warning 级别）+ `/api/frontend-log`（sendBeacon 上报）

## 设计约束摘要 [required]

### 硬约束（违反即 bug）
- trace buffer 必须在 HTTP 全量刷新后存活（使用 `sessionStorage`）
- 导航类型检测必须在页面加载最早期执行（`main.tsx` 入口，在 React 渲染前）
- `pagehide` 快照必须在页面卸载前同步写入（不能使用异步操作）

### 设计取舍（不得自行推翻）
- 使用 `sessionStorage` 而非 `localStorage`（[D1]）
- 不修改 `EventBatcher.dispose()` 行为（[D2]）——诊断期间保持原有行为

### 语义不变量（实现中必须保持为真）
- 可观测性埋点不改变任何现有业务行为
- trace buffer 写入失败不影响正常导航
- 导航类型检测在所有浏览器中安全执行（不支持 `performance.getEntriesByType` 时静默跳过）

### 非目标（不得扩展）
- 不修复 HTTP 全量刷新问题
- 不构建通用 APM 系统
- 不修改后端 API

<!-- [design-time] 章节结束 -->

## 改动范围 [required]

| 文件 | 修改内容 |
|------|----------|
| `src/web/lib/nav-trace.ts` | **新增**：trace buffer 管理、page load 检测、pagehide 快照 |
| `src/web/main.tsx` | 初始化 nav-trace（page load 检测） |
| `src/web/hooks/useWebSocket.ts` | EventBatcher.flush/dispose 添加 trace 记录；WS onMessage 添加 trace 记录 |
| `src/web/mutations/issue.mutations.ts` | useCloseIssue onMutate/onSuccess/onError 添加 trace 记录 |
| `src/web/components/StageActionBar.tsx` | confirmClose 添加 trace 记录 |
| `src/web/components/TopBar.tsx` | navigate 调用添加 trace 记录 |
| `src/web/pages/IssueBoard.tsx` | navigate 调用添加 trace 记录 |

## 验证 [required]

### 通用

- [ ] 正常 SPA 导航（无 close）：控制台输出 debug 级别日志，不输出 warning
- [ ] Close issue 后导航离开：trace buffer 记录完整时间线（close_issue_start → on_mutate → ws_event → batcher_dispose → navigate → pagehide）
- [ ] HTTP 全量刷新后页面加载：控制台输出 warning 级别日志，包含 trace buffer 内容
- [ ] `sessionStorage` 中 trace buffer 在全量刷新后存活
- [ ] trace buffer 超过 100 条时，旧记录被正确丢弃
- [ ] 现有功能不受影响（close issue、导航、WebSocket 均正常工作）
- [ ] 浏览器不支持 `performance.getEntriesByType` 时静默跳过，不报错

## 关联 [required]

- **相关**: F20260706x53y（Close Issue 消除冗余重渲染，PR #579）— 前序修复
- **后续**: 根据 trace buffer 诊断数据，创建新 feature 修复 HTTP 全量刷新根因

## 关键决策记录 [required]

| # | 决策点 | 最终决策 | 状态 |
|---|--------|----------|------|
| D1 | trace buffer 存储方式 | `sessionStorage`——同标签页存活全量刷新，标签关闭自动清除 | 设计阶段确认 |
| D2 | 是否同时修改 dispose() 行为 | 不修改——诊断期间保持原有行为，确保诊断数据有效性 | 用户确认 |

## 风险与缓解 [required]

| # | 风险 | 严重程度 | 影响 | 缓解策略 | 负责方 |
|---|------|----------|------|----------|--------|
| R1 | trace buffer 写入性能 | 低 | 每次事件写入 sessionStorage 有微量开销 | ring buffer 限制 100 条；写入使用同步 JSON.stringify，数据量极小 | 开发者 |
| R2 | 诊断期间问题不再复现 | 中 | 无法捕获诊断数据 | 埋点长期保留（非临时），直到问题复现 | 架构师 |
| R3 | `sessionStorage` 在某些浏览器中不可用 | 低 | trace buffer 失效 | try-catch 保护，不可用时静默跳过 | 开发者 |

## 架构师-2 对抗审视

### 审视结论：认可，方案可推进到 development

#### 问题 1：`/api/frontend-log` schema 不兼容

现有端点 zod schema 要求 `level`（required）和 `metric`（required），`NavTraceEntry` 格式不兼容。已在组件 2 中补充说明：发送时适配为 `PerfEntry` 格式（`level: "warn"`, `type: "nav_trace_dump"`, `metric: "http_reload"`, `reason: JSON.stringify(traceBuffer)`）。

#### 问题 2：Navigate 追踪覆盖范围

`NavLink`（Sidebar）和浏览器后退按钮不调用 `navigate()`，不会被 trace 记录。已在组件 6 中补充说明：`pagehide` 事件作为兜底，在所有导航路径下都会触发。

#### 认可的部分

1. D2 正确——不修改 `dispose()` 行为，确保诊断数据反映真实问题
2. `sessionStorage` 选择正确——同标签页存活全量刷新，标签关闭自动清除
3. `pagehide` 优于 `beforeunload`——现代浏览器中更可靠，不触发确认对话框
4. 事件类型覆盖全面——close issue 流程、EventBatcher 生命周期、WS 事件、导航、pagehide
5. 非目标边界清晰——不修复、不改后端、不建通用 APM
6. 语义不变量——埋点不影响业务行为，写入失败静默跳过

#### 语义保真度检查

- [x] 意图锚修饰语保留到行为条目
- [x] 行为条目有 ← UA-1 追溯（B1, B3）
- [x] 非目标边界清晰
- [x] 硬约束可验证
- [x] 语义不变量完整
- [x] 设计取舍有正反论述（[D1], [D2]）
