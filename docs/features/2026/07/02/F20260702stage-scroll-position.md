# F20260702stage-scroll-position: Stage 切换后滚动位置异常

**特性类型**: bugfix
**创建日期**: 2026-07-02
**状态**: 设计中

## 问题背景

### 现象
当用户推进 stage 时，页面滚动到了非常下方的位置，导致页面显示为空白。用户需要手动向上滚动才能看到本 stage 的开头位置。

### 复现路径
1. 在任意 stage 中，点击"推进 Stage"按钮或确认 stage suggestion
2. 新 stage 加载完成后，页面自动滚动到非常下方的位置
3. 页面显示为空白区域
4. 用户需要向上滚动才能看到新 stage 的消息

### 影响范围
- 所有 stage 切换场景（手动推进、自动推进、stage suggestion 确认）
- 新 stage 消息数量较少时（1-3 条消息）尤为明显

## 问题分析

### 根因定位

**关键代码位置**：`src/web/pages/IssueConversation.tsx`

#### 1. Stage 切换时强制设置"在底部"状态（Lines 106-114）

```typescript
useEffect(() => {
  if (prevStageIdRef.current !== stageId) {
    if (prevStageIdRef.current) clearPendingMessages(prevStageIdRef.current);
    prevStageIdRef.current = stageId;
    setOlderHistory([]);
    allHistoryLoadedRef.current = false;
    wasAtBottomRef.current = true;  // ← 问题根源：强制设置为 true
  }
}, [stageId]);
```

#### 2. 自动滚动逻辑（Lines 143-151）

```typescript
const totalSize = virtualizer.getTotalSize();
useLayoutEffect(() => {
  const el = scrollRef.current;
  if (!el || sorted.length === 0) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD;
  if (atBottom || wasAtBottomRef.current) {  // ← 当 wasAtBottomRef.current === true 时触发
    virtualizer.scrollToIndex(sorted.length - 1, { align: 'end' });  // ← 滚动到最后一条消息的底部
  }
}, [sorted, totalSize]);
```

#### 3. 虚拟化列表容器（Lines 363-386）

```typescript
<div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
  {virtualizer.getVirtualItems().map((virtualRow) => {
    // ... 渲染消息
  })}
</div>
```

### 问题机制

1. **Stage 切换触发**：当 `stageId` 变化时，`wasAtBottomRef.current` 被设置为 `true`
2. **消息加载触发**：新 stage 的消息加载完成后，`sorted` 数组更新，触发 `useLayoutEffect`
3. **滚动计算错误**：因为 `wasAtBottomRef.current === true`，调用 `virtualizer.scrollToIndex(sorted.length - 1, { align: 'end' })`
4. **虚拟化器行为**：虚拟化器尝试将最后一条消息滚动到可视区域的底部
5. **高度不匹配**：
   - 虚拟化列表容器高度 = 消息数量 × 估算高度（120px）
   - 如果只有 1 条消息，容器高度 = 120px
   - 可视区域高度可能有 800px
   - "滚动到底部"会把 120px 的列表推到 800px 可视区域的顶部，留下 680px 空白在下面

### 用户看到的现象

- 页面滚到了非常下方的位置（实际上是空白区域）
- 页面显示为空白（因为消息被推到了可视区域顶部以上）
- 需要向上滚动才能看到新 stage 的消息

## 设计方案

### 方案概述

修改 stage 切换时的滚动策略：不再强制滚动到底部，而是根据消息列表的实际高度决定滚动行为。

### 详细设计

#### 核心原则

**Stage 切换后，用户应该看到新 stage 的第一条消息，而不是空白区域。**

#### 实现策略

**方案 A：滚动到顶部（推荐）**

当 stage 切换时，将 `wasAtBottomRef.current` 设置为 `false`，并滚动到列表顶部。

**优点**：
- 逻辑简单，行为可预测
- 用户始终能看到新 stage 的第一条消息
- 符合"从头开始阅读"的直觉

**缺点**：
- 如果用户习惯看到最新消息，需要手动滚动到底部

**方案 B：智能滚动**

