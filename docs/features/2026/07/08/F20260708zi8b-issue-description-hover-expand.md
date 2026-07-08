---
id: F20260708zi8b
title: issue-description-hover-expand
from_ids: [F20260707mgdt]
tags: [feature, frontend, ux]
modules: [web]
doc_kind: spec
---

# F20260708zi8b [web] Issue 对话界面 — 问题描述 hover 展开/收缩

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

**特性类型**: feature（交互优化）
**创建日期**: 2026-07-08
**状态**: implemented

## 背景 [required]

### 问题描述

Issue 对话界面中间栏的固定区域包含 issue header（ID、状态、标题、摘要/描述）。当 `issue.summary`（问题描述）很长时，占据大量垂直空间，压缩下方对话区域。

前序特性 F20260707mgdt 已通过移除冗余 properties grid 节省了 ~120px，但其非目标明确标注"不引入可折叠/可收起机制"。本特性针对用户明确提出的新需求：将问题描述做成 hover 展开样式。

### 当前代码

`src/web/pages/IssueConversation.tsx` 第 144 行：

```tsx
{issue.summary && <p className="text-[14px] text-text-secondary leading-relaxed">{issue.summary}</p>}
```

`summary` 无截断，完整渲染。当文本很长时，占据多行空间。

## 目标 [required]

1. 问题描述默认收缩为一行（尾部省略），释放垂直空间给对话区域
2. 鼠标 hover 时展开显示完整内容
3. 不影响固定区域的其他内容（stage tabs、WS banner）布局

## 非目标 [required]

- 不折叠 issue 标题（标题通常简短，无需折叠）
- 不改变固定区域的架构分离（F20260706v2mn MP1 保持不变）
- 不修改 PropertiesPanel 或右侧栏
- 不引入点击展开/折叠（用户明确要求 hover 交互）

## 用户意图锚 [required]

| # | 用户原话 | 来源 | 关键修饰语 | 架构师解读 |
|---|----------|------|------------|------------|
| UA-1 | "有时候问题描述会非常长" | 消息 #4356 | 数量：非常长；条件：有时候 | summary 字段内容长度不定，长文本场景需要处理 |
| UA-2 | "压缩了下方对话的空间" | 消息 #4356 | 空间：下方对话空间；动作：压缩 | 长描述占据固定区域过多垂直空间，挤压消息滚动区域 |
| UA-3 | "鼠标移上去才展开" | 消息 #4356 | 时序：hover 时；条件：才（仅 hover 时） | 交互方式为 hover 触发展开，非点击、非始终展开 |
| UA-4 | "否则收缩为一行" | 消息 #4356 | 数量：一行；状态：否则（非 hover 时） | 默认状态为单行显示，配合省略号截断 |

## 核心业务行为 [required]

| # | 场景 | 预期行为 | 追溯 | 测试覆盖 |
|---|------|----------|------|----------|
| B1 | 当 issue.summary 存在且长度超过一行时 | 默认显示为一行，尾部省略号截断 | ← UA-1, UA-4 | P1 手动验证 |
| B2 | 当用户鼠标 hover 到描述区域时 | 展开显示完整 summary 内容 | ← UA-3 | P1 手动验证 |
| B3 | 当用户鼠标移出描述区域时 | 恢复为一行截断状态 | ← UA-3, UA-4 | P1 手动验证 |
| B4 | 当 issue.summary 为空或很短（不超过一行）时 | 正常显示，hover 无视觉变化 | ← UA-1 | P1 手动验证 |
| B5 | 当描述展开时 | 固定区域高度增加，消息区域相应缩小，scroll-to-bottom 行为不退化 | ← UA-2 | P1 手动验证 |

## 设计 [required]

### 修改点 1：summary 添加 hover 展开/收缩样式

**文件**: `src/web/pages/IssueConversation.tsx`（第 144 行）

**当前**：
```tsx
{issue.summary && <p className="text-[14px] text-text-secondary leading-relaxed">{issue.summary}</p>}
```

**修改后**：
```tsx
{issue.summary && (
  <p className="text-[14px] text-text-secondary leading-relaxed line-clamp-1 hover:line-clamp-none">
    {issue.summary}
  </p>
)}
```

