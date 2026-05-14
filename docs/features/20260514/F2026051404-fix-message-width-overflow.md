# F2026051404 修复对话消息宽度超出页面

## 背景

在项目管理-对话页面中，消息宽度有时会超出中间区域甚至超出屏幕右侧。用户报告了这个 UI 问题。

## 目标

修复消息宽度溢出问题，确保消息在任何情况下都不会超出可视区域。

## 非目标

- 不改变消息的最大宽度比例（78%）
- 不修改消息的布局结构
- 不影响其他页面的样式

## 设计

### 问题根因

在 flex 布局中，父容器链缺少 `min-width: 0` 约束。当消息包含超长无空格内容（如 JSON 序列化的长字符串）时，flex item 的默认 `min-width: auto` 会导致整个容器链被撑宽，进而使 `max-width: 78%` 的绝对值变大，消息超出可视区域。

### 修复方案

1. **`#messages` 容器** - 添加 `min-width: 0` 和 `overflow-x: hidden`
   - `min-width: 0` 防止 flex item 被内容撑宽
   - `overflow-x: hidden` 裁剪溢出内容

2. **`.message-event-detail`** - 添加 `word-break: break-word`
   - 允许 JSON 序列化输出中的超长无空格字符串换行

3. **父容器链** - `#app-root`、`.main-panel`、`.workspace-main` 添加 `min-width: 0`
   - 完善防溢出约束链，确保从顶层到底层的所有 flex item 都有正确的最小宽度约束

## 生效路径

修复通过 CSS 样式生效，修改文件：`src/web/styles.css`

## 改动范围

- `src/web/styles.css` - 添加 `min-width: 0` 和 `word-break: break-word` 属性

## 验证

### 自动化检查

- `npm run build` - 构建通过
- `npm run lint` - 代码检查通过

### 人工验证

1. 打开项目管理-对话页面
2. 发送包含超长无空格字符串的消息（如长 URL 或 JSON）
3. 验证消息宽度不超过中间区域
4. 展开事件详情面板，验证内容不超出屏幕
5. 在不同窗口宽度下验证响应式布局正常

## 风险与决策记录

### 风险

- **低风险**：添加 `min-width: 0` 是 flex 布局的标准防溢出做法，不会影响正常布局
- **低风险**：`word-break: break-word` 允许在单词内换行，对长无空格字符串有效，不影响正常文本

### 决策

- 选择在父容器链的多个层级添加 `min-width: 0`，而不是只在最底层添加，以确保完整的防溢出约束链
- 选择 `word-break: break-word` 而不是 `overflow-wrap: break-word`，因为前者兼容性更好且能处理更极端的情况

## 范围变更记录

无
