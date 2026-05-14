# F2026051405 移除反哺策略（usage_policy）

## 背景

知识飞轮的最新架构为：`知识提取 > 生成知识 > 治理对话（AI 驱动）> 状态更新 skill > 回写去向`。反哺策略（usage_policy）是旧设计残留，原本通过 `knowledge_usage_policy` 表控制知识是否进入系统提示词、以什么模式注入、限制哪些阶段和角色。最新架构下，知识的生效方式和去向由治理对话中的 AI 灵活决定，不再需要静态策略配置。

旧流程中反哺策略与 prompt 注入管线深度耦合：`knowledge_item` -> `knowledge_usage_policy` -> `injectable()` 查询 -> `buildKnowledgeContextSection` -> 系统提示词。这条管线需要整体移除。

## 目标

1. 移除 `knowledge_usage_policy` 表及全部相关代码
2. 移除 prompt 注入管线（`injectable()` 查询、`knowledgeContext` 注入路径）
3. 移除前端策略配置 UI（表单、摘要、模式指南）
4. 简化 `approveKnowledge()` 和 `updateKnowledgeGovernance()` 移除自动创建策略逻辑
5. 更新测试用例覆盖移除后的正确行为

## 非目标

1. 不修改 `knowledge_governance` 表结构（`runtime_feedback_allowed`、`runtime_feedback_channels` 作为治理裁决的一部分保留）
2. 不修改 `knowledge_use` 表及其 API 端点（`GET /uses`、`POST /record-use` 保留，仍可用于记录 `manual_reference` 等非 policy 驱动的使用）
3. 不修改治理对话相关的表和功能

## 设计

### 移除 knowledge_usage_policy 表

从 schema 中删除 `knowledge_usage_policy` 表定义。该表的所有字段（`allow_prompt_injection`、`prompt_mode`、`skill_visibility`、`tool_visibility`、`checker_binding`、`stage_types`、`snail_names`、`priority`、`token_budget`）均不再使用。

### 移除 prompt 注入管线

旧管线：`knowledge_item` JOIN `knowledge_usage_policy` -> `injectable()` 查询（5 个门禁条件）-> `buildKnowledgeContextSection()` -> 系统提示词。

移除后：知识不再通过策略配置自动注入系统提示词。知识的生效方式由治理对话中的 AI 通过治理裁决决定（如提交系统提示词 PR、skill PR 等）。

### 简化 approveKnowledge 和 updateKnowledgeGovernance

旧逻辑：审批或治理更新时，如果治理裁决允许 prompt 通道，自动创建默认策略。

移除后：审批和治理更新只操作知识本体和治理状态，不再创建策略记录。

### 移除前端策略 UI

知识中心详情页移除：
- "真实反哺状态"区块
- "系统提示词反哺配置"表单
- Prompt 模式选择指南
- 策略保存逻辑

## 生效路径

1. `src/persistence/schema.ts`：数据库表定义
2. `src/shared/knowledge-types.ts`：类型定义
3. `src/persistence/knowledge-model.ts`：数据模型层
4. `src/knowledge-center/knowledge-service.ts`：服务层
5. `src/project-workflow/manager.ts`：管理层
6. `src/interaction-entry/api/knowledge-routes.ts`：API 路由
7. `src/prompt-center/builder.ts`：系统提示词构建
8. `src/web/knowledge-center.js`：前端 UI

## 改动范围

修改（19 个文件）：

1. `src/persistence/schema.ts`
2. `src/shared/knowledge-types.ts`
3. `src/shared/types.ts`
4. `src/shared/index.ts`
5. `src/persistence/helpers.ts`
6. `src/persistence/knowledge-model.ts`
7. `src/persistence/knowledge-types.ts`
8. `src/persistence/store.ts`
9. `src/knowledge-center/knowledge-service.ts`
10. `src/knowledge-center/index.ts`
11. `src/knowledge-center/governance-prompt.ts`
12. `src/project-workflow/manager.ts`
13. `src/interaction-entry/api/knowledge-routes.ts`
14. `src/prompt-center/builder.ts`
15. `src/web/knowledge-center.js`
16. `src/web/styles.css`
17. `tests/persistence/persistence-test.ts`
18. `tests/project/stage-cycle-test.ts`
19. `tests/web/knowledge-center-test.ts`

新增：

1. `docs/features/20260514/F2026051403-remove-usage-policy.md`

## 验证

1. `npm run lint` ✓
2. `npm run build` ✓
3. `npm run test` ✓（35 个测试文件全部通过）
4. 确认代码中不存在对 `knowledge_usage_policy` 表的任何引用
5. 确认前端不再展示"反哺策略"相关内容
6. 确认 API 不再暴露 usage-policy 端点（`/usage-policy` GET/PUT 已移除）
7. 确认 usage tracking 端点保留（`/uses` GET、`/record-use` POST）

## 风险与决策记录

1. 决策：完全移除 prompt 注入管线而非改为治理驱动注入。原因是用户确认最新架构下知识生效方式由治理对话中的 AI 灵活决定，不需要静态注入机制。
2. 决策：保留 `knowledge_use` 表、`recordKnowledgeUse` 功能及对应的 API 端点（`GET /uses`、`POST /record-use`）。原因是该表仍可用于记录 `manual_reference`、`search_result` 等非 policy 驱动的使用场景。
3. 决策：保留 `knowledge_governance` 表的 `runtime_feedback_allowed` 和 `runtime_feedback_channels` 字段。原因是这些字段是治理裁决的一部分，虽然不再有 policy 层做二次门禁，但治理对话中仍需记录这些决策。