根据消息列表高度和可视区域高度的关系，决定滚动位置：
- 如果消息列表高度 < 可视区域高度：不滚动（自然显示）
- 如果消息列表高度 >= 可视区域高度：滚动到底部

**优点**：
- 兼顾两种场景
- 用户体验更智能

**缺点**：
- 实现复杂，需要额外的高度计算
- 边界情况多，容易出错

**方案 C：滚动到第一个新消息**

记录 stage 切换前的消息数量，切换后滚动到第一个新消息的位置。

**优点**：
- 用户能看到新 stage 的起始内容
- 保持一定的上下文连续性

**缺点**：
- 实现最复杂，需要维护额外状态
- 新 stage 可能没有"新消息"概念（因为是全新 stage）

### 推荐方案

**选择方案 A：滚动到顶部**

理由：
1. **简单可靠**：逻辑清晰，边界情况少
2. **符合直觉**：新 stage 应该从头开始阅读
3. **问题本质**：当前问题的本质是"滚动位置错误导致空白"，方案 A 直接解决这个问题
4. **用户行为**：如果用户想看最新消息，可以手动滚动到底部（已有滚动按钮）

### 实现细节

#### 修改点 1：Stage 切换时的 `wasAtBottomRef` 设置

**文件**：`src/web/pages/IssueConversation.tsx`
**位置**：Lines 106-114

**修改前**：
```typescript
useEffect(() => {
  if (prevStageIdRef.current !== stageId) {
    if (prevStageIdRef.current) clearPendingMessages(prevStageIdRef.current);
    prevStageIdRef.current = stageId;
    setOlderHistory([]);
    allHistoryLoadedRef.current = false;
    wasAtBottomRef.current = true;  // ← 强制设置为 true
  }
}, [stageId]);
```

**修改后**：
```typescript
useEffect(() => {
  if (prevStageIdRef.current !== stageId) {
    if (prevStageIdRef.current) clearPendingMessages(prevStageIdRef.current);
    prevStageIdRef.current = stageId;
    setOlderHistory([]);
    allHistoryLoadedRef.current = false;
    wasAtBottomRef.current = false;  // ← 修改为 false，不自动滚动到底部
  }
}, [stageId]);
```

#### 修改点 2：Stage 切换后滚动到顶部

**文件**：`src/web/pages/IssueConversation.tsx`
**位置**：Lines 106-114

**修改后**：
```typescript
useEffect(() => {
  if (prevStageIdRef.current !== stageId) {
    if (prevStageIdRef.current) clearPendingMessages(prevStageIdRef.current);
    prevStageIdRef.current = stageId;
    setOlderHistory([]);
    allHistoryLoadedRef.current = false;
    wasAtBottomRef.current = false;  // ← 不自动滚动到底部

    // 新增：滚动到顶部
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = 0;
    }
  }
}, [stageId]);
```

#### 修改点 3：自动滚动逻辑调整（可选）

如果希望保留"用户已经在底部时自动滚动"的行为，可以调整自动滚动逻辑：

**文件**：`src/web/pages/IssueConversation.tsx`
**位置**：Lines 143-151

**修改前**：
```typescript
const totalSize = virtualizer.getTotalSize();
useLayoutEffect(() => {
  const el = scrollRef.current;
  if (!el || sorted.length === 0) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD;
  if (atBottom || wasAtBottomRef.current) {
    virtualizer.scrollToIndex(sorted.length - 1, { align: 'end' });
  }
}, [sorted, totalSize]);
```

**修改后**：
```typescript
const totalSize = virtualizer.getTotalSize();
useLayoutEffect(() => {
  const el = scrollRef.current;
  if (!el || sorted.length === 0) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD;
  // 只有用户已经在底部时才自动滚动，不依赖 wasAtBottomRef
  if (atBottom) {
    virtualizer.scrollToIndex(sorted.length - 1, { align: 'end' });
  }
}, [sorted, totalSize]);
```

**注意**：这个修改会移除 `wasAtBottomRef` 的影响，可能会影响其他场景（如页面初始加载）。需要评估是否需要保留 `wasAtBottomRef` 的逻辑。

### 边界情况处理

#### 1. 新 stage 消息加载中

