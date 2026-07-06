---
id: F20260703kzqm
title: Stage Suggestion 已阅自动消失
status: implemented
created_at: 2026-07-03
---

# F20260703kzqm — Stage Suggestion "已阅自动消失"

## 背景

当前 Stage Suggestion 的生命周期是：创建 → 用户看到 → 用户必须点击 Confirm 或 Ignore 才能移除。如果用户进入 Issue 页面看到了 Suggestion 但没有点击任何按钮就离开，下次进入时 Suggestion 仍然存在。

用户反馈：**只要看到了，Suggestion 就应该消失**。当前的"必须显式操作"模式制造了不必要的交互摩擦。

## 设计目标

1. Suggestion 在用户首次看到后自动标记为"已阅"
2. 已阅的 Suggestion 在下次加载时不再显示
3. 用户在当前会话中仍可主动 Confirm 或 Ignore

## 需求分析

### 用户心智模型

当前系统将 Suggestion 定位为"决策请求"——用户必须做出 Confirm/Ignore 的二选一。但用户的实际使用模式更接近"通知"：看到信息后，要么行动，要么自然离开。

**核心矛盾**："Ignore"在语义上是主动拒绝，但用户很多时候只是"看到了但不想操作"。当前系统将这两种行为混为一谈。

### 交互场景矩阵

| 场景 | 当前行为 | 期望行为 |
|------|---------|---------|
| 进入 Issue → 看到 Suggestion → 点 Confirm | 正常推进 | 不变 |
| 进入 Issue → 看到 Suggestion → 点 Ignore | Suggestion 消失 | 不变 |
| 进入 Issue → 看到 Suggestion → 离开 → 再次进入 | **Suggestion 仍在**（问题） | Suggestion 消失 |
| WebSocket 推送新 Suggestion → 用户在页面上看到 → 刷新页面 | Suggestion 仍在 | Suggestion 消失 |

### 行为规格

**B1 — 自动标记已阅**：当 SuggestionCard 组件首次挂载时，系统自动将对应的 Suggestion 标记为"已阅"（seen）。

**B2 — 已阅不出现在列表中**：`GET /api/stages/:stageId/transition-suggestions` 不返回 status 为 `seen` 的 Suggestion。

**B3 — 当前会话仍可操作**：SuggestionCard 组件挂载后，即使 Suggestion 已被标记为 seen，当前页面上的 Confirm/Ignore 按钮仍然可用。用户在当前会话中可以正常操作。

**B4 — dismiss_count 不受影响**：自动标记 seen 不计入 dismiss_count。dismiss_count 仅统计用户主动点击 Ignore 的次数。

**B5 — 优雅降级**：如果 seen API 调用失败（网络问题、用户快速离开），Suggestion 在下次加载时仍会显示。这与当前行为一致，不会导致数据丢失。

**B6 — seen 不参与自动推进**：`seen` 状态的 Suggestion 不应被 `AutoAdvanceEngine` 评估。`evaluateAdvance` 只应考虑 `pending` 状态的 Suggestion。`acknowledgeSuggestion` 从内存移除 seen 记录后，`evaluateAdvance` 自然不会看到它；服务器重启后 `restoreSuggestions` 只恢复 `pending` 状态，也不会看到它。

## 方案设计

### 状态机变更

```
当前：  pending ──→ confirmed
                 ──→ ignored

新增：  pending ──→ seen ──→ confirmed
                          ──→ ignored
        pending ──→ confirmed   (直接确认，跳过 seen)
        pending ──→ ignored     (直接忽略，跳过 seen)
```

`seen` 是一个中间状态：表示用户已阅但未做决策。它不会出现在 GET 列表中，但保留了后续 Confirm/Ignore 的可能性。

### API 变更

#### 新增：`PATCH /api/stages/:stageId/transition-suggestions/:targetKey/acknowledge`

轻量级"已阅确认"接口。

- 请求体：`{ created_at: string }`（定位具体 suggestion 记录）
- 行为：将匹配的 pending suggestion 标记为 `seen`
- 幂等：重复调用不报错
- 响应：`204 No Content`

#### 变更：`GET /api/stages/:stageId/transition-suggestions`

过滤条件从 `status = 'pending'` 改为 `status NOT IN ('seen', 'confirmed', 'ignored')`，即只返回 `pending` 状态的 suggestion。

#### 变更：`POST /api/stages/:stageId/advance`（Confirm）

无变更。Confirm 时将所有该 stage 的 suggestion 标记为 confirmed（包括 seen 状态的）。

#### 变更：`DELETE /api/stages/:stageId/transition-suggestions/:targetKey`（Ignore）

无变更。Ignore 时将匹配的 suggestion 标记为 ignored（包括 seen 状态的）。

### 数据层变更

#### DB schema

