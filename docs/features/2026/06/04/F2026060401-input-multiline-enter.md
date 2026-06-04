---
id: F2026060401
title: input-multiline-enter
from_ids: []
tags: [ux, web]
modules: [web]
doc_kind: spec
---

# F2026060401 [web] 输入框换行行为调整

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

当前 Issue 对话输入框（`#input` textarea）的键盘行为是：Enter 直接发送消息，Shift+Enter 插入换行。用户希望直接按 Enter 就能换行，降低多行输入的操作门槛。

## 目标

### P1 — 键盘行为反转

将 Enter 与 Shift+Enter 的行为互换：
- **Enter**：在 textarea 中插入换行（浏览器默认行为，不调用 `preventDefault`）
- **Shift+Enter**：发送消息
- 发送按钮（`#send-btn`）点击行为不变

### P1 — textarea 自动扩展

Enter 换行后用户自然输入多行，固定 54px 高度会导致 UX 退化。textarea 需自动扩展：
- 输入时根据内容自动增长高度
- 上限 200px，超出后显示滚动条
- 清空后恢复初始 54px 高度

## 非目标

- 不改变 @mention 建议选择时的 Enter/Tab 行为（仍为确认选择）；Shift+Enter 在任何状态下均为发送
- 不改变发送按钮的点击行为
- 不改变 Evolution Center 治理对话的输入行为（独立组件）

## 设计

### P1 详设 — 键盘行为

修改 `src/web/composer-keyboard.js` 的 `bindComposerKeyboard`：

1. 当 mention 建议激活时，Enter（无 Shift）仍为确认选择，逻辑不变
2. 非 mention 状态下：Shift+Enter 触发 `deps.send()`，Enter 不拦截（走浏览器默认换行）
3. 提示 placeholder 或 composer hints 区域补充 "Shift+Enter 发送" 提示

### P1 详设 — 自动扩展

1. `app.js` 监听 `input` 事件，每次输入时重置 `height` 为初始值再设为 `scrollHeight`，受限于 CSS `max-height: 200px`
2. `composer.css` 添加 `max-height: 200px` 和 `overflow-y: auto`
3. `composer.js` 的 `clear()` 方法在清空值后 `dispatchEvent(new Event("input"))` 触发高度重置

## 生效路径

- `src/web/composer-keyboard.js` — 键盘事件处理
- `src/web/ui-shell.js` — composer hints 提示文案
- `src/web/app.js` — textarea 自动扩展逻辑
- `src/web/styles/components/composer.css` — textarea 高度约束
- `src/web/components/composer.js` — 清空后触发高度重置

## 设计约束摘要

- **边界**：只改 issue 对话输入框，不动 evolution-conversation 的输入行为
- **关键决策**：Enter 换行、Shift+Enter 发送，与主流聊天应用（Slack、Discord 默认模式）一致
- **语义不变量**：mention 选择时 Enter 仍为确认，不被换行覆盖

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 改动 |
|---|---|
| `src/web/composer-keyboard.js` | Enter/Shift+Enter 行为互换 |
| `src/web/ui-shell.js` | composer hints 补充 "Shift+Enter 发送" 提示 |
| `src/web/app.js` | textarea 自动扩展 input 事件监听 |
| `src/web/styles/components/composer.css` | 添加 max-height 和 overflow-y |
| `src/web/components/composer.js` | clear() 后 dispatchEvent 触发高度重置 |

## 验证

### P1

- [ ] 在输入框中按 Enter，光标换行到下一行，不发送消息
- [ ] 按 Shift+Enter，消息发送成功
- [ ] 点击发送按钮，消息发送成功
- [ ] @mention 建议激活时按 Enter 仍为确认选择
- [ ] @mention 建议激活时按 Shift+Enter 仍为发送
- [ ] 输入多行文本，textarea 自动扩展高度
- [ ] 超过 200px 后出现滚动条
- [ ] 发送后 textarea 恢复初始 54px 高度

## 关联

无

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | 用户习惯 Enter 发送 vs 换行 | 采用换行模式，与 Slack/Discord 默认一致；发送按钮始终可用 | 2026-06-04 |
| 2 | textarea 固定 54px 与多行输入矛盾 | 检视发现 UX 退化，加回自动扩展（上限 200px） | 2026-06-04 |

## 范围变更记录

| 日期 | 变更内容 | 原因 | 用户确认 |
|---|---|---|---|
| 2026-06-04 | 新增 textarea 自动扩展（P1） | 加压检视发现固定 54px 高度在 Enter 换行后产生 UX 退化 | 已确认（用户要求 WeChat 风格自动扩展） |
