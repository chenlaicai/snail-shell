---
id: F20260625ad94
title: fix-ui-rendering-bottleneck
from_ids: [F20260625bc8d]
tags: [web, performance, bugfix, react, websocket]
modules: [web]
doc_kind: spec
change_type: bugfix
---

# F20260625ad94 [web] 修复 UI 渲染链路剩余瓶颈

## 背景

F20260625bc8d 已实施 5 项优化（Semaphore、busy_timeout、WebSocket 批处理、React.memo、虚拟化），但 UI 仍然卡顿。用户反馈多 agent 并发时操作无响应。

### 历史溯源

| 时间 | 提交 | 变更 |
|------|------|------|
| 2026-06-25 | `fce41811` (F20260625bc8d) | 修复多 Agent 并发卡死：Semaphore + busy_timeout + WebSocket 批处理 + React.memo + 虚拟化 |
| 2026-06-25 | 当前 | 深入排查前端渲染链路，发现 5 项剩余瓶颈 |

## 根因分析

### 第一轮：确认 F20260625bc8d 优化已落地

| 优化项 | 状态 | 位置 |
|--------|------|------|
| WebSocket 事件批处理 | ✅ 已落地 | `useWebSocket.ts:54-203` EventBatcher 类 |
| React.memo | ✅ 已落地 | `ChatMessage.tsx:176-183` |
| 虚拟化 | ✅ 已落地 | `IssueConversation.tsx:68-73` useVirtualizer |

### 第二轮：前端渲染链路深度排查

#### 瓶颈 1：`updateIssueActivityStatus` 绕过批处理（关键）

**位置**：`useWebSocket.ts:67`

**问题**：每个 WebSocket 消息都会**立即**调用 `updateIssueActivityStatus`，触发两次 `setQueryData`：
1. 更新 `issues.detail` 查询数据
2. 更新 `workspaces.issues` 查询数据

**影响**：5 个 agent × 10 事件/秒 = 50 次/秒 × 2 次 `setQueryData` = **100 次/秒的 React 重渲染**。这完全绕过了 EventBatcher 的批处理好处！

**扇出放大**：`setQueriesData({ queryKey: queryKeys.workspaces.issues(""), exact: false })` 使用 `exact: false`，会匹配所有以 `workspaces.issues` 为前缀的查询。如果存在多个 workspace issue list 查询（不同 filter、不同页面），每个都会收到新引用并触发重渲染。实际频率可能是 100 × N 次/秒（N = 匹配的查询数）。

**代码路径**：
```
WebSocket 消息到达
  → EventBatcher.add()
    → updateIssueActivityStatus()  // 立即执行，不进入 batch
      → queryClient.setQueryData(issues.detail)      // 触发重渲染
      → queryClient.setQueriesData(workspaces.issues) // 触发重渲染
    → 收集事件到 batch
    → schedule() → flush()  // 批处理的收益被上面的立即更新抵消
```

#### 瓶颈 2：`applyBatch` 总是创建新数组引用

**位置**：`useWebSocket.ts:124-173`

**问题**：即使事件内容没有实际变化，也会创建新数组：
- line 130: `result = [...result, ...]` 创建新数组
- line 144: `result.map(...)` 创建新数组
- line 159: `result.map(...)` 创建新数组

**影响**：React.memo 的引用比较总是失败，导致所有消息重渲染。

#### 瓶颈 3：ChatMessage memo 比较函数有缺陷

**位置**：`ChatMessage.tsx:176-183`

**问题**：`prev.message.events === next.message.events` 是引用比较。由于瓶颈 2 中创建新数组，这个比较总是 `false`。

**影响**：React.memo 100% 失效，每个消息都会重新渲染。

#### 瓶颈 4：EventStream 的 useMemo 别名未过滤

**位置**：`ChatMessage.tsx:187-193`

**问题**：
```typescript
const { filteredEvents, toolCalls, commands } = useMemo(() => {
  return {
    filteredEvents: events,  // 别名直接返回 events，实际没有过滤效果
    toolCalls: events.filter(...).length,
    commands: events.filter(...).length,
  };
}, [events]);  // 依赖 events，每次变化都重新计算
```

`filteredEvents` 是 `events` 的直接引用，变量名暗示有过滤但实际没有。`useMemo` 确实缓存了 `toolCalls` 和 `commands` 的计数，但由于依赖 `events` 引用（瓶颈 2 导致每次都是新引用），缓存每次都失效。

#### 瓶颈 5：RichTextRenderer streaming 时频繁解析

**位置**：`RichTextRenderer.tsx:32-34`

**问题**：streaming 期间 `content` 频繁变化，每次都会触发：
1. `splitMermaidBlocks(content)` - 字符串分割
2. `marked.parse(content)` - Markdown 解析（CPU 密集）
3. `sanitizeHtml(html)` - HTML 清洗（DOM 操作）

