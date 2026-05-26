---
id: F2026051908
title: UI 支持 Mermaid 图表展示
from_ids: []
tags: [ui, ui]
modules: [project_management]
---
# F2026051908 UI 支持 Mermaid 图表展示

## 背景

当前 Snail Shell 前端已经使用 `marked` 展示 Markdown，但对 Mermaid 图表语法仍按普通代码块显示。用户期望 UI 能展示 Mermaid 这类业界主流 Markdown 图表能力，并明确指出当前 UI 视觉效果过于简陋，不能把现有样式视为稳定目标。

本 feature 的问题不是为现有简陋代码块补一个特殊分支，而是把消息中的 Markdown 内容升级为更完整的阅读展示能力：常规 Markdown 继续由成熟解析器负责，Mermaid 代码块由官方 Mermaid 渲染为图表，Snail Shell 负责安全边界、消息语义和统一视觉呈现。

## 目标

1. 支持 Markdown fenced code block 中的 `mermaid` 图表渲染。
2. 使用官方 `mermaid` 包，不引入小众插件或自研图表解析。
3. 保持 `marked` + sanitizer 的 Markdown 安全边界，不让 assistant 原始 HTML 直接进入页面。
4. 改进 Markdown 消息卡片、代码块、表格和 Mermaid 图表的整体视觉效果，避免继续沿用过于简陋的展示目标。
5. 增加自动化测试覆盖 Mermaid 占位渲染、安全清洗和 Markdown 既有路径。

## 非目标

1. 不引入 React、MDX、unified 全家桶或新的前端框架迁移。
2. 不改变消息数据结构、持久化格式或 message-out 协议。
3. 不为了旧 UI 样式保留兼容分支或临时回退路径。
4. 不实现 Mermaid 语法编辑器、导出图片或交互式图表配置面板。

## 设计

Markdown 渲染继续以 `marked` 作为成熟解析器。为了让 Mermaid 图表进入统一安全链路，sanitizer 保留 fenced code block 经过解析后产生的 `code.language-mermaid` 语言标记，但仍不保留普通原始 HTML 中的任意 `class`。这样 Mermaid 识别只来自 Markdown 代码围栏语义，而不是不可信 HTML 任意注入。

`renderMarkdownFragment` 先同步返回安全 DOM，随后对其中的 Mermaid 代码块执行受控升级：将代码块替换成 `.mermaid-diagram` 容器，并通过官方 Mermaid 的 ESM 浏览器产物异步渲染 SVG。Mermaid 初始化使用受限安全配置，关闭自动 start，由 Snail Shell 明确控制渲染时机和容器。

视觉上，Markdown 内容不再只是蓝色消息泡里的普通文本。消息卡片使用更接近阅读面板的深色玻璃背景、层次化标题、代码块和表格样式；Mermaid 图表作为独立图表面板展示，保留失败态和原始源码回显，避免渲染失败时用户看不到内容。

## 生效路径

1. `src/web/markdown-renderer.js` 识别 `mermaid` 代码块并异步渲染图表。
2. `src/web/message-renderer.js` 继续把 assistant final text 和 markdown content block 交给统一 Markdown 渲染模块。
3. `scripts/build-dist.ts` 将 `mermaid` 浏览器 ESM 主文件及其同级 chunks 产物复制到前端 vendor 目录，保证发布后的浏览器动态 import 能加载完整模块图。
4. `src/web/styles.css` 提供 Markdown 阅读面板和 Mermaid 图表面板样式。
5. `tests/web/message-renderer-test.ts` 覆盖 Mermaid 代码块转换、安全 class 白名单和既有 Markdown 展示。

## 改动范围

1. `package.json`、`package-lock.json`：新增官方 `mermaid` 依赖。
2. `src/web/markdown-renderer.js`：新增 Mermaid 代码块识别、渲染升级和受控属性保留。
3. `src/web/styles.css`：升级 Markdown 与 Mermaid 展示样式。
4. `scripts/build-dist.ts`：复制 Mermaid 浏览器 ESM 主文件和 chunks 产物。
5. `tests/web/message-renderer-test.ts`：补充 Mermaid 与安全测试。
6. `tests/scripts/build-dist-test.ts`：覆盖发布产物中 Mermaid ESM chunks 的完整性。
7. 当前 feature 文档。

## 验证

1. 运行 `npm run test`。
2. 验证普通 Markdown 标题、加粗、行内代码、围栏代码块仍正常渲染。
3. 验证 `<script>` 等原始 HTML 不进入最终 DOM。
4. 验证非 Mermaid 原始 HTML `code.class` 不会保留。
5. 验证 Mermaid fenced code block 被转换为图表容器，并保留源码用于失败态回显。
6. 验证构建产物包含 `mermaid.esm.min.mjs` 及浏览器动态 import 需要的 `chunks/*.mjs`。

## 风险与决策记录

用户明确表示当前 UI 效果不满意，因此本次不把现有消息泡和 Markdown 样式作为稳定视觉基线。稳定边界是成熟 Markdown 解析、安全渲染和消息语义；视觉呈现允许直接升级到更好的目标状态。

新增 Mermaid 会增加前端 vendor 资源和运行时渲染成本，但这是支持业界主流图表展示的必要依赖。失败态保留原始源码回显，避免图表语法错误导致内容不可见。

## 范围变更记录

1. 初始讨论聚焦“是否有成熟 Markdown 展示框架”；用户随后明确当前 UI 视觉效果不满意，因此本 feature 范围从单纯 Mermaid 支持扩展为 Markdown/Mermaid 展示体验升级。
2. PR 检视发现只复制 Mermaid ESM 主文件会遗漏其相对路径依赖的 chunks，发布后的浏览器动态 import 会失败；本轮补齐构建产物完整性和对应测试。
