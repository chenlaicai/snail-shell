---
id: F20260629huz7
title: ui-optimization-3
tags: [feature, web]
modules: [web]
doc_kind: spec
---

# F20260629huz7 — UI 优化三则

## Meta

- **编号**: F20260629huz7
- **类型**: feature
- **状态**: locked
- **创建**: 2026-06-29
- **锁定**: 2026-06-29（架构师-1 + 架构师-2 交叉审视完成）

## Background

用户反馈三个 UI 问题：
1. @mention 下拉候选框在输入框靠近屏幕底部时溢出可视区域
2. 用户消息和最终答复区域缺少复制按钮
3. 右侧栏 Activity 区块只显示 issue 创建和当前 stage 进入，不显示历史 stage 切换记录

## Core Business Behavior

### B1: Mention Dropdown 视口自适应

**当前行为**: `MentionDropdown` 使用 `absolute top-full` 固定向下展开，当输入框靠近屏幕底部时，下拉列表被截断。

**期望行为**: 下拉列表应检测可用空间，空间不足时向上展开（flip upward）。上下空间都不够时限制高度并滚动。

### B2: 消息复制按钮

**当前行为**: `ChatMessage` 组件无复制功能，用户需手动选择文本复制。

**期望行为**: 每条用户消息和最终答复右上角显示复制按钮，点击后将内容复制到剪贴板并显示 toast 反馈。

### B3: Activity 历史记录

**当前行为**: `PropertiesPanel` 的 Activity 区块硬编码两条静态记录（created issue + entered current stage），stage 切换后不更新历史。

**期望行为**: Activity 区块显示所有已进入 stage 的记录（按时间排序），stage 推进时自动追加新记录。

## Design

### D1: Mention Dropdown 视口自适应

**方案**: 使用 `useLayoutEffect` + `getBoundingClientRect()` 检测下拉框位置，空间不足时切换为 `bottom-full` 向上展开。

**实现要点**:
- `MentionDropdown` 组件内部维护 `flip` 状态
- 渲染后检测：如果 `dropdown.getBoundingClientRect().bottom > viewportHeight`，则 flip=true
- flip=true 时使用 `bottom-full mb-1` 代替 `top-full mt-1`
- 需要监听 `suggestions` 变化重新检测
- **边界处理**: flip 向上后如果顶部空间也不够（`dropdown.getBoundingClientRect().top < 0`），限制下拉框高度为 `max-h-[50vh]` 并保持滚动

**取舍说明**:
- 不监听 `window.resize` 事件重新计算——场景罕见（用户在下拉框展开时调整窗口），额外监听增加复杂度，收益低
- 不引入第三方定位库（Floating UI 等），保持轻量
- 不改变现有键盘导航和鼠标选择逻辑

### D2: 消息复制按钮

**方案**: 在 `ChatMessage` 组件的用户消息和最终答复气泡右上角均添加复制按钮（hover 时显示）。

**复制内容源**:
- **assistant 消息**: 优先 `message.context.context`，fallback `message.content`
- **user 消息**: `message.content`（user 消息无 context）
- 使用 `navigator.clipboard.writeText()`，包裹 try-catch，失败时 `showToast("复制失败", true)`

**UI 位置**: 气泡右上角，与现有 `kind` badge 共存（badge 在 `absolute top-2 right-3`，复制按钮在其左侧）

**反馈**: 复制成功后调用 `showToast("Copied")` 已有 toast 组件

**约束**:
- system 消息不显示复制按钮（居中标签样式，无实质内容）
- streaming 状态下不显示复制按钮（内容未完成）
- 复制按钮 hover 时显示，避免视觉干扰

### D3: Activity 历史记录

**方案**: `PropertiesPanel` 接收 `issue.stages` 数组，渲染所有 stage 的进入记录。

**数据源**: `issue.stages` 已包含所有 stage 记录（含 `entered_at`、`title`、`status`），无需新增 API。

**渲染逻辑**:
- 保留 "System created issue" 作为第一条
- 遍历 `issue.stages`，每个 stage 生成一条 ActivityItem
- action 文本：`entered "{stage.title}"`（与当前格式一致）
- 时间：使用 `stage.entered_at`
- 排序：按 `entered_at` 升序（数组顺序可能不稳定，以时间为准）
- 只显示 entered 事件，不显示 left 事件（保持简洁）

**约束**:
- 不改变 ActivityItem 组件结构
- 不引入实时事件流（当前需求仅要求 stage 历史，不要求消息级 activity）

## Open Questions

无

## Task Anchor

- **本质目标**: 提升 UI 可用性——下拉框不溢出、消息可复制、stage 历史可见
- **反目标**: 不引入重量级依赖、不改变现有交互逻辑
- **成功标准**: 三个优化项在视觉和功能上均符合预期，无回归

## Design-time Decisions

| # | 决策 | 正面 | 负面 | 结论 |
|---|------|------|------|------|
| 1 | Dropdown 定位方案 | 纯 CSS + React state，轻量无依赖 | 需要手动计算，不如 Floating UI 精确 | 采用，场景简单无需重量级方案 |
| 1a | 上下空间都不够 | 限制 max-h-[50vh] + 滚动 | 视觉上被截断 | 采用，极端场景可接受 |
| 1b | 不监听 resize | 减少复杂度 | 窗口调整时下拉位置可能不准 | 采用，场景罕见 |
| 2 | 复制按钮覆盖范围 | user + assistant 消息均覆盖 | 增加 UI 元素 | 采用，用户明确要求"两个框" |
| 2a | clipboard 失败处理 | try-catch + toast 错误提示 | 额外代码 | 采用，健壮性必要 |
| 3 | Activity 排序 | 按 entered_at 升序，稳定可预期 | 需要排序计算 | 采用，数组顺序不可靠 |
| 3a | 只显示 entered | 保持简洁，条目可控 | 丢失 left 信息 | 采用，用户需求是"进入"记录 |
