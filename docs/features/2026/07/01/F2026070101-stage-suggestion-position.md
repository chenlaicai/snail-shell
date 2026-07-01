---
id: F2026070101
title: stage-suggestion-position
from_ids: [F2026060306]
tags: [ui, ux]
modules: [web]
doc_kind: spec
---

# F2026070101 [web] Stage Suggestion / Actions 显示位置优化

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

当前 `StageSuggestionCard`（AI 推进建议）和 `StageActionBar`（手动推进/关闭按钮）均渲染在 `IssueConversation` 页面的**滚动区域顶部**（issue header 和 properties grid 下方、消息列表上方）。

用户交互流程的断裂点：

1. **用户视角停留在对话底部**：对话是降序排列（最新消息在底部），用户默认阅读位置在页面底部。
2. **操作目标在页面顶部**：stage 推进建议和操作按钮在滚动区域顶部，用户每次需要操作时必须向上滚动。
3. **操作频率高**：stage 推进是核心工作流中的高频操作，每次 agent 完成工作后用户都需要确认或手动推进。
4. **滚动距离随对话增长**：随着对话消息增多，顶部与底部的距离越来越远，操作成本持续上升。

## 目标

将两个操作组件移至**不随对话滚动的固定可见区域**，用户无需滚动即可看到和操作。

## 非目标

- 不改变 `StageSuggestionCard` 和 `StageActionBar` 的内部逻辑（API 调用、状态管理、显示条件）
- 不改变消息列表的虚拟滚动机制
- 不引入新的后端 API

## 设计

### 核心决策：分组件定位

从交互设计角度分析，两个组件有不同的语义，应该放在不同的位置：

| 组件 | 语义 | 交互特征 | 最佳位置 |
|------|------|----------|----------|
| StageSuggestionCard | AI 发出的"建议消息" | 动态出现/消失，时间敏感 | 对话流末尾（消息列表下方） |
| StageActionBar | issue 的"控制面板" | 相对固定，随时可用 | 右侧 PropertiesPanel 顶部 |

**理由**：
- **StageSuggestionCard 是对话内容**：它是 AI 对用户说的话（"建议推进到 X"），放在对话流末尾符合对话语义。用户在对话底部时自然看到。
- **StageActionBar 是控制面板**：它是 issue 级别的操作（推进、关闭），不是对话内容。放在右侧 PropertiesPanel 与其他 issue 属性（详情、角色、阶段列表）放在一起，符合"属性+操作"的 UI 模式（Jira、Linear 等工具的常见范式）。
- **右侧栏始终可见**：PropertiesPanel 固定在视口右侧，不随对话滚动，StageActionBar 放在其中顶部可保证始终可见。

### 布局变更

变更前：
```
scrollable area
  ├── issue header
  ├── properties grid
  ├── StageSuggestionCard    ← 当前位置
  ├── StageActionBar         ← 当前位置
  ├── messages (virtual list)
  └── scroll buttons

PropertiesPanel (右侧)
  ├── Details
  ├── Roles / Context / Participants
  └── Stages / Activity
```

变更后：
```
scrollable area
  ├── issue header
  ├── properties grid
  ├── messages (virtual list)
  ├── StageSuggestionCard    ← 新位置（对话流末尾）
  └── scroll buttons

PropertiesPanel (右侧)
  ├── StageActionBar         ← 新位置（顶部操作区）
  ├── Details
  ├── Roles / Context / Participants
  └── Stages / Activity
```

### 技术说明

**StageSuggestionCard 位置**：虚拟列表容器使用 `height: getTotalSize()` + `position: relative`，容器高度等于所有消息总高度。StageSuggestionCard 放在容器之后，自然排在最后一条消息下方。

**StageActionBar 移入 PropertiesPanel**：
- PropertiesPanel 已有 `overflow-y-auto`，独立滚动
- StageActionBar 放在 PropertiesPanel 内容顶部（`<aside>` 内 `<div>` 的第一个子元素），在所有 section 之前
- PropertiesPanel 已接收 `issue` 和 `stage` props，StageActionBar 需要的 `onStageChanged` 回调需从 IssueConversation 传入
- StageActionBar 宽度适配：进入侧边栏后改为**垂直堆叠**布局——select 和按钮各占一行，与 PropertiesPanel 内其他 section 的视觉风格一致。当前水平布局（`Stage Actions` 标签 + select + `Advance Stage` + 分隔线 + `Close Issue` 在一行）在 280px 侧边栏中空间不足，垂直排列可保证所有元素正常显示且不溢出

