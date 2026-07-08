---
id: F20260707dgba
title: Markdown 渲染样式补全
from_ids: [F2026050802, F2026050810]
tags: [ui]
modules: [web]
---
# F20260707dgba Markdown 渲染样式补全

## 用户意图锚

| ID | 用户原话 | 来源 | 关键修饰语 | 架构师解读 |
|----|---------|------|-----------|-----------|
| UA-1 | "最终答复的md格式展示有点不好看" | msg#4289 | 空间：最终答复展示区；视觉属性：不好看 | 最终答复（set_final_body）的 Markdown 渲染视觉效果不达标，需要改善 |
| UA-2 | "比如说好像 我就没见过表格？" | msg#4289 | 视觉属性：没见过表格；条件：GFM 表格语法 | 表格是典型症状——语法被解析但视觉上不可见，用户感知为"没有表格"。暗示表格不是唯一问题，"比如说"表明存在同类未发现的问题 |

## 背景

### 历史脉络

- **F2026050802**：首次补齐 Markdown 表格展示，当时使用自研行级解析器（`message-renderer.js`），在 `styles.css` 中为 `.markdown-block table` 添加了样式。
- **F2026050810**：用户反馈多种 Markdown 语法未渲染（代码围栏、加粗等），根因是自研解析器覆盖面不足。方案改为引入 `marked` 库 + 自研白名单 sanitizer，替代自研解析器。

### 当前状态

系统已从 vanilla JS/CSS 迁移到 React/Tailwind 架构。迁移后：

1. **解析层正确**：`RichTextRenderer.tsx` 使用 `marked` v18.0.5，配置 `gfm: true, breaks: true`，GFM 表格、标题、引用等语法均能正确解析为对应 HTML 标签。
2. **安全层正确**：自研 sanitizer 的 `ALLOWED_TAGS` 包含 `table`, `thead`, `tbody`, `tr`, `th`, `td`, `blockquote`, `h1-h6`, `hr` 等标签，允许它们通过。
3. **样式层缺失**：`MarkdownBlock` 组件的 Tailwind className 只为 `a`, `code`, `li`, `ol`, `p`, `pre`, `ul` 添加了样式。以下元素在解析和安全层均正确处理，但渲染时**零样式**：

| 元素 | 当前表现 | 用户感知 |
|------|---------|---------|
| `table`/`thead`/`tbody`/`tr`/`th`/`td` | 无边框、无内边距、无表头区分 | "没见过表格"——暗色主题下不可见 |
| `h1`-`h6` | 无字号/字重区分 | 标题与正文混为一体 |
| `blockquote` | 无缩进、无左侧标记线 | 引用内容无法视觉区分 |
| `hr` | 无可见分隔线 | 水平分隔不可见 |
| `del`/`em`/`strong` | 依赖浏览器默认样式 | 基本可用但缺乏一致性 |
| `ol`/`ul`/`li` | Tailwind v4 preflight 移除 `list-style`，全局重置移除 padding | 有序列表无序号、无序列表无圆点，退化为间距较小的段落 |
| `code`（行内） | 仅有文字颜色（`text-shell-300`），无背景、无内边距、无圆角 | 行内代码与正文区分度不足，不像"代码" |

4. **功能层缺陷**：GFM task list 语法（`- [ ]` / `- [x]`）由 `marked` 解析为 `<input type="checkbox" disabled>`，但 `input` 不在 `ALLOWED_TAGS` 中，checkbox 被 sanitizer 移除，task list 退化为普通列表项。

### 根因

F2026050810 完成时，markdown 样式写在 `styles.css` 的 `.markdown-block` 选择器下。迁移到 React/Tailwind 后，`styles.css` 中的 markdown 元素样式未迁移到 `RichTextRenderer.tsx` 的 Tailwind className 中。解析和安全层在迁移时正确保留，但样式层出现遗漏。

## 目标

1. 让 GFM 表格在暗色主题下有清晰的视觉结构（边框、内边距、表头区分）。
2. 让标题、引用、水平线等 Markdown 元素有符合暗色主题的视觉表现。
3. 让 GFM task list 的 checkbox 正确渲染（功能性修复）。
4. 不引入新的 Markdown 解析库或改变现有解析/安全链路。

## 非目标

1. 不改变 `marked` 配置或替换解析库。
2. 不改变 sanitizer 的安全模型（不开放 `script`、事件属性等）。
3. 不新增代码高亮主题。
4. 不改变消息存储格式或 API 协议。

## 设计

### 修复策略

在 `RichTextRenderer.tsx` 的 `MarkdownBlock` 组件 className 中补齐缺失元素的 Tailwind 样式。这是纯样式层修复——解析层和安全层已正确工作，无需改动。

