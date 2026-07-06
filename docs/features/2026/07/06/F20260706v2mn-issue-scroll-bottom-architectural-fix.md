---
id: F20260706v2mn
title: issue-scroll-bottom-architectural-fix
from_ids: [F20260703k7mr, F20260702n8vx, F20260702k4tp]
tags: [bugfix, frontend, scroll, virtualization, architecture]
modules: [web]
doc_kind: spec
---

# F20260706v2mn [web] 进入 Issue 不显示到对话底部 — 架构层根因修复

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

**特性类型**: bugfix（架构根因修复）
**创建日期**: 2026-07-06
**状态**: 实现完成

## 背景 [required]

用户反馈：进入 issue 界面后页面不显示到对话最下方，感觉还是有空白处。**此问题已反复出现多次**，经历了 9 次提交、7 个 PR、8 个 Feature 文档的修复-回归循环。

### 历史修复时间线

| 时间 | PR | Feature | 操作 | 结果 |
|------|-----|---------|------|------|
| 5/27 | #473 | F2026052705 | 引入虚拟滚动，修改 auto-scroll 条件 | 埋下隐患 |
| 5/28 | #296 | F2026052802 | 修复切换对话停在顶部 | 临时修复 |
| 6/26 | #471 | F20260626sskc | 修复虚拟滚动下 auto-scroll 失效 | 临时修复 |
| 7/2 | #550 | F20260702k4tp | Stage 切换滚动到顶部（误诊） | 引入回归 |
| 7/2 | #555 | F20260702n8vx | 恢复 wasAtBottomRef=true + 添加 paddingEnd | 正确方向但 paddingEnd 本身有缺陷 |
| 7/2 | #558 | F20260702rzzu | 文件拆分丢失 PR #555 修复 | 引入回归 |
| 7/4 | #573 | F20260703k7mr | 恢复 PR #555 的两项修复 | **问题仍然存在** |

### 关键认知

PR #573（最新修复）忠实地恢复了 PR #555 的两项修复：
1. `wasAtBottomRef.current = true`（stage-switch effect）
2. `paddingEnd` 逻辑（usePaddingEnd hook + useVirtualizer 配置）

**但问题仍然存在**，说明 PR #555 的方案本身存在未发现的缺陷。本次分析不再做表面修补，而是从架构层定位根因。

## 溯源与根因分析 [required]

### 当前代码结构

`IssueConversation.tsx` 的滚动容器（`scrollRef` div, line 133）内部包含两类内容：

```
<div ref={scrollRef} className="relative flex-1 overflow-y-auto px-6 py-6">  ← 滚动容器
  <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5">        ← 内容包裹器
    1. Issue header（ID徽章 + 标题 + 摘要）                    ≈80px
    2. Stage tabs（阶段切换按钮）                               ≈40px
    3. Properties grid（Stage/SOP/Created/Closed/Stages）       ≈120px
    4. WS status banner（条件渲染）                              ≈30px
    5. Divider                                                   1px
    --- 以上为"非消息内容"，合计约 270-300px ---
    6. Virtual message list（虚拟滚动消息列表）                   变长
    7. StageSuggestionCard                                       ≈变长
  </div>
</div>
```

### Virtualizer 自带测量修正机制（关键背景）

经 TanStack Virtual v3 源码验证（`@tanstack/virtual-core/dist/esm/index.js`），`scrollToIndex` 调用后会启动 `scheduleScrollReconcile` 协调机制：

1. `scrollToIndex(last, { align: 'end' })` → 滚动到 `getMaxScrollOffset()` → 启动 `reconcileScroll`
2. `reconcileScroll` 通过 `requestAnimationFrame` 循环重新检查目标 offset
3. 如果 `getMaxScrollOffset()` 变化（因 `measureElement` 改变了 `scrollHeight`），重新滚动
4. 连续 1 帧目标不变且 scroll offset 匹配 → 协调完成
5. 5 秒超时兜底（`MAX_RECONCILE_MS = 5e3`）
6. 每次 scroll 事件也会触发 reconcile（line 422-423）