`stage_suggestion.status` 字段的合法值从 `'pending' | 'confirmed' | 'ignored'` 扩展为 `'pending' | 'seen' | 'confirmed' | 'ignored'`。

无需 DDL 变更——`status` 字段是 `TEXT` 类型，新值直接写入即可。

#### Repository 层

- `listPendingByStage(stageId)`：SQL 不变（`WHERE status = 'pending'`），因为 seen 的 suggestion 不应出现在列表中
- 新增 `markSeen(id)` 方法：`UPDATE stage_suggestion SET status = 'seen', processed_at = ? WHERE id = ? AND status = 'pending'`
- 类型变更：`StageSuggestionRecord.status`（repository.ts:459）从 `"pending" | "confirmed" | "ignored"` 扩展为 `"pending" | "seen" | "confirmed" | "ignored"`

#### Collaboration 层

- 新增 `acknowledgeSuggestion(stageId, targetKey, createdAt)` 方法
  1. 从内存 suggestions Map 中找到匹配项
  2. 调用 `stageSuggestionRepo.markSeen(id)` 持久化
  3. 从内存 Map 中移除
  4. 返回 boolean（是否找到匹配项）

- **变更** `dismissSuggestion`：增加 DB 回退逻辑。当前实现仅从内存 Map 查找（collaboration.ts:150-157），如果 `acknowledgeSuggestion` 已从内存移除，`dismissSuggestion` 会返回 false 导致前端显示错误 toast。修正为：内存找不到时，从 DB 查找 `pending` 或 `seen` 状态的记录并操作。与 `evaluateAdvance` 的现有回退模式一致（collaboration.ts:171-173）。

- **变更** `advanceStage`：增加 DB 回退逻辑。当前实现遍历内存 Map 并调用 `markProcessed`（collaboration.ts:161-162），如果 Map 已被 acknowledge 清空，seen 的记录不会被标记为 confirmed。修正为：遍历内存 + DB 中该 stage 的所有 suggestion（pending/seen），统一标记为 confirmed 并清理。

### 前端变更

#### StageSuggestionCard 组件

1. 组件挂载时（`useEffect` on mount），调用 `PATCH .../acknowledge` 标记已阅
2. 但不立即清除当前显示——用户在当前页面仍可看到并操作
3. Confirm/Ignore 按钮行为不变

#### IssueConversation 页面

无变更。StageSuggestionCard 的挂载逻辑不变。

### API 契约变更

`endpoints.ts` 新增端点类型定义：
```ts
"PATCH /api/stages/:stageId/transition-suggestions/:targetKey/acknowledge": {
  params: { stageId: string; targetKey: string };
  body: { created_at: string };
  response: void;
}
```

### 启动恢复

`startup-recovery.ts` 的 `restoreSuggestions` 方法：无需变更。它只恢复 `pending` 状态的 suggestion，`seen` 状态的已被过滤。

## 不兼容更新

无。新增的 `seen` 状态对现有行为无影响——已有的 `pending` → `confirmed`/`ignored` 路径不变。

## 实现指引

- **acknowledge 调用时机**：`useEffect` 空依赖数组（仅 mount 时触发），在 effect 内调用 acknowledge API。不依赖 IntersectionObserver——即使用户未滚动到卡片位置，只要页面加载即视为"已阅"。
- **幂等性**：acknowledge 接口对非 pending 状态的记录返回 204（不报错），避免快速重复调用导致异常。
- **竞态处理**：acknowledge 与 Confirm/Ignore 之间存在竞态。时序：① GET 返回 suggestion（pending）→ 组件渲染 → useEffect 触发 acknowledge API（异步，在途）→ ② 用户快速点击 Ignore/Confirm → ③ acknowledge API 返回。如果 ② 先完成从内存移除，③ 的 acknowledgeSuggestion 内存查找失败但 DB 操作幂等（WHERE status = 'pending' 不匹配已 ignored 的记录）。如果 ③ 先完成从内存移除，② 的 dismissSuggestion/advanceStage 需要 DB 回退逻辑才能正确操作。**因此 dismissSuggestion 和 advanceStage 必须增加 DB 回退**。

## 测试覆盖

- `acknowledgeSuggestion`：pending → seen 正常路径、对非 pending 记录幂等（返回 204）
- `dismissSuggestion` DB 回退：内存中无匹配时，从 DB 查找 seen 记录并标记 ignored
- `advanceStage` DB 回退：内存 Map 为空时，从 DB 查找 seen 记录并标记 confirmed
- 竞态场景：acknowledge 先完成 + dismiss 后执行 → DB 最终为 ignored
- 竞态场景：dismiss 先完成 + acknowledge 后执行 → DB 最终为 ignored（幂等）
- `evaluateAdvance`：seen 的 suggestion 不参与评估
- 多标签页：标签页 A acknowledge 后，标签页 B 的 refetch 不返回该 suggestion
