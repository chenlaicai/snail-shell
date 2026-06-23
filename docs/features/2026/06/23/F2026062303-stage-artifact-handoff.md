---
id: F2026062303
title: stage-artifact-handoff
from_ids: []
tags: [workflow, context, ui]
modules: [issue-collaboration, web]
doc_kind: spec
---

# F2026062303 [workflow] Issue 级别统一上下文：消除 Stage 间上下文断裂

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

当前系统的上下文传递模型以 Stage 为单位：每个 Stage 有独立的 `output_artifacts: Record<string, string>`，Stage 之间通过 `from_stage_id` 链接。这个模型在 v1 → v2 重构后存在根本性缺陷：

1. **Agent 上下文断裂**：`buildSystemReminder` 只读取当前 Stage 的 `output_artifacts`，不回溯前置 Stage。新 Stage 的 agent 启动时对前置 Stage 一无所知。
2. **UI 产物不可见**：PropertiesPanel 只渲染当前 Stage 的产物，用户在 Review Stage 看不到 Development Stage 产出了什么。
3. **Stage 转移无交接**：`advanceStage` 创建新 Stage 时 `output_artifacts: {}`，不携带任何前置上下文。
4. **模型复杂度**：链式传递（`from_stage_id` 回溯）增加了不必要的复杂性，且只有部分消费者使用。

**根因**：Stage 级别的上下文模型导致每个 Stage 只能看到自己的产物，跨 Stage 传递依赖链式回溯，而 v2 的回溯链路没有消费者。

**用户决策**：不做局部修补（P1/P2 方案），而是将上下文提升到 Issue 级别，所有 Stage 所有角色共享同一套上下文。改动面虽大，但从根本上解决问题。

## 目标

将上下文从 Stage 级别提升到 Issue 级别。Issue 维护一套统一的 `context: Record<string, string>`，所有 Stage、所有角色往里写入和读取。agent 启动时通过 system reminder 注入完整 Issue 上下文，UI 通过 PropertiesPanel 展示 Issue 上下文。

## 非目标

- 不实现 MCP 上下文查询工具（本次注入完整 key-value，MCP 工具作为未来可选增强）
- 不做 `output_artifacts` 的数据迁移（旧 Stage 数据保留，新逻辑不再使用）
- 不删除 Stage 表的 `output_artifacts` 字段（保留数据库兼容）
- 不删除 `from_stage_id`（保留 Stage 链路拓扑元数据，Timeline 视图等未来特性需要）
- 不实现 Stage Timeline 视图（独立特性）
- 不强制 agent 记录产物（属于 SOP 设计范畴，通过 SOP handbook 的产物要求解决）

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当 agent 被调用且 Issue 有 `context` 时 | system reminder 应包含 `## Issue 上下文` section，列出 Issue.context 的完整 key-value 列表 | |
| B2 | 当 agent 被调用且 Issue 的 `context` 为空时 | system reminder 不包含"Issue 上下文"section | |
| B3 | 当任意角色通过 `record-issue-repo-context` 写入上下文时 | 写入 Issue 级别 `context`，key 格式为 `{stage_key}.{artifact_name}` | |
| B4 | 当用户在 UI 查看任意 Stage 时 | PropertiesPanel 展示 Issue 级别的完整上下文（不分组，不分 Stage） | |
| B5 | 当 Stage 推进时 | 新 Stage 的 agent 自动获得 Issue 完整上下文（通过 system reminder 注入），无需回溯前置 Stage | |
| B6 | 当 `makeStageTransitionSuggestion` 生成建议时 | suggestion 的 `artifacts` 字段拷贝 Issue.context（而非 Stage.output_artifacts） | |

## 设计

### 数据模型

**Issue 表新增字段**：

```
context TEXT NOT NULL DEFAULT '{}'
```

存储 JSON `Record<string, string>`，与 Stage 的 `output_artifacts` 格式一致。

**Key 命名规范**：`{stage_key}.{artifact_name}`

