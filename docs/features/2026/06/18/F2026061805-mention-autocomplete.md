---
id: F2026061805
title: mention-autocomplete
from_ids: [F2026061803]
tags: [ux, web]
modules: [web, api]
doc_kind: spec
change_type: feature
---

# F2026061805 [web] @mention 自动补全

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

F2026061803 的 P2 目标是输入框支持 @mention 自动补全当前 stage 的 role_instance，但该 feature 已合入时未实现 P2。本次独立提取 P2 作为独立 feature 实现。

当前 `ChatInput.tsx` 是简单 textarea，无 @mention 功能。v1 有 `useMention.ts` hook 实现了完整逻辑，可作为参考。

## 目标

输入框支持 @mention 自动补全当前 stage 的 role_instance。

- 数据源：`stage.role_instances`（已展开的 `string[]`）
- 前端 UI 选择角色后，构造 `to_speakers` 数组随消息发送
- 后端直接使用前端传入的 `to_speakers`，无需正则解析
- 后端保留 fallback 逻辑（AI agent 场景仍使用 `resolveToSpeakers`）

## 非目标

- 不改变 Message 数据模型（`to_speakers: string[]` 已存在）
- 不改变 `message-payload` skill 的 mention 协议
- 不改变 AI agent 的 mention 行为
- 不改变发送按钮的点击行为

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当用户在输入框中输入 @ 时 | 应显示 role_instance 补全列表，支持键盘导航（ArrowUp/Down）和选择（Enter/Tab） | |
| B2 | 当用户在补全列表中按 ArrowDown 时 | 选中项应向下移动，循环回顶部 | |
| B3 | 当用户在补全列表中按 ArrowUp 时 | 选中项应向上移动，循环回底部 | |
| B4 | 当用户在补全列表中按 Enter 或 Tab 时 | 应确认选择，插入 @role_instance_name 到文本中，光标定位在 @name 之后 | |
| B5 | 当用户在输入框中按 Escape 且补全列表激活时 | 补全列表应关闭，不影响已输入的文本 | |
| B6 | 当用户选择 @mention 后 | 光标应定位在 `@name ` 之后，用户可继续输入 | |
| B7 | 当用户在输入框中按 Shift+Enter 且补全列表激活时 | 消息应发送，同时关闭补全列表 | |
| B8 | 当用户输入 @ 后输入过滤文本时 | 补全列表应按名称子串过滤，区分大小写不敏感 | |
| B9 | 当过滤后无匹配角色时 | 补全列表应关闭 | |
| B10 | 当用户发送包含 @mention 的消息时 | 前端应将选中的角色实例传入 `to_speakers` 字段，后端直接使用该字段路由消息 | |
| B11 | 当 `stage.role_instances` 为空且用户输入 @ 时 | 不显示补全列表，@ 作为普通文本处理 | |
| B12 | 当用户点击补全列表中的某一项时 | 应确认选择，插入 @role_instance_name 到文本中 | |

## 设计

### 数据源

- `stage.role_instances: string[]` — 已展开的角色实例列表（如 `["开发者", "审查者-1", "审查者-2"]`）
- 不使用 `currentStage.assignments`（包含 snail_key 等不需要的元数据）

### 组件职责

1. `useMention` hook（适配 v1 逻辑）：管理 mention 状态、键盘导航、过滤建议
   - **关键适配**：不直接操作 DOM（避免 React 受控组件兼容性问题），返回 `{ newValue, cursorPos }` 由 ChatInput 调用 `setValue` 更新
2. `MentionDropdown` 组件：显示补全列表 UI（绝对定位在 textarea 上方）
3. `ChatInput` 集成：监听输入变化，触发 mention 检测；将 role_instances 传递给 hook

### 数据流

```
用户输入 @ → extractMentionQuery 检测 → 过滤 role_instances →
显示补全列表 → 用户选择 → hook 返回 { newValue, cursorPos } + selectedRoles →
ChatInput 调用 setValue → 发送时构造 { text, to_speakers } →
后端直接使用 to_speakers 路由消息
```

### API 扩展

**当前 API**：
```typescript
const sendMessageBody = z.object({
  text: z.string().min(1),
  from_speaker: z.string().optional(),
});
```

**扩展后**：
```typescript
const sendMessageBody = z.object({
  text: z.string().min(1),
  from_speaker: z.string().optional(),
  to_speakers: z.array(z.string()).optional(),  // 新增
});
```

**后端处理逻辑**：
- 如果 `to_speakers` 存在且非空 → 直接使用
- 如果 `to_speakers` 不存在或为空 → fallback 到 `resolveToSpeakers`（正则提取）
- AI agent 场景仍使用 `resolveToSpeakers`（不经过此 API）

### 键盘行为契约

| 场景 | Enter 行为 | Shift+Enter 行为 | Escape 行为 |
|---|---|---|---|
| 补全列表未激活 | 换行 | 发送 | 无操作 |
| 补全列表已激活 | **确认选择** | **发送**（同时关闭补全列表） | 关闭补全列表 |

**理由**：Shift+Enter 是明确的发送意图，不应被补全列表拦截。用户可在选择后按 Escape 关闭补全列表再按 Enter 换行。

### 光标位置

选择 mention 后，光标放在 `@name ` 之后（与 v1 行为一致）。

### 多 mention 场景

使用 `lastIndexOf("@")` 策略，只处理光标前最近的 `@`（与 GitHub、Slack 等主流应用一致）。

### React 兼容性适配

