---
id: F2026062204
title: fix-shift-enter-sends
from_ids: [F2026061805]
tags: [bugfix, web]
modules: [web]
doc_kind: spec
change_type: bugfix
---

# F2026062204 [web] 修复 Shift+Enter 在补全列表激活时未发送消息

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

F2026061805 实现了 @mention 自动补全功能，并定义了键盘行为契约（B7）：

> 当用户在输入框中按 Shift+Enter 且补全列表激活时，消息应发送，同时关闭补全列表。

用户报告：在输入框中输入 `@` 触发补全列表后，按 Shift+Enter 不会发送消息，而是将 `@query` 替换为 `@第一个建议项 `，光标跳到 mention 之后。

## 目标

修复 Shift+Enter 在补全列表激活时的行为，使其符合 F2026061805 的设计契约：发送消息并关闭补全列表。

## 非目标

- 不改变 F2026061805 定义的键盘行为契约
- 不改变 Enter 在补全列表激活时的行为（确认选择）
- 不改变发送按钮行为
- 不涉及 v1 代码

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B7 | 当用户在输入框中按 Shift+Enter 且补全列表激活时 | 消息应发送，同时关闭补全列表 | 人工验证（项目无键盘事件测试模式） |

## 设计

### 问题分析

`useMention.ts` 的 `handleKeyDown` 函数（第 118 行）对 Enter 和 Shift+Enter 的判断未做区分：

```typescript
if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); return true; }
```

当用户按 Shift+Enter 时，`e.key` 仍为 `"Enter"`，导致 `handleMentionKeyDown` 返回 `true`（consumed）。`ChatInput.tsx` 收到 consumed=true 后进入 `applyMentionSelection()` 分支，而非 Shift+Enter 的发送分支。

### 修复约束

- `useMention.handleKeyDown` 必须区分 Enter（确认选择）和 Shift+Enter（不消费，交给调用方处理发送）
- 修复后 Shift+Enter 应返回 `false`，由 `ChatInput.tsx:90-94` 的发送逻辑接管

## 生效路径

- `src/web/hooks/useMention.ts` — handleKeyDown 中 Enter 判断需排除 Shift+Enter

## 设计约束摘要

- **边界**：仅修改 `useMention.ts` 的键盘事件判断，不改变其他组件
- **关键决策**：Shift+Enter 不应被 useMention hook 消费，应由 ChatInput 处理发送逻辑
- **语义不变量**：F2026061805 的键盘行为契约不变

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 改动 |
|---|---|
| `src/web/hooks/useMention.ts` | handleKeyDown 中 Enter 判断排除 Shift+Enter |

## 验证

- [ ] 补全列表激活时按 Shift+Enter → 消息发送，补全列表关闭
- [ ] 补全列表激活时按 Enter → 确认选择，不发送
- [ ] 补全列表未激活时按 Shift+Enter → 消息发送
- [ ] 补全列表未激活时按 Enter → 换行

## 关联

- **前置**: F2026061805（@mention 自动补全）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | 修复位置 | 在 useMention.handleKeyDown 中排除 Shift+Enter，最小改动 | 在 ChatInput 中先检查 Shift+Enter 再调用 mention handler | useMention 中排除 | useMention 是键盘事件的第一消费者，应正确声明自己消费的事件范围 | 架构师-1 | 2026-06-22 |