示例：
```
design.feature_doc_path = docs/features/2026/06/23/F2026062301-xxx.md
dev.worktree_path = /Users/orca/.../worktrees/xxx
dev.branch_name = feature-xxx
dev.pr_url = https://github.com/.../pull/123
review.decision = approved
```

前缀的用途：
- 避免不同 Stage 产出同名 artifact 时的 key 冲突
- UI 展示时用户能一眼看出来源
- agent 不关心前缀（它只看 key-value），但也不受前缀影响

### 写入方

**`record-issue-repo-context` skill**：改为写入 Issue 级别 `context`（而非 Stage 的 `output_artifacts`）。

**写入接口**：`PATCH /api/issues/:issueId` 或新增 `PATCH /api/issues/:issueId/context`，接受 `Record<string, string>`，merge 语义（保留已有 key，覆盖冲突 key）。

**Key 前缀注入**：skill 脚本在写入时自动添加当前 Stage 的 key 前缀。例如在 Development Stage 写入时，`worktree_path` 自动变为 `dev.worktree_path`。

### 读取方：Agent 上下文注入

**`buildSystemReminder` 变更**：

在 `<context>` 的 `## 当前阶段` section 中，新增 `## Issue 上下文` section：

```markdown
## Issue 上下文

- design.feature_doc_path: docs/features/2026/06/23/F2026062301-xxx.md
- dev.worktree_path: /Users/orca/.../worktrees/xxx
- dev.branch_name: feature-xxx
- dev.pr_url: https://github.com/.../pull/123
```

**边界条件**：
- Issue.context 为空 → 跳过，不生成此 section
- Issue 不存在（数据异常）→ 跳过，log warning

**注入方式**：完整 key-value 注入（不只 key 列表）。理由：
- 300-500 token 对 200k context window 微不足道
- 推模式比拉模式可靠，消除 MCP 工具硬依赖
- 简化 agent 行为，不需要"判断是否需要查询"

**移除**：现有 `**阶段产物**` 行（展示 Stage.output_artifacts）不再需要，替换为 Issue 上下文 section。

### 读取方：UI

**PropertiesPanel 变更**：

现有 "Context" section 改为渲染 Issue.context（而非 Stage.output_artifacts）。不分组，不分 Stage——统一展示 Issue 级别的完整上下文。

**数据来源**：前端通过 issue detail API 获取 Issue.context（需在 DTO 中新增字段）。

### 读取方：Suggestion

**`makeStageTransitionSuggestion` 变更**：

`artifacts` 字段从拷贝 `stage.output_artifacts` 改为拷贝 `issue.context`。suggestion 的语义从"当前 Stage 的产物"变为"Issue 的完整上下文"。

### Stage 层处理

**`advanceStage`**：不再需要初始化新 Stage 的 `output_artifacts`（新逻辑不使用该字段）。`from_stage_id` 保留，记录 Stage 链路拓扑。

**`output_artifacts`**：Stage 表的字段保留（数据库兼容），但新逻辑不再写入或读取。旧 Stage 的 `output_artifacts` 数据保持原样。

**`addOutputArtifacts`**：不再有调用方。可标记为 deprecated，但不删除（避免破坏可能的外部调用）。

## 生效路径

- `src/domain/issue/model.ts` — Issue 模型新增 `context` 字段
- `src/domain/issue/_internal/repository.ts` — Issue 表新增 `context` 列
- `src/domain/issue/_internal/adapter.ts` — `addOutputArtifacts` deprecated
- `src/api-contracts/dto.ts` — `IssueDetailDto` 新增 `context` 字段
- `src/app/issue-collaboration/collaboration.ts` — `buildSystemReminder` 读取 Issue.context；`makeStageTransitionSuggestion` 适配
- `src/web/components/PropertiesPanel.tsx` — "Context" section 改为渲染 Issue.context
- `v1/.meta/skills/record-issue-repo-context/` — skill 脚本改为写入 Issue.context
- SOP handbook — 约束产物的 key 命名规范和"下游可读性"

## 设计约束摘要