虽然有 `useMemo`，但依赖项频繁变化导致缓存失效。

#### 系统层约束 1：TanStack Query 的 `setTimeoutZero` 机制

**位置**：`useWebSocket.ts:179-184`

`EventBatcher.flush()` 对每个 stage 调用 `setQueryData`，但 TanStack Query v5 的 `notifyManager` 对每个 `setQueryData` 独立调度 `setTimeoutZero`。这些是独立的宏任务，不被 React 18 的自动批处理合并。

```
flush() 遍历 N 个 stage：
  → setQueryData(stageA) → notifyManager.batch() → setTimeoutZero(callbackA)
  → setQueryData(stageB) → notifyManager.batch() → setTimeoutZero(callbackB)
  → setQueryData(stageC) → notifyManager.batch() → setTimeoutZero(callbackC)
// N 个独立的宏任务 = N 次独立的 React re-render
```

**缓解因素**：TanStack Query 的 Proxy-based property tracking 会抑制无关 query key 的通知。如果 `setQueryData(stages.messages(stageA))` 没有改变 `stageB` 的 data 引用，`stageB` 的订阅者不会 re-render。实际 re-render 次数 = flush 次数 × 本轮有数据变化的 stage 数（通常为 1-2 个）。

**可选优化**：在 `flush()` 内部使用 `notifyManager.batch()` 将所有 `setQueryData` 包裹在同一批次中，使所有 stage 的更新合并为一次 re-render。但这是 TanStack Query 内部 API，可能在版本升级时变化。

#### 系统层约束 2：虚拟化测量级联

**位置**：`IssueConversation.tsx:68-73`

`@tanstack/react-virtual` 的工作流程：
1. 首次渲染：用 `estimateSize: 120px` 计算位置
2. DOM 挂载后：`ResizeObserver` 测量实际高度
3. 高度不匹配 → `resizeItem()` → `notify()` → 第二次 re-render
4. 位置修正后，overscan buffer 可能需要换入/换出 → 第三次 re-render

聊天消息高度差异极大（40px ~ 400px+），几乎每条消息都会触发测量修正。

**与 streaming 的叠加效应**：streaming 期间，每次 batch flush 改变消息内容 → DOM 高度变化 → `ResizeObserver` 再次触发 → 又一次 re-render。每条可见消息在每个 flush 周期产生 2 次 re-render（数据更新 + 测量修正）。

此外，`@tanstack/react-virtual` 默认 `useFlushSync = true`，在 scroll 事件触发的测量中使用 `flushSync` 强制同步 DOM 提交，阻塞主线程。

#### 补充路径：`invalidateQueries` 触发的二次渲染

**位置**：`useWebSocket.ts:189-194`

`flush()` 中对 `stage_transition_suggested` 事件会调用 `invalidateQueries` 触发 refetch，这会产生一个独立的渲染周期。但 `stage_transition_suggested` 频率极低（< 1次/分钟），不构成性能瓶颈。

#### 补充路径：auto-scroll 的隐性影响

**位置**：`IssueConversation.tsx:76-82`

`useEffect` 依赖 `[sorted]`，每次 batch flush 导致 sorted 变化都会触发 auto-scroll。`requestAnimationFrame(() => el.scrollTop = el.scrollHeight)` 可能触发浏览器 layout。但虚拟化库 `@tanstack/react-virtual` 已处理了平滑滚动，且 auto-scroll 仅在用户已在底部时触发，影响有限。

### 性能影响量化

> 以下频率基于 "5 agent × 10 事件/秒" 假设，耗时为估算值（基于 typical markdown 文本长度），实际值需 DevTools Performance 面板实测确认。

| 操作 | 频率（估算） | 耗时（估算） | 影响 |
|------|------|------|------|
| `updateIssueActivityStatus` | 50次/秒 | ~0.1ms/次 | 100次/秒 React 重渲染 |
| `applyBatch` 数组创建 | ~60次/秒 | ~0.05ms/次 | 所有消息重渲染 |
| `marked.parse` | 10-30次/秒 | ~2ms/次 | 主线程阻塞 |
| `sanitizeHtml` | 10-30次/秒 | ~1ms/次 | DOM 操作 |
| `setTimeoutZero` 多 stage | ~60次/秒 × N stage | ~0.1ms/次 | N 次独立 re-render（N=有变化的 stage 数） |
| 虚拟化测量级联 | ~60次/秒 × 可见消息数 | ~0.5ms/次 | 每条可见消息 2 次 re-render（数据+测量） |

## 修复方案

