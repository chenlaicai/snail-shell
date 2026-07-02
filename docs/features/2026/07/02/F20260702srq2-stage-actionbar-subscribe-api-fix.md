---
id: F20260702srq2
title: StageActionBar 订阅 API 修复
tags: [bugfix, frontend, web, tanstack-query]
modules: [web]
---
# StageActionBar 订阅 API 修复

**编号**：F20260702srq2
**状态**：implemented
**变更类型**：bugfix
**创建**：2026-07-02

## 问题

PR #531 (`49f22102`) 引入的 `StageActionBar.tsx` 中 `qc.subscribe(...)` 调用报错，导致对话打开时组件崩溃。

## 根因分析

### 完整数据流追踪

```
用户打开对话页面
  → StageActionBar 组件挂载
  → useEffect 执行
  → qc.subscribe({ queryKey, listener })  ← 错误！
  → TypeError: qc.subscribe is not a function
  → 组件崩溃
```

### 根因（高置信度）：错误的 TanStack Query API 调用

PR #531 在 `StageActionBar.tsx:28` 中使用了 `qc.subscribe(...)`，但 `QueryClient` 没有 `subscribe` 方法。

**类型分析**：
- `QueryClient` 类：提供 `getQueryCache()`、`getQueryData()`、`setQueryData()` 等方法，**没有** `subscribe`
- `QueryCache` 类：继承自 `Subscribable<QueryCacheListener>`，**有** `subscribe` 方法

PR #531 的意图是监听 query cache 变化以检测 `close_summary` 从 null 到有值的转变，但使用了错误的对象层级。

### 正确的 API 调用方式

```typescript
// 错误（PR #531 引入）
return qc.subscribe({
  queryKey: queryKeys.issues.detail(issue.id),
  listener: ({ query }) => { ... }
});

// 正确
return qc.getQueryCache().subscribe((event) => {
  if (event.type !== 'updated') return;
  // 手动过滤 queryKey
  // ...
});
```

## 核心业务行为

- **当 StageActionBar 组件挂载时**，应正确订阅 query cache 变化，不应报错
- **当 close_summary 从 null 变为有值时**，应弹出 cleanup 结果 toast
- **当组件卸载时**，应正确取消订阅，避免内存泄漏

## 设计方案

### 改动：修正 subscribe API 调用

**文件**：`src/web/components/StageActionBar.tsx`

将 `qc.subscribe(...)` 改为 `qc.getQueryCache().subscribe(...)`，并手动过滤事件类型和 queryKey：

```typescript
useEffect(() => {
  const targetKey = queryKeys.issues.detail(issue.id);
  return qc.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated') return;
    const qk = event.query.queryKey;
    if (qk.length !== targetKey.length || qk[0] !== targetKey[0] || qk[1] !== targetKey[1]) return;
    const data = event.query.state.data as IssueDetailDto | undefined;
    const current = data?.close_summary;
    const prev = prevCloseSummaryRef.current;
    prevCloseSummaryRef.current = current;
    if (prev == null && current != null) {
      showToast(formatCleanupResult(current));
    }
  });
}, [qc, issue.id]);
```

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/web/components/StageActionBar.tsx` | 修改 | 修正 subscribe API 调用 |

## 设计取舍记录

| 决策 | 正面 | 反面 | 结论 |
|------|------|------|------|
| qc.getQueryCache().subscribe vs qc.subscribe | 正确的 API，符合 TanStack Query v5 设计 | 需手动过滤事件和 queryKey | 选择正确的 API |
| 手动过滤 vs 使用 queryClient.subscribe 的 queryKey 选项 | 无额外依赖 | 代码稍冗长 | 选择手动过滤，因为 queryClient.subscribe 不存在 |

## 验证计划

1. **组件挂载验证**：打开对话页面，确认 StageActionBar 不报错
2. **close_summary 监听验证**：关闭 issue，确认 cleanup 结果 toast 正确弹出
3. **组件卸载验证**：导航离开再返回，确认无内存泄漏或重复订阅
4. **TypeScript 编译验证**：确认修改后无类型错误

## 交叉审视记录

### 第一轮：架构师-1 初始分析

- 根因：PR #531 使用了错误的 API `qc.subscribe`，`QueryClient` 没有此方法
- 方案：改用 `qc.getQueryCache().subscribe`，手动过滤事件和 queryKey
- 置信度：高（已验证 TanStack Query v5 类型定义）

### 第二轮：架构师-2 交叉审视

#### 审视结论：✅ 方案可行，需补充细节

**根因分析**：✅ 完整准确
- PR #531 错误使用 `qc.subscribe`，`QueryClient` 无此方法
- 应使用 `qc.getQueryCache().subscribe`

**方案设计**：✅ 正确，补充以下细节

1. **事件类型过滤说明**
   - TanStack Query v5 QueryCache 事件类型：`added`、`removed`、`updated`、`observerAdded`、`observerRemoved`、`observerResultsUpdated`
   - 本方案只监听 `updated` 事件，因为只有状态更新才可能改变 `close_summary`
   - 其他事件类型（如 `added`）不会触发 toast，符合预期

2. **queryKey 过滤逻辑验证**
   - `queryKeys.issues.detail(id)` 返回 `["issues", id]`（已从 `keys.ts:31` 确认）
   - 过滤逻辑 `qk.length !== targetKey.length || qk[0] !== targetKey[0] || qk[1] !== targetKey[1]` 正确
   - 可选优化：使用 TanStack Query 的 `hashKey` 函数简化比较，但当前实现可接受

3. **边界情况分析**
   - ✅ issue.id 变化：useEffect 依赖 `[qc, issue.id]`，id 变化时重新订阅
   - ✅ 组件快速挂载卸载：useEffect 清理函数取消订阅
   - ✅ 多个 StageActionBar 实例：每个实例独立订阅，互不干扰
   - ✅ close_summary 重复触发：`prevCloseSummaryRef` 机制防止重复 toast

**验证计划**：⚠️ 建议补充

| 序号 | 验证项 | 验证方法 | 预期结果 |
|------|--------|----------|----------|
| 1 | 组件挂载验证 | 打开对话页面 | StageActionBar 不报错 |
| 2 | close_summary 监听 | 关闭 issue | cleanup 结果 toast 正确弹出 |
| 3 | 组件卸载验证 | 导航离开再返回 | 无内存泄漏或重复订阅 |
| 4 | TypeScript 编译 | `npm run check` | 无类型错误 |
| 5 | 事件类型边界 | 手动触发 query 添加/移除 | 不会误触发 toast |
| 6 | queryKey 隔离 | 同时打开两个不同 issue | 各自独立监听，互不干扰 |
| 7 | 并发场景 | 快速切换 issue | 订阅正确更新，无残留 |

**风险评估**：低风险
- 单文件修改，影响范围小
- 修复逻辑简单，无复杂状态管理
- 已有 PR #531 的原始意图作为参考