- **边界**：上下文存储在 Issue 级别，不再按 Stage 隔离。Stage 的 `output_artifacts` 保留但不使用。`from_stage_id` 保留用于拓扑。
- **关键决策**：system reminder 注入完整 key-value（非只 key 列表），消除 MCP 工具硬依赖。key 命名带 Stage 前缀（`{stage_key}.{artifact_name}`）避免冲突和追溯来源。
- **非目标约束**：不做 MCP 工具、不做数据迁移、不删除 `output_artifacts` 字段、不强制 agent 记录产物。
- **语义不变量**：Issue.context 是唯一的真实来源（single source of truth）。所有 Stage 的 agent 共享同一套上下文。写入是 merge 语义（保留已有 key，覆盖冲突 key）。
- **前置依赖**：本 feature 的价值高度依赖 agent 实际记录产物的行为。Issue.context 为空时，system reminder 和 UI 均无内容可展示。SOP handbook 各 Stage 定义中应增加具体的产物记录要求（如 Design Stage 必须记录 `design.feature_doc_path`，Development Stage 必须记录 `dev.worktree_path`/`dev.branch_name`/`dev.pr_url`）。本 feature 提供读取和展示机制，不提供记录强制。

<!-- [design-time] 章节结束 -->

### 任务锚

#### 本质目标
将上下文从 Stage 级别提升到 Issue 级别，消除 Stage 间上下文断裂。Issue 维护一套统一的 `context: Record<string, string>`，所有 Stage、所有角色共享同一套上下文。

#### 反目标
- 不得修改 `extendable_context` 字段（该字段用于演进项等其他用途）
- 不得删除 `output_artifacts` 字段（保留数据库兼容）
- 不得删除 `from_stage_id`（保留 Stage 链路拓扑元数据）
- 不得实现 MCP 上下文查询工具（本次注入完整 key-value，MCP 工具作为未来可选增强）

#### 语义不变量
- Issue.context 是唯一的真实来源（single source of truth）
- 所有 Stage 的 agent 共享同一套上下文
- 写入是 merge 语义（保留已有 key，覆盖冲突 key）
- Key 命名带 Stage 前缀（`{stage_key}.{artifact_name}`）避免冲突和追溯来源

#### 成功标准
- Agent 启动时通过 system reminder 注入完整 Issue 上下文
- UI PropertiesPanel 展示 Issue 级别的完整上下文
- Stage transition suggestion 的 artifacts 字段拷贝 Issue.context
- `npm test` 全部通过
- `npm run check` 通过

## 改动范围

| 文件 | 改动 |
|------|------|
| `src/domain/issue/model.ts` | Issue 类型新增 `context: Record<string, string>` |
| `src/domain/issue/_internal/repository.ts` | Issue 表新增 `context` 列；Issue 查询和写入适配 |
| `src/domain/issue/_internal/adapter.ts` | `addOutputArtifacts` 标记 deprecated |
| `src/api-contracts/dto.ts` | `IssueDetailDto` 新增 `context` 字段；`StageDetailDto` 的 `output_artifacts` 保留但不再有写入方 |
| `src/app/issue-collaboration/collaboration.ts` | `buildSystemReminder` 读取 Issue.context 注入 `## Issue 上下文` section；`makeStageTransitionSuggestion` 拷贝 Issue.context |
| `src/web/components/PropertiesPanel.tsx` | "Context" section 改为渲染 Issue.context（从 issue prop 读取，不再从 stage） |
| `v1/.meta/skills/record-issue-repo-context/` | skill 脚本改为写入 Issue.context；key 前缀自动注入 |

## 验证

### 核心行为

- [ ] 创建 issue，通过 `record-issue-repo-context` 写入 `design.feature_doc_path`
- [ ] 验证 Issue.context 包含 `design.feature_doc_path` key
- [ ] 进入 Development Stage，检查 agent 的 system reminder 包含 `## Issue 上下文` section，且包含 `design.feature_doc_path`
- [ ] 通过 `record-issue-repo-context` 写入 `dev.worktree_path`，验证 Issue.context 合并（不丢失 `design.feature_doc_path`）
- [ ] 进入 Review Stage，检查 agent 的 system reminder 包含所有已写入的上下文（`design.*` + `dev.*`）

