---
id: F20260707q3kz
title: issue-conversation-scroll-blank-space-fix
from_ids: [F20260706v2mn, F20260707mgdt, F20260701w8ey]
tags: [bugfix, frontend, scroll, virtualization, architecture]
modules: [web]
doc_kind: spec
---

# F20260707q3kz [web] Issue 对话界面滚动空白 — StageSuggestionCard 移出滚动容器

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

**特性类型**: bugfix（架构根因修复）
**创建日期**: 2026-07-07
**状态**: 设计锁定

## 背景 [required]

### 已完成项

用户请求的两项优化中，**properties grid 移除已在 PR #589 (F20260707mgdt) 完成**。

### 未解决项

用户反馈：进入 issue 对话界面时，最新消息下方有大片空白。**此问题已反复出现 9+ 次**，经历 7 个 PR、8 个 Feature 文档的修复-回归循环。最近一次修复 F20260706v2mn (PR #583) 识别了三个根因并分别用 MP1/MP2/MP3 修复，但问题仍然存在。

用户明确表示："其实很早之前是没有问题的，然后后来出了问题变成不显示最底部"（消息 #4240）。"很早之前"指的是 F20260701w8ey（7月1日）之前——那时 StageSuggestionCard 不在滚动容器底部。

### MP1 的不完整性

F20260706v2mn 的 MP1 将 issue header、stage tabs、properties grid、WS status banner 从滚动容器移出到 `shrink-0` 固定区域。**但 StageSuggestionCard 被留在滚动容器内**。

F20260706v2mn 自身确立的语义不变量声明：

> "滚动容器内不得包含非虚拟化的固定内容（根因 1 的语义不变量）"

StageSuggestionCard 正是"非虚拟化的固定内容"。MP1 修复了大部分非消息内容，但遗漏了 StageSuggestionCard。

## 溯源与根因分析 [required]

### 根因：StageSuggestionCard 在滚动容器内导致 scrollToIndex 过冲

经 F20260706v2mn 引用的 TanStack Virtual v3 源码验证：

```javascript
// virtual-core getOffsetForIndex (line 958-960)
if (align === "end" && index === this.options.count - 1) {
    return [this.getMaxScrollOffset(), align];
}

// getMaxScrollOffset (line 907-910)
this.getMaxScrollOffset = () => {
    return this.scrollElement.scrollHeight - this.scrollElement.clientHeight;
};
```

`scrollToIndex(last, { align: 'end' })` 对最后一个 item 直接返回 `getMaxScrollOffset()` = `scrollHeight - clientHeight`。这是**滚动容器的最大滚动偏移**，不是最后一条消息的位置。

**F20260701w8ey（7月1日）将 StageSuggestionCard 移入滚动容器底部**，此后 `scrollHeight` 包含 card 高度，`getMaxScrollOffset()` 过冲：

| 计算项 | 无 card（7月1日前） | 有 card（当前） |
|--------|---------------------|-----------------|
| `scrollHeight` | `totalSize + 48` (padding) | `totalSize + 48 + 20 (gap) + ~100 (card)` |
| `getMaxScrollOffset()` | `totalSize - clientHeight + 48` | `totalSize - clientHeight + 168` |
| 最后消息 end 位置 | `24 + totalSize` | `24 + totalSize` |
| 视口底部到最后消息距离 | 24px (padding) | **~144px** (gap + card + padding) |

**有 card 时，`scrollToIndex` 滚动到 `getMaxScrollOffset()`，视口底部在 card 下方，最后一条消息距视口底部约 144px。** 这就是用户看到的"最新消息下有一大片空白"。

### 交叉审视修正

架构师-2 交叉审视确认 RC4 成立，并指出最初分析的"根因 5"（card 异步加载导致 wasAtBottomRef 覆盖）不成立——初始滚动模式下 `handleScroll` 被阻断，`wasAtBottomRef` 不会被覆盖。用户看到的空白是 RC4（`scrollToIndex` 过冲），不是异步加载导致 auto-scroll 失效。RC5 已删除。

## 目标 [required]

1. 进入 issue 时自动滚动到对话最底部，最新消息显示在视口底部附近（标准聊天行为，如微信）
2. 彻底消除 StageSuggestionCard 对滚动计算的干扰
3. StageSuggestionCard 不渲染时不占位——无空白残留
4. 完结 MP1 的语义不变量：滚动容器内只包含虚拟化内容

## 非目标 [required]

- 不改变 StageSuggestionCard 的功能逻辑（API 调用、状态管理、显示条件）
- 不改变消息加载、历史翻页、实时更新的行为
- 不改变消息排列方式（消息从顶部自然排列，不做底部对齐等布局操纵）
- 不涉及后端 API 变更

## 用户意图锚 [required]

| # | 用户原话 | 来源 | 关键修饰语 | 架构师解读 |
|---|----------|------|------------|------------|
| UA-1 | "移除中间栏上方的 表格" | 消息 #4202 | 空间：中间栏上方；动作：移除 | 移除 properties grid（**已完成于 PR #589**） |
| UA-2 | "还是并没有展示最新消息" | 消息 #4202 | 条件：进入 issue 时；预期：展示最新消息 | 进入 issue 对话界面时，最新消息应可见 |
| UA-3 | "还是在最新消息下有一大片的空白" | 消息 #4202 | 空间：最新消息下；视觉属性：一大片空白 | 最新消息下方不应有大面积空白 |
| UA-4 | "这个问题反反复复好几次了" | 消息 #4202 | 数量：反反复复好几次 | 必须根因级修复，不能再次回归 |
| UA-5 | "理论上不应该填充任何空白呀，消息到哪就是哪" | 消息 #4238 | 条件：理论上；动作：不填充空白；语义：消息到哪就是哪 | 不添加任何人工空白，不操纵消息布局，消息自然排列 |
| UA-6 | "其实我要的效果就是最普通的最常见的最新消息展示机制，比如说微信这种" | 消息 #4240 | 类比：微信；程度：最普通、最常见 | 标准聊天应用的滚动到底部行为 |
| UA-7 | "很早之前是没有问题的，然后后来出了问题变成不显示最底部" | 消息 #4240 | 时序：很早之前→后来；状态：没问题→有问题 | 问题是由某次变更引入的，不是原生问题 |
| UA-8 | "这个suggestioncard是临时出现的，比如切换issue后就自动消失了，这个能力还是有的吧" | 消息 #4248 | 时序：临时出现；条件：切换issue后自动消失 | StageSuggestionCard 的条件渲染行为必须保留 |
| UA-9 | "当没有suggestion card时，你不能还留一大片空白在那占位呀" | 消息 #4248 | 条件：没有card时；禁止：留空白占位 | card 不渲染时不得有空白占位 |

## 核心业务行为 [required]

| # | 场景 | 预期行为 | 追溯 | 测试覆盖 |
|---|------|----------|------|----------|
| B1 | 当用户点击 issue 进入对话页面时 | 页面自动滚动到对话最底部，最新消息显示在视口底部附近（标准聊天行为） | ← UA-2, UA-3, UA-6 | T1 |
| B2 | 当用户切换 stage 时 | 页面滚动到新 stage 的底部 | ← UA-2 | T3 |
| B3 | 当 StageSuggestionCard 渲染时 | card 在滚动容器外显示，不影响滚动位置 | ← UA-3 | T5 |
| B4 | 当 StageSuggestionCard 不渲染时（无 suggestion / 已确认 / 已忽略 / 切换 issue） | card 区域完全收起，无空白占位 | ← UA-8, UA-9 | T5 |
| B5 | 当新消息到达且用户在底部时 | 自动跟随滚动到新消息 | | T4 |
| B6 | 消息排列方式 | 消息从顶部自然排列，不添加人工空白，不做底部对齐 | ← UA-5 | — |

## 设计 [required]

### 修改点 1：将 StageSuggestionCard 移出滚动容器

**文件**：`src/web/pages/IssueConversation.tsx`

将 StageSuggestionCard 从滚动容器内移出，放到滚动容器与输入区域之间。条件渲染——有 suggestion 时显示并占位，无 suggestion 时完全不渲染（无空白残留）。

修改前结构：
```
<div className="shrink-0 px-6 pt-6">  ← 固定区域（header + tabs）
  ...
</div>

<div ref={scrollRef} className="relative flex-1 overflow-y-auto px-6 py-6">  ← 滚动容器
  <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5">
    <div style={{ height: virtualizer.getTotalSize() }}>  ← 虚拟消息列表
      ...
    </div>
    <StageSuggestionCard />  ← 非虚拟化内容，影响 scrollToIndex
  </div>
  <!-- 滚动按钮 -->
</div>

<div className="shrink-0 px-6 pb-8 pt-4">  ← 输入区域
  ...
</div>
```

修改后结构：
```
<div className="shrink-0 px-6 pt-6">  ← 固定区域（header + tabs）
  ...
</div>

<div ref={scrollRef} className="relative flex-1 overflow-y-auto px-6 py-6">  ← 滚动容器（纯虚拟化内容）
  <div className="mx-auto w-full max-w-[1120px]">
    <div style={{ height: virtualizer.getTotalSize() }}>  ← 虚拟消息列表
      ...
    </div>
  </div>
  <!-- 滚动按钮 -->
</div>

{/* StageSuggestionCard — 固定区域，不在滚动容器内 */}
{/* 组件 return null 时无 DOM 产出，自然不占位 */}
<StageSuggestionCard ... />

<div className="shrink-0 px-6 pb-8 pt-4">  ← 输入区域
  ...
</div>
```

**关键变化**：
1. 滚动容器只包含虚拟消息列表——`getMaxScrollOffset()` 准确反映最后一条消息位置
2. StageSuggestionCard 移到滚动容器外，条件渲染（组件已 `return null` 当无 suggestion，无 DOM 产出 = 无占位）
3. StageSuggestionCard 需要适当的 padding/max-width 保持视觉一致

> **[D1]** 将 StageSuggestionCard 移出滚动容器。正方：(1) 完结 MP1 语义不变量——滚动容器内只包含虚拟化内容；(2) `getMaxScrollOffset()` 不再受 card 影响，`scrollToIndex(last, { align: 'end' })` 准确对齐最后一条消息（24px padding 间隙，标准行为）；(3) card 组件 `return null` 时不产出 DOM，自然无空白占位。反方：card 不再随消息流滚动。依据：UA-3 要求"最新消息下不应有空白"，UA-6 要求"标准聊天行为"，UA-7 确认问题由 F20260701w8ey 引入。用户已确认同意推翻 F20260701w8ey（消息 #4248）。交叉审视确认 RC4 成立，RC5 删除。

### 修改点 2：StageSuggestionCard 样式适配

StageSuggestionCard 移到固定区域后需要：
1. 添加 `px-6` 水平 padding 与页面其他区域对齐
2. 添加 `max-w-[1120px] mx-auto` 限制宽度与消息区域一致
3. 组件 `return null` 时无 DOM 产出——天然满足 UA-9（无空白占位）

### 修改点 3：滚动容器简化

移除 StageSuggestionCard 后，滚动容器内的 `flex-col gap-5` 包裹器不再需要（只有一个子元素）。简化为直接包含虚拟列表容器。

> **[D2]** 简化滚动容器结构。正方：减少 DOM 层级，消除不必要的 flex 包裹。反方：无。依据：结构简化是自然的代码清理，不改变功能行为。

## 生效路径 [required]

- 代码：`src/web/pages/IssueConversation.tsx`（布局结构调整）
- 无配置变更、无 API 变更、无提示词变更

## 设计约束摘要 [required]

### 硬约束（违反即 bug）
- 进入 issue 时必须滚动到底部，最新消息可见 ← UA-2, UA-6
- 最新消息下方不得有大面积空白 ← UA-3
- 滚动容器内只包含虚拟化内容（MP1 语义不变量完结）← UA-4
- StageSuggestionCard 不渲染时无空白占位 ← UA-9
- 不添加人工空白，不操纵消息布局 ← UA-5
- StageSuggestionCard 的条件渲染行为保留 ← UA-8

### 语义不变量（实现中必须保持为真）
- `scrollHeight` 仅由虚拟消息列表高度 + padding 决定，不包含 StageSuggestionCard
- `getMaxScrollOffset()` 准确反映最后一条消息的底部位置
- StageSuggestionCard `return null` 时无 DOM 产出，无空白占位

### 非目标（不得扩展）
- 不改变 StageSuggestionCard 的功能逻辑
- 不改变 `useChatScroll` 的核心滚动逻辑（MP2/MP3 保持不变）
- 不改变 `useMessages` 的职责
- 不做消息底部对齐等布局操纵

<!-- [design-time] 章节结束 -->

## 改动范围 [required]

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/web/pages/IssueConversation.tsx` | 修改 | 将 StageSuggestionCard 从滚动容器移出到固定区域；简化滚动容器内 flex 结构 |

## 验证 [required]

### P1 手动验证
- [ ] 进入 issue 时，页面自动滚动到对话底部，最新消息显示在视口底部附近（标准行为）
- [ ] 进入 issue 时，最新消息下方无不合理空白
- [ ] StageSuggestionCard 渲染时，在滚动容器外显示，不影响滚动位置
- [ ] StageSuggestionCard 不渲染时（无 suggestion / 已确认 / 已忽略 / 切换 issue），无空白占位
- [ ] 切换 stage 时，页面滚动到新 stage 的底部
- [ ] 新消息到达时，如果用户在底部，自动跟随滚动
- [ ] 消息排列方式不变——从顶部自然排列，无人工空白

### 自动化测试（防回归）

| # | 测试 | 断言（行为级） |
|---|------|----------------|
| T1 | 初始加载后滚动位置 | `scrollTop + clientHeight >= scrollHeight - SCROLL_THRESHOLD`（最新消息可见） |
| T2 | stage 切换后滚动到底部 | 切换 stage 后 `scrollTop + clientHeight >= scrollHeight - SCROLL_THRESHOLD` |
| T3 | 新消息到达时 auto-scroll | 用户在底部时新消息到达后自动滚动到底部 |
| T4 | StageSuggestionCard 不在滚动容器内 | 滚动容器的 `scrollHeight` 不包含 card 高度 |
| T5 | StageSuggestionCard 不渲染时无占位 | card 返回 null 时，card 区域无 DOM 元素、无空白 |

### 通用
- [ ] `npm run check` 通过

## 关联 [required]

- **前序修复**: F20260706v2mn（PR #583 — MP1/MP2/MP3 修复，MP1 不完整）
- **properties grid 移除**: F20260707mgdt（PR #589 — 已完成）
- **card 位置决策**: F20260701w8ey（将 card 移入滚动容器——本次推翻此决策，用户确认）

## 关键决策记录 [required]

| # | 决策点 | 最终决策 | 正方 | 反方 | 状态 |
|---|--------|----------|------|------|------|
| D1 | StageSuggestionCard 是否移出滚动容器 | 移出 | 完结 MP1 不变量，消除根因（144px 过冲），scrollToIndex 准确，card 不渲染时无占位 | card 不再随消息流滚动 | 用户确认（消息 #4248）。推翻 F20260701w8ey |
| D2 | 滚动容器结构简化 | 简化 | 减少 DOM 层级，代码清理 | 无 | 交叉审视共识 |

## 风险与缓解 [required]

| # | 风险 | 严重程度 | 影响 | 缓解策略 | 负责方 |
|---|------|----------|------|----------|--------|
| R1 | StageSuggestionCard 在固定区域占位，减少消息区域高度 | 中 | card 渲染时占 ~100px | card 条件渲染，无 suggestion 时不占位（UA-9）；card 始终可见反而提升可操作性 | 架构师 |
| R2 | card 移出后视觉布局变化 | 低 | card 不再在消息流末尾 | card 仍然位于消息区域下方，位置语义不变；始终可见比随消息滚动更好 | 架构师 |

## 交叉审视记录 [required]

### 第一轮

- **架构师-2 确认 RC4 成立**：代码验证 StageSuggestionCard 在滚动容器内（`IssueConversation.tsx:213`），`scrollToIndex(last, { align: 'end' })` 返回 `getMaxScrollOffset()` 包含 card 高度，144px 过冲计算正确
- **架构师-2 指出 RC5 不成立**：初始模式下 `handleScroll` 被阻断（`useChatScroll.ts:109-111`），`wasAtBottomRef` 不会被覆盖。card 的 `useQuery` 只重渲染子组件，不触发 `useLayoutEffect` 重跑。RC5 已删除
- **架构师-2 指出 F20260701w8ey 冲突**：用户两次拒绝将 card 移到固定区域。需用户确认才能推翻
- **架构师-2 建议**：向用户提方案而非只澄清

### 用户确认

用户确认同意移出 StageSuggestionCard（消息 #4248）："同意；原来是这个原因"。同时补充两个要求：
1. card 的临时出现/消失行为必须保留（UA-8）
2. card 不渲染时不得有空白占位（UA-9）
