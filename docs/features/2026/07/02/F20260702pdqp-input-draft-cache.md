---
id: F20260702pdqp
title: input-draft-cache
tags: [feature, frontend, localStorage, cache]
---

# F20260702pdqp — 输入框草稿缓存

## 背景与动机

用户在 Issue 对话页输入较长内容时，如果页面刷新（手动刷新、浏览器崩溃、网络断开重连等），已输入的内容会丢失。需要一个前端缓存机制，在页面刷新后恢复输入框内容。

**核心诉求**：
- 输入框内容缓存到 localStorage
- 每个 Issue 单独缓存（隔离不同 Issue 的草稿）
- 页面刷新后自动恢复
- 不持久化到数据库（纯前端方案）

## 设计目标

1. **无感知缓存**：用户输入时自动保存，无需手动操作
2. **Issue 级隔离**：不同 Issue 的草稿互不干扰
3. **自动清理**：消息发送成功后清除对应草稿
4. **遵循现有模式**：复用 `pending-messages.ts` 的 localStorage 封装模式

## 技术方案

### 1. 存储层：`input-drafts.ts`

新建 `src/web/lib/input-drafts.ts`，提供草稿的 CRUD API：

```typescript
const STORAGE_KEY = "snail:input_drafts";

interface DraftData {
  content: string;
  updatedAt: string; // ISO timestamp
}

// API 设计
saveDraft(issueId: string, content: string): void
getDraft(issueId: string): string | null
removeDraft(issueId: string): void
```

**Key 设计**：`snail:input_drafts` 存储 `Record<string, DraftData>`，key 为 `issueId`。

**不按 stageId 隔离的原因**：
- 用户需求明确说"每个 issue 单独的缓存"
- 同一 Issue 内切换 stage 时，草稿应该是连续的（用户可能在不同 stage 间来回切换继续输入）
- 如果按 stageId 隔离，切换 stage 后草稿会丢失，体验不佳

### 2. 组件层：ChatInput 改造

修改 `src/web/components/ChatInput.tsx`：

1. **Props 扩展**：新增 `issueId?: string` prop
2. **初始化**：组件挂载时从 localStorage 读取草稿
3. **缓存写入**：输入变化时 debounce 保存（300ms）
4. **发送后清理**：`handleSend` 成功后调用 `removeDraft`

```typescript
// 伪代码
const [value, setValue] = useState(() => {
  if (issueId) return getDraft(issueId) ?? "";
  return "";
});

// Debounce 保存
useEffect(() => {
  if (!issueId || !value) return;
  const timer = setTimeout(() => saveDraft(issueId, value), 300);
  return () => clearTimeout(timer);
}, [issueId, value]);

// 发送后清理
const handleSend = useCallback(() => {
  // ... existing logic
  if (issueId) removeDraft(issueId);
}, [issueId, ...]);
```

### 3. 调用层：IssueConversation 传递 issueId

修改 `src/web/pages/IssueConversation.tsx`：

```diff
- <ChatInput onSend={handleSend} disabled={...} roleInstances={...} />
+ <ChatInput issueId={issueId} onSend={handleSend} disabled={...} roleInstances={...} />
```

## 数据流

```
用户输入 → handleChange → setValue → useEffect(debounce) → saveDraft → localStorage
                                                                    ↓
页面刷新 → ChatInput 初始化 → getDraft → setValue → 恢复内容
                                                                    ↓
消息发送 → handleSend → removeDraft → localStorage 清除
```

## 边界场景

| 场景 | 处理方式 |
|------|----------|
| issueId 为空（加载中） | 不缓存，不恢复 |
| 草稿内容为空 | 不写入 localStorage（节省空间） |
| 并发写入 | 最后一次写入覆盖（debounce 保证） |
| localStorage 满 | 捕获异常，静默失败（不阻塞用户输入） |
| 切换 Issue | 自动切换到对应 Issue 的草稿 |
| 发送失败 | 草稿保留（用户可能修改后重试） |

