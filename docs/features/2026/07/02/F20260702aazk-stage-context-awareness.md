---
id: F20260702aazk
title: Stage 推进时的情境感知
status: implemented
created_at: 2026-07-02
---

# F20260702aazk — Stage 推进时的情境感知

## 背景

Stage 推进时，`autoInvokeNewStage()` 向新阶段的默认角色发送 `"开始执行。"` 作为 kickoff 消息。agent 获得的上下文仅限于 system-reminder 中的 Issue 上下文（key-value 对）和 identity 块。

**问题**：当 stage 回滚后重新进入（如 design → development → 回滚到 design → 修改 feature doc → 再次 development），新阶段的 agent 无法获知：
1. 之前发生了什么（哪些阶段已经走过）
2. 为什么回滚（回滚原因）
3. 前序阶段的关键决策和产出
4. 当前是第几次进入这个阶段

**现有能力**：
- `snail-message-history` MCP 已有 4 个消息查询工具（search_messages, list_messages, get_message, get_message_window）
- `snail-issue-context` MCP 提供 get_context/set_context
- `Stage.from_stage_id` 形成阶段链
- `stage_audit` 表记录阶段流转审计

**核心架构问题**：当前 `rollbackStage()` 实现会 DELETE 当前 stage 及其 audit 记录，导致阶段链丢失历史。这与"情境感知"的需求直接矛盾——如果 stage 记录被删除，agent 无法知道曾经发生过什么。

**缺口**：
- stage transition 模型需要从"DELETE 式回滚"改为"append-only 式推进"
- context block 不包含阶段链信息
- kickoff 消息没有区分首次进入 vs 重新进入
- 没有阶段级别的结构化历史查询工具
- role skill 没有引导 agent 了解当前情境

## 核心业务行为

1. **当 stage 发生转换时**（无论前进还是后退），系统应创建新的 stage 记录，`from_stage_id` 指向当前 stage，当前 stage 设置 `left_at`。stage chain 是 append-only 的，永不删除
2. **当 agent 进入新 stage 时**，context block 应自动展示阶段链（所有阶段的 key、时间、状态），使 agent 无需主动查询即可了解全局进展
3. **当 agent 进入新 stage 时**，context block 应展示前序阶段的最近消息（每阶段最多 2 条 final_text），使 agent 了解前序阶段的关键讨论
4. **当 stage 重新进入一个已访问过的 key 时**，context block 应标注"重新进入"，kickoff 消息应明确提示 agent 了解前序情况
5. **当 agent 需要深入了解某个阶段时**，可通过 `get_stage_history` MCP 工具获取结构化的阶段历史（含消息列表）
6. **当 role skill 被加载时**，应包含"了解当前情境"的指引，引导 agent 使用 MCP 工具查询历史

## [design-time]

### 决策记录

#### D0: Stage 转换模型 — append-only chain

**问题**：当前 `rollbackStage()` 会 DELETE 当前 stage 记录，丢失历史。应该保持 DELETE + 外部补偿，还是改为 append-only？

**方案 A**：保持 DELETE + `sop.rollback_log` 补偿（原方案）
**方案 B**：废弃 `rollbackStage()`，统一用 `advanceStage()` 实现所有 stage 转换，stage chain append-only

**选择方案 B**。理由：
- stage chain 自身就是完整历史，不需要外部补偿机制
- 消除孤儿消息问题（stage 记录始终存在，消息始终可查）
- 简化 re-entry 检测（遍历 chain 检查同 key 前驱即可）
- `stage_audit` 表自然保留每次转换的审计记录
- 概念统一：没有"回滚"，只有"推进到某个 stage key"

**实现要点**：
- `advanceStage()` 的当前实现已支持任意 targetKey（只要在 `available_transitions` 中），无需修改其实现
- SOP YAML 已定义反向边（如 `development → design`、`review → design`），因此 `available_transitions` 已包含回退目标
- `advanceStage()` 已有的行为：设置 `left_at`、创建新 stage（`from_stage_id` 指向当前）、从 `sop_snapshot.stage_definitions` 查找 title/description/roles — 全部符合 append-only 模型
- 实际变更为两项：(1) `rollbackStage()` 标记 `@deprecated` 并委托给 `advanceStage()` (2) collaboration 层的 `rollbackStage()` 方法内部改为调用 `advanceStage()`
- 不兼容更新：`rollbackStage()` 接口废弃（标记 `@deprecated`），调用方改为使用 `advanceStage()`

