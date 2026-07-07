---
id: F20260707mgdt
title: issue-conversation-layout-shrink-fixed-area
from_ids: [F20260706v2mn]
tags: [bugfix, frontend, layout]
modules: [web]
doc_kind: spec
---

# F20260707mgdt [web] Issue 对话界面中间栏固定区域过高 — 移除冗余内容

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

**特性类型**: bugfix（布局回归修复）
**创建日期**: 2026-07-07
**状态**: 实现完成

## 背景 [required]

### 问题描述

用户反馈：issue 对话界面中间栏的上方被固定住了，对话记录区域高度非常低，用户体验差。

### 根因溯源

**引入 commit**: `5a667867`（PR #583, F20260706v2mn，2026-07-07 合入）

F20260706v2mn 为了修复"进入 issue 不显示到对话底部"的反复回归 bug（已回归 7+ 次），执行了架构层修复 MP1：将非消息内容（issue header、stage tabs、properties grid、WS banner、divider）从滚动容器内移出到 `shrink-0` 固定区域。

**MP1 的设计意图是正确的**——分离非消息内容与滚动容器消除了 `getMaxScrollOffset` 受非消息内容干扰的根因，scroll-to-bottom bug 确实被修复了。

**但 MP1 引入了副作用**：固定区域占用约 270-300px 垂直空间。在典型笔记本屏幕（768-900px 高度）上，扣除 TopBar（56px）和输入区（~120px），消息区域仅剩 ~290-424px，严重影响可读性。

### 固定区域内容分析

| 内容 | 高度估算 | 是否必要 | 说明 |
|------|----------|----------|------|
| Issue header（ID + 标题 + 摘要） | ~80px | 部分 | 标题已在 TopBar 面包屑中显示（截断），摘要仅此处展示 |
| Stage tabs | ~40px | 是 | 必要的阶段导航，PropertiesPanel 中无等价物 |
| Properties grid（Stage/SOP/Created/Closed/Stages） | ~120px | **否** | **与右侧 PropertiesPanel 完全重复** |
| WS status banner | ~30px | 是 | 条件渲染，仅断连时显示 |
| Divider | 1px | — | 视觉分隔 |
| **合计** | **~270px** | | |

### 关键发现：Properties grid 与 PropertiesPanel 完全重复

中间栏固定区域的 properties grid 显示：Stage、SOP、Created、Closed、Stages —— 这 5 个字段全部在右侧 `PropertiesPanel`（`src/web/components/PropertiesPanel.tsx`）的 "Details" 和 "Stages" Section 中展示。

PropertiesPanel 是固定 280px 宽的右侧栏，始终可见。中间栏的 properties grid 是纯冗余内容，占用 ~120px 固定空间。

### F20260706v2mn 的风险评估

F20260706v2mn 的风险表 R1 记录了此风险：

> "非消息内容移出后，消息区域减少约 300px" — 缓解策略："非消息内容已是必要信息（header/tabs/properties），固定展示符合预期；如需优化可后续折叠"

**该缓解策略的判断有误**：properties grid 并非"必要信息"，它已在 PropertiesPanel 中展示。当时未识别到这一冗余。

## 目标 [required]

1. 恢复消息区域的有效高度，消除冗余固定内容对空间的浪费
2. 不破坏 F20260706v2mn 修复的 scroll-to-bottom 行为
3. 保持固定区域中真正必要的内容（stage tabs、WS banner）

## 非目标 [required]

- 不回退 MP1 的架构分离（非消息内容与滚动容器分离是正确的架构方向）
- 不改变 PropertiesPanel 的内容和布局
- 不重新设计 issue 界面的整体布局
- 不引入可折叠/可收起机制（增加复杂度且非当前问题根因）

## 用户意图锚 [required]

| # | 用户原话 | 来源 | 关键修饰语 | 架构师解读 |
|---|----------|------|------------|------------|
| UA-1 | "中间栏的上方被固定住了" | 消息 #4105 | 空间：中间栏上方；状态：被固定住 | 中间栏上方区域不随消息滚动，占据固定空间 |
| UA-2 | "对话记录的区域就特别的小（高度非常低）" | 消息 #4105 | 空间：对话记录区域；数量：特别的小；视觉属性：高度非常低 | 消息区域可用高度不足，严重影响阅读 |
| UA-3 | "对话文本本来就多" | 消息 #4105 | 数量：本来就多 | 消息内容量大，需要足够的垂直空间展示 |
| UA-4 | "是否是为了解决别的问题、而引入了现在的问题" | 消息 #4105 | 条件：是否为了解决别的问题 | 用户已识别到"修复引入回归"的模式，要求确认因果关系 |

## 核心业务行为 [required]

| # | 场景 | 预期行为 | 追溯 | 测试覆盖 |
|---|------|----------|------|----------|
| B1 | 当用户进入 issue 对话页面时 | 消息区域有足够高度展示多条消息，无需频繁滚动 | ← UA-2, UA-3 | P1 手动验证 |
| B2 | 当用户查看 issue 对话时 | 中间栏固定区域只包含必要内容（stage tabs、WS banner），不包含与 PropertiesPanel 重复的信息 | ← UA-1, UA-2 | P1 手动验证 |
| B3 | 当用户进入 issue 对话页面时 | 仍自动滚动到对话底部（F20260706v2mn 修复的行为不退化） | ← UA-4 | P1 手动验证 |

## 设计 [required]

### 修改点 1：移除中间栏固定区域的 properties grid

