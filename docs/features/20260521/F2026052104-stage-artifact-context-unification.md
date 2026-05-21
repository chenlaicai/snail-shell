# F2026052104 Stage 产物上下文统一与 Repo Context 优化

## 背景

当前 Snail Shell 存在两套并行的"产物/上下文"记录机制：

1. **Stage 层的 `output_artifacts`**：`string[]`，存储产物 ID 列表，随工作流在 stage 间流转。
2. **Feature 层的 `branch_name` / `worktree_path` / `pr_url`**：通过独立的 `record-feature-repo-context` CLI 写入，agent 经常遗忘调用，导致记录"时灵时不灵"。

这两套机制本质上都是 feature 的流程上下文：branch/PR/worktree 本就是 development stage 的产出，应该随 stage 流转到 review stage 作为 context。两套分离的机制导致了：

- 数据归属错位（repo context 在 feature 表而非 stage）
- 记录不稳定（agent 需要额外记一步 CLI 调用）
- 维护成本高（两个 UI 入口 + 独立 CLI）
- 扩展性差（加新字段需要改 schema）

## 目标

1. `Stage.output_artifacts` 从 `string[]` 改为 `Record<string, string>`（扁平 map）
2. 将 `branch_name`、`worktree_path`、`pr_url` 作为 stage 产物上下文写入 `output_artifacts`
3. 删除 `feature` 表的 `branch_name`、`worktree_path`、`pr_url` 列
4. `record-feature-repo-context` CLI/skill 改为写入当前 stage 的 `output_artifacts`
5. UI 统一为一个 key-value 编辑器，agent 写入和用户手动修改使用同一入口
6. 消费者（repo-cleanup、prompt builder、UI）从 stage 读取上下文

## 非目标

- 不考虑兼容迁移（直接做到最终状态）
- 不保留 `feature` 表上的 repo context 列或兼容读取路径
- 不保留旧的 `string[]` 格式的 `output_artifacts` 兼容代码

## 设计

### 核心决策：Stage 层承载所有产物上下文

**Stage 是正确的归属。** `branch_name`、`worktree_path`、`pr_url` 本就是 development stage 的产出，天然应该随 stage 流转到 review。放在 feature 表是错位的。

### 数据模型

**Stage.output_artifacts**：`TEXT`，存 JSON object（之前是 JSON array）

```json
{
  "branch_name": "feature/xxx",
  "worktree_path": "/Users/.../worktrees/xxx",
  "pr_url": "https://github.com/org/repo/pull/123",
  "change_summary": "实现了xxx"
}
```

默认值从 `'[]'` 改为 `'{}'`。字段完全扁平，无嵌套。

**Feature 表**：移除 `branch_name`、`worktree_path`、`pr_url` 列。Feature 不再承载 repo context。

### API 变更

**移除**：
- `PATCH /features/:featureId/repo-context` — 不再需要

**保留/更新**：
- `PATCH /stages/:stageId` — `output_artifacts` 接受 `Record<string, string>` 而非 `string[]`
- Stage advance guard：检查 `Object.keys(output_artifacts).length === 0` 而非 `output_artifacts.length`

### CLI 变更

`record-feature-repo-context` 改为：
- 接收 `--stage-id`（或通过 `--feature-id` 查找当前 stage）
- 写入 stage 的 `output_artifacts`（merge 而非覆盖，保留已有 key）
- 参数改为 key=value 形式：`--set branch_name=feat/xxx --set pr_url=https://...`

### Feature 表 repo context 推导

Feature 不再直接存储 repo context。消费者需要时从当前（或最近完成的 development）stage 的 `output_artifacts` 中读取对应 key：

- `repo-cleanup.ts`：从 feature 的 development stage 中读取 `worktree_path`、`branch_name`
- `repo-context-view.js`：从 current_stage 的 `output_artifacts` 中读取并展示
- Prompt builder：直接使用 stage 的 `output_artifacts` 渲染

### UI 统一

