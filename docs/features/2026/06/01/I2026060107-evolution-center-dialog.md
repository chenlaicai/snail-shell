---
id: I2026060107
title: evolution-center-dialog
from_ids: [F2026052903, F2026052907]
tags: [evolution, knowledge, web, feature]
modules: [evolution, web, persistence]
doc_kind: spec
---

# I2026060107 Evolution Center 对话界面 + 知识库独立

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

**核心思路**：Evolution Center 作为一级模块，治理对话在 Evolution 视图内嵌完成，不跳转到工作区管理视图。底层复用 workspace + SOP 数据模型，但 UI 保持独立。

**改动文件**：

#### 2.1 新增 `src/web/evolution-conversation.js`

轻量对话组件，嵌入 Evolution 视图的 `evolution-detail` 区域：
- `open(conversationId, options)` — 打开对话，渲染消息列表 + 输入框
- `close()` — 关闭对话，恢复详情视图
- `renderFromStore(store, conversationId)` — 接收 realtime store 更新
- 消息通过 `renderMessages` 渲染（复用 message-renderer）
- 发送通过 `POST /api/conversations/:id/messages`
- 支持 Enter 发送、Shift+Enter 换行

#### 2.2 `src/web/evolution-center.js`

- `onNavigateToConversation` → `onOpenConversation`：在 Evolution 视图内打开对话
- `evolutionConversation` 参数：接收对话组件实例
- 新增 `openConversation`、`closeConversation`、`renderConversationFromStore` 方法
- `submitCreate`：创建成功后调用 `onOpenConversation` 打开内嵌对话
- `renderItemDetail`："进入对话"按钮调用 `onOpenConversation`

#### 2.3 `src/web/workspace-tree-view.js`

- 过滤 `evolution-center` workspace 不出现在工作区管理侧边栏
- Evolution Center 作为独立一级模块，不应在工作区列表中出现

#### 2.4 `src/web/app.js`

- 创建 `evolutionConversation` 实例（container: `$evolutionDetail`）
- 传入 `evolutionCenter` 作为 `evolutionConversation` 参数
- `openEvolutionConversation` 回调：
  1. `selectWorkspace("evolution-center")` — 更新内部状态
  2. `selectFeature(featureId, { preferredConversationId })` — 选中 feature 和 conversation
  3. `evolutionCenter.openConversation()` — 在 Evolution 视图内渲染对话
  4. `connectEvolutionRealtime()` — 连接 WebSocket
- realtime `onStoreChange` 同时调用 `evolutionCenter.renderConversationFromStore()`

**数据流**：
```
用户创建演进项
  → POST /evolution/items
  → 后端创建 evolution_item + feature + stage + conversation
  → 返回 EvolutionItemWithConversation（包含 conversation.id）
  → 前端调用 onOpenConversation({ featureId, conversationId })
  → selectWorkspace("evolution-center") 更新内部状态
  → selectFeature(featureId, { preferredConversationId }) 选中 feature
  → evolutionCenter.openConversation() 在 Evolution 视图内渲染对话
  → connectEvolutionRealtime() 连接 WebSocket 接收实时消息
  → 用户在 Evolution 视图内完成治理对话
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

- [x] 所有 UI 文本统一使用 "Evolution Center" 英文名
- [x] 创建演进项后在 Evolution 视图内打开治理对话
- [x] 演进项详情页有"进入对话"按钮
- [x] 对话界面支持消息收发
- [x] Evolution Center 不出现在工作区管理侧边栏
- [x] 知识库在 Web UI 中有独立一级入口
- [x] 知识库 API 独立（/knowledge/items）
- [x] 现有功能无回归（45 tests pass）

## 变更记录

| 日期 | 变更内容 |
|------|----------|
| 2026-06-01 | 初始创建，记录三个问题 |
| 2026-06-01 | v2: 对话改为 Evolution 视图内嵌，不再跳转到工作区管理 |