## 与现有机制的关系

| 机制 | 用途 | 存储内容 | 清除时机 |
|------|------|----------|----------|
| `pending-messages` | 待发送/失败消息恢复 | 已发送的消息 | 发送成功 / 手动重试 |
| **`input-drafts`（本方案）** | 输入框草稿恢复 | 未发送的输入内容 | 发送成功 |

两者互补，不冲突：
- `pending-messages` 关注"已提交但未确认的消息"
- `input-drafts` 关注"未提交的输入内容"

## 不兼容更新

无。纯前端新增功能，不影响现有 API 或数据结构。

## 验收标准

### 功能验收

1. **S1 — 缓存写入**：在 Issue 对话页输入内容后，localStorage 中存在 `snail:input_drafts` 条目
2. **S2 — 按 Issue 隔离**：在 Issue A 输入内容，切换到 Issue B，Issue A 的草稿不受影响
3. **S3 — 刷新恢复**：输入内容后刷新页面，输入框自动恢复之前的内容
4. **S4 — 发送清理**：发送消息成功后，对应 Issue 的草稿从 localStorage 清除
5. **S5 — 空内容不缓存**：清空输入框后不写入 localStorage

### 非功能验收

6. **NF1 — 性能**：debounce 300ms，不造成输入卡顿
7. **NF2 — 兼容性**：localStorage 不可用时静默降级，不阻塞正常输入

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| localStorage 被禁用 | 低 | 高 | 捕获异常，静默降级 |
| 草稿内容过大 | 低 | 中 | 单条草稿通常 < 10KB，不设上限 |
| 用户误以为草稿已发送 | 低 | 低 | 草稿和消息在 UI 上区分明显 |

## 决策记录

### D1 — 存储粒度：Issue 级 vs Stage 级

**决策**：按 Issue 级存储，不按 Stage 隔离。

**正方论点**：
- 用户需求明确说"每个 issue 单独的缓存"
- 同一 Issue 内切换 stage 时，草稿应该是连续的
- 简化实现，减少 key 数量

**反方论点**：
- 不同 stage 可能有不同的输入上下文
- 按 stage 隔离可以更精确地恢复

**结论**：采纳正方。用户需求是 Issue 级隔离，且切换 stage 时保留草稿更符合直觉。

### D2 — Debounce 时间：300ms

**决策**：300ms debounce。

**理由**：
- 与常见输入 debounce 时间一致（搜索建议通常 200-500ms）
- 平衡实时性和性能
- 用户输入速度通常 < 300ms/字符

### D3 — 清除时机：发送成功后

**决策**：仅在消息发送成功后清除草稿。

**理由**：
- 发送失败时保留草稿，方便用户修改后重试
- 与 `pending-messages` 的失败处理逻辑一致

## 实现状态

**状态**：✅ 已完成

### 变更文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/web/lib/input-drafts.ts` | 新增 | 草稿 localStorage 存储层 |
| `src/web/components/ChatInput.tsx` | 修改 | 新增 `issueId` prop，debounce 缓存，发送后清理 |
| `src/web/pages/IssueConversation.tsx` | 修改 | 传递 `issueId` 到 ChatInput |
| `tests/input-drafts.test.ts` | 新增 | 存储层单元测试（7 个用例） |

### 测试覆盖

- S1 — 缓存写入：✅ `saves and retrieves draft by issueId`
- S2 — 按 Issue 隔离：✅ `isolates drafts by issueId`
- S4 — 发送清理：✅ `removes draft after send`
- S5 — 空内容不缓存：✅ `returns null for non-existent issueId`
- 边界 — localStorage 异常：✅ `silently fails when localStorage throws`
- 边界 — 覆盖写入：✅ `overwrites existing draft on save`
- 边界 — 删除不存在的草稿：✅ `does not throw when removing non-existent draft`
