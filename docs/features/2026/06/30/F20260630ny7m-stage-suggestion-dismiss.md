---
id: F20260630ny7m
title: stage-suggestion-dismiss
from_ids: [F2026060306]
tags: [web, bugfix, workflow, ui]
modules: [workflow, web]
doc_kind: spec
change_type: bugfix
---

# F20260630ny7m — Stage Suggestion 点击 Ignore 不消失

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 变更类型

BugFix

## 问题描述

`StageSuggestionCard` 组件中，点击 "Ignore" 按钮后卡片短暂消失，但在以下场景会重新出现：

1. WebSocket 推送新的 `stage_transition_suggested` 事件时，React Query 缓存被 invalidate，触发 refetch
2. 页面刷新后，`dismissedKey` 本地状态丢失
3. 同一 stage 存在多条 suggestion 时，`find()` 过滤掉被 dismissed 的一条后，返回下一条

## 根因分析

### 直接原因

`StageSuggestionCard.tsx` 的 "Ignore" 实现是纯客户端行为：

```tsx
// line 14: 本地 state，不持久化
const [dismissedKey, setDismissedKey] = useState<string | null>(null);

// line 56: 仅更新本地 state，无 API 调用
onClick={() => setDismissedKey(`${suggestion.stage_id}:${suggestion.target_key}:${suggestion.created_at}`)}
```

- `dismissedKey` 是 React 组件本地状态，组件卸载或页面刷新后丢失
- 没有调用后端 API 删除 suggestion，后端 `suggestions` Map 中数据不变

### 为什么 WebSocket 会触发 refetch

`useWebSocket.ts` 的 `EventBatcher.flush()` 中（line 280-283）：

```ts
for (const { issueId, stageId } of this.pendingStageTransitions) {
  this.queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
  this.queryClient.invalidateQueries({ queryKey: queryKeys.stages.detail(stageId) });
  this.queryClient.invalidateQueries({ queryKey: queryKeys.stages.messages(stageId) });
}
```

`queryKeys.stages.detail(stageId)` 返回 `["stages", stageId]`（`keys.ts` line 36），这是 `["stages", stageId, "transition-suggestions"]` 的前缀。React Query 的 `invalidateQueries` 按前缀匹配，因此 suggestions 查询也会被 invalidate 并 refetch。

### 原始设计遗漏

原始 feature 文档 `F2026060306` 设计了 `POST /issues/:id/reject-stage-suggestion` 端点和 `clearStageSuggestion` 方法，但当前重构后的实现（`IssueCollaboration`）未包含等价功能。`rollbackStage` 是唯一清理 suggestions 的路径（line 415: `this.suggestions.delete(stageId)`），但它删除整个 stage 的全部 suggestions，不是单条 dismiss。

### 次要问题：advanceStage 不清理 suggestions

`advanceStage`（line 151-156）成功后不清理 suggestions Map。旧 suggestion 在 stage 推进后仍残留在内存中。

## 设计

### 核心业务行为

- 当用户点击 "Ignore" 时，后端应从 `suggestions` Map 中删除对应的 suggestion
- 当 suggestion 被 dismiss 后，WebSocket invalidate 不应让它重新出现
- 当 stage 被 advance 后，该 stage 的所有 suggestions 应被清理

### 后端变更

**1. `IssueCollaboration` 新增 `dismissSuggestion` 方法**

```ts
dismissSuggestion(stageId: string, targetKey: string): boolean
```

- 从 `this.suggestions.get(stageId)` 中过滤掉 `target_key === targetKey` 的条目
- 如果过滤后数组为空，删除整个 Map entry
- 返回是否成功删除（true/false）

**2. `advanceStage` 补充清理**

在 `advanceStage` 成功后调用 `this.suggestions.delete(stageId)`，清理已推进 stage 的残留 suggestions。

**3. API 端点**

```
DELETE /api/stages/:stageId/transition-suggestions/:targetKey → { ok: true }
```

- 调用 `collaboration.dismissSuggestion(stageId, targetKey)`
- 404 如果 suggestion 不存在

**4. API 契约注册**

在 `endpoints.ts` 中新增：

```ts
"DELETE /api/stages/:stageId/transition-suggestions/:targetKey": EndpointDef<
  { stageId: string; targetKey: string }, never, never, { ok: true }
>;
```

### 前端变更

**`StageSuggestionCard.tsx`**

1. 删除 `dismissedKey` 本地 state
2. Ignore 按钮 `onClick` 改为调用 `DELETE /api/stages/:stageId/transition-suggestions/:targetKey`
3. 成功后调用 `refetch()` 刷新列表
4. 失败时 showToast 提示错误

## 修改文件

| 文件 | 改动 |
|------|------|
| `src/app/issue-collaboration/collaboration.ts` | 新增 `dismissSuggestion` 方法；`advanceStage` 补充 `suggestions.delete(stageId)` |
| `src/api-contracts/endpoints.ts` | 新增 `DELETE /api/stages/:stageId/transition-suggestions/:targetKey` 端点定义 |
| `src/infra/http/routes/issue.route.ts` | 新增 DELETE 路由处理 |
| `src/web/components/StageSuggestionCard.tsx` | Ignore 改为调用 DELETE API，移除 `dismissedKey` state |

## 边界情况

- **多条 suggestion**：dismiss 按 `target_key` 精确匹配，不影响其他 suggestion
- **快速连续点击**：dismiss 是幂等操作，重复调用返回 404 不影响 UI
- **WebSocket 推送新 suggestion**：新 suggestion 的 `target_key` 或 `created_at` 与已 dismiss 的不同，正常显示；如果用户再次 ignore，调用新的 DELETE
- **页面刷新**：dismiss 已持久化到后端 Map，refetch 后不会重新出现

## 验证

- [x] 点击 "Ignore" 后卡片消失，刷新页面后不再出现
- [x] 点击 "Ignore" 后 WebSocket 推送新事件不会让已 dismiss 的 suggestion 重新出现
- [x] 同一 stage 有多条 suggestion 时，ignore 只删除对应的一条
- [x] "Confirm" 正常工作，stage 推进后 suggestion 不残留
- [x] `npm run check` 通过
- [x] 现有测试不回归

<!-- [design-time] 章节结束 -->