### 各元素样式规格

#### 表格（table/thead/tbody/tr/th/td）

| 行为条目 | 预期行为 | 追溯 |
|---------|---------|------|
| B-1 | 表格全宽，边框折叠（border-collapse） | ← UA-2 |
| B-2 | 表头有背景色区分（使用 `bg-surface-3`） | ← UA-2 |
| B-3 | 单元格有边框（`border-white/10`）、内边距（`px-3 py-1.5`） | ← UA-2 |
| B-4 | 表格容器支持横向滚动，防止宽表格撑破布局 | ← UA-1 |
| B-5 | 表头文字左对齐（支持 `align` 属性覆盖） | ← UA-2 |

#### 标题（h1-h6）

| 行为条目 | 预期行为 | 追溯 |
|---------|---------|------|
| B-6 | h1-h6 有字号和字重递减层级 | ← UA-1 |
| B-7 | 标题与上下文有适当间距（`mt-4 mb-2` 量级） | ← UA-1 |

#### 引用（blockquote）

| 行为条目 | 预期行为 | 追溯 |
|---------|---------|------|
| B-8 | 引用块有左侧边框线（`border-l-2 border-shell-400/40`） | ← UA-1 |
| B-9 | 引用块有左内边距（`pl-3`）和文字颜色淡化（`text-text-secondary`） | ← UA-1 |

#### 水平线（hr）

| 行为条目 | 预期行为 | 追溯 |
|---------|---------|------|
| B-10 | hr 渲染为可见的分隔线（`border-white/10`），有上下间距 | ← UA-1 |

#### Task list（input）

| 行为条目 | 预期行为 | 追溯 |
|---------|---------|------|
| B-11 | sanitizer 允许 `input` 标签，限制属性为 `type`（仅 `checkbox`）、`disabled`、`checked` | ← UA-1 |
| B-12 | task list checkbox 不可交互（`disabled`），仅作展示 | ← UA-1 |
| B-13 | task list 项有适当缩进，checkbox 与文字有间距 | ← UA-1 |

#### 删除线/斜体/加粗（del/em/strong）

| 行为条目 | 预期行为 | 追溯 |
|---------|---------|------|
| B-14 | `del` 有删除线样式（浏览器默认，确认暗色主题下可见） | ← UA-1 |
| B-15 | `em` 有斜体样式（浏览器默认） | ← UA-1 |
| B-16 | `strong` 有加粗样式（浏览器默认） | ← UA-1 |

#### 列表标记（ol/ul/li）

> **背景**：Tailwind v4 preflight（`@import "tailwindcss"`）对 `ol, ul, menu` 设置 `list-style: none`；`globals.css` 第 46 行全局重置 `* { margin: 0; padding: 0; }`。当前 `MarkdownBlock` className 仅有 `[&_ol]:my-2 [&_ul]:my-2 [&_li]:my-1`（间距），缺少 `list-style-type` 和 `padding-left`，导致列表无序号/圆点。

| 行为条目 | 预期行为 | 追溯 |
|---------|---------|------|
| B-17 | `ol` 有序号标记（`list-decimal`） | ← UA-1 |
| B-18 | `ul` 有圆点标记（`list-disc`） | ← UA-1 |
| B-19 | `ol`/`ul` 有左内边距以容纳标记（`pl-6` 量级） | ← UA-1 |
| B-20 | 嵌套列表有递增缩进 | ← UA-1 |

#### 行内代码（code）

> **背景**：当前 `[&_code]:text-shell-300` 仅设置文字颜色。`marked` 对行内代码产出 `<code>`，对代码块产出 `<pre><code>`。`[&_code]` 选择器匹配两者，需确保 `pre > code` 不受行内代码背景样式影响。

| 行为条目 | 预期行为 | 追溯 |
|---------|---------|------|
| B-21 | 行内 `code` 有背景色（`bg-surface-2` 或 `bg-white/5`）、小内边距（`px-1 py-0.5`）、圆角（`rounded`） | ← UA-1 |
| B-22 | `pre > code` 不应用行内代码的背景/内边距/圆角（由 `pre` 容器统一样式） | ← UA-1 |

### 安全约束

- `input` 标签仅允许 `type="checkbox"`、`disabled`、`checked` 三个属性，不允许 `name`、`value`、`onclick` 等。
- sanitizer 对 `input` 的 `type` 属性值做白名单校验，非 `checkbox` 值移除整个 `input` 节点。

### 实现指引