**这意味着 virtualizer 自身能独立处理测量修正周期，不完全依赖 React 的 `useLayoutEffect`。**

### 根因 1（架构层）：非消息内容与虚拟消息列表共用滚动容器

`usePaddingEnd` 计算底部填充时，用 `el.clientHeight`（滚动容器总高度）减去消息估算高度，**未减去非消息内容的高度**：

```typescript
// useChatScroll.ts line 39-40
const rawContentHeight = itemCount * 120;
setPaddingEnd(Math.max(0, el.clientHeight - rawContentHeight));
//                              ↑ 滚动容器总高度，包含非消息内容区域
```

**具体场景**（3 条消息，容器 800px，非消息内容 300px）：

| 计算项 | 当前值 | 正确值 |
|--------|--------|--------|
| `el.clientHeight` | 800px | 800px |
| 非消息内容高度 | （未计入） | 300px |
| 消息估算高度 | 360px (3×120) | 360px |
| `paddingEnd` | **440px** | **140px** |
| 虚拟列表总高度 | 800px (360+440) | 500px (360+140) |
| 滚动内容总高度 | 1100px (300+800) | 800px (300+500) |
| 多余填充 | **300px** | 0px |

多余 300px 的 `paddingEnd` 直接表现为视口底部的空白区域。

### 根因 2（时序层）：handleScroll 在测量修正周期内暂时覆盖 wasAtBottomRef

初始加载时的时序：

1. 消息到达 → `sorted` 变化 → `useLayoutEffect` 触发
2. `wasAtBottomRef.current === true` → 调用 `scrollToIndex(last, { align: 'end' })`
3. **但虚拟列表使用估算高度（120px/条），实际高度可能差异很大**
4. 浏览器触发 scroll 事件 → `handleScroll` 执行
5. `wasAtBottomRef.current = atBottom`（line 93）—— **此行在 `isSmoothScrollingRef` 检查（line 94）之前，无条件执行**
6. 如果估算高度的滚动位置不在底部（`atBottom === false`），`wasAtBottomRef.current` 被覆盖为 `false`
7. `measureElement` 回调测量实际高度 → `totalSize` 变化 → `useLayoutEffect` 再次触发
8. `atBottom || wasAtBottomRef.current` → **均为 `false`** → `useLayoutEffect` 的 `scrollToIndex` 被跳过

**关键澄清（第二轮审视补充）**：步骤 8 中 `useLayoutEffect` 的 `scrollToIndex` 被跳过，**但不影响初始加载的最终滚动位置**。因为 virtualizer 的 `scheduleScrollReconcile` 机制（见上方"Virtualizer 自带测量修正机制"）独立于 `useLayoutEffect`，会持续修正滚动位置直到 `getMaxScrollOffset()` 稳定。

**RC2 的实际影响范围**（修订）：

| 场景 | 是否受 RC2 影响 | 原因 |
|------|----------------|------|
| 初始加载（进入 issue）的最终位置 | **否** | virtualizer 协调机制独立修正 |
| 协调期间（~100ms-5s）新消息到达 | **是**（边缘情况） | `useLayoutEffect` 不调用 `scrollToIndex`，协调仍用旧 index |
| 协调完成后新消息到达（B5） | **否** | 协调完成后 `atBottom = true`，`wasAtBottomRef` 已恢复 |

**结论：RC2 对初始加载的影响是暂时的，不是永久的。用户看到错误位置的根本原因是 RC1+RC3 膨胀了 `getMaxScrollOffset`，virtualizer 忠实地滚动到了"错误的正确位置"。**

### 根因 3（机制层）：paddingEnd 机制在少消息场景下根本无效

经 TanStack Virtual v3 源码验证（`@tanstack/virtual-core/dist/esm/index.js`），`scrollToIndex(last, { align: 'end' })` 对最后一个 item 直接返回 `getMaxScrollOffset()`：

