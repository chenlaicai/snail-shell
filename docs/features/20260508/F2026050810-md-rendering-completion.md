# F2026050810 Markdown 显示效果补全

## 背景

用户反馈“最终文本”中 Markdown 没有完整渲染，代码围栏 ` ```text ` 和 `**加粗**` 仍按纯文本展示。检查现有实现后确认，前次表格优化只为 Markdown 表格增加了专用解析和样式，未建立完整 Markdown 展示路径，导致其他常见 Markdown 语法仍未呈现为对应视觉效果。

实现过程中用户进一步指出：网页展示 Markdown 已有成熟框架和技术，不应靠逐个样式补齐语法。该反馈暴露的问题不是单个语法遗漏，而是渲染模型错误：应由成熟 Markdown 解析器负责语法覆盖，Snail Shell 只负责安全边界和 UI 样式。

## 目标

1. 让 assistant 最终文本和 message-out markdown 块使用同一 Markdown 展示能力。
2. 使用成熟 Markdown 解析器覆盖常见 Markdown/GFM 展示能力，避免自研子集继续遗漏语法。
3. 保持 assistant 内容的安全边界，不把模型输出或消息内容未经清洗地交给页面 DOM。
4. 增加测试覆盖，避免后续退回表格专用解析或未清洗 HTML 输出。

## 非目标

1. 不改变消息数据结构、持久化格式或 message-out 协议。
2. 不允许 assistant 输出的原始 HTML 扩展前端安全边界。
3. 不新增代码高亮主题或复杂排版系统；本次重点是 Markdown 结构正确渲染。

## 设计

现有 `src/web/message-renderer.js` 已经把 assistant 最终文本按 `createMarkdownBlock` 展示，但 `renderMarkdownBody` 只处理表格、简单标题、单行引用、单一 `- ` 列表和极窄的单行代码围栏。直接继续扩展自研解析会形成长期维护风险：每次用户发现一个语法缺口，就需要继续堆一个局部解析分支。

因此本次改为引入 `marked` 作为成熟 Markdown/GFM 解析器，由它负责语法解析和 HTML 生成。由于 `marked` 默认会保留原始 HTML，不能直接把输出写入页面；新增 `src/web/markdown-renderer.js` 在解析后执行白名单 sanitizer，仅允许 Markdown 展示需要的安全标签与属性进入最终 DOM，并过滤 `script`、事件属性、`javascript:` 链接等不可信内容。

项目当前前端是静态 ESM 文件，没有浏览器打包链路。`src/web/package.json` 显式声明该静态目录按 ESM 运行，避免 Node 测试和浏览器运行对 `.js` 模块类型产生不同解释。构建时通过 `scripts/build-dist.ts` 将 `node_modules/marked/lib/marked.esm.js` 复制到 `dist/src/web/vendor/marked.esm.js`，源码中通过 `./vendor/marked.esm.js` 引用该浏览器 ESM 产物。

## 生效路径

1. `src/web/message-view.js` 继续把完成态 assistant final_text 映射为 `message_context`。
2. `src/web/message-renderer.js` 对 assistant `message_context` 和 markdown content block 调用同一 `createMarkdownBlock`。
3. `src/web/markdown-renderer.js` 使用 `marked` 解析 Markdown，并在进入 DOM 前执行白名单清洗。
4. `scripts/build-dist.ts` 将 `marked` 浏览器 ESM 文件复制到前端静态资源目录。
5. `src/web/package.json` 固化前端静态模块目录的 ESM 运行边界。
6. `src/web/styles.css` 中既有 `.markdown-block` 样式继续作用于 Markdown 解析后的节点。

## 改动范围

1. 新增 `src/web/markdown-renderer.js`。
2. 调整 `src/web/message-renderer.js`，使用统一 Markdown 渲染模块。
3. 保留 `src/web/markdown-table.js` 的既有解析测试，确保前次表格能力不回退。
4. 更新 `scripts/build-dist.ts`，复制 `marked` 浏览器 ESM 产物。
5. 新增 `src/web/package.json`，声明前端静态目录使用 ESM。
6. 更新 `package.json` 与 `package-lock.json`，新增 `marked` 依赖，并新增测试用 DOM 实现 `linkedom`。
7. 更新 `tests/web/message-renderer-test.ts`，覆盖标题、加粗、行内代码、围栏代码块和脚本清洗。
8. 新增当前 feature 文档。

## 验证

1. 运行 `npm run test`。
2. 重点验证 Markdown 表格既有解析测试仍通过。
3. 重点验证成熟 Markdown 渲染路径可展示标题、`**加粗**`、`` `code` `` 和围栏代码块。
4. 重点验证原始 `<script>` 不会进入最终 DOM。

## 风险与决策记录

本次引入 `marked` 会增加一个运行时依赖和一个前端 vendor 文件复制步骤，但这是为避免自研 Markdown 子集长期遗漏语法所必须的边界调整。安全风险通过白名单 sanitizer 控制：解析器负责 Markdown 语法覆盖，Snail Shell 负责决定哪些 HTML 标签和属性可进入页面。

## 范围变更记录

1. 初版实现曾尝试继续扩展自研 Markdown 子集；用户指出网页 Markdown 展示应使用成熟框架或技术后，范围调整为引入成熟解析器并补安全清洗层，避免继续逐个语法补丁化实现。
