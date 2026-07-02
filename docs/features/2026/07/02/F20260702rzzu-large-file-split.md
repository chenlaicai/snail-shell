---
id: F20260702rzzu
title: 超大文件拆分：collaboration.ts / ChatMessage.tsx / IssueConversation.tsx
from_ids: []
tags: [refactor, code-health, large-file-split]
---

# F20260702rzzu — 超大文件拆分：collaboration.ts / ChatMessage.tsx / IssueConversation.tsx

## 背景

Issue #547 代码健康检视报告 F-4 指出三个超大文件需要拆分：

| 文件 | 当前行数 | 问题 |
|------|---------|------|
| `src/app/issue-collaboration/collaboration.ts` | 618 | `IssueCollaboration` 类承载了信号解析、系统提示构建、dispatch 等多个职责 |
| `src/web/components/ChatMessage.tsx` | 594 | 消息气泡、事件时间线、工具调用解析、定时器 hook 全部挤在一个文件 |
| `src/web/pages/IssueConversation.tsx` | 456 | 页面组件内嵌 4 个自定义 hook 的完整逻辑 + 10 个子组件渲染 |

## 设计目标

1. **大幅缩减文件行数**：前端文件 < 340 行，后端文件 < 500 行（collaboration.ts 因提取量有限，降至 ~489 行；如需进一步拆分需提取更多方法）
2. **遵循已建立的拆分模式**：后端用 deps 接口 + 构造函数注入，前端用独立 hook / 子组件文件
3. **零行为变更**：纯结构重构，所有测试必须原样通过
4. **不引入新抽象层**：只做物理拆分，不改变模块间的调用关系

## 不兼容更新

无。纯内部结构重构，所有公开 API（`IssueCollaboration` 类、`ChatMessage` 组件、`IssueConversation` 页面）签名不变。

---

## Part 1: collaboration.ts 拆分

### 当前状态

`IssueCollaboration` 类（618 行）已提取 6 个模块（auto-advance、consumer-notifier、helpers、message-handler、resource-cleanup、startup-recovery），但仍有以下职责耦合在主类中：

| 职责 | 行数 | 纯度 |
|------|------|------|
| 阶段转换信号解析（`detectStageTransition` + `extractStageTransitionSuggestion` 系列） | ~66 | 中：8 个方法中 3 个纯函数、2 个半纯（仅调用其他方法）、3 个有副作用 |
| 系统提示构建（`buildSystemReminder` + `buildContextBlock` + `extractTerminalContext`） | ~63 | 高：纯文本拼接 |
| Dispatch / Agent 调用（`dispatch` + `invokeAgent` 系列） | ~140 | 中：依赖多个 this 字段 |
| 其他（生命周期、消费者管理、路由等） | ~288 | — |

### 提取方案

#### 1a: `StageTransitionSignalParser`（新增 `_internal/signal-parser.ts`，~130 行含辅助方法）

**提取内容**（核心解析 8 方法 ~66 行 + 辅助 4 方法 ~26 行 + import/接口 ~38 行 ≈ ~130 行）：
- `detectStageTransition`（入口方法，含 L1 信号拦截逻辑，访问 this.suggestions/this.autoAdvanceEngine）
- `extractStageTransitionSuggestion`（半纯，访问 this.deps.messagePort）
- `extractSignalPayload`（半纯，仅调用其他方法）
- `extractFromSignalPayload`（半纯，仅调用其他方法）
- `extractFromTextPayload`（半纯，仅调用其他方法）
- `buildTransitionPayload`（纯函数）
- `makeStageTransitionSuggestion`（纯函数）
- `tryParseStageTransition`（纯函数）
- `recordAuditTrail`（辅助，~3 行）
- `generateDisagreementCard`（辅助，~4 行）
- `persistSuggestion` / `restoreSuggestions`（辅助，~19 行）

