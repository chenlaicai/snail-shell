# F2026052401 UI 响应式溢出修复

## 背景

当前 Snail Shell 的聊天核心区域（消息区+侧边栏）存在以下响应式问题：

1. **零视口感知**：窗口大小变化时布局不响应，无 `@media`、无 `ResizeObserver`、无 `matchMedia`
2. **内容撑破容器**：长文本（无空格长字符串）、代码块、图片等内容可超出消息气泡边界，导致横向滚动条或布局错位
3. **单布局无降级**：固定三栏布局（390px + 1fr + 318px），窄屏时上下文面板和侧边栏挤压消息区至不可用

## 目标

建立三层响应式约束体系，解决内容撑破骨架的溢出问题：

1. **骨架层**（CSS `@media`）：3 套布局自动切换，不依赖 JS
2. **血肉约束**（CSS Container Queries）：气泡宽度由消息区实际宽度决定
3. **尺寸感知**（`ResizeObserver`）：给 JS 侧 `data-layout` 属性供后续扩展使用

## 非目标

- 不改变 HTML 结构
- 不改变现有视觉外观（在足够宽窗口下行为不变）
- 不涉及知识中心/提示词中心/项目管理等页面
- 不引入任何框架或构建工具

## 设计

### 三层响应式架构

```
┌─────────────────────────────────────────────────┐
│  第一层：Media Queries — 页面骨架（几栏？）        │
│  @media (width >= 1400px) → 三栏全宽              │
│  @media (1100-1399px)    → 两栏（sidebar+main）   │
│  @media (< 1100px)       → 两栏（icon rail+main） │
├─────────────────────────────────────────────────┤
│  第二层：Container Queries — 组件内部布局          │
│  @container main-panel (max-width: 600px) → 92%  │
│  @container main-panel (601-850px)     → 88%     │
│  @container main-panel (> 850px)       → CSS 变量│
├─────────────────────────────────────────────────┤
│  第三层：ResizeObserver — 运行时尺寸感知           │
│  data-layout = full|medium|narrow|compact         │
└─────────────────────────────────────────────────┘
```

### 断点设计

```
>= 1400px: sidebar=390, context=318,  msg=78% | 三栏全宽
1100-1399:  sidebar=390, context=0,    msg=82% | 两栏：sidebar+main
< 1100px:   sidebar=72,  context=0,    msg=88% | 两栏：icon rail+main
```

### 设计决策

- **骨架层纯 CSS（`@media`），无 JS 依赖** — JS 挂了窄屏也不会撑爆
- **Container Queries 做渐进增强** — 不支持的浏览器用 `--message-max-width` CSS 变量兜底
- **面板 `display: none` 而非移除 DOM** — 宽屏恢复时状态不丢
- **`--context-panel-width: 0px` 双重保障** — grid track 数保持 3 不变，即使 display 未生效也不会多出一列空白

## 改动范围

修改 5 个既有文件，约 100 行代码：

1. `src/web/styles/tokens.css` — 响应式 Token 覆盖（3 个 `@media` 块）
2. `src/web/styles/layout.css` — 骨架层：`container-type`、`overflow: hidden`、面板显隐
3. `src/web/styles/components/message.css` — 血肉约束：`@container` 查询控制气泡宽度
4. `src/web/styles/components/markdown-content.css` — 内容防溢出加固：`max-width + word-break`
5. `src/web/app.js` — `ResizeObserver` 设置 `data-layout` 属性

## 验证

1. DevTools 逐区间拖拽窗口 → 确认布局切换无闪烁/错位
2. 在各断点下发送长消息（无空格长字符串）→ 确认无横向滚动条
3. 在各断点下展开代码块/表格/event stream → 确认内容不撑破气泡
4. 在各断点下切换 primary view → 确认面板正确显隐
5. `getComputedStyle` 验证 CSS 变量在各断点返回预期值
6. 从 >=1400 拖到 <900 再拖回来 → 确认所有面板恢复正确

## 不兼容更新

无。

## 范围变更记录

- **新增 `eslint.config.mjs` 修改**：`ResizeObserver` 和 `window` 是浏览器全局 API，需在 ESLint globals 中声明为 `readonly`。在 `src/web/**/*.js` 的 globals 块中新增 `ResizeObserver` 和 `window` 两项（各 1 行），不属于原始计划但为实现副作用。
- **自检修复：`@container` 阈值修正与去兼容守卫**：自检发现两处问题：① `@container main-panel` 的 601-850 范围在三栏布局下（1400px 视口，main-panel 仅 692px）会将消息宽度从 CSS 变量的 78% 改为 88%，容器查询越权覆盖了 `@media` 的预期值，已删除该范围，仅保留 ≤600px 单一阈值；② `app.js` 中 `if (window.ResizeObserver)` 守卫属于不必要的兼容过渡代码，已移除。

## 任务锚

### 本质目标
让 Snail Shell 的聊天核心区在任意窗口宽度下都保持可用布局，内容永远不撑破骨架。

### 反目标
- 不改 HTML 结构
- 不影响 >=1400px 宽屏下的既有外观
- 不引入 JS 布局计算（骨架切换纯 CSS）

### 语义不变量
- grid 三栏定义 `sidebar | main | context` 不变
- CSS 变量 `--sidebar-width`, `--context-panel-width`, `--message-max-width` 继续作为唯一宽度入口
- `min-width: 0` 防溢出链不动

### 成功标准
- 6 个验证场景全部通过
- 宽屏（>=1400px）下视觉与改造前一致
- 窄屏下所有内容不超出视口边界
