# F2026050810 Markdown 显示效果补全

## 背景

用户反馈“最终文本”中 Markdown 没有完整渲染，代码围栏 ` ```text ` 和 `**加粗**` 仍按纯文本展示。检查现有实现后确认，前次表格优化只为 Markdown 表格增加了专用解析和样式，未建立完整 Markdown 展示路径，导致其他常见 Markdown 语法仍未呈现为对应视觉效果。

## 目标

1. 让 assistant 最终文本和 message-out markdown 块使用同一 Markdown 展示能力。
2. 覆盖常见 Markdown 展示效果：标题、段落、无序列表、有序列表、引用、围栏代码块、行内代码、加粗和表格。
3. 保持 assistant 内容的安全边界，不把模型输出或消息内容交给 `innerHTML` 直接解析。
4. 增加测试覆盖，避免后续只保留表格渲染而遗漏常用内联语法。

## 非目标

1. 不引入第三方 Markdown 依赖。
2. 不实现完整 CommonMark/GFM 规范的所有语法，例如链接、图片、任务列表、嵌套列表和复杂转义。
3. 不改变消息数据结构、持久化格式或 message-out 协议。

## 设计

现有 `src/web/message-renderer.js` 已经把 assistant 最终文本按 `createMarkdownBlock` 展示，但 `renderMarkdownBody` 只处理表格、简单标题、单行引用、单一 `- ` 列表和极窄的单行代码围栏。此次将该路径扩展为统一的安全 Markdown 子集渲染：块级结构仍在 `renderMarkdownBody` 中按行识别，内联结构拆到 `src/web/markdown-inline.js`，由 DOM API 创建 `strong`、`code` 或文本节点。

该设计避免 `innerHTML` 解析用户或模型生成内容。表格单元格、段落、标题、列表和引用都通过 `textContent` 写入叶子节点，因此 `<script>` 等原始 HTML 只会作为文本展示。

## 生效路径

1. `src/web/message-view.js` 继续把完成态 assistant final_text 映射为 `message_context`。
2. `src/web/message-renderer.js` 对 assistant `message_context` 和 markdown content block 调用同一 `createMarkdownBlock`。
3. `src/web/markdown-inline.js` 提供行内加粗和行内代码解析，供 Markdown 块级渲染复用。
4. `src/web/styles.css` 中既有 `.markdown-block` 样式继续作用于新增节点。

## 改动范围

1. 新增 `src/web/markdown-inline.js`。
2. 扩展 `src/web/message-renderer.js` 的 Markdown 块级和内联渲染能力。
3. 更新 `tests/web/message-renderer-test.ts`，覆盖行内加粗、行内代码和原始 HTML 文本保留。
4. 新增当前 feature 文档。

## 验证

1. 运行 `npm run test`。
2. 重点验证 Markdown 表格既有解析测试仍通过。
3. 重点验证 `**加粗**` 与 `` `code` `` 可被解析为渲染段，原始 HTML 不被解释为 HTML。

## 风险与决策记录

本次选择实现 Snail Shell UI 当前消息展示需要的安全 Markdown 子集，而不是引入第三方 Markdown 解析器。原因是项目当前没有前端构建依赖链，直接引入完整解析器会扩大依赖和安全审查范围；同时用户反馈集中在常见展示效果缺失，本次子集能覆盖最终文本的主要可读性问题。

## 范围变更记录

无。