当 stage 切换后，消息可能还在加载中（`sorted.length === 0`）。此时：
- 自动滚动逻辑不会触发（因为 `sorted.length === 0`）
- 用户会看到"No messages yet"提示
- 消息加载完成后，`sorted` 更新，触发自动滚动逻辑
- 因为 `wasAtBottomRef.current === false`，不会自动滚动

**处理**：无需特殊处理，行为符合预期。

#### 2. 新 stage 消息数量很少（1-3 条）

当消息数量很少时：
- 虚拟化列表容器高度 < 可视区域高度
- 不需要滚动，消息自然显示在可视区域内
- 用户能看到所有消息

**处理**：无需特殊处理，行为符合预期。

#### 3. 新 stage 消息数量很多

当消息数量很多时：
- 虚拟化列表容器高度 > 可视区域高度
- 用户需要手动滚动到底部才能看到最新消息
- 可以使用已有的"回到底部"按钮

**处理**：无需特殊处理，用户可以使用滚动按钮。

#### 4. 用户已经在底部时推进 stage

如果用户在推进 stage 前已经在当前 stage 的底部：
- 推进后，新 stage 加载
- 因为 `wasAtBottomRef.current === false`，不会自动滚动
- 用户会看到新 stage 的第一条消息

**处理**：符合预期，用户可以从头开始阅读新 stage。

## 验收标准

### 功能验收

1. **Stage 切换后不出现空白区域**
   - 推进 stage 后，页面应该显示新 stage 的第一条消息
   - 不应该出现大片空白区域

2. **Stage 切换后滚动位置正确**
   - 新 stage 消息数量少时：消息自然显示在可视区域内
   - 新 stage 消息数量多时：显示第一条消息，用户可以手动滚动

3. **不影响其他滚动行为**
   - 用户手动滚动时，行为正常
   - 新消息到达时，如果用户在底部，自动滚动到底部
   - "回到顶部"和"回到底部"按钮功能正常

### 性能验收

1. **滚动性能不受影响**
   - 虚拟化列表的滚动性能保持不变
   - 大量消息时的渲染性能保持不变

2. **Stage 切换响应时间**
   - Stage 切换的响应时间不受影响
   - 不引入额外的延迟

### 兼容性验收

1. **向后兼容**
   - 现有的 stage 推进逻辑保持不变
   - WebSocket 实时更新逻辑保持不变

2. **跨浏览器兼容**
   - 在主流浏览器中测试滚动行为
   - 确保行为一致

## 测试场景

### 场景 1：手动推进 stage（消息数量少）

**前置条件**：
- 当前 stage 有 10 条消息
- 用户在底部位置

**操作步骤**：
1. 点击"推进 Stage"按钮
2. 等待新 stage 加载完成

**预期结果**：
- 页面显示新 stage 的第一条消息
- 不出现空白区域
- 滚动位置在列表顶部

### 场景 2：手动推进 stage（消息数量多）

**前置条件**：
- 当前 stage 有 10 条消息
- 用户在底部位置

**操作步骤**：
1. 点击"推进 Stage"按钮
2. 等待新 stage 加载完成（新 stage 有 50 条消息）

**预期结果**：
- 页面显示新 stage 的第一条消息
- 不出现空白区域
- 滚动位置在列表顶部
- 用户可以手动滚动到底部

### 场景 3：Stage suggestion 确认

**前置条件**：
- 当前 stage 有 5 条消息
- 用户在中间位置
- Stage suggestion 卡片显示

**操作步骤**：
1. 点击 stage suggestion 卡片的"确认"按钮
2. 等待新 stage 加载完成

**预期结果**：
- 页面显示新 stage 的第一条消息
- 不出现空白区域
- 滚动位置在列表顶部

### 场景 4：自动推进 stage（WebSocket）

**前置条件**：
- 当前 stage 有 10 条消息
- 用户在底部位置
- 后端触发自动推进

**操作步骤**：
1. 等待 WebSocket 推送 `stage_changed` 事件
2. 等待新 stage 加载完成

**预期结果**：
- 页面显示新 stage 的第一条消息
- 不出现空白区域
- 滚动位置在列表顶部

### 场景 5：Stage 切换后新消息到达

