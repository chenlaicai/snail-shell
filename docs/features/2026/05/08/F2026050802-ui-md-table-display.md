---
id: F2026050802
title: UI Markdown 表格展示
from_ids: []
tags: [ui]
modules: [project_management]
---
# F2026050802 UI Markdown 表格展示

## 背景

当前 UI 消息正文已经能识别部分 Markdown 语法，但用户观察到表格等内容仍呈现为接近原始文本的效果，导致“看起来不是 Markdown 渲染”。这影响 agent 输出结构化结论、对比信息和阶段产物摘要时的可读性。

## 目标

1. 确认 UI 消息正文 Markdown 渲染链路中表格未按预期展示的根因。
2. 让常见 Markdown 表格在 UI 中呈现为表格效果，而不是普通段落或纯文本。
3. 保持既有段落、列表、代码块等 Markdown 展示能力不退化。
4. 补充必要样式与验证记录，确保桌面和移动端可读。

## 非目标

1. 不引入新的 Markdown 编辑器或富文本编辑能力。
2. 不改变消息存储格式、消息协议或 agent 输出格式。
3. 不处理完整 GitHub Markdown 全量特性之外的复杂扩展语法。

## 设计

UI 层应把消息内容作为 Markdown 文本渲染，同时支持 GFM 表格这类实际协作中高频使用的扩展语法。表格的能力边界应在前端渲染层解决，不改变后端存储和消息传输结构。

渲染时需要同时处理语法能力和视觉样式：如果解析器不支持表格，表格会退化为文本；如果解析器生成了 `<table>` 但缺少 CSS，也会让用户误以为没有 Markdown 效果。因此实现需覆盖解析链路和 `.markdown-block` 表格样式。

根因确认：当前 `src/web/message-renderer.js` 的 `renderMarkdownBody` 是手写的安全行级解析器，只识别标题、列表、引用和单行代码块，不识别 GFM 表格；`src/web/styles.css` 也只为结构化 `table` 内容块设置 `.table-block table` 样式，没有覆盖 Markdown 正文内的表格。

实现取舍：继续使用 DOM API 和 `textContent` 构造 Markdown 表格，不把 assistant 输出的 Markdown 直接转为 HTML 字符串，避免为了表格展示引入新的 HTML sanitization 边界。

## 生效路径

1. 前端消息正文 Markdown 渲染代码。
2. 前端全局或组件样式中的 Markdown 表格样式。
3. 自动化测试、构建或人工验证记录。

## 改动范围

预计涉及：

1. `src/web/markdown-table.js`：新增无 DOM 依赖的 Markdown 表格解析逻辑。
2. `src/web/message-renderer.js`：在 Markdown 正文渲染中识别表格并生成 DOM 表格节点。
3. `src/web/styles.css`：为 `.markdown-block table`、`th`、`td` 补齐视觉样式和横向滚动。
4. `tests/web/message-renderer-test.ts`：覆盖表格识别、无外框管道格式、HTML 文本保持为普通 cell 文本、非法分隔行不识别。

## 验证

已执行：`npm run test`，通过构建、lint 和 33 个编译后测试文件。

验证覆盖：

1. Markdown 表格表头、分隔行和数据行能被解析为表格结构。
2. 支持带外框管道和不带外框管道的常见表格写法。
3. 表格 cell 中的 HTML 片段保持为普通文本，渲染层仍通过 DOM `textContent` 输出。
4. 既有 `message-view`、`workspace-layout` 等 Web 测试继续通过，降低原有消息展示回归风险。

限制：本轮未启动浏览器进行人工视觉验证；移动端可读性通过 CSS 横向滚动策略和构建测试间接覆盖。

## 风险与决策记录

当前决策：本次只修复 UI 消息正文的 Markdown 表格展示，不改变消息数据模型和 agent 输出协议。原因是用户反馈的症状发生在展示层，且当前 feature 目标是“UI 的 md 格式展示”。

安全边界决策：不引入完整 Markdown-to-HTML 库，也不开放原始 HTML 渲染；当前 UI Markdown 仍是受控子集，表格作为高频结构化展示能力在现有安全模型内补齐。

## 范围变更记录

暂无。