```javascript
// virtual-core getOffsetForIndex (line 958-960)
if (align === "end" && index === this.options.count - 1) {
    return [this.getMaxScrollOffset(), align];
}

// getMaxScrollOffset 使用 DOM 实际值 (line 907-910)
this.getMaxScrollOffset = () => {
    return this.scrollElement.scrollHeight - this.scrollElement.clientHeight;
};
```

`getMaxScrollOffset()` = `scrollHeight - clientHeight`（DOM 实际值）。`scrollHeight` 包含 `paddingEnd`（因为虚拟列表容器 `height: virtualizer.getTotalSize()`，而 `getTotalSize()` 包含 `paddingEnd`）。

**paddingEnd 膨胀了 scrollHeight，导致 `getMaxScrollOffset` 偏大**。virtualizer 的协调机制忠实地将滚动位置修正到 `getMaxScrollOffset()`——但这是一个被 paddingEnd 膨胀的**错误目标**。用户看到的是空白 padding 而非最新消息。

**当消息总高度 < 视口高度时**，即使有 paddingEnd 使 `scrollHeight > clientHeight`，`scrollToIndex(last, { align: 'end' })` 也会滚动到 `getMaxScrollOffset`——即 padding 的最底部。最后一条消息在视口上方，下方全是 padding 空白。

**结论：paddingEnd 在少消息场景下是纯粹的空白制造器，无法实现"最后一条消息显示在视口底部"的目标。**

### 为什么 PR #555 / #573 的修复不够

| 修复项 | PR #555/#573 做了什么 | 为什么不够 |
|--------|----------------------|------------|
| `wasAtBottomRef = true` | 确保进入时触发 auto-scroll | virtualizer 协调机制已处理初始加载修正，此项非关键 |
| `paddingEnd` | 消息少时填充底部 | paddingEnd 本身无效且制造空白（根因 3）；计算未减去非消息内容高度（根因 1） |
| `estimateSize: 120` | 估算消息高度 | virtualizer 协调机制会修正估算偏差，此项非关键 |

**每次"修复"都在症状层面打补丁，从未触及架构根因：非消息内容与虚拟列表共用滚动容器 + paddingEnd 膨胀 `getMaxScrollOffset`。**

## 目标 [required]

1. 进入 issue 时自动滚动到对话最底部，显示最新消息
2. 消息少时不出现大面积空白
3. 彻底消除此问题的反复回归循环——通过架构层修复而非补丁

## 非目标 [required]

- 不改变消息加载、历史翻页、实时更新的行为
- 不改变 PropertiesPanel 的内容和布局
- 不涉及后端 API 变更
- 不重新设计 issue 界面的整体布局（仅调整滚动容器边界）

## 用户意图锚 [required]

| # | 用户原话 | 来源 | 关键修饰语 | 架构师解读 |
|---|----------|------|------------|------------|
| UA-1 | "进入issue界面还是没显示到对话的最下方" | 消息 #3930 | 空间：最下方；时序：进入时；条件：进入issue界面 | 进入 issue 界面的瞬间，视口应定位在对话最底部，显示最新消息 |
| UA-2 | "感觉还是有空白处" | 消息 #3930 | 视觉属性：空白处 | 视口中不应有不合理的空白区域 |
| UA-3 | "这个问题反复好几次了" | 消息 #3930 | 数量：反复好几次 | 修复必须是根因级的，不能再次回归 |
| UA-4 | "先做溯源，然后根因分析，然后给出完整解决方案" | 消息 #3930 | 时序：先...然后...然后 | 用户要求方法论：溯源→根因→完整方案，不接受补丁 |

## 核心业务行为 [required]