### 边界场景

| 场景 | StageSuggestionCard | StageActionBar |
|------|---------------------|----------------|
| stage in_progress + 有建议 | 渲染在消息列表下方 | 渲染在 PropertiesPanel 顶部 |
| stage in_progress + 无建议 | null | 渲染在 PropertiesPanel 顶部 |
| stage completed | null | null（PropertiesPanel 正常显示其他内容） |
| issue closed | null | null |
| 首次加载无 stage | null | null |

## 核心业务行为

1. **当 stage 处于 in_progress 且存在 AI 建议时，建议卡片出现在对话消息末尾，用户在对话底部可直接看到并点击确认**
2. **当 stage 处于 in_progress 时，StageActionBar 显示在右侧 PropertiesPanel 顶部，用户无需滚动即可看到推进和关闭按钮**
3. **当无建议时，建议卡片不渲染；当 stage 非 in_progress 时，StageActionBar 不渲染**
4. **StageSuggestionCard 和 StageActionBar 的显隐条件、API 调用逻辑不变**

## 不兼容更新

无。纯前端布局变更，不涉及 API 或数据模型变化。

## 影响文件

| 文件 | 改动 |
|------|------|
| `src/web/pages/IssueConversation.tsx` | 从滚动区域移除两个组件；将 StageSuggestionCard 放到虚拟列表容器之后；将 StageActionBar 的 props 传给 PropertiesPanel |
| `src/web/components/PropertiesPanel.tsx` | 新增 StageActionBar 渲染（顶部），接收 `onStageChanged` prop |

## 验收标准

- [ ] stage in_progress + 有 AI 建议时，建议卡片显示在对话消息末尾，用户在对话底部可直接看到
- [ ] stage in_progress + 有 AI 建议时，点击 "Confirm" 正确执行推进
- [ ] stage in_progress + 有 AI 建议时，点击 "Ignore" 正确忽略建议
- [ ] stage in_progress 时，StageActionBar 显示在右侧 PropertiesPanel 顶部，"Advance Stage" 和 "Close Issue" 正常工作
- [ ] stage in_progress + 多个可选目标阶段时，StageActionBar 的下拉选择器和按钮在侧边栏中正常显示
- [ ] stage completed 时，StageSuggestionCard 和 StageActionBar 均不渲染
- [ ] issue closed 时，StageSuggestionCard 和 StageActionBar 均不渲染
- [ ] 消息列表的虚拟滚动、上拉加载历史、粘性底部等行为不受影响
- [ ] PropertiesPanel 的其他内容（Details、Roles、Context、Stages、Activity）正常显示，不受 StageActionBar 影响

## 决策记录

| 时间 | 决策 | 正方论点 | 反方论点 | 结论 |
|------|------|----------|----------|------|
| 2026-07-01 | 初始方案：两个组件移至输入框上方固定区域 | 始终可见 | StageActionBar 是固定按钮，放对话区域语义不对 | 被用户纠正 |
| 2026-07-01 | 修订 v1：仅移 StageSuggestionCard，StageActionBar 保持顶部 | 建议卡片语义正确 | StageActionBar 仍在顶部，用户仍需滚动 | 被用户纠正 |
| 2026-07-01 | 修订 v2：StageSuggestionCard → 对话末尾，StageActionBar → PropertiesPanel | 两个组件都在固定可见区域；语义匹配（对话内容 vs 控制面板）；符合 Jira/Linear 等工具的常见模式 | PropertiesPanel 宽度 280px 需要适配 | 采用 |
| 2026-07-01 | 交叉审视：多 transition 验收 | 架构师-2 指出下拉选择器场景需覆盖 | — | 补充验收标准 |
| 2026-07-01 | 侧边栏适配：垂直堆叠 | 架构师-2 指出水平布局在 280px 侧边栏中空间不足 | — | 改为垂直堆叠，与 PropertiesPanel 其他 section 风格一致 |

## 交叉审视结论

- 初始方案和修订 v1 经架构师-2 审视通过
- 用户两次纠正后形成修订 v2（当前方案）
- 修订 v2 经架构师-2 审视通过，确认侧边栏垂直堆叠适配方案

<!-- [design-time] 章节结束 -->
