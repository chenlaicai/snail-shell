# F2026051301 知识中心治理对话集成

## 背景

知识飞轮治理落地（F2026051107）已建立独立的 `knowledge_governance` 表和治理专用对话数据表，但前端知识中心仍缺少对话式治理体验。用户无法在知识详情页直接查看和参与治理对话，治理流程的交互闭环未完成。

## 目标

1. 在知识详情页集成治理对话组件，支持查看历史消息和发送新消息。
2. 通过 API 路由暴露治理对话的读写能力。
3. 实现治理对话的基本交互：消息列表、消息发送、实时刷新。
4. 保持与现有知识中心 UI 的一致性。

## 非目标

1. 本次不实现 WebSocket 实时推送（使用轮询替代）。
2. 本次不实现复杂的治理状态机编辑。
3. 本次不修改后端治理数据模型。
4. 本次不实现治理对话中的 AI 自动回复。

## 设计

### API 路由

新增以下路由：

- `GET /knowledge/:knowledgeId/governance-conversation` - 获取治理对话信息
- `GET /knowledge/:knowledgeId/governance-conversation/messages` - 获取消息列表
- `GET /knowledge/:knowledgeId/governance-conversation/events` - 获取事件流
- `GET /knowledge/:knowledgeId/governance-conversation/dispatch-state` - 获取派发状态
- `POST /knowledge/:knowledgeId/governance-conversation/messages` - 发送消息

### 前端组件

在 `knowledge-center.js` 中新增：

- `loadGovernanceConversation()` - 加载治理对话
- `renderGovernanceChat()` - 渲染对话界面
- `sendGovernanceMessage()` - 发送消息
- `loadGovernanceMessages()` - 刷新消息列表

### 后端方法

在 `ProjectManager` 中新增：

- `sendConversationMessage()` - 统一的消息发送方法

## 生效路径

1. `src/api/knowledge-routes.ts` - 治理对话 API 路由
2. `src/project/manager.ts` - 消息发送方法
3. `src/web/knowledge-center.js` - 前端对话组件
4. `src/web/styles.css` - 对话样式

## 改动范围

1. `src/api/knowledge-routes.ts`
2. `src/project/manager.ts`
3. `src/web/knowledge-center.js`
4. `src/web/styles.css`

## 验证

1. `npm run build` - 构建通过
2. `npm test` - 所有 35 个测试文件通过
3. 知识详情页能显示治理对话区域
4. 能发送消息到治理对话
5. 消息列表能正确渲染

## 风险与决策记录

1. 决策：使用轮询而非 WebSocket 实现实时性。原因是当前阶段优先保证功能闭环，WebSocket 改造可后续进行。
2. 决策：复用现有 `sendStructuredMessage` 方法发送消息。原因是保持消息处理逻辑的一致性。

## PR 记录

- 待创建