v1 的 `useMention` 使用 native setter + dispatch input event 直接操作 DOM，在 React 受控组件中可能失效（native setter 修改 DOM 值后可能被 React 状态回冲）。

v2 适配方案：hook 不直接操作 DOM，而是返回 `{ newValue, cursorPos }`，由 `ChatInput` 的 `setValue` 统一管理状态。

## 生效路径

- `src/web/components/ChatInput.tsx` — @mention 集成
- `src/web/hooks/useMention.ts` — **新增**，@mention 状态管理 hook
- `src/web/components/MentionDropdown.tsx` — **新增**，@mention 补全列表 UI
- `src/infra/http/routes/issue.route.ts` — 扩展 `sendMessageBody` 支持 `to_speakers`
- `src/app/issue-collaboration/collaboration.ts` — `sendMessage` 接受 `to_speakers` 参数

## 设计约束摘要

- **边界**：扩展 API 请求体支持 `to_speakers`，不改变 Message 数据模型
- **关键决策**：
  - 数据源使用 `stage.role_instances`（已展开的字符串数组）
  - 前端 UI 选择角色后直接传入 `to_speakers`，后端优先使用该字段
  - hook 不直接操作 DOM，返回文本变换结果由 ChatInput 统一管理
  - 键盘行为：补全列表激活时 Enter 确认选择、Shift+Enter 发送、Escape 关闭补全列表
- **非目标约束**：不改变 Message 数据模型、不改变 message-payload skill
- **语义不变量**：
  - 补全列表激活时 Enter 确认选择、Shift+Enter 发送
  - 发送按钮行为不变
  - 后端保留 fallback 逻辑（AI agent 场景）

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 改动 |
|---|---|
| `src/web/components/ChatInput.tsx` | @mention 集成，传递 role_instances，管理 selectedRoles |
| `src/web/pages/IssueConversation.tsx` | 传递 stage.role_instances 到 ChatInput |
| `src/web/hooks/useMention.ts` | **新增**，@mention 状态管理 hook |
| `src/web/components/MentionDropdown.tsx` | **新增**，@mention 补全列表 UI |
| `src/infra/http/routes/issue.route.ts` | 扩展 `sendMessageBody` 支持 `to_speakers` |
| `src/app/issue-collaboration/collaboration.ts` | `sendMessage` 接受 `to_speakers` 参数 |

## 验证

> **注意**：自动化测试代码已移除（commit `7b73423c`，用户授权）。以下验证项需通过手动测试确认。

- [ ] 输入 @ 时显示 role_instance 补全列表
- [ ] 键盘 ArrowUp/Down 可导航补全列表
- [ ] Enter/Tab 确认选择，插入 @role_instance_name
- [ ] Escape 关闭补全列表
- [ ] 选择后光标定位在 @name 之后
- [ ] Shift+Enter 发送消息（无论补全列表是否激活）
- [ ] 输入 @ 后输入文本可过滤补全列表
- [ ] 过滤无匹配时补全列表关闭
- [ ] 发送消息时 `to_speakers` 字段包含选中的角色实例
- [ ] 后端直接使用 `to_speakers` 路由消息（无需正则解析）
- [ ] role_instances 为空时输入 @ 不显示补全列表
- [ ] 鼠标点击补全列表项可确认选择

## 关联

- **前置**: F2026061803（P2 @mention 设计记录）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | @mention 数据源 | `role_instances` 是已展开的字符串数组，直接可用 | `assignments` 包含 snail_key 等元数据，未来可扩展 | 使用 `role_instances` | 简单优先，YAGNI 原则；补全列表只需展示角色名 | 架构师-1, 架构师-2 | 2026-06-18 |
| D2 | mention 文本插入方式 | hook 返回 `{ newValue, cursorPos }`，ChatInput 统一 setState | hook 直接操作 DOM（v1 方式） | 返回文本变换结果，ChatInput 管理状态 | 避免 React 受控组件的兼容性风险（native setter 可能被状态回冲） | 架构师-1, 架构师-2 | 2026-06-18 |
| D3 | Shift+Enter 在补全列表时的行为 | Shift+Enter 是明确的发送意图，应优先执行 | 用户可能想在选择后继续编辑 | Shift+Enter 发送，Enter 确认选择 | 遵循 F2026060401 设计原则，Shift+Enter 是发送快捷键 | 架构师-1, 架构师-2 | 2026-06-18 |
| D4 | 多 mention 场景处理 | `lastIndexOf` 只处理光标前最近的 @ | 支持多 mention 同时编辑 | 保持 `lastIndexOf` 策略 | 与 GitHub、Slack 等主流应用一致，复杂度可控 | 架构师-1, 架构师-2 | 2026-06-18 |
| D5 | mention 数据传递方式 | 前端构造 `to_speakers` 数组，后端直接使用 | 前端插入 @text，后端正则解析 | 前端传入 `to_speakers`，后端优先使用 | 与 Message 数据模型对齐，精确无误识别，UI 驱动 | 架构师-1, 架构师-2, 用户 | 2026-06-18 |

## 范围变更记录

| 变更 | 原因 | 日期 |
|------|------|------|
| 非目标从"不改变后端 API"调整为"扩展 API 请求体支持 to_speakers" | 用户指出 Message 模型已有 `to_speakers` 字段，前端直接传入更精确 | 2026-06-18 |
| 改动范围增加后端文件（route.ts、collaboration.ts） | API 请求体扩展需要后端支持 | 2026-06-18 |
