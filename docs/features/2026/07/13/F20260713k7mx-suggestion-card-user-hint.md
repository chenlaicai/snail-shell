---
id: F20260713k7mx
title: StageSuggestionCard 确认推进时支持用户补充说明
status: locked
created_at: 2026-07-13
---

# F20260713k7mx - StageSuggestionCard 确认推进时支持用户补充说明

## 背景

Feature F20260706zqje 为 `StageActionBar`（手动推进）添加了 `user_hint` 支持，用户可填写推进说明传递给新阶段的 agent。但该 feature 遗漏了 `StageSuggestionCard`（Agent 建议推进确认）路径。

**现状**：系统中有两条 stage 推进路径：
1. **StageActionBar**（侧边栏手动推进）- 已支持 `user_hint`，有"添加推进说明..."可折叠输入框
2. **StageSuggestionCard**（对话区 Agent 建议确认）- **未支持 `user_hint`**，点击 "Confirm" 直接推进

在多 Agent 协作系统中，StageSuggestionCard 是主要的推进路径（Agent 通过 `request_stage_transition` 发起建议，用户确认）。用户点击 "Confirm" 时无法添加自定义说明，直接进入新 stage。

## 用户意图锚

| ID | 用户原话 | 来源 | 关键修饰语 | 架构师解读 |
|----|---------|------|-----------|-----------|
| UA-1 | "我点击advance stage时为什么没有自定义输入内容？" | Issue 创建消息 | 空间：无；时序：点击时；数量：无；条件：点击 advance stage；视觉属性：无 | 用户期望在推进 stage 操作中有自定义输入内容的能力 |
| UA-2 | "我记得这个需求是做过的" | Issue 创建消息 | 时序：过去已完成 | 用户确认此需求曾经实现，暗示当前存在回归或遗漏 |
| UA-3 | "现在还是点击确认就直接进入新stage了" | Issue 创建消息 | 条件：点击确认；时序：直接（无中间步骤） | 用户描述的具体痛点：点击"Confirm"按钮后无中间输入环节，直接推进 |

## 核心业务行为

1. **当用户在 StageSuggestionCard 点击 "Confirm" 推进 stage 时**，应能可选地填写补充说明（`user_hint`，最长 2000 字符） ← UA-1, UA-3
2. **当 `user_hint` 有内容时**，系统将其作为用户消息发送给新阶段的 agent（与 StageActionBar 行为一致） ← UA-1
3. **当 `user_hint` 为空时**，保持当前行为（直接推进，发送默认 kickoff 消息） ← UA-3
4. **`user_hint` 输入框默认折叠**，用户点击"添加推进说明..."展开，减少视觉干扰（与 StageActionBar 的 D2 决策一致） ← UA-1
5. **当推进被阻断触发 ForceAdvanceDialog 时**，StageSuggestionCard 的 `userHint` 应传递给 ForceAdvanceDialog（与 StageActionBar 行为一致） ← UA-1

## [design-time]

### 根因分析

F20260706zqje 的变更清单（C0-C2）覆盖了：
- C0: `collaboration.ts` 后端逻辑（advanceStage / autoInvokeNewStage）
- C1: `issue.route.ts` API 路由（advanceStageBody schema 增加 user_hint）
- C2: `StageActionBar.tsx` 前端组件（可折叠 textarea + API 传参）

但**未覆盖** `StageSuggestionCard.tsx`。这不是回归 bug（代码从未被删除），而是原始 feature 的设计遗漏——变更清单中未识别到 StageSuggestionCard 也是一个推进入口。

### 决策记录

#### D1: 修复方式 - 扩展还是新建

**问题**：是在 F20260706zqje 上补充，还是创建新 feature？

**选择创建新 feature**。理由：
- F20260706zqje 状态为 `locked`，已合入的 feature 文档不可二次修改
- 当前修复涉及新的 UI 组件（StageSuggestionCard），有独立的行为条目和验收标准

#### D2: UI 一致性