**Deps 接口**：
```typescript
export interface SignalParserDeps {
  messagePort: Pick<MessagePort, "getMessageEvents">;
  stageSuggestionRepo: StageSuggestionRepository;
  notifyConsumers(stageId: string, method: string, ...args: unknown[]): Promise<void>;
  autoAdvanceEngine: Pick<AutoAdvanceEngine, "evaluate">;
}
```

**理由**：信号解析是 `IssueCollaboration` 中最大的逻辑块（核心 66 行 + 辅助 26 行）。8 个核心方法中 3 个是无副作用纯函数，2 个半纯（仅调用链内方法），3 个有副作用（访问 suggestions map 或 autoAdvanceEngine）。提取后主类减少 ~130 行（含辅助方法和 import），信号解析逻辑可独立测试。

#### 1b: `SystemPromptBuilder`（新增 `_internal/system-prompt-builder.ts`，~60 行）

**提取内容**：
- `buildSystemReminder`
- `buildContextBlock`
- `extractTerminalContext`

**Deps 接口**：
```typescript
export interface SystemPromptBuilderDeps {
  messagePort: Pick<MessagePort, "getMessageEvents" | "getContext">;
  snailPort: Pick<SnailPort, "findByKey">;
}
```

**注意**：`extractTerminalContext` 依赖 `this.deps.messagePort.getContext` 和 `this.deps.messagePort.getMessageEvents`；`buildSystemReminder` 依赖 `this.deps.snailPort.findByKey`。`buildContextBlock` 是纯函数，不依赖任何 deps。此外，`extractBlocksFallback`（第 24-30 行，独立纯函数）需随 `extractTerminalContext` 一起移入新文件。

**理由**：这三个方法是纯文本拼接，零副作用，零对类状态的依赖。提取后主类减少 ~60 行。

#### 不提取的部分

- **Dispatch / Agent 调用**（~140 行）：虽然行数多，但耦合度高——依赖 `this.deps`、`this.helpers`、`this.messageHandler`、`this.activeInvocations`、`this.dispatchStates`、`this.notifyConsumers`、`this.buildSystemReminder`、`this.resolveReplies`、`this.extractTerminalContext`、`this.detectStageTransition`。提取需要传递 10+ 个依赖，收益不高。保留为优先级最低的后续优化。
- **ConsumerRegistry**（~12 行）：太小，不值得独立文件。

### 拆分后预期

`IssueCollaboration` 类从 618 行降至 ~489 行（信号解析 66 + 系统提示 63 = 129 行提取量）。

---

## Part 2: ChatMessage.tsx 拆分

### 当前状态

| 职责 | 行数 |
|------|------|
| `ChatMessageInner` + `ChatMessage` memo（消息气泡核心） | ~280 |
| `EventStream` + `EventItem` 子组件（事件时间线渲染） | ~180 |
| 工具调用解析工具函数（`deriveToolCallSummary` 等 4 个） | ~80 |
| `useLiveTimer` hook | ~23 |
| `extractContextUsage` 工具函数 | ~19 |
| 常量 + imports | ~12 |

### 提取方案

#### 2a: `EventTimeline`（新增 `EventTimeline.tsx`，~260 行）

**提取内容**：
- `EventStream` 组件
- `EventItem` 组件
- `truncateText`、`deriveToolCallSummary`、`extractFirstStringValue`、`parseMcpToolName` 工具函数

**接口**：`EventStream` 和 `EventItem` 已经通过 props 接收所有数据，零对 `ChatMessageInner` 的依赖。提取是纯物理移动。

**理由**：事件时间线是独立的 UI 关注点，与消息气泡渲染无循环依赖。这是最大的单一提取块（~260 行），将 `ChatMessage.tsx` 从 594 行降至 ~334 行。

#### 2b: `useLiveTimer`（新增 `hooks/useLiveTimer.ts`，~25 行）

**提取内容**：`useLiveTimer` hook

**理由**：独立 hook，仅依赖 React hooks 和 `MessageDto` 类型。虽然只有 23 行，但提取到 hooks 目录符合项目惯例（已有 `useWebSocket`、`useMention` 等）。

