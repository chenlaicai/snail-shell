---
id: F20260713f8g9
title: ForceAdvanceDialog 支持用户补充说明
status: locked
created_at: 2026-07-13
---

# F20260713f8g9 - ForceAdvanceDialog 支持用户补充说明

## 背景

F20260706zqje 为 StageActionBar（右侧栏手动推进）添加了 `user_hint` 支持，但**遗漏了 ForceAdvanceDialog**（409 阻断后的强制推进对话框）。

用户点击 StageActionBar 的 "Advance Stage" -> 推进被 409 拦截 -> ForceAdvanceDialog 打开 -> 对话框内**没有 hint 输入框** -> 用户无法添加补充说明。

前序 F20260713k7mx（PR #602）根因判断有误，修复了 StageSuggestionCard 而非 ForceAdvanceDialog。PR #602 的变更（为 StageSuggestionCard 的正常 Confirm 路径添加 hint 输入）仍然有效，与本特性互补。

### 根因链路

1. StageActionBar 的"添加推进说明..."按钮虽存在（`StageActionBar.tsx:146-151`），但样式为 `text-[11px] text-text-muted`，过于隐蔽
2. 用户未注意到该按钮，直接点击 "Advance Stage"
3. 推进被 409 阻断，ForceAdvanceDialog 打开
4. Dialog 组件使用 `<dialog>.showModal()`（`dialog.tsx:18`），原生模态 + `backdrop:bg-black/60` 遮罩阻止用户与底层 StageActionBar 交互
5. ForceAdvanceDialog 接收 `userHint` prop 用于 API 传参（`ForceAdvanceDialog.tsx:16,40`），但**无输入框 UI**
6. 用户在对话框中无法编辑或新建 hint

### 后端验证

后端已完全就绪，无需改动：
- `forceAdvance()` 接收 `userHint` 参数（`collaboration.ts:223`）
- 传递给 `autoInvokeNewStage(newStage, userHint)`（`collaboration.ts:260`）
- API 路由使用 `advanceStageBody` schema（已包含 `user_hint` 字段）（`issue.route.ts:253-254`）

## 用户意图锚

| ID | 用户原话 | 来源 | 关键修饰语 | 架构师解读 |
|----|---------|------|-----------|-----------|
| UA-1 | "我就是点击右侧栏的按钮的，就是没看到输入内容，只有'是否强制的确认信息'" | 阶段历史消息 | 空间：右侧栏；视觉属性：没看到输入内容、只有强制确认信息 | 用户使用 StageActionBar 推进，被 409 阻断后看到 ForceAdvanceDialog，对话框中无 hint 输入框 |

## 核心业务行为

1. **当用户在 ForceAdvanceDialog 中**，可以看到一个可编辑的 hint 输入框（textarea） `← UA-1`
2. **当父组件传入了 userHint 时**，输入框预填充该值 `← UA-1`
3. **当用户在对话框中编辑 hint 后点击"确认强制推进"**，编辑后的 hint 传递给 force advance API `← UA-1`
4. **当用户未填写 hint 时**，保持当前行为（不传 user_hint） `← UA-1`

## [design-time]

### 决策记录

#### D0: 输入框默认展开还是折叠

**问题**：ForceAdvanceDialog 中的 hint 输入框应该默认展开还是可折叠？

**方案 A**：默认展开
**方案 B**：可折叠，默认隐藏

**选择方案 A**。理由：
- 对话框已经是用户主动触发的上下文（点击了 Advance Stage 并被 409 阻断）
- 用户打开对话框的目的就是要强制推进，此时提供 hint 输入是合理的
- 对话框空间足够，不需要折叠节省空间
- 与 F20260706zqje D2（StageActionBar 使用可折叠）不冲突——StageActionBar 是常驻 UI，需要减少干扰；ForceAdvanceDialog 是临时模态，不需要

#### D1: userHint prop 的角色

**问题**：父组件传入的 `userHint` prop 应该如何使用？

**方案 A**：作为初始值，用户可在对话框中编辑
**方案 B**：只读展示，不可编辑

**选择方案 A**。理由：
- 用户可能需要在看到阻断原因后修改 hint
- 阻断原因可能影响用户想传达的指示内容
- 只读展示无法解决用户"看不到输入框"的问题

#### D2: 变更范围

**问题**：是否同时修改 StageSuggestionCard 的正常 Confirm 路径（添加 hint 输入）？

**方案 A**：仅修改 ForceAdvanceDialog
**方案 B**：同时修改 StageSuggestionCard

**选择方案 A**。理由：
- 用户投诉的具体场景是 ForceAdvanceDialog 缺少输入框
- StageSuggestionCard 的正常 Confirm 路径缺少 hint 输入是另一个问题，由 PR #602（F20260713k7mx）解决
- 两个 PR 互补，不冲突

### 变更清单

#### C0: ForceAdvanceDialog 增加可编辑 hint 输入框（ForceAdvanceDialog.tsx）

**文件**：
- `src/web/components/ForceAdvanceDialog.tsx`

**变更**：

1. 新增 `hintInput` state，初始值从 `userHint` prop 获取
2. 在阻断原因列表和按钮之间添加 textarea（maxLength=2000，样式与 StageActionBar 一致）
3. `handleForceAdvance()` 使用 `hintInput` 替代 `userHint` prop 传给 API
4. textarea 默认展开（无需折叠按钮）

### 不兼容更新

无。`userHint` prop 语义不变（仍是初始值来源），API 调用不变。

### 实现指引

- `hintInput` state 初始化：`useState(userHint ?? "")`
- textarea 样式参考 `StageActionBar.tsx:153-160`（`w-full rounded-md border border-white/6 bg-surface-0 px-2.5 py-1.5 text-xs ...`）
- placeholder：`"可选：填写强制推进的原因或对新阶段的指示..."`
- API 调用修改：`body: { target_key: targetKey, user_hint: hintInput.trim() || undefined }`

### 验收标准

| ID | 标准 | 验证方式 |
|----|------|----------|
| AC-0 | ForceAdvanceDialog 包含可编辑 textarea | 触发 409 阻断 -> 对话框打开 -> 可见 textarea |
| AC-1 | textarea 预填充父组件传入的 userHint | 在 StageActionBar 填写 hint -> 触发 409 -> 对话框 textarea 显示已填写的 hint |
| AC-2 | 编辑后的 hint 传递给 force advance API | 在对话框中编辑 hint -> 点击确认 -> API request body 包含编辑后的 user_hint |
| AC-3 | 未填写 hint 时行为不变 | 对话框中 textarea 为空 -> 点击确认 -> API request body 不包含 user_hint |
| AC-4 | maxLength=2000 约束 | 输入超过 2000 字符 -> 无法继续输入 |
| AC-5 | StageSuggestionCard 的 force advance 路径也获得输入能力 | 从 StageSuggestionCard 触发 409 -> 对话框打开 -> 可见可编辑 textarea |