| # | 场景 | 预期行为 | 追溯 | 测试覆盖 |
|---|------|----------|------|----------|
| B1 | 当用户点击 issue 进入对话页面时 | 页面自动滚动到对话最底部，显示最新消息，无不合理空白 | ← UA-1, UA-2 | T1, T2 |
| B2 | 当用户在 stage A 中手动切换到 stage B 时 | 页面滚动到 stage B 的底部，显示最新消息 | ← UA-1 | T3 |
| B3 | 当用户通过推进 stage 从 stage A 进入 stage B 时 | 页面滚动到 stage B 的底部，显示最新消息 | ← UA-1 | T3 |
| B4 | 当 stage 消息数量较少（1-3 条）时 | 消息从顶部开始排列，下方紧跟 StageSuggestionCard，无不合理的 paddingEnd 空白 | ← UA-2 | T2 |
| B5 | 当新消息到达且用户在底部时 | 自动跟随滚动到新消息 | | T4 |
| B6 | 当虚拟列表测量修正（estimateSize→实际高度）时 | 滚动位置必须修正到正确位置，不被 handleScroll 中断 | ← UA-3 | T5 |

## 设计 [required]

### 修改点 1：分离非消息内容与滚动容器（根因 1 修复 — 核心修复）

**文件**：`src/web/pages/IssueConversation.tsx`

将 issue header、stage tabs、properties grid、WS status banner、divider 从滚动容器中移出，放入一个 `shrink-0` 的固定区域。滚动容器只保留虚拟消息列表和 StageSuggestionCard。

修改前结构：
```
<div ref={scrollRef} className="relative flex-1 overflow-y-auto px-6 py-6">
  <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5">
    <!-- 非消息内容（~300px）-->
    <!-- 虚拟消息列表 -->
    <!-- StageSuggestionCard -->
  </div>
  <!-- 滚动按钮 -->
</div>
```

修改后结构：
```
<!-- 非消息内容（固定，不随消息滚动）-->
<div className="shrink-0 px-6 pt-6">
  <div className="mx-auto w-full max-w-[1120px]">
    <!-- Issue header -->
    <!-- Stage tabs -->
    <!-- Properties grid -->
    <!-- WS status banner -->
    <!-- Divider -->
  </div>
</div>

<!-- 消息滚动容器（只包含消息和 StageSuggestionCard）-->
<div ref={scrollRef} className="relative flex-1 overflow-y-auto px-6 py-6">
  <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5">
    <!-- 虚拟消息列表 -->
    <!-- StageSuggestionCard -->
  </div>
  <!-- 滚动按钮 -->
</div>
```

> **[D1]** 将非消息内容移出滚动容器。正方：(1) 滚动容器只包含消息和 StageSuggestionCard，`getMaxScrollOffset` 不受非消息内容干扰；(2) 符合主流聊天应用布局模式（header 固定、消息区滚动）；(3) 彻底消除根因 1，避免再次回归。反方：非消息内容不再随消息滚动消失，固定占用约 300px 垂直空间。依据：用户明确要求"进入 issue 时显示到对话最下方"和"不应有空白处"，当前架构使这两个需求无法同时满足。根因 1 是所有历史回归的根本原因，必须从架构层修复。交叉审视共识：方向正确，核心修复。

### 修改点 2：修复 handleScroll 竞态条件（根因 2 修复 — defense-in-depth 安全网）

**文件**：`src/web/hooks/useChatScroll.ts`

**定位**（第二轮审视修订）：MP2 是 defense-in-depth 安全网，不是核心修复。初始加载的正确性由 MP1+MP3 修复 `getMaxScrollOffset` + virtualizer 协调机制共同保证。MP2 的价值是：(1) 消除协调期间短暂的 `wasAtBottomRef` 覆盖窗口；(2) 确保 B5（新消息 auto-scroll）在边缘情况下不被跳过；(3) 作为安全网防止未来 virtualizer 协调机制变化时的回归。

**问题**：`handleScroll` 中 `wasAtBottomRef.current = atBottom`（line 93）在 `isSmoothScrollingRef.current` 检查（line 94）之前执行，且 `isSmoothScrollingRef` 不覆盖即时 `scrollToIndex`。

**修复方案：引入 `isInitialScrollRef` + `totalSize` 稳定检测 + 超时兜底**