#### D1: 阶段链展示方式

**问题**：context block 空间有限，阶段链可能很长（多次重新进入），如何平衡信息量和简洁性？

**方案 A**：只展示最近 3 个阶段，超出部分折叠
**方案 B**：展示全部阶段，但每阶段只有一行摘要
**方案 C**：展示全部阶段，前序阶段各附带最近 2 条消息

**选择方案 C**。理由：
- agent 需要完整路径来理解"我是怎么到这里的"
- 每阶段 2 条消息不会过度膨胀 context block（每条约 200 字，5 个阶段 ≈ 2000 字）
- 如果阶段数超过 5，截断并提示"更多历史请使用 MCP 工具查询"

#### D2: `get_stage_history` vs 增强现有 `list_messages`

**问题**：应该新增 `get_stage_history` 工具还是增强现有的 `list_messages`？

**方案 A**：新增独立工具 `get_stage_history`
**方案 B**：在 `list_messages` 中增加 `stage_detail` 模式

**选择方案 A**。理由：
- `list_messages` 是消息级别的查询，`get_stage_history` 是阶段级别的结构化数据（含 stage 元信息、产物）
- 两个工具的关注点不同，合并会增加 `list_messages` 的复杂度
- 独立工具的 description 更容易被 agent 发现和理解

#### D3: kickoff 消息增强范围

**问题**：kickoff 消息应该包含多少历史信息？

**方案 A**：kickoff 只标注"重新进入"，详细历史靠 context block
**方案 B**：kickoff 包含完整的前序阶段摘要

**选择方案 A**。理由：
- context block 已经包含阶段链和前序消息，kickoff 不需要重复
- kickoff 消息过长会稀释 agent 对核心任务的注意力
- "重新进入"标注足以让 agent 意识到需要额外关注上下文

### 变更清单

#### C0: 废弃 rollbackStage，统一为 advanceStage（port.ts + collaboration.ts + repository.ts）

**文件**：
- `src/domain/issue/port.ts` — 废弃 `rollbackStage` 接口
- `src/domain/issue/_internal/adapter.ts` — `rollbackStage()` 委托给 `advanceStage()`
- `src/domain/issue/_internal/repository.ts` — `rollbackStage()` 标记 `@deprecated`
- `src/app/issue-collaboration/collaboration.ts` — `rollbackStage()` 方法内部改为调用 `advanceStage()`

**变更**：

1. **`StagePort` 接口**：`rollbackStage()` 标记 `@deprecated`
2. **`adapter.ts`**：`rollbackStage()` 实现改为委托给 `advanceStage(currentStageId, targetKey)`（`advanceStage()` 已支持任意 targetKey，无需修改其实现）
3. **`repository.ts`**：`rollbackStage()` 的 DELETE 实现标记 `@deprecated`，不再被调用
4. **`collaboration.ts`**：`rollbackStage()` 方法内部改为调用 `this.deps.stagePort.advanceStage(stageId, targetKey)`，保留方法签名以兼容调用方

**确认无需修改**：`advanceStage()` 的当前实现已完整支持 append-only 模型——设置 `left_at`、创建新 stage（`from_stage_id` 指向当前）、从 `sop_snapshot.stage_definitions` 查找定义。SOP YAML 已定义反向边（如 `development → design`），`available_transitions` 已包含回退目标。

**不兼容更新**：`StagePort.rollbackStage()` 废弃。外部调用方（如有）需迁移到 `advanceStage()`。

#### C1: context block 增加阶段链展示（collaboration.ts）

**文件**：`src/app/issue-collaboration/collaboration.ts`

**变更**：在 `buildContextBlock()` 方法中，新增"阶段历史"段落，插入到"Issue 上下文"和"当前阶段"之间。

