---
id: F2026061601
title: stage-source-of-truth-and-ui-refinement
from_ids:
  - F2026060901
tags:
  - web
  - stage
  - url-state
  - conversation
  - context-panel
  - websocket
  - message-renderer
  - system-reminder
  - agent
modules:
  - web
  - issue-collaboration
  - acs-agents
doc_kind: spec
---

# F2026061601 [refactor] Stage Source of Truth 重构 + 对话 UI 全链路优化

## 背景

v2 初始化 PR（F2026060901）之后，对话页面存在多处架构不一致问题：

1. **Stage source of truth 冲突**：URL search params (`?stage=xxx`) 和 Zustand store (`conversationStore.currentStage`) 同时管理当前阶段，导致切换阶段时出现竞态和状态不一致。
2. **WebSocket 状态语义模糊**：右侧面板展示的 WebSocket 状态实际是 issue 级连接，容易被误解为 stage 级。
3. **已完成 Stage 仍可输入**：阶段已结束后输入框仍然可用，用户可能在已关闭的上下文中发消息。
4. **Agent 系统提示词结构松散**：平铺的 XML 标签难以被 Agent 精确解析，尤其在多角色协作场景。
5. **消息渲染器职责不清**：流式过程事件和最终答复混在同一个 `finalBlocks` 数组中。

## 改动概览

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `ConversationLayout.tsx` | 重构 | 当前 stage 改由 URL params + issue detail 派生，不再依赖 store |
| `conversationStore.ts` | 瘦身 | 移除 `currentStage` 和 `setCurrentStage`，只保留纯客户端状态 |
| `useWebSocket.ts` | 重构 | `useIssueRealtime` 接受 `currentStageId` 参数，不再读 store |
| `ContextPanel.tsx` | 重构 | 接受 `stage` prop，移除 store 依赖和 WebSocket 状态展示 |
| `AppShell.tsx` | 修复 | 从 URL params 派生 stage 并传给 ContextPanel |
| `ConversationView.tsx` | 增强 | 已完成 Stage 显示只读提示，隐藏输入框 |
| `StageActions.tsx` | 增强 | 推进后返回后端 StageDetailDto，直接用于 cache 更新 |
| `StageSuggestionBanner.tsx` | 增强 | 同上，推进后用后端返回值更新状态 |
| `MessageRenderer.tsx` | 重构 | 流式过程 vs 最终答复分离，UI 样式刷新 |
| `collaboration.ts` | 重构 | `buildSystemReminder` → `buildInvocationContext` + `renderInvocationContext` |
| `claude-code.ts` | 修复 | 空 output events 时 fallback 到 result content |
| `claude-code-stateful.ts` | 修复 | 同上 |
| `eslint.config.mjs` | 配置 | 忽略 `.snail/` 目录 |

## 核心设计决策

### 1. Stage Source of Truth：URL Params 权威

**决策**：当前 stage 由 URL `?stage=xxx` + issue detail 共同派生，Zustand store 不再保存 `currentStage`。

**派生逻辑**（`ConversationLayout.tsx:62`）：
```typescript
const selectedStageId = searchParams.get("stage");
const currentStage = selectedStageId
  ? issue?.stages.find((s) => s.id === selectedStageId)
    ?? issue?.current_stage
    ?? issue?.stages.at(-1)
    ?? null
  : issue?.current_stage
    ?? issue?.stages.at(-1)
    ?? null;
```

**一致性约束**：
- URL 中的 stage ID 必须存在于 `issue.stages` 中，否则 fallback 到 `current_stage` 或最后一个 stage。
- stage 切换只通过 `setSearchParams` 触发，不写 store。
- 推进成功后，`handleStageChanged` 先乐观更新 issue cache，再 `setSearchParams` 切到新阶段。

**好处**：
- URL 是唯一的 stage 状态来源，刷新页面、分享链接都保持一致。
- 移除了 store → URL 双向同步的复杂性。
- `AppShell`（ContextPanel 宿主）可以通过同样的逻辑从 URL 派生 stage，无需 store 通信。

### 2. Issue 级 WebSocket 状态

**决策**：WebSocket 状态从右侧面板移到 issue 标题旁，明确标注为 issue 级连接。

**实现**（`ConversationLayout.tsx:14`）：
```tsx
<IssueRealtimeBadge status={wsStatus} />
```

**原因**：当前 WebSocket 是 issue 级 channel（一个 issue 一个连接），不是 stage 级。放在右侧面板容易误导用户认为是当前 stage 的连接状态。

### 3. 已完成 Stage 只读

**决策**：`stage.status === "completed"` 时隐藏输入框，显示只读提示。

**实现**（`ConversationView.tsx:291`）：
```tsx
{!isStageWritable ? (
  <div>当前 Stage 已结束，历史对话保留为只读。请切换到当前 Stage 继续对话。</div>
) : (
  // 输入框
)}
```

**好处**：防止用户在已结束的阶段发消息导致数据不一致。

### 4. Invocation Context 结构化

**决策**：Agent 系统提示词从平铺 XML 改为结构化 JSON，包裹在 `<snail-invocation-context>` 标签中。

**结构**：
```json
{
  "project": { "workspace_path": "..." },
  "issue": { "issue_id": "...", "title": "...", "summary": "..." },
  "sop": { "key": "...", "name": "...", "shared_handbook": "..." },
  "stage": { "stage_id": "...", "key": "...", "available_transitions": [...] },
  "collaboration": {
    "current_role_instance": "...",
    "roles": [{ "role_instance": "...", "role_key": "...", "is_current": true, ... }]
  },
  "rules": ["...", "..."]
}
```

**好处**：
- Agent 可以精确解析 JSON 而非猜测 XML 标签含义。
- 多角色信息结构化，每个角色带 `is_current` / `is_primary` 标记。
- SOP 信息独立为 `sop` 字段，不再混在 issue 中。

### 5. 消息渲染器：过程 vs 结论分离

**决策**：`text_event` 从 `finalBlocks` 移到 `processBlocks`，最终答复只保留 `context.context`（后端存储的最终文本）。

**效果**：
- 流式过程中产生的文本块归入"流式过程"折叠区。
- 最终答复区域只显示后端持久化的结论，避免重复。
- UI 样式统一使用 shell design tokens。

### 6. Agent 空输出保护

**决策**：Claude Code / Claude Code Stateful agent 在 `outputEventCount === 0` 但 `resultContent` 非空时，将 result content 包装为 text event 输出。

**原因**：某些情况下 Claude Code 直接返回文本结果而不产生中间 events，之前会抛出 `no output events` 错误。

## URL State 同步协议

```
用户点击 stage tab → setSearchParams({ stage: id })
                  ↓
URL ?stage=xxx 变化
                  ↓
ConversationLayout 重新派生 currentStage
                  ↓
ConversationView / ContextPanel / StageActions 收到新 stage
                  ↓
推进成功 → handleStageChanged(stage)
         ├─ 乐观更新 issue cache（setQueryData）
         ├─ invalidate issue + messages queries
         └─ setSearchParams({ stage: newStage.id })
```

## 测试要点

- [ ] 切换 stage tab 后刷新页面，stage 保持选中
- [ ] 推进 stage 后 URL 自动切到新阶段
- [ ] 已完成 stage 不显示输入框
- [ ] ContextPanel 正确显示 Participants 和 Artifacts
- [ ] WebSocket 状态只出现在 issue 标题旁
- [ ] Agent 收到结构化 invocation context
- [ ] 消息流式过程和最终答复正确分离
