# F2026052003 UI 架构一步到位重构与提示词强化

## 背景

当前 UI 存在两个层面的问题：

### UI 架构层面

1. **单一巨型 CSS**：`styles.css` 2646 行平铺一个文件，无模块化、无分层
2. **无 design token 系统**：颜色 `#0b1120`、`#f97316`、间距 `12px`、`14px` 等魔法数字重复出现几十次，改一处需全局搜索替换
3. **HTML 模板嵌入 JS**：`ui-shell.js` 内 150+ 行 template literal，改布局要在 JS 字符串中找 HTML
4. **app.js 是上帝对象**：~1000 行同时管理状态、渲染、路由、事件绑定，无组件边界
5. **CSS 选择器基于 ID**：`#messages`、`#input`、`#send-btn` 遍地，高特异性难覆盖
6. **Grid 布局硬编码**：固定像素值 `390px`、`318px`，缺乏响应式基础

### 提示词层面

`B-01` 的身份与责任契约已包含"一步到位"规则（第 75-81 行、第 93 行），但在研发者实际提案时仍出现渐进式分阶段方案的倾向。分析发现：
- 规则使用"优先"而非"必须"——给了灰色地带
- 缺少自检机制——提出分阶段方案时不需要主动证明"为什么不能一步到位"
- 模型训练数据偏差：通用语料中"MVP first""incremental migration"模式是主流，与 Snail Shell 要求相反

## 目标

1. UI：一次性建立完整的 design token 系统 + CSS 分层文件结构 + class-based 组件架构
2. 提示词：强化 B-01 中的"一步到位"规则，从"优先"升级为"必须"，并增加自检机制

## 非目标

- 不引入任何框架依赖（React、Vue 等）
- 不引入构建工具（webpack、vite 等）
- 不改变现有视觉外观（token 化后的最终渲染结果应与改造前一致）
- 不引入 Web Components / Shadow DOM（保持 light DOM 模式）

## 设计

### CSS 架构

```
src/web/
├── index.html                      # 不变
├── styles/
│   ├── tokens.css                  # CSS 自定义属性定义（颜色、间距、圆角、阴影、字号）
│   ├── base.css                    # reset + 排版基础
│   ├── layout.css                  # app-shell 三大区域布局
│   ├── components/
│   │   ├── message.css             # 消息气泡、消息卡片
│   │   ├── composer.css            # 输入区
│   │   ├── workspace-tree.css      # 左侧项目树
│   │   ├── context-panel.css       # 右侧上下文面板
│   │   ├── primary-nav.css         # 主导航
│   │   ├── brand-bar.css           # 品牌栏
│   │   ├── badge.css               # 状态标签
│   │   ├── markdown-content.css    # markdown 渲染内容
│   │   ├── question-card.css       # 问题卡片
│   │   ├── mention.css             # mention 提示
│   │   ├── knowledge.css           # 知识中心
│   │   ├── snail-den.css           # Snail Den
│   │   ├── prompt-center.css       # Prompt Center
│   │   ├── skill-center.css        # Skill Center
│   │   ├── project-config.css      # 项目配置页
│   │   └── conversation-source.css # 对话来源空状态
│   └── utilities.css               # 通用工具类（truncate 等）
```

层次关系：`tokens.css` → `base.css` → `layout.css` → `components/*.css` → `utilities.css`

### JS 组件架构

将 app.js 中的渲染逻辑拆分为 class-based 组件：

```
src/web/
├── app.js                          # 应用入口，管理全局状态和路由
├── components/
│   ├── message-list.js             # 消息列表渲染
│   ├── composer.js                 # 输入区 + mention + 发送
│   ├── workspace-tree.js           # 项目/Feature/Conversation 树
│   ├── context-rail.js             # 右侧上下文信息
│   ├── primary-nav.js              # 主导航切换
│   ├── boss-mentions.js            # Boss mention 横幅
│   └── app-shell.js               # UI 壳层挂载（替代 ui-shell.js 的模板字符串方式）
├── ui-shell.js                     # 保留，但改为使用 DOM API 构建壳层
├── primary-view.js                 # 保留，视图切换逻辑
```

组件模式：
```js
class MessageList {
  constructor({ container, state, onReply, onInterrupt, ... }) {
    this.container = container;
    this.state = state;
    // ...
  }
  render(messageStore) { /* 渲染消息列表 */ }
  scrollToBottom() { /* 滚到底部 */ }
  jumpToMessage(id) { /* 跳转到指定消息 */ }
}
```

优点：
- 每个组件有自己明确的状态输入和事件回调
- 改一处不影响其他组件
- 未来可以渐进升级为 Web Components 而不需重写

### 提示词强化

`B-01` 修改：