**前置条件**：
- 刚刚切换到新 stage
- 新 stage 有 3 条消息
- 用户在顶部位置

**操作步骤**：
1. 等待新消息到达（AI 回复）

**预期结果**：
- 新消息显示在列表末尾
- 页面不自动滚动到底部（因为用户不在底部）
- 用户可以手动滚动查看新消息

## 实现约束

### 约束 1：不改变虚拟化列表的核心逻辑

虚拟化列表的滚动逻辑（`useLayoutEffect`）是核心功能，不能随意修改。本次修改只调整 `wasAtBottomRef` 的初始值，不改变滚动逻辑本身。

### 约束 2：不影响其他 stage 切换场景

除了手动推进和自动推进，还有其他 stage 切换场景（如页面初始加载、URL 参数变化）。需要确保这些场景的行为不受影响。

### 约束 3：保持向后兼容

现有用户习惯"推进后看到最新消息"的行为会改变。需要评估是否需要提供配置选项或过渡方案。

## 风险评估

### 风险 1：用户习惯改变

**风险描述**：部分用户可能习惯"推进后看到最新消息"的行为，改变后可能不适应。

**缓解措施**：
- 提供"回到底部"按钮，用户可以快速滚动到底部
- 在 release notes 中说明行为变化

### 风险 2：边界情况处理

**风险描述**：某些边界情况下，滚动行为可能不符合预期。

**缓解措施**：
- 充分测试各种场景
- 保留 `wasAtBottomRef` 机制，便于后续调整

### 风险 3：性能影响

**风险描述**：额外的滚动操作可能影响性能。

**缓解措施**：
- 滚动操作是轻量级的，不会显著影响性能
- 虚拟化列表的渲染逻辑保持不变

## 决策记录

### 决策 1：选择方案 A（滚动到顶部）

**正方观点**：
- 简单可靠，逻辑清晰
- 符合"从头开始阅读"的直觉
- 直接解决"空白区域"问题

**反方观点**：
- 部分用户可能习惯看到最新消息
- 需要手动滚动到底部

**决策理由**：
- 问题的本质是"滚动位置错误导致空白"，方案 A 直接解决这个问题
- "从头开始阅读"更符合新 stage 的使用场景
- 提供"回到底部"按钮作为补偿

### 决策 2：是否保留 `wasAtBottomRef` 机制

**正方观点**：
- 保留机制便于后续调整
- 其他场景可能依赖这个机制

**反方观点**：
- 当前场景不需要这个机制
- 增加代码复杂度

**决策理由**：
- 保留 `wasAtBottomRef` 机制，但修改其初始值
- 不改变自动滚动逻辑的核心行为
- 便于后续根据用户反馈调整

## 后续优化

### 优化 1：智能滚动（方案 B）

如果用户反馈"希望看到最新消息"，可以实现智能滚动逻辑：
- 根据消息列表高度和可视区域高度的关系，决定滚动位置
- 需要额外的高度计算和边界情况处理

### 优化 2：滚动位置记忆

如果用户在多个 stage 之间切换，可以记忆每个 stage 的滚动位置：
- 记录用户在每个 stage 的滚动位置
- 切换回某个 stage 时，恢复之前的滚动位置
- 需要额外的状态管理和存储逻辑

### 优化 3：平滑滚动动画

Stage 切换时，可以添加平滑滚动动画：
- 从当前位置平滑滚动到新位置
- 提升用户体验
- 需要额外的动画逻辑和性能考虑

## 附录

### 相关代码文件

1. `src/web/pages/IssueConversation.tsx` - 主要修改文件
2. `src/web/components/StageActionBar.tsx` - Stage 推进按钮
3. `src/web/components/StageSuggestionCard.tsx` - Stage suggestion 卡片
4. `src/web/hooks/useWebSocket.ts` - WebSocket 实时更新

### 相关文档

1. `@tanstack/react-virtual` 虚拟化列表文档
2. React `useEffect` 和 `useLayoutEffect` 文档
3. 浏览器滚动行为规范

### 测试工具

1. Chrome DevTools - 滚动位置调试
2. React DevTools - 组件状态检查
3. 性能分析工具 - 滚动性能测试
