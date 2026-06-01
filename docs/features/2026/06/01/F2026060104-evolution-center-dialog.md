---
id: F2026060104
title: evolution-center-dialog
from_ids: [F2026052903, F2026052907]
tags: [evolution, knowledge, web, feature]
modules: [evolution, web, persistence]
doc_kind: spec
---

# F2026060104 Evolution Center 对话界面 + 知识库独立

## 问题背景

用户反馈三个问题：

1. **命名问题**："演进中心"中文名生硬，使用英文 "Evolution Center"
2. **功能缺失**：新增演进项后没有对话界面，只显示"已关联 Conversation"文本标签（设计文档 F2026052903 明确要求复用项目管理 SOP，但前端实现遗漏）
3. **架构问题**：知识库应完全独立为一级模块

## 决策记录

| # | 决策 | 结论 | 来源 |
|---|------|------|------|
| 1 | 命名方案 | 使用 "Evolution Center" 英文名 | 用户确认 |
| 2 | 对话界面实现 | 直接用工作区管理那一套（workspace + SOP），复用现有 conversation 组件 | 用户确认，与 F2026052903 设计一致 |
| 3 | 知识库独立 | 完全独立为一级模块（UI + API） | 用户确认 |

## 需求分析

### 问题 1：命名

**现状**：前端和文档中使用"演进中心"中文名
**目标**：统一使用 "Evolution Center" 英文名
**范围**：
- 导航按钮文本
- 页面标题
- 相关文档中的称呼

### 问题 2：对话界面（核心问题）

**现状**：
- 后端创建演进项时已自动生成治理对话（conversation + feature + stage）
- 前端只有 CRUD 视图，无对话能力
- 详情页只显示"已关联 Conversation"静态文本
- 现有 conversation 系统已有完整组件：MessageList、Composer、message-store、realtime-manager

**影响**：
- 用户无法在 Web 界面中进行治理对话
- 治理流程断裂，演进项变成"死数据"

**目标状态**：
- 创建演进项后自动进入对话界面（workspace 视图）
- 对话界面复用现有 conversation 组件
- 详情页增加"进入对话"按钮
- 与现有 conversation 系统完全集成

**设计依据**：
- F2026052903 明确："演进项通过 Feature 进入项目管理流程"
- Evolution Center 本质是一个 workspace + SOP
- 治理对话在 Feature Stage 中完成

### 问题 3：知识库独立

**现状**：
- 知识库数据和 API 已是独立模块
- 但在 Web UI 中没有独立入口，嵌套在 evolution-center 下
- 通过 workspace_id 关联，逻辑上已解耦

**目标状态**：
- 知识库作为一级模块完全独立
- Web UI 有独立一级入口
- API 路由独立（/knowledge/items）
- 与 evolution-center 解耦

## 详细设计

### 1. 命名统一

**改动范围**：
- `src/web/evolution-center.js`：renderSummary 中 "演进中心" → "Evolution Center"
- `src/web/ui-shell.js`：导航按钮文本
- 其他 UI 文本

### 2. Evolution Center 对话界面集成

**核心思路**：创建演进项后，导航到 workspaces 视图，自动选中 evolution-center workspace、对应的 feature、stage、conversation，复用现有对话组件。

**改动文件**：

#### 2.1 `src/web/evolution-center.js`

- 添加 `onNavigateToConversation` 回调参数
- `submitCreate` 方法：创建成功后，调用 `onNavigateToConversation({ featureId, conversationId })`
- `renderItemDetail` 方法：添加"进入对话"按钮
- 绑定"进入对话"按钮事件

#### 2.2 `src/web/app.js`

- 初始化 evolutionCenter 时传入 `onNavigateToConversation` 回调
- 回调实现：
  ```js
  async function navigateToEvolutionConversation({ featureId, conversationId }) {
    await selectWorkspace("evolution-center");
    await selectFeature(featureId);
    await selectConversation(conversationId);
    switchPrimaryView("workspaces");
  }
  ```

**数据流**：
```
用户创建演进项
  → POST /evolution/items
  → 后端创建 evolution_item + feature + stage + conversation
  → 返回 EvolutionItemWithConversation（包含 conversation.id）
  → 前端调用 onNavigateToConversation({ featureId, conversationId })
  → 导航到 workspaces 视图
  → 自动选中 evolution-center workspace
  → 自动选中对应 feature、stage、conversation
  → 复用现有 MessageList + Composer 组件
```

### 3. 知识库独立模块

**改动文件**：

#### 3.1 新增 `src/web/knowledge-library.js`

- 页面结构：列表 + 搜索 + 详情
- 复用现有 knowledge-library skill 的 API
- 支持按 scope（global/workspace）筛选

#### 3.2 新增 `src/interaction-entry/api/knowledge-routes.ts`

- `GET /knowledge/items`：列表查询
- `GET /knowledge/items/:id`：详情查询
- `GET /knowledge/items/search`：全文搜索

#### 3.3 修改 `src/web/ui-shell.js`

- 导航栏增加"知识库"一级入口
- 新增 `$navKnowledge` 和 `$knowledgePanel`

#### 3.4 修改 `src/web/app.js`

- 初始化 knowledgeLibrary
- 绑定导航事件
- switchPrimaryView 支持 "knowledge"

#### 3.5 新增 `src/web/styles/components/knowledge-library.css`

- 知识库页面样式

## 验收标准

- [ ] 所有 UI 文本统一使用 "Evolution Center" 英文名
- [ ] 创建演进项后自动进入 workspace 对话视图
- [ ] 演进项详情页有"进入对话"按钮
- [ ] 对话界面支持消息收发、角色切换
- [ ] 知识库在 Web UI 中有独立一级入口
- [ ] 知识库 API 独立（/knowledge/items）
- [ ] 现有功能无回归

## 变更记录

| 日期 | 变更内容 |
|------|----------|
| 2026-06-01 | 初始创建，记录三个问题 |