**原理**：
- `line-clamp-1`：Tailwind 工具类，限制为 1 行显示，超出部分用省略号截断。项目已在 `WorkspaceDirectory.tsx`（`line-clamp-2`）和 `KnowledgeLibrary.tsx`（`line-clamp-3`）中使用此模式。
- `hover:line-clamp-none`：鼠标 hover 时移除行数限制，显示完整内容。

**不需要 group-hover 的原因**：hover 目标就是 `p` 元素本身，不需要父容器作为 hover 区域。

**不需要 transition 的原因**：`line-clamp` 属性不可动画化，添加 transition 无效果。

### 不需要修改的部分

- `useChatScroll.ts` — 滚动逻辑不受影响
- `PropertiesPanel.tsx` — 右侧面板无变更
- 固定区域架构（MP1）— `shrink-0` 分离保持不变

> **[D1]** 使用 `line-clamp-1` + `hover:line-clamp-none` 而非 `truncate` + `hover:whitespace-normal`。正方：(1) `line-clamp-1` 是项目已有模式（WorkspaceDirectory、KnowledgeLibrary），一致性更好；(2) `truncate` 使用 `white-space: nowrap`，hover 时切换 `whitespace-normal` 需要额外处理 `overflow`，组合不如 `line-clamp` 简洁。反方：`truncate` 是更基础的 Tailwind 类。依据：项目一致性优先。

## 生效路径 [required]

- 代码：`src/web/pages/IssueConversation.tsx`（第 144 行，修改 `p` 标签的 className）
- 无配置变更、无 API 变更、无提示词变更

## 设计约束摘要 [required]

### 硬约束（违反即 bug）
- F20260706v2mn 的 scroll-to-bottom 行为不退化
- 固定区域 `shrink-0` 架构分离保持不变

### 语义不变量（实现中必须保持为真）
- 非 hover 状态下 summary 最多占 1 行
- hover 状态下 summary 显示完整内容
- summary 为空时不渲染该元素

### 非目标（不得扩展）
- 不对 issue title 做折叠
- 不引入点击展开
- 不修改 PropertiesPanel

## 改动范围 [required]

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/web/pages/IssueConversation.tsx` | 修改 | 第 144 行 `p` 标签 className 添加 `line-clamp-1 hover:line-clamp-none` |

## 验证 [required]

### P1 手动验证
- [ ] issue.summary 较长时，默认显示为一行并带省略号
- [ ] 鼠标 hover 到描述文字时，展开显示完整内容
- [ ] 鼠标移出后，恢复为一行截断状态
- [ ] issue.summary 为空时不显示描述区域
- [ ] issue.summary 很短（不超过一行）时，显示正常，hover 无视觉变化
- [ ] 描述展开时消息区域缩小，但 scroll-to-bottom 行为正常
- [ ] Stage tabs 和 WS banner 不受 hover 影响

### 通用
- [ ] `npm run check` 通过

## 关联 [required]

- **前序特性**: F20260707mgdt（移除冗余 properties grid，非目标标注"不引入可折叠机制"）
- **架构基础**: F20260706v2mn（MP1 固定区域分离架构）
- **项目模式参考**: `WorkspaceDirectory.tsx` line-clamp-2、`KnowledgeLibrary.tsx` line-clamp-3

## 关键决策记录 [required]

| # | 决策点 | 最终决策 | 正方 | 反方 | 状态 |
|---|--------|----------|------|------|------|
| D1 | 截断方案选择 | `line-clamp-1` + `hover:line-clamp-none` | 项目已有 line-clamp 模式，一致性更好；组合更简洁 | `truncate` + `hover:whitespace-normal` 更基础 | 已确认（架构师-2 审视通过） |

## 风险与缓解 [required]

| # | 风险 | 严重程度 | 影响 | 缓解策略 | 负责方 |
|---|------|----------|------|----------|--------|
| R1 | hover 展开导致布局抖动 | 低 | 描述展开时固定区域增高，消息区域缩小，可能造成视觉跳动 | 这是用户明确要求的交互行为，布局变化是预期效果 | 架构师 |
| R2 | 移动端无 hover 事件 | 低 | 触屏设备无法触发 hover 展开 | 当前界面为桌面端应用，移动端适配不在本特性范围 | 架构师 |