### UI

- [ ] 在任意 Stage 查看 PropertiesPanel，确认 "Context" section 展示 Issue 级别上下文（包含所有 Stage 的产物）
- [ ] 验证长路径（如 `/Users/orca/ai/snail-shell/.snail/worktrees/feature-stage-artifact-handoff/`）在 280px 面板中的显示效果

### Suggestion

- [ ] 触发 stage transition suggestion，验证 suggestion 的 `artifacts` 字段包含 Issue.context（而非 Stage.output_artifacts）

### 兼容性

- [ ] 验证旧 Stage 的 `output_artifacts` 数据不受影响（数据库层面保留）
- [ ] 验证 `from_stage_id` 链路不受影响

### 通用

- [ ] `npm test` 全部通过
- [ ] `npm run check` 通过

## 关联

- **相关**: F2026052104（Stage 产物上下文统一——本 feature 的前置基础，本 feature 进一步将上下文提升到 Issue 级别）
- **相关**: F2026060303（Stage 转移验证——P4 自动触发与本 feature 配合）
- **相关**: F2026051101（意图识别与 Stage 上下文追溯——本 feature 从系统层面解决追溯问题）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | 上下文存储级别：Stage vs Issue | Issue 级别消除链式传递，模型简化，全链路可见 | 改动面大，需要修改所有消费者，回归风险高 | Issue 级别统一上下文 | 用户明确要求"本次做完整"；改动面可控（5 核心 + 3 边界）；长期收益明确 | 架构师-1, 架构师-2, 用户 | 2026-06-23 |
| D2 | Key 命名规范：扁平 vs 带前缀 | 带前缀避免冲突、追溯来源、UI 可读 | key 更长，agent 不需要前缀 | 带前缀 `{stage_key}.{artifact_name}` | 冲突避免和来源追溯的价值大于 key 长度的微小开销 | 架构师-1, 架构师-2 | 2026-06-23 |
| D3 | 注入方式：完整 key-value vs 只 key 列表 | 完整注入消除 MCP 工具硬依赖，推模式比拉模式可靠，300-500 token 开销微不足道 | 只注入 key 列表更省 token，agent 按需查询更精确 | 注入完整 key-value | 可靠性和简洁性优先于 token 优化；200k context window 下 300-500 token 不构成瓶颈 | 架构师-1, 架构师-2 | 2026-06-23 |
| D4 | MCP 工具优先级 | 未来 token 压力场景下可能需要；按前缀查询提供便利性 | 注入完整 key-value 时非必要；增加实现和维护成本 | 本次不做，作为未来可选增强 | 注入完整 value 时 MCP 工具不提供额外价值；避免过度设计 | 架构师-1, 架构师-2 | 2026-06-23 |
| D5 | 现有 `output_artifacts` 处理 | 保留字段避免数据库迁移和回归风险；新逻辑不使用即可 | 保留废弃字段增加认知负担 | 保留字段，新逻辑不再使用 | 最小改动原则；删除字段需要迁移，收益不大 | 架构师-1, 架构师-2 | 2026-06-23 |
| D6 | `makeStageTransitionSuggestion` 适配 | suggestion 的语义应反映 Issue 完整上下文 | 改动 suggestion 可能影响现有 UI | 改为拷贝 Issue.context | 统一上下文后，suggestion 应展示 Issue 级别信息 | 架构师-1, 架构师-2 | 2026-06-23 |
| D7 | 产物记录强制方式 | 本 feature 只解决"读取和展示"，不解决"记录和强制" | 如果 agent 不记录产物，本 feature 全部失效 | 不强制，通过 SOP handbook 解决 | 记录强制属于 SOP 设计范畴；本 feature 的设计约束摘要中显式记录此前置依赖 | 架构师-1, 架构师-2 | 2026-06-23 |
| D8 | UI 展示分组 | 统一上下文后不再需要 Stage 间分组 | 分组有助于理解来源 | 不分组，统一展示 Issue.context | key 前缀已提供来源信息，无需额外分组 | 架构师-1, 架构师-2 | 2026-06-23 |