1. 新增 `isInitialScrollRef`，在 stage-switch effect 中设为 `true`（与 `wasAtBottomRef.current = true` 同时）
2. 在 `useLayoutEffect` 中，如果 `isInitialScrollRef.current === true`，无条件调用 `scrollToIndex`（不依赖 `wasAtBottomRef`），并检测 `totalSize` 是否稳定
3. **`totalSize` 稳定定义**：连续两次 `useLayoutEffect` 触发之间 `totalSize` 变化 < 1px。稳定后 `isInitialScrollRef.current = false`，退出初始模式
4. **超时兜底（设计约束，非可选缓解）**：`isInitialScrollRef` 必须有超时兜底（建议 500ms），确保即使 `totalSize` 不变化（如 virtualizer 缓存了测量值，无第二次 `useLayoutEffect` 触发）也能退出初始模式。超时后 `handleScroll` 恢复正常工作
5. `handleScroll` 中，如果 `isInitialScrollRef.current === true` 或 `isSmoothScrollingRef.current === true`，提前返回，不更新 `wasAtBottomRef`
6. 同时将 `wasAtBottomRef.current = atBottom` 移到 `isSmoothScrollingRef` 检查之后（修复平滑滚动期间也被覆盖的问题）

**约束**：
- 初始模式覆盖从首次 `scrollToIndex` 到 `totalSize` 稳定的完整周期，包括多轮 `measureElement` → `totalSize` 变化 → 修正 `scrollToIndex` 的循环
- 超时兜底确保 `isInitialScrollRef` 不会永久卡在 `true`（退出死角）
- 初始模式结束后，`handleScroll` 恢复正常工作，包括更新 `wasAtBottomRef`
- 不得影响用户手动滚动时的 `wasAtBottomRef` 更新

> **[D2]** 修复 handleScroll 竞态条件，采用 `isInitialScrollRef` + `totalSize` 稳定检测 + 超时兜底。正方：(1) 消除协调期间的 `wasAtBottomRef` 覆盖窗口；(2) 确保 B5 边缘情况不被跳过；(3) defense-in-depth 防止未来 virtualizer 协调机制变化时的回归。反方：增加 `isInitialScrollRef` 状态管理。依据：UA-3 要求"不能再次回归"。交叉审视共识：必要且有退出死角防护，定位修订为安全网。

### 修改点 3：移除 paddingEnd 机制（根因 3 修复 — 核心修复）

**文件**：`src/web/hooks/useChatScroll.ts`

**移除内容**：
- `usePaddingEnd` 函数（lines 17-44）
- `paddingEnd` 状态和 `containerHeight` 状态
- ResizeObserver 逻辑
- `useVirtualizer` 配置中的 `paddingEnd` 参数

**移除理由**（经 TanStack Virtual 源码验证）：

`scrollToIndex(last, { align: 'end' })` 对最后一个 item 直接返回 `getMaxScrollOffset() = scrollHeight - clientHeight`。`paddingEnd` 膨胀了 `scrollHeight`，导致 virtualizer 协调机制将滚动位置修正到 padding 区域底部而非最后一条消息处。

**移除后效果验证**（第二轮审视确认）：

| 场景 | 有 paddingEnd | 无 paddingEnd |
|------|---------------|---------------|
| 少消息（总高 < 视口） | 滚动到 padding 底部，消息在视口外 | `getMaxScrollOffset` 可能 > 0（因 StageSuggestionCard + gap），滚动到内容底部，消息大部分可见 |
| 多消息（总高 > 视口） | paddingEnd = 0，无影响 | 同左，`scrollToIndex` 正常滚动到底部 |

**少消息场景详细计算**（MP1+MP3 后，3 条消息，滚动容器 500px）：
- 虚拟列表容器高度 = 360px（仅消息，无 paddingEnd）
- `scrollHeight` = 24(py-6 top) + 360(messages) + 20(gap) + 100(card) + 24(py-6 bottom) = 528px
- `getMaxScrollOffset` = 528 - 500 = 28px
- `scrollToIndex(last, { align: 'end' })` → scrollTop = 28px
- 视口显示：消息（大部分）+ StageSuggestionCard + 少量 padding
- **正确** ✓