1. 第 79-80 行：强化"一步到位"规则，从"优先"升级为"必须"，增加严格条件列举和自检机制
2. 新增自检规则：提出分阶段方案前必须先证明为什么不能一步到位

`S-03` 修改：

3. 新增第 11 条：网上优秀实践检索规则 — 在面临 UI/UX 设计、架构模式、技术选型等决策时按需检索

## 生效路径

- `.meta/prompts/prompts/B-01-身份与责任契约.md` — 提示词规则（一步到位强化）
- `.meta/prompts/prompts/S-03-研发者手册.md` — 提示词规则（网上实践检索）
- `src/web/styles/` — 新 CSS 分层目录
- `src/web/styles.css` — 改为 `@import` 聚合文件
- `src/web/*.js` — 组件化改造的 JS 文件
- `src/web/ui-shell.d.ts` — TypeScript 类型声明

## 改动范围

- `.meta/prompts/prompts/B-01-身份与责任契约.md` — 提示词强化（一步到位）
- `.meta/prompts/prompts/S-03-研发者手册.md` — 提示词强化（网上实践检索）
- `src/web/styles.css` → `src/web/styles.css`（`@import` 聚合）+ `src/web/styles/`（分层文件）
- `src/web/ui-shell.js` — 壳层构建改为 DOM API
- `src/web/ui-shell.d.ts` — TypeScript 类型声明
- `src/web/app.js` — 拆出组件渲染逻辑
- `src/web/components/` — 新组件文件
- `src/web/index.html` — 可能的 CSS 引用路径调整
- `tests/web/helpers/shell-dom.ts` — DOM mock 测试辅助
- `tests/web/*.ts` — 测试断言更新

## 验证

- TypeScript 编译无错误
- 已有测试通过
- 人工验证：所有页面在改造前后外观一致
- 人工验证：各视图切换正常（projects / knowledge / snail-den / prompts / skills / project-config）
- 人工验证：消息发送、mention、回复等功能正常

## 风险与决策记录

- 改动文件数量较大（~15 个 CSS 文件 + ~7 个 JS 组件），但每个文件职责单一
- CSS 引用关系变更可能导致初始加载时短暂的样式缺失（FOUC），通过 `@import` 顺序和 index.html 中的 link 顺序解决

## 范围变更记录

- **新增测试辅助模块**：`tests/web/helpers/shell-dom.ts` — 最小 DOM mock，允许在 Node 环境中执行 `mountUiShell()` 并序列化渲染结果为 HTML 字符串。因为 `ui-shell.js` 从模板字符串重构为 `el()` DOM API 后，原测试中直接 grep 源码 HTML 属性字符串的方式失效。通过 mock 全局 `document` + 动态 import 替代 jsdom，无需新增依赖。
- **测试断言风格统一**：`ui-entrypoint-test.ts` 和 `workspace-layout-test.ts` 中的 shell 断言从"读源码字符串"改为"读渲染 DOM HTML"。class/id/data-* 属性断言直接生效，无需逐条改写为 JS 属性语法。
- **CSS 变量化断言**：以下 4 处 CSS 断言从硬编码值改为 token 引用 + token 值双重验证：
  - `.app-shell` / `.app-shell[data-primary-view="knowledge"]` 的 `grid-template-columns`：从 `390px ... 318px` 改为 `var(--sidebar-width) ... var(--context-panel-width)`，并额外断言 token 值
  - `.repo-context-card-inline` 的 `background`：从 `rgba(15, 23, 42, 0.58)` 改为 `rgba(var(--color-bg-overlay), 0.58)`
  - `.has-event-stream` 的 `width`：从 `78%` 改为 `var(--message-max-width)`，并额外断言 token 值
- **JS 组件拆分**：`app.js` 中的消息列表、输入区、项目树渲染逻辑拆分为 `src/web/components/message-list.js`、`composer.js`、`workspace-tree.js` 三个 class-based 组件，通过构造函数注入依赖（DOM 容器、状态查询、事件回调）。`app.js` 角色降级为全局状态管理 + 路由编排。
- **S-03 提示词强化**：新增第 11 条"网上优秀实践检索"规则——当面临 UI/UX 设计、架构模式、技术选型等存在公认优秀实践的决策时，必须主动检索网上实践（优先 GitHub）。不需要每次小决策都联网，触发条件是问题领域有已知成熟模式但当前方案存在明显不确定性。
- **TypeScript 类型声明**：新增 `src/web/ui-shell.d.ts`，为 `ui-shell.js` 的 `el()`、`tx()`、`mountUiShell()` 提供类型声明，解决 `tests/web/helpers/shell-dom.ts` 导入时的 TS7016 错误。`shell-dom.ts` 中保留 `any` cast 注释说明原因（mock DOM 替换了真实 document）。