**执行顺序**：修复 1 → 修复 2 → 修复 3/4（可并行） → 修复 5。修复 1 是其他修复的前提——只要 `updateIssueActivityStatus` 以 100 次/秒的频率触发 `setQueryData`，修复 2、3、4 的收益会被完全淹没。

### 修复 1：将 `updateIssueActivityStatus` 移入批处理

**目的**：消除绕过批处理的瓶颈。

**方案**：
1. 将 `activity_status` 的更新收集到 batch 中
2. 在 `flush()` 时一起处理
3. 只保留每个 issue 最新的 `activity_status`，避免重复更新

**预期效果**：100 次/秒 → ~60 次/秒（每帧一次）

### 修复 2：优化 `applyBatch` 的结构共享

**目的**：避免不必要的数组引用变化。

**方案**：
1. 在 `result.map()` 中，先判断该 message 是否有新事件（通过 `eventsByMessage` / `statusByMessage` Map 查询）
2. 没有新事件的消息直接返回原引用 `m`，不创建新对象
3. 当前代码已经用 Map 分组，只需在 map 回调中增加 `if (!newEvents) return m` 的早返回

**前置依赖**：修复 2 是修复 3、4 的前置条件。只有修复 2 保证未变化消息的 `events` 引用不变，修复 3 的 memo 比较才有实际意义。

**预期效果**：React.memo 失效率从 100% 降至 ~10%

### 修复 3：改进 ChatMessage memo 比较

**目的**：更智能的 memo 策略。

**前置依赖**：修复 2（applyBatch 结构共享）必须先落地。否则即使修复 3 改用 length+lastId 比较，`applyBatch` 对没有新事件的消息也创建了新引用——React 仍会进入 memo 比较函数，虽然比较结果可能是 true，但比较本身是不必要的开销。

**方案**：
1. 比较 `message.events.length` 而非引用
2. 比较最后一条事件的 ID
3. 或使用 `useMemo` 预计算事件摘要

**预期效果**：未变化的消息不重渲染

### 修复 4：EventStream 实际过滤 text events

**目的**：让 `useMemo` 有实际效果。

**方案**：
```typescript
const { filteredEvents, toolCalls, commands } = useMemo(() => {
  const filtered = events.filter(e => e.payload?.type !== "text");
  return {
    filteredEvents: filtered,
    toolCalls: filtered.filter(e => e.payload?.type === "tool_call").length,
    commands: filtered.filter(e => e.payload?.type === "command").length,
  };
}, [events]);
```

**预期效果**：减少 EventStream 的计算量

### 修复 5：RichTextRenderer 增量解析

**目的**：避免 streaming 时重复解析整个文档。

**方案**：缓存已渲染的 HTML 片段，只对最后一个 block 做增量重新解析，前面的 block 直接复用 safeHtml。
1. 维护 `cachedContent: string` 和 `cachedSafeHtmls: string[]`（每个 block 的 safeHtml）
2. 新 content 到达时，检查是否以 `cachedContent` 开头
3. 若是：
   - 前 N-1 个 block 直接复用 `cachedSafeHtmls`
   - 对最后一个 block（可能包含新增内容）重新执行 `marked.parse` + `sanitizeHtml`
   - 若增量内容产生新 block，追加到 `cachedSafeHtmls`
4. 若否（内容被截断/重写）：全量重新解析

**正确性保证**：Markdown 块是跨边界关联的——未闭合的代码块、列表、引用等会导致增量解析错误。方案中"对最后一个 block 重新解析"确保了未闭合块的正确处理，前面已完成的 block 不受影响。

**注意**：不能用 `requestIdleCallback` 延迟解析——streaming 期间用户需要实时看到内容，延迟解析会导致内容闪烁。

**预期效果**：streaming 期间 CPU 密集操作减少 60-90%（取决于增量大小）

## 核心业务行为

| 编号 | 场景 | 预期行为 |
|------|------|----------|
| B1 | 5+ 个 agent 同时运行 | UI 操作响应 < 100ms，无卡顿 |
| B2 | agent 持续产出事件 | 浏览器帧率 > 30fps，无掉帧 |
| B3 | streaming 消息时 | 输入框和滚动操作流畅 |
| B4 | 消息列表超过 100 条 | 虚拟滚动 + memo 确保只有可见消息渲染 |
| B5 | agent 活跃时 | React DevTools Profiler 单次 commit 耗时 < 8ms |

## 改动范围

| 文件 | 改动 |
|------|------|
| `src/web/hooks/useWebSocket.ts` | 重构 EventBatcher，将 activity_status 更新移入 batch；优化 applyBatch 结构共享 |
| `src/web/components/ChatMessage.tsx` | 改进 React.memo 比较函数；优化 EventStream useMemo |
| `src/web/components/RichTextRenderer.tsx` | 缓存 safeHtml + 最后一个 block 增量解析 |
| `src/web/mutations/conversation.mutations.ts` | 评估乐观更新 ID 冲突（预存 bug，非本特性引入） |