> **[D3]** 移除 paddingEnd 机制。正方：(1) paddingEnd 在少消息场景下根本无效（源码验证），是空白制造器；(2) 消除 usePaddingEnd hook、ResizeObserver、containerHeight state，简化代码；(3) paddingEnd 是多次回归的来源，移除后减少回归面。反方：无（paddingEnd 无法实现其设计目标"消息显示在底部"，移除无功能损失）。依据：TanStack Virtual 源码验证 + 两轮交叉审视。交叉审视共识：移除正确，核心修复。

## 生效路径 [required]

- 代码：`src/web/pages/IssueConversation.tsx`（布局结构调整）、`src/web/hooks/useChatScroll.ts`（竞态条件修复 + 移除 paddingEnd）
- 无配置变更、无 API 变更、无提示词变更

## 设计约束摘要 [required]

### 硬约束（违反即 bug）
- 进入 issue 时（组件首次挂载）必须滚动到底部 ← UA-1
- stage 切换时必须滚动到底部 ← UA-1
- 消息少时不得出现 paddingEnd 产生的空白 ← UA-2
- `isInitialScrollRef` 必须有超时兜底（≤ 500ms），防止退出死角
- 滚动容器内不得包含非虚拟化的固定内容（根因 1 的语义不变量）
- 不得使用 paddingEnd 机制（根因 3 的语义不变量）

### 语义不变量（实现中必须保持为真）
- `wasAtBottomRef.current` 在初始滚动模式（`isInitialScrollRef.current === true`）期间不被 `handleScroll` 覆盖
- `wasAtBottomRef.current === true` 当且仅当需要自动滚动到底部
- `isInitialScrollRef.current === false` 当且仅当 `totalSize` 已稳定（连续两次变化 < 1px）或超时兜底已触发
- 滚动容器内只包含虚拟消息列表和 StageSuggestionCard

### 非目标（不得扩展）
- 不重新设计 issue 界面布局
- 不引入新的滚动状态管理机制（`isInitialScrollRef` 是最小必要补充）
- 不改变 `useMessages` 的职责
- 不改变 PropertiesPanel

<!-- [design-time] 章节结束 -->