将 `repo-context-view.js`（三个 prompt 对话框）和 `workspace-context.js` 中的 artifact pills 合并为一个统一的 key-value 编辑器：
- 以表格/列表形式展示所有 key-value
- 每行可编辑 key 和 value
- 可添加/删除行
- Agent 写入的和用户手动修改的使用同一入口
- 后端统一为 `PATCH /stages/:stageId`

## 生效路径

- `src/shared/domain-types.ts`：Stage 类型定义
- `src/persistence/schema.ts`：数据库 schema
- `src/persistence/store.ts`：持久化层读写
- `src/persistence/helpers.ts`：JSON 解析
- `src/project-workflow/manager.ts`：业务逻辑
- `src/project-workflow/repo-cleanup.ts`：仓库清理
- `src/interaction-entry/api/feature-routes.ts`：API 路由
- `src/bin/record-feature-repo-context.ts`：CLI 工具
- `.meta/skills/record-feature-repo-context/`：Skill 文档
- `.meta/prompts/`：开发者 playbook
- `src/web/workspace-context.js`：UI context 面板
- `src/web/repo-context-view.js`：UI repo context 展示
- `src/web/feature-workflow-state.js`：UI 状态辅助

## 改动范围

### 类型系统
- `src/shared/domain-types.ts`：`Stage.output_artifacts` 改为 `Record<string, string>`，`Feature` 移除 `branch_name/worktree_path/pr_url`，更新 `CreateStageInput`
- `src/project-workflow/manager-types.ts`：更新 `StageDetail`、`FeatureDetail`

### 数据库
- `src/persistence/schema.ts`：feature 表移除三列，stage 表 `output_artifacts` DEFAULT 改为 `'{}'`
- `src/persistence/migrations.ts`：删除。`initSchema()` 添加 HARD RULE 禁止自动迁移，旧库 `output_artifacts` 为 `[]` 或 feature 表仍含旧列时需人工处理
- `src/persistence/helpers.ts`：`mapStage` 解析改为 Record
- `src/persistence/store.ts`：创建/更新 stage 时的序列化适配

### API 与业务逻辑
- `src/interaction-entry/api/feature-routes.ts`：移除 `PATCH /features/:featureId/repo-context` 路由，更新 `parseStageUpdates`
- `src/project-workflow/manager.ts`：移除 `updateFeatureRepoContext`，更新 `assertStageCanAdvance`
- `src/project-workflow/repo-cleanup.ts`：从 stage 读取 repo context
- `src/project-workflow/workflow.ts`：如有引用需要更新

### CLI 与 Skill
- `src/bin/record-feature-repo-context.ts`：完全重写，写入 stage
- `.meta/skills/record-feature-repo-context/SKILL.md`：更新文档
- `.meta/skills/record-feature-repo-context/record-feature-repo-context`：可能需要更新

### 提示词
- `src/prompt-center/builder.ts`：`output_artifacts` 渲染适配 Record 类型
- `.meta/prompts/`：更新 developer playbook 中对 skill 的引用

### UI
- `src/web/workspace-context.js`：改为 key-value 编辑器
- `src/web/repo-context-view.js`：合并到统一的 key-value 编辑器
- `src/web/feature-workflow-state.js`：移除 `featureRepoContextFields` 等
- `src/web/app.js`：移除 repo context 相关 handler

### 测试
- 所有受影响的单元测试和集成测试

## 验证

- `npm test` 全部通过
- `npm run check-feature-doc-numbering` 通过
- 手动验证 UI key-value 编辑器功能
- 验证 stage advance 流程（空 map 应被阻止）
- 验证 repo cleanup 从 stage 正确读取上下文

## 风险与决策记录

- **不兼容变更**：`output_artifacts` 类型从 `string[]` 变为 `Record<string, string>`。不提供自动迁移——`initSchema()` 只在全新数据库创建表，不修改已有数据。旧数据库如有 `output_artifacts` 为 `[]` 或 feature 表含旧列，需人工处理（如重建数据库）。用户确认无需兼容迁移。
- **Feature 列删除**：`feature` 表的三列直接删除，不保留。现有数据在迁移中丢失，用户确认可接受。