**问题**：StageSuggestionCard 的 user_hint 输入框形式是否与 StageActionBar 一致？

**选择一致**。理由：
- 两个推进入口应提供相同的用户体验
- 复用 F20260706zqje D2 的决策：可折叠 textarea，默认隐藏
- placeholder 文案保持一致："可选：填写推进原因或对新阶段的指示..."

### 变更清单

#### C1: StageSuggestionCard 增加 user_hint 输入与传参（StageSuggestionCard.tsx）

**文件**：
- `src/web/components/StageSuggestionCard.tsx`

**变更**：

1. 增加 `userHint` state 和 `showHintInput` state
2. 在 "Confirm" / "Ignore" 按钮上方增加可折叠的 textarea（与 StageActionBar 样式一致）
3. `handleConfirm()` 将 `userHint` 传递给 advance API
4. ForceAdvanceDialog 传入 `userHint` prop
5. 推进成功后清空并折叠输入

**行为规格**：

- `showHintInput` 初始值为 `false`
- 点击"添加推进说明..."按钮切换 `showHintInput`
- textarea 的 `maxLength` 为 2000
- `handleConfirm()` 中 `user_hint: userHint.trim() || undefined`
- 推进成功后（handleConfirm 成功路径）执行 `setUserHint("")` 和 `setShowHintInput(false)`
- ForceAdvanceDialog 的 `userHint` prop 传入 `userHint.trim() || undefined`
- ForceAdvanceDialog 的 `onConfirmed` 回调中执行 `setUserHint("")` 和 `setShowHintInput(false)`（与 StageActionBar.tsx:187 行为一致）

### 不兼容更新

无。所有变更都是向后兼容的：
- `user_hint` 在 API 层已是可选字段（F20260706zqje 已实现）
- 后端 `advanceStage` 已支持 `userHint` 参数（F20260706zqje 已实现）
- 本 feature 仅修改前端组件，不涉及后端变更

### 验收标准

| ID | 标准 | 验证方式 |
|----|------|----------|
| AC-1 | StageSuggestionCard 显示"添加推进说明..."按钮 | 页面加载有 stage suggestion 时 -> 验证按钮可见 |
| AC-2 | 点击按钮展开/折叠 textarea | 点击"添加推进说明..." -> textarea 出现 -> 再点击 -> textarea 消失 |
| AC-3 | 填写 userHint 后 Confirm 传递给 API | 填写"测试说明" -> 点击 Confirm -> 验证 API request body 包含 `user_hint: "测试说明"` |
| AC-4 | 不填 userHint 时 Confirm 行为不变 | 不填写 -> 点击 Confirm -> 验证 API request body 不包含 `user_hint` 或为 `undefined` |
| AC-5 | Confirm 成功后输入框清空折叠 | 推进成功后 -> 验证 textarea 清空且折叠 |
| AC-6 | ForceAdvanceDialog 携带 userHint | 填写说明 -> Confirm 触发 409 -> 验证 ForceAdvanceDialog 收到 userHint |
| AC-7 | 强制推进成功后输入框清空折叠 | 填写说明 -> Confirm 触发 409 -> ForceAdvanceDialog 确认推进 -> 验证 textarea 清空且折叠 |
| AC-8 | 新阶段收到 user_hint 作为用户消息 | 填写"请重新设计方案X" -> Confirm -> 验证新阶段收到用户消息"请重新设计方案X" |

### 实现指引

- 仅修改 `src/web/components/StageSuggestionCard.tsx` 一个文件
- 后端 API (`POST /api/stages/:stageId/advance`) 已支持 `user_hint` 字段，无需后端变更
- UI 样式类名参考 StageActionBar.tsx 的对应元素，保持视觉一致
- textarea 样式：`className="w-full rounded-md border border-white/6 bg-surface-0 px-2.5 py-1.5 text-xs text-text-primary focus:border-shell-600/40 focus:outline-none resize-none"`
- 按钮样式：`className="text-[11px] text-text-muted hover:text-text-secondary transition-colors"`