## 验证清单

- [ ] V1：5 个 agent 并发运行时，UI 操作响应 < 100ms
- [ ] V2：浏览器 DevTools Performance 面板中 >50ms 的长帧数量 < 5 次/分钟
- [ ] V3：输入延迟 < 50ms（Performance.measure 测量 keydown → re-render 完成）
- [ ] V4：React DevTools Profiler 显示未变化的消息不重渲染
- [ ] V5：React DevTools Profiler 单次 commit 耗时 < 8ms
- [ ] V6：streaming 期间 ResizeObserver 触发频率 < 30 次/秒（DevTools Performance 面板）

## 设计决策

### D1：是否将 activity_status 更新移入 batch

**决策**：移入 batch，只保留最新值。

**正方**：
- 消除绕过批处理的关键瓶颈
- activity_status 变化频率低，延迟更新用户无感知
- 减少 100 次/秒的 React 重渲染

**反方**：
- activity_status 可能短暂不同步（< 16ms）
- 需要修改 batch 结构

**结论**：性能收益远大于短暂不同步的影响。

### D2：是否使用深比较替代引用比较

**决策**：使用事件长度 + 最后事件 ID 的轻量比较。

**正方**：
- 避免深比较的性能开销
- 比引用比较更准确

**反方**：
- 可能遗漏某些变化场景
- 需要维护额外的比较逻辑
- **盲区**：如果后端事件是替换而非追加（如 status 事件更新已有事件的内容），`events.length` 不变且 lastId 不变，memo 会错误地认为消息没变化

**结论**：轻量比较在性能和准确性之间取得平衡。当前后端事件模型只支持追加（`message_event_appended` 语义），不存在替换场景，此风险可接受。

### D3：是否保留 `schedule()` 的 rAF + setTimeout 双保险

**决策**：保留。

**正方**：
- `requestAnimationFrame` 在标签页不可见时不触发，这是浏览器的节流策略
- `setTimeout(50ms)` 兜底确保不可见标签页下事件不会无限堆积
- 50ms 而非 16ms 是有意为之：不可见标签页不需要 60fps 更新频率，50ms 足够

**反方**：
- 不可见标签页下 batch 窗口是 50ms 而非 16ms，事件可能延迟
- 两个定时器可能在可见标签页下同时触发 flush（rAF 先触发，setTimeout 兜底时 `this.scheduled` 已为 false）

**结论**：双保险机制正确。可见标签页下 rAF 先触发 flush，setTimeout 因 `scheduled=false` 而跳过；不可见标签页下 rAF 不触发，setTimeout 50ms 后兜底触发。这是 F20260625bc8d 的设计决策，本特性保持不变。

### D4：是否在 `flush()` 内部使用 `notifyManager.batch()` 包裹所有 `setQueryData`

**决策**：暂不使用，依赖 property tracking 抑制无关通知。如实测发现多 stage re-render 是瓶颈，则引入。

**正方**：
- 合并所有 stage 更新为一次 re-render，减少多 stage 场景下的渲染次数
- 对多 agent 并发场景有直接收益

**反方**：
- `notifyManager.batch()` 是 TanStack Query 内部 API，可能在版本升级时变化
- property tracking 已经抑制了无关 query key 的通知，实际 re-render 次数 = flush 次数 × 有变化的 stage 数（通常为 1-2 个）
- 增加代码复杂度和维护成本

**结论**：当前 property tracking 已足够，暂不引入内部 API 依赖。如实测发现多 stage re-render 是瓶颈（如 3+ 个 stage 同时活跃），再评估引入。

## 已知系统层约束

以下问题属于系统层限制，不在本特性修复范围内，但需知晓：

| 约束 | 影响 | 缓解措施 |
|------|------|----------|
| TanStack Query `setTimeoutZero` 机制 | 每个 stage 的 `setQueryData` 触发独立宏任务 | property tracking 抑制无关通知；可选 `notifyManager.batch()` |
| 虚拟化测量级联 | 每条可见消息在每个 flush 周期产生 2 次 re-render | 优化 `estimateSize`；可选禁用 `useFlushSync` |
| 乐观更新 ID 冲突 | `Date.now()` placeholder ID 与数据库自增 ID 不匹配，短暂显示重复消息 | 预存 bug，`onSettled` refetch 后恢复正确 |

## 与 F20260625bc8d 的关系

本特性是 F20260625bc8d 的延续，解决其未覆盖的前端渲染链路瓶颈。F20260625bc8d 解决了"后端资源"和"批处理框架"问题，本特性解决"批处理内部实现"和"组件渲染"问题。