**阶段链构建逻辑**：
1. 从当前 stage 出发，通过 `from_stage_id` 回溯构建链路（防止数据异常，最多回溯 20 层）
2. 链路即为完整的 stage history（append-only，无 DELETE，无孤儿）
3. 对链路中的每个阶段：
   - 展示：`[key] title — entered_at`，当前阶段标注 `(当前)`
   - 如果不是当前阶段，调用 `messagePort.listMessages(stage.id, 2)` 获取最近 2 条消息
   - 对每条消息，调用 `messagePort.getContext(msg.id)` 获取 final_text 内容
   - 消息内容截断到 200 字符
4. **重新进入检测**：遍历链路，如果当前 stage key 在前驱节点中出现过，标注 `(当前 · 重新进入)`

**输出格式**：
```
## 阶段历史
1. [design] 设计阶段 — 2026-07-02 10:00
   - 架构师-1: Feature 文档已锁定，核心变更为...
   - user: 确认方案 LGTM
2. [development] 开发阶段 — 2026-07-02 14:00
   - 开发者: 实现了 X 功能，发现 Y 问题...
3. [design] 设计阶段 — 2026-07-02 15:00
   - 架构师-1: 根据反馈更新了 feature doc...
4. [development] 开发阶段 — 2026-07-02 16:00 (当前 · 重新进入)
```

**边界条件**：
- 阶段数 > 5：只展示最近 5 个阶段，前面的折叠为 `... (N 个更早阶段)`（降低 N+1 查询最坏情况，5 × 3 = 15 次查询）
- 消息内容为空：跳过该消息
- 消息内容超过 200 字符：截断并加 `...`
- 阶段链构建遇到环（from_stage_id 指向已遍历的阶段）：中断回溯

#### C2: 新增 `get_stage_history` MCP 工具（snail-message-history.ts）

**文件**：`src/domain/snail-mcp-server/_internal/servers/snail-message-history.ts`

**变更**：新增 `createGetStageHistoryTool()` 函数，注册到 `snail-message-history` server。

**工具定义**：
```typescript
{
  name: "get_stage_history",
  description: "获取 Issue 的完整阶段历史链，包含每个阶段的元信息和最近消息。用于了解整体进展和前序阶段的关键决策。",
  inputSchema: {
    type: "object",
    properties: {
      issue_id: { type: "string", description: "Issue ID" },
      include_messages: { type: "boolean", description: "是否包含每个阶段的最近消息，默认 true" },
      messages_per_stage: { type: "number", description: "每个阶段返回的消息数量，默认 3" },
    },
    required: ["issue_id"],
  },
}
```

**返回结构**：
```typescript
{
  stages: Array<{
    stage_id: string;
    key: string;           // 如 "design"
    title: string;
    description: string;
    entered_at: string;
    left_at: string | null;  // null = 当前阶段
    is_current: boolean;
    is_re_entry: boolean;    // 同一 key 在 chain 中出现过更早的实例
    output_artifacts: Record<string, string>;
    messages?: Array<{       // include_messages=true 时包含
      message_id: number;
      from_speaker: string | null;
      content: string | null;
      created_at: string;
    }>;
  }>;
  total_stages: number;
}
```

**实现要点**：
1. 从当前 stage 出发，通过 `from_stage_id` 回溯构建链路（append-only，所有 stage 都存在）
2. 对链路中每个 stage，如果 `include_messages=true`，调用 `messagePort.listMessages(stage.id, messages_per_stage)` 获取最近消息
3. 对每条消息，调用 `messagePort.getContext(msg.id)` 获取内容
4. `is_current` = `left_at === null`
5. `is_re_entry` = 同一 key 在 chain 的更早位置出现过

#### C3: kickoff 消息增强（collaboration.ts）

**文件**：`src/app/issue-collaboration/collaboration.ts`

**变更**：修改 `autoInvokeNewStage()` 方法，根据是否为重新进入发送不同的 kickoff 消息。

**判断逻辑**（依赖 C0 的 append-only chain）：
1. 获取当前 stage 的 `key`
2. 通过 `from_stage_id` 回溯 stage chain
3. 如果发现前驱节点中有相同 key 的 stage，说明是重新进入

**kickoff 消息内容**：
- 首次进入：保持 `"开始执行。"` 不变
- 重新进入：`"重新进入 [key] 阶段。请先了解前序阶段的情况和变更，再开始工作。"`