**B-4 表格横向滚动**：`MarkdownBlock` 使用 `dangerouslySetInnerHTML` 注入 HTML，无法给单个 `<table>` 包裹 wrapper div。预期方向：通过 Tailwind 的 `[&_table]:block [&_table]:overflow-x-auto` 或 `[&_table]:table-fixed [&_table]:w-full` 实现。关键约束：不能改变 `marked` 的输出结构，只能在 className 层面控制。

**B-5 表格 align 属性**：GFM 表格对齐语法（`:---:`, `---:`）由 `marked` 转为 `<th align="center">`。Tailwind 的 `text-left` 类选择器优先级高于 HTML `align` 属性的 presentational hint，会覆盖对齐。预期方向：不对 `th`/`td` 设置默认 `text-align`（浏览器默认左对齐），让 `align` 属性自然生效。关键约束：GFM 对齐语法必须正常工作。

**B-21/B-22 行内代码与代码块区分**：`[&_code]` 同时匹配行内 `code` 和 `pre > code`。预期方向：先对 `code` 设置行内样式（背景/内边距/圆角），再用 `[&_pre_code]` 覆盖为透明背景/无内边距。关键约束：不能改变 `marked` 的输出结构。

## 生效路径

1. `src/web/components/RichTextRenderer.tsx` — 补齐 `MarkdownBlock` className 中缺失元素的 Tailwind 样式；在 `ALLOWED_TAGS` 中添加 `input`；在 `ALLOWED_ATTRIBUTES` 中添加 `input` 的属性白名单和 `type` 值校验。

## 改动范围

| 文件 | 改动内容 |
|------|---------|
| `src/web/components/RichTextRenderer.tsx` | 1. `MarkdownBlock` className 补齐 table/thead/tbody/tr/th/td/h1-h6/blockquote/hr/ol/ul/code 的 Tailwind 样式<br>2. `ALLOWED_TAGS` 添加 `input`<br>3. `ALLOWED_ATTRIBUTES` 添加 `input` 属性白名单<br>4. `sanitizeNode` 中对 `input` 的 `type` 属性做值校验 |

## 验收标准

| ID | 标准 | 追溯 |
|----|------|------|
| AC-1 | GFM 表格在暗色主题下有可见边框、表头背景区分、单元格内边距 | ← B-1~B-5 |
| AC-2 | h1-h6 有可区分的字号层级 | ← B-6, B-7 |
| AC-3 | blockquote 有左侧标记线和缩进 | ← B-8, B-9 |
| AC-4 | hr 有可见分隔线 | ← B-10 |
| AC-5 | GFM task list `- [ ]` 和 `- [x]` 正确渲染 checkbox | ← B-11~B-13 |
| AC-6 | 宽表格不撑破布局（横向滚动） | ← B-4 |
| AC-7 | sanitizer 不允许 `input` 的非 checkbox type 值 | ← B-11 |
| AC-8 | 有序列表显示序号，无序列表显示圆点 | ← B-17, B-18 |
| AC-9 | 列表有左缩进容纳标记，嵌套列表递进缩进 | ← B-19, B-20 |
| AC-10 | 行内代码有背景色、内边距、圆角；代码块内的 code 不受行内样式影响 | ← B-21, B-22 |

## 风险与决策记录

### 决策 1：在 Tailwind className 中补齐样式，不恢复 CSS 文件

**正方**：当前架构已全面采用 Tailwind，所有组件样式统一用 className 管理。恢复 `globals.css` 中的 markdown 样式会引入两套样式系统，增加维护成本。

**反方**：Tailwind 的 `[&_table]:...` 语法可读性较差，复杂表格样式可能不如 CSS 清晰。

**结论**：采用 Tailwind className，与现有 `MarkdownBlock` 的样式管理方式一致。

### 决策 2：允许 `input` 标签通过 sanitizer

**正方**：GFM task list 是 marked + gfm 的标准输出，不允许 `input` 会导致功能退化。

**反方**：扩大攻击面——`input` 标签理论上可以用于表单注入。

**结论**：允许 `input` 但严格限制属性（仅 `type=checkbox`、`disabled`、`checked`），在 sanitizer 中对 `type` 属性值做白名单校验。安全风险可控。

## 不兼容更新

无。

## 范围变更记录

1. **交叉审视补充**：架构师-2 发现列表标记缺失——Tailwind v4 preflight 移除 `ol/ul` 的 `list-style`，全局重置移除 padding，当前 className 未补回，导致列表无序号/圆点。新增 B-17~B-20、AC-8~AC-9。属于"不好看"的同类症状，纳入本次修复范围。
2. **行内代码样式补强**：架构师-2 发现行内 `code` 仅有文字颜色，无背景/内边距/圆角，视觉区分度不足。用户确认纳入。新增 B-21~B-22、AC-10。