**文件**: `src/web/pages/IssueConversation.tsx`

移固定区域中的 properties grid（Stage/SOP/Created/Closed/Stages 卡片），该内容已在 PropertiesPanel 中展示。

**修改前固定区域内容**：
- Issue header（ID + 标题 + 摘要）
- Stage tabs
- **Properties grid** ← 移除
- WS status banner（条件渲染）
- Divider

**修改后固定区域内容**：
- Issue header（ID + 标题 + 摘要）
- Stage tabs
- WS status banner（条件渲染）
- Divider

**空间节省**：约 120px（从 ~270px 降至 ~150px）

**影响面计算**（900px 屏幕）：
- 修改前：900 - 56(TopBar) - 270(固定区) - 120(输入) = 454px 消息区
- 修改后：900 - 56(TopBar) - 150(固定区) - 120(输入) = 574px 消息区 (+26%)
- 768px 屏幕：修改前 322px → 修改后 442px (+37%)

### 不需要修改的部分

- `useChatScroll.ts` — 滚动逻辑不受影响，MP1 的分离架构保持不变
- `PropertiesPanel.tsx` — 右侧面板已包含完整信息，无需变更
- 滚动容器内的内容 — 不变

> **[D1]** 移除 properties grid 而非移除 issue header 或 stage tabs。正方：(1) properties grid 与 PropertiesPanel 100% 重复，移除无信息损失；(2) 节省 ~120px，是固定区域中最大的可移除项；(3) stage tabs 是必要导航，issue header 提供上下文（ID、summary 在其他位置不可见）。反方：用户可能习惯在中间栏看到属性。依据：PropertiesPanel 始终可见（280px 固定宽度），属性信息不会丢失；且 properties grid 于 PR #583（2026-07-07）当天引入，用户无习惯依赖。架构师-2 审视确认。

## 生效路径 [required]

- 代码：`src/web/pages/IssueConversation.tsx`（移除 properties grid JSX 块）
- 无配置变更、无 API 变更、无提示词变更

## 设计约束摘要 [required]

### 硬约束（违反即 bug）
- F20260706v2mn 的 scroll-to-bottom 行为不退化 ← UA-4
- 固定区域不得包含与 PropertiesPanel 重复的内容
- Stage tabs 保留在固定区域

### 语义不变量（实现中必须保持为真）
- 滚动容器内只包含虚拟消息列表和 StageSuggestionCard（F20260706v2mn 不变量保持）
- `shrink-0` 固定区域不随消息滚动（F20260706v2mn 不变量保持）

### 非目标（不得扩展）
- 不引入可折叠机制
- 不改变 PropertiesPanel
- 不回退 MP1 架构分离

## 改动范围 [required]

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/web/pages/IssueConversation.tsx` | 修改 | 移除固定区域中的 properties grid JSX 块（约第 164-177 行） |

### 实现指引

- **PropRow 函数清理**：`IssueConversation.tsx` 底部的 `PropRow` 组件（约第 285-292 行）仅被 properties grid 使用。移除 grid 后该组件变为死代码，应一并清理。约束：确认没有其他引用后再删除。

## 验证 [required]

### P1 手动验证
- [ ] 进入 issue 时，中间栏固定区域不再显示 properties grid
- [ ] 右侧 PropertiesPanel 仍完整显示 Stage/SOP/Created/Closed/Stages 信息
- [ ] 消息区域高度明显增加
- [ ] 进入 issue 时仍自动滚动到对话底部
- [ ] Stage tabs 仍显示在固定区域
- [ ] WS 断连时 banner 仍显示

### 通用
- [ ] `npm run check` 通过

## 关联 [required]

- **引入 commit**: F20260706v2mn（PR #583 — MP1 将非消息内容移到固定区域，引入此副作用）
- **被重复的组件**: `PropertiesPanel.tsx`（右侧 280px 面板，已包含相同属性信息）

## 关键决策记录 [required]

| # | 决策点 | 最终决策 | 正方 | 反方 | 状态 |
|---|--------|----------|------|------|------|
| D1 | 移除哪些固定区域内容 | 移除 properties grid | 与 PropertiesPanel 100% 重复，移除无信息损失，节省 ~120px；properties grid 于 PR #583（2026-07-07）当天引入，用户无习惯依赖 | 用户可能习惯中间栏看到属性 | 已确认（架构师-2 审视通过） |
| D2 | 是否同时移除 issue header 以进一步压缩固定区域 | 不移除，保留 issue header | issue header 包含 issue ID（8字符短 ID，TopBar 无）、status badge（PropertiesPanel 用色点非 badge）、summary（TopBar 和 PropertiesPanel 均无），提供首次进入时的上下文 | 移除可额外节省 ~80px | 已确认（架构师-2 审视通过） |

## 风险与缓解 [required]

| # | 风险 | 严重程度 | 影响 | 缓解策略 | 负责方 |
|---|------|----------|------|----------|--------|
| R1 | 用户习惯在中间栏查看属性 | 低 | 用户需转向右侧面板 | properties grid 于 PR #583（2026-07-07）当天引入，用户无习惯依赖；PropertiesPanel 始终可见，信息未丢失 | 架构师 |
| R2 | 移除 properties grid 后固定区域高度仍不理想 | 低 | ~150-190px 仍占用空间（issue header 高度随标题/摘要长度变化） | 当前先解决最大冗余项；issue header 包含独有信息（ID、summary），不宜移除 | 架构师 |