## 改动范围 [required]

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/web/pages/IssueConversation.tsx` | 修改 | 将非消息内容从滚动容器移出到 `shrink-0` 固定区域 |
| `src/web/hooks/useChatScroll.ts` | 修改 | 移除 usePaddingEnd hook 及相关状态；新增 isInitialScrollRef + totalSize 稳定检测 + 超时兜底；修复 handleScroll 中 wasAtBottomRef 更新顺序 |

## 验证 [required]

### P1 手动验证
- [ ] 进入 issue 时，页面自动滚动到对话底部，显示最新消息
- [ ] 进入 issue 时，视口无不合理空白区域
- [ ] 在 stage A 手动切换到 stage B 时，页面滚动到 stage B 的底部
- [ ] 通过推进 stage 进入新 stage 时，页面滚动到新 stage 的底部
- [ ] 新 stage 消息少（1-3 条）时无 paddingEnd 空白，消息从顶部排列
- [ ] 新消息到达时，如果用户在底部，自动跟随滚动
- [ ] 点击"回到底部"按钮，页面滚动到最新消息
- [ ] 消息高度差异大（短系统消息 + 长 assistant 消息）时，进入 issue 滚动位置正确

### 自动化测试（防回归）

此问题已回归 7 次，必须补充自动化测试防止再次回归。测试应以行为验证为主，不耦合实现细节：

| # | 测试 | 断言（行为级） |
|---|------|----------------|
| T1 | 初始加载后滚动位置 | `scrollTop + clientHeight >= scrollHeight - SCROLL_THRESHOLD`（最新消息可见） |
| T2 | 少消息场景无 padding 空白 | 少消息时虚拟列表容器高度 ≈ 消息总高度（误差 < 10px），无额外 padding 空间 |
| T3 | stage 切换后滚动到底部 | 切换 stage 后 `scrollTop + clientHeight >= scrollHeight - SCROLL_THRESHOLD` |
| T4 | 新消息到达时 auto-scroll | 用户在底部时新消息到达后 `scrollTop + clientHeight >= scrollHeight - SCROLL_THRESHOLD` |
| T5 | 混合高度消息初始加载 | 不同高度消息混合场景下，初始加载后 `scrollTop + clientHeight >= scrollHeight - SCROLL_THRESHOLD` |

### 通用
- [ ] `npm run check` 通过

## 关联 [required]

- **前序修复**: F20260703k7mr（PR #573 — 恢复 PR #555 修复，问题仍存在）
- **原始 paddingEnd 方案**: F20260702n8vx（PR #555 — 正确方向但 paddingEnd 本身有缺陷）
- **回归引入**: F20260702k4tp（PR #550 — 误诊为滚动到顶部问题）
- **文件拆分回归**: F20260702rzzu（PR #558 — 丢失 PR #555 修复）
- **交叉审视第一轮**: 架构师-2 独立验证三个根因，提出 5 个发现（paddingEnd 残留误差、paddingEnd 根本无效性、测量周期定义、意图锚消息 ID、自动化测试），全部整合
- **交叉审视第二轮**: 架构师-2 发现 virtualizer `scheduleScrollReconcile` 协调机制，修订 RC2 影响范围，提出 MP2 退出死角和超时兜底约束，建议 T2/T5 改为行为测试，全部整合

## 关键决策记录 [required]

| # | 决策点 | 最终决策 | 正方 | 反方 | 状态 |
|---|--------|----------|------|------|------|
| D1 | 非消息内容是否移出滚动容器 | 移出 | 消除根因 1，getMaxScrollOffset 不受干扰，符合主流聊天应用模式 | 非消息内容固定占位约 300px | 交叉审视共识（两轮） |
| D2 | handleScroll 竞态条件修复方案 | isInitialScrollRef + totalSize 稳定检测 + 超时兜底（500ms） | 消除协调期间覆盖窗口，defense-in-depth | 增加 isInitialScrollRef 状态管理 | 交叉审视共识（两轮），定位修订为安全网 |
| D3 | paddingEnd 机制去留 | 移除 | paddingEnd 在少消息场景根本无效（源码验证），是空白制造器，移除后简化代码 | 无（paddingEnd 无法实现设计目标） | 交叉审视共识（两轮） |
| D4 | paddingEnd 移除后少消息布局 | 消息从顶部排列，下方紧跟 StageSuggestionCard | 简洁，无多余空白；符合主流聊天应用行为 | 消息不在底部（贴近输入框） | 交叉审视共识。UA-1 的"最下方"指最新消息可见，少消息时所有消息都可见，不冲突 |

## 风险与缓解 [required]

| # | 风险 | 严重程度 | 影响 | 缓解策略 | 负责方 |
|---|------|----------|------|----------|--------|
| R1 | 非消息内容移出后，消息区域减少约 300px | 中 | 小屏幕上消息可视区域变小 | 非消息内容已是必要信息（header/tabs/properties），固定展示符合预期；如需优化可后续折叠 | 架构师 |
| R2 | totalSize 稳定检测在极端情况下不收敛 | 低 | isInitialScrollRef 卡在 true，handleScroll 被永久抑制 | **超时兜底（500ms）已提升为设计约束**，确保即使 totalSize 不变化也能退出 | 架构师 |
| R3 | 非消息内容移出后视觉布局变化 | 低 | 用户感知到 header 不再随消息滚动 | 属预期行为变化，符合主流聊天应用模式 | 架构师 |
| R4 | 移除 paddingEnd 后少消息时消息在顶部 | 低 | 用户可能期望消息在底部（贴近输入框） | UA-1 的"最下方"指最新消息可见；主流聊天应用新频道也是顶部对齐；StageSuggestionCard 紧随消息提供视觉填充 | 架构师 |