### 拆分后预期

`ChatMessage.tsx` 从 594 行降至 ~334 行。

---

## Part 3: IssueConversation.tsx 拆分

### 当前状态

页面组件内嵌了 4 个自定义 hook 的完整逻辑（数据获取、消息管理、滚动控制、消息操作）和 10 个子组件的渲染逻辑。

| 职责 | 行数 |
|------|------|
| `useChatScroll` 逻辑（虚拟化 + 滚动管理） | ~100 |
| `useMessages` 逻辑（消息查询 + 历史加载 + 排序去重） | ~70 |
| `useIssueData` 逻辑（issue/workspace 查询 + stage 派生） | ~30 |
| `useMessageActions` 逻辑（发送/重试/中断） | ~40 |
| 渲染逻辑（10 个子区域） | ~180 |
| 其他（imports、常量、loading/error 状态） | ~36 |

### 提取方案

#### 3a: `useChatScroll`（新增 `hooks/useChatScroll.ts`，~105 行）

**提取内容**：
- `scrollRef`、`wasAtBottomRef`、`isSmoothScrollingRef` refs
- `scrollPosition` state
- `useVirtualizer` setup
- auto-scroll-to-bottom `useLayoutEffect`
- `loadMoreHistory` 回调（含 cursor 分页 + 滚动位置保持）
- `handleScroll` 回调（含顶部历史加载触发）
- `scrollToTop` / `scrollToBottom` 回调

**接口**：
```typescript
interface UseChatScrollOptions {
  sorted: MessageDto[];
  stageId: string;
  setOlderHistory: (msgs: MessageDto[]) => void;
  isLoadingHistoryRef: React.MutableRefObject<boolean>;
  allHistoryLoadedRef: React.MutableRefObject<boolean>;
}
```

**理由**：滚动管理是 `IssueConversation.tsx` 中最大的单一逻辑块（~87 行），与数据获取逻辑在职责上正交。

**Stage 切换滚动重置**：原 `useMessages` 的 stage 切换 effect 中包含 `wasAtBottomRef.current = false` 和 `scrollRef.current.scrollTop = 0`，这属于滚动职责。提取后将此逻辑移入 `useChatScroll`，以 `stageId` 为 effect 依赖自行处理。这样 `useMessages` 不再需要访问 scroll refs，消除双向依赖。

#### 3b: `useMessages`（新增 `hooks/useMessages.ts`，~75 行）

**提取内容**：
- 消息 `useQuery`（含 pending message merge 的 `select` 函数）
- `olderHistory` state + 相关 refs
- stage 切换时的历史重置 `useEffect`
- `sorted` memo（反转 + 历史合并 + 去重）

**接口**：
```typescript
interface UseMessagesOptions {
  stageId: string;
}
// Returns: { sorted, olderHistory, setOlderHistory, isLoadingHistoryRef, allHistoryLoadedRef, messagesQuery }
// 注意：stage 切换的滚动重置（wasAtBottomRef + scrollRef.scrollTop）已移入 useChatScroll，
// useMessages 的 stage 切换 effect 仅负责数据清理（clearPendingMessages + setOlderHistory([]) + allHistoryLoadedRef 重置）
```

**理由**：消息管理是第二大的逻辑块，包含复杂的 pending message merge 逻辑，值得独立模块化。

### 不提取的部分

- **`useIssueData`**（~30 行）：太小，提取反而增加间接性
- **`useMessageActions`**（~40 行）：同上
- **子组件**（`IssueHeader`、`IssuePropertiesGrid` 等）：虽然分析报告建议了 6 个子组件，但每个只有 10-25 行，提取后会创建大量微文件，增加导航成本。当前渲染逻辑已经通过缩进和注释分块清晰，不需要物理拆分。

### 拆分后预期

`IssueConversation.tsx` 从 456 行降至 ~280 行。

---

## 汇总