**注意**：kickoff 消息保持简洁，详细历史通过 context block（C1）和 MCP 工具（C2）获取。

#### C4: Role Skill 增加"了解当前情境"指引

**文件**：各 role skill 的 SKILL.md

**变更**：在每个 code-delivery SOP 的 role skill（cd-design, cd-development, cd-review, cd-merge）中，在"工作流程索引"之前增加一个"情境感知"段落。

**内容模板**：
```markdown
## 情境感知

进入 stage 后，在开始具体工作前，先了解当前情境：

1. **阅读 context block**：system-reminder 中的"阶段历史"段落已包含完整的阶段链和前序阶段的关键消息
2. **判断是否为重新进入**：如果 kickoff 消息包含"重新进入"或 context block 标注"重新进入"，说明你正在重新进入一个已访问过的阶段，需要特别关注前序阶段发生了什么变化
3. **按需深入查询**：如果 context block 中的信息不足以理解当前情况，使用以下 MCP 工具：
   - `get_stage_history`：获取完整的阶段历史和结构化数据
   - `list_messages`：查询特定阶段的消息列表
   - `search_messages`：按关键词搜索历史消息
   - `get_context`：读取 Issue 上下文中存储的跨阶段元数据
4. **不要假设"开始执行"意味着从零开始**：前序阶段可能已经完成了大量工作，你需要在已有基础上继续
```

#### C5: conversation-history skill 清理

**文件**：`.claude/skills/conversation-history` 符号链接

**变更**：删除无效的符号链接（目标目录 `data/file/skills/conversation-history` 不存在）。`snail-message-history` MCP server 已完全替代旧的 conversation-history skill。

### 不兼容更新

- `StagePort.rollbackStage()` 接口废弃（`@deprecated`），内部委托给 `advanceStage()`
- `advanceStage()` 的 `targetKey` 参数不再限制为"下一个"stage key，可以是任意 key
- context block 新增"阶段历史"段落（仅 LLM 消费，不构成 breaking change）

### 实现指引

- C0 是基础架构变更，必须先于 C1/C2/C3 完成
- C0 的实际工作量很小：`advanceStage()` 实现无需修改（已支持任意 targetKey），只需废弃 `rollbackStage()` 并委托
- C0 废弃 `rollbackStage()` 时，保留方法签名并委托给 `advanceStage()`，避免一次性修改所有调用方
- C1 的阶段链回溯需处理 `from_stage_id` 为 null（首个阶段）和环路的边界情况
- C1/C2 的重新进入检测：遍历 chain 检查同 key 前驱，O(n) 复杂度，n 通常 < 20
- 自环防护：SOP 不定义自环边（`targetKey === current.key`），`available_transitions` 天然阻止自环

### 验收标准

| ID | 标准 | 验证方式 |
|----|------|----------|
| AC-0 | `advanceStage()` 支持 target 为任意 stage key | 调用 advanceStage(currentId, "design") → 验证新 stage 创建且旧 stage 未被删除 |
| AC-1 | `rollbackStage()` 废弃后委托给 `advanceStage()` | 调用 rollbackStage → 验证行为与 advanceStage 一致，无 DELETE |
| AC-2 | context block 包含阶段历史段落 | 创建 issue → 推进 stage → 检查新 stage 的 system-reminder |
| AC-3 | 阶段历史展示前序阶段的最近消息 | 在 design stage 发送消息 → 推进到 development → 检查 context block |
| AC-4 | 重新进入的 context block 标注"重新进入" | 推进 → 再次推进到同 key → 检查阶段历史中标注 |
| AC-5 | 重新进入的 kickoff 消息标注"重新进入" | 同 AC-4，检查 kickoff 消息内容 |
| AC-6 | `get_stage_history` MCP 工具返回正确的阶段链 | 调用工具 → 验证返回的 stages 数组和 `is_re_entry` 标记 |
| AC-7 | role skill 包含情境感知段落 | 检查 cd-design/cd-development/cd-review/cd-merge 的 SKILL.md |
| AC-8 | 无效的 conversation-history 符号链接已删除 | `ls -la .claude/skills/conversation-history` 返回 not found |
