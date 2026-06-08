---
id: F2026051408
title: Skill Center 一级目录
from_ids: []
tags: [ui, skill]
modules: [project_management]
---
# F2026051408 Skill Center 一级目录

## 背景

Snail Shell 系统中有多个独立的 skill 能力包（如 message-out、knowledge-candidate、conversation-history 等），分散在 `.meta/skills/` 目录下。目前没有统一的入口查看和管理这些 skill，用户需要手动浏览文件系统才能了解系统中有哪些 skill 及其用途。

## 目标

1. 新增 "Skill Center" 一级目录，与现有的 Prompt Center 并列
2. 集中展示系统中已注册的所有 skill
3. 支持按 name/description/content 搜索 skill
4. 支持查看 skill 的详细信息（title、description、原始内容）
5. 与现有 Prompt Center 风格保持一致

## 非目标

1. 不涉及 skill 的编辑、创建或删除功能
2. 不涉及 skill 的运行时调用或测试
3. 不涉及 skill 的版本管理或依赖关系

## 设计

### 数据来源

- 使用已有的 `listSkills()` 函数（来自 `src/skill-center/registry.ts`）
- 通过 `/meta/skills` API 端点暴露数据
- 返回数据包含：name、title、description、filePath、content

### 前端架构

1. **skill-center-view.js**：视图组件，负责渲染列表和详情
2. **app.js**：初始化 skill center 实例，绑定事件
3. **primary-view.js**：添加 "skills" 视图类型支持
4. **ui-shell.js**：添加导航按钮、面板和上下文卡片

### 交互设计

- 左侧面板：skill 列表，支持搜索过滤
- 右侧面板：选中 skill 的详情展示
- 右侧上下文栏：Skill Center 说明和目录结构信息

## 生效路径

- 代码：`src/web/skill-center-view.js`、`src/web/app.js`、`src/web/primary-view.js`、`src/web/ui-shell.js`
- API：`src/interaction-entry/api/server.ts` 中的 `/meta/skills` 路由
- 样式：`src/web/styles.css` 中的 skill center 相关样式

## 改动范围

### 新增文件
- `src/web/skill-center-view.js` — Skill Center 视图组件

### 修改文件
- `src/web/app.js` — 添加 skill center 初始化和事件绑定
- `src/web/primary-view.js` — 添加 "skills" 视图类型支持
- `src/web/ui-shell.js` — 添加导航按钮、面板和上下文卡片
- `src/interaction-entry/api/server.ts` — 添加 `/meta/skills` API 路由
- `src/web/styles.css` — 添加 skill center 相关样式

## 验证

1. 运行 `npm run build` 构建成功
2. 运行 `npm test` 所有测试通过
3. 启动服务后访问 Skill Center 页面，验证：
   - 导航按钮显示正常
   - skill 列表加载成功
   - 搜索功能正常工作
   - 点击列表项可以查看详情
   - 样式与 Prompt Center 一致

## 风险与决策记录

### 风险
1. 如果 `.meta/skills/` 目录下没有 SKILL.md 文件，`listSkills()` 可能返回空数组
2. 如果 skill 文件内容过大，详情展示可能影响性能

### 决策
1. 对于空列表，显示 "没有已注册的 Skill" 提示
2. 对于大文件，限制 `.skill-raw-content` 的最大高度为 500px，支持滚动

## 范围变更记录

无