| 文件 | 拆分前 | 拆分后 | 减少 |
|------|--------|--------|------|
| `collaboration.ts` | 618 | 497 | 121 行 |
| `ChatMessage.tsx` | 594 | 318 | 276 行 |
| `IssueConversation.tsx` | 456 | 284 | 172 行 |
| **总计** | **1668** | **1099** | **569 行** |

新增文件：

| 文件 | 实际行数 | 来源 |
|------|---------|------|
| `_internal/signal-parser.ts` | 113 | collaboration.ts |
| `_internal/system-prompt-builder.ts` | 96 | collaboration.ts |
| `EventTimeline.tsx` | 252 | ChatMessage.tsx |
| `hooks/useLiveTimer.ts` | 30 | ChatMessage.tsx |
| `hooks/useChatScroll.ts` | 85 | IssueConversation.tsx |
| `hooks/useMessages.ts` | 89 | IssueConversation.tsx |

## 核心业务行为

本次为纯结构重构，不改变任何业务行为。所有现有行为规格保持不变。

## 验收标准

| AC | 验证命令 | 预期结果 |
|----|---------|---------|
| AC-1 | `wc -l src/app/issue-collaboration/collaboration.ts` | < 500 |
| AC-2 | `wc -l src/web/components/ChatMessage.tsx` | < 340 |
| AC-3 | `wc -l src/web/pages/IssueConversation.tsx` | < 290 |
| AC-4 | `npm run check` | lint 0 error, tsc 0 error, build 成功 |
| AC-5 | `npm run test` | 全部通过，无回归 |
| AC-6 | `grep -r "export class IssueCollaboration" src/app/issue-collaboration/collaboration.ts` | 1 结果（主类仍在原文件） |
| AC-7 | `grep -r "export const ChatMessage" src/web/components/ChatMessage.tsx` | 1 结果（主组件仍在原文件） |
| AC-8 | `grep -r "export function IssueConversation" src/web/pages/IssueConversation.tsx` | 1 结果（页面组件仍在原文件） |

## 决策记录

### DR-1: useChatScroll/useMessages 双向依赖解决

**问题**：原代码中 stage 切换 effect（`useMessages` 逻辑）同时执行数据清理和滚动重置（`wasAtBottomRef.current = false`、`scrollRef.current.scrollTop = 0`），而 scroll refs 归属于滚动管理职责。

**方案对比**：
| 方案 | 描述 | 优劣 |
|------|------|------|
| A（采用） | 将 stage 切换滚动重置移入 `useChatScroll` | 单向依赖，职责内聚 |
| B | `UseMessagesOptions` 接收 scrollRef/wasAtBottomRef 参数 | 双向依赖，接口复杂化 |
| C | 提升 refs 到父组件 | 过度工程，两个 hook 都需外部传入 |

**决策**：采用方案 A。`useChatScroll` 以 `stageId` 为 effect 依赖，自行重置 `wasAtBottomRef` 和 `scrollRef.scrollTop`。`useMessages` 仅负责数据清理。

### DR-2: collaboration.ts 拆分行数预期修正

**问题**：原始设计预期拆分后 ~428 行，实际可提取方法体仅 129 行（信号解析 66 + 系统提示 63）。

**决策**：修正预期为 ~489 行。AC-1 阈值放宽至 <500 行。如未来需要进一步降至 <400 行，可提取 `resolveToSpeakers`/`resolveMentions`/`extractMentions`（~36 行）和 `resolveReplies`（~17 行）。

## 实现指引

1. **先做 Part 2（ChatMessage.tsx）**：前端拆分最简单，`EventTimeline` 是纯物理移动，零依赖变更。可以快速验证拆分模式。
2. **再做 Part 3（IssueConversation.tsx）**：hook 提取需要处理参数传递，但逻辑清晰。
3. **最后做 Part 1（collaboration.ts）**：后端拆分需要定义 deps 接口、修改构造函数注入链，是最复杂的部分。
4. **每个 Part 独立可验证**：每完成一个 Part 就运行 `npm run check && npm run test`，确保中间状态不破坏构建。
