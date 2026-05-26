---
id: F2026051307
title: 模块结构重构
from_ids: []
tags: [refactor]
modules: [project_management]
---
# F2026051307 模块结构重构

## 背景

代码存在模块边界模糊、职责混杂的问题：

1. `ProjectManager`（728 行）是 god object，混合了项目 CRUD、特性生命周期、对话管理、消息分发、知识治理、制品管理、提及解析、摘要刷新
2. `persistence/store.ts` 在模块级别调用 `loadStageDefinitions()`，造成持久化层→元数据层的运行时循环依赖
3. `project/` 目录 18 个文件混合了工作流、协作消息处理、知识治理、仓库清理、启动恢复等关注点
4. 消息协作、API 路由、飞书集成散落在 `project/`、`api/`、`conversation/`、`integrations/` 四个目录

## 目标

1. 建立 8 个职责清晰的模块，每个模块有明确的边界和单一职责
2. 消除 `persistence ↔ meta` 循环依赖
3. 依赖方向单向，无循环
4. 每个模块可独立优化，不影响其他模块

## 非目标

1. 不重构各模块内部实现（如 ProjectManager 方法拆分为独立 service 类）
2. 不修改前端代码（`web/`）
3. 不修改 CLI 工具（`bin/`）的业务逻辑
4. 不修改 agent 适配器层（`agent/`）

## 设计

### 模块清单

| 模块 | 目录 | 职责 | 关键文件 |
|---|---|---|---|
| 基础类型层 | `shared/` | 域类型、消息类型、知识类型，零运行时依赖 | domain-types, message-types, knowledge-types, message-context-utils |
| 提示词中心 | `prompt-center/` | 提示词注册、构建、渲染、评估 | registry, builder, evaluation-registry, evaluation-runner |
| Skill 中心 | `skill-center/` | Skill 定义注册 | registry |
| 蜗牛窝 | `snail-den/` | Agent runtime 工厂 + SystemAI 辅助小蜗牛 | index (template 池), system-ai (摘要/提及提取) |
| 消息总线 | `message-bus/` | 消息分发、协作编排、中断控制、事件构建 | collaboration, message-bus, message-events, message-protocol, message-context, message-out, agent-message, message-interrupt, mentions |
| 项目工作流 | `project-workflow/` | 项目/特性/阶段/对话/制品管理 | manager, workflow, manager-types, manager-queries, manager-events, conversation-queue, startup-recovery, summary-input, repo-cleanup, self-project-seed, tool-use |
| 知识中心 | `knowledge-center/` | 知识 CRUD + 治理工作流 | knowledge-service, governance-prompt |
| 交互入口 | `interaction-entry/` | API server + WebSocket + 飞书集成 | api/server, api/feature-routes, api/knowledge-routes, api/validation, gateway, feishu/ |

### 依赖方向

```
shared ← persistence
shared ← prompt-center ← skill-center
shared ← snail-den (← agent/)
shared ← message-bus (← persistence)
以上全部 ← project-workflow
以上全部 ← knowledge-center
以上全部 ← interaction-entry
```

### 关键设计决策

**1. 打破 `persistence ↔ meta` 循环依赖**

- 将域类型从 `persistence/types.ts` 提取到 `shared/domain-types.ts`
- `persistence/types.ts` 改为 re-export from shared
- `meta/index.ts` 改为从 shared 导入类型，而非从 persistence

**2. SystemAI 接口提取**

- 定义 `SystemAI` 接口（generateConversationSummary, generateMessageContextSummary, extractMentions）
- `SystemAISnail` 类实现该接口
- `ProjectManagerDeps` 使用接口类型替代具体类，测试可 mock

**3. 消息总线独立**

- 9 个消息相关文件从 `project/` 迁入 `message-bus/`
- 内部导入（如 `./message-events`）无需修改（同目录搬迁）
- 外部消费者更新导入路径

**4. 知识治理提取**

- 13 个知识 CRUD 方法从 ProjectManager 提取为独立函数
- `defaultKnowledgeUsagePolicy` 辅助函数一并迁入
- ProjectManager 改为委托 knowledge-center 函数

## 改动范围

### 新建文件（22 个）

- `src/shared/`：domain-types.ts, message-types.ts, knowledge-types.ts, message-context-utils.ts, types.ts, index.ts
- `src/prompt-center/`：registry.ts, builder.ts, evaluation-registry.ts, evaluation-runner.ts, index.ts
- `src/skill-center/`：registry.ts, index.ts
- `src/snail-den/`：system-ai.ts
- `src/message-bus/`：index.ts
- `src/project-workflow/`：index.ts
- `src/knowledge-center/`：knowledge-service.ts, governance-prompt.ts, index.ts
- `src/interaction-entry/`：index.ts

### 迁移文件（30+ 个）

- `project/message-*` → `message-bus/`
- `project/collaboration.ts` → `message-bus/`
- `project/agent-message.ts` → `message-bus/`
- `project/mentions.ts` → `message-bus/`
- `project/manager*` → `project-workflow/`
- `project/workflow.ts` → `project-workflow/`
- `project/其他支撑文件` → `project-workflow/`
- `api/*` → `interaction-entry/api/`
- `conversation/gateway.ts` → `interaction-entry/`
- `integrations/feishu/*` → `interaction-entry/feishu/`

### 删除目录（4 个）

- `src/project/`（全部迁入 project-workflow/ 和 message-bus/）
- `src/api/`（迁入 interaction-entry/api/）
- `src/conversation/`（迁入 interaction-entry/）
- `src/integrations/`（迁入 interaction-entry/feishu/）

### 修改文件（15+ 个）

- `src/main.ts`：更新导入路径
- `src/index.ts`：按新模块结构组织导出
- `src/agent/prompt-mapper.ts`：导入路径更新
- `src/bin/conversation-history.ts`、`src/bin/message-out.ts`：导入路径更新
- `scripts/seed-self-project.ts`：导入路径更新
- `src/persistence/types.ts`、`message-types.ts`、`knowledge-types.ts`：改为 re-export from shared
- `src/meta/index.ts`、`prompt-registry.ts`：导入路径更新
- `src/snails/prompt-builder.ts`、`registry.ts`：导入路径更新
- `src/llm/summary.ts`、`mention-extractor.ts`：导入路径更新
- `eslint.config.mjs`：更新豁免文件路径
- 10+ 个测试文件：导入路径更新

## 验证

1. `npm run lint` ✓
2. `npm run build` ✓
3. `npm run test` — 35 个测试全部通过 ✓
4. `npx tsc --noEmit` — 无类型错误 ✓
5. 确认无循环依赖：所有模块依赖方向单向
6. 确认旧目录已删除，无残留 shim 文件

## PR

https://github.com/chenlaicai/snail-shell/pull/172
