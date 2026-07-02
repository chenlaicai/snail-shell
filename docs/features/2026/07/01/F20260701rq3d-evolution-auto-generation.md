---
id: F20260701rq3d
title: evolution-auto-generation
from_ids: []
tags: [evolution, feedback, auto-generation, flywheel]
modules: [evolution, collaboration, prompt]
doc_kind: spec
---

# F20260701rq3d [evolution] Evolution 自动生成机制

## 背景

当前 evolution 系统的条目创建完全依赖手动调用 `create_candidate` MCP 工具。用户在使用系统过程中遇到问题、表达不满意或纠正 agent 行为时，这些宝贵的反馈信号没有被自动捕获和记录。

历史上曾有知识飞轮的 `negative_feedback` 场景类型（2026-05-11 至 2026-05-29），通过知识重复出现间接检测"旧知识未生效"，但在演进中心重构中被移除。当前系统缺少自动识别用户反馈并生成 evolution 条目的能力。

用户的最终愿景是形成闭环飞轮：**使用系统 → 识别不好用 → 提取 → 处理 → 优化系统 → 使用系统**。

## 目标

建立 evolution 自动生成机制，实现：
1. **自动识别用户反馈**：agent 在对话过程中识别用户不满意、困惑、纠正等反馈信号
2. **自动创建 evolution 条目**：识别到反馈信号后，自动调用 `create_candidate` 创建演进项
3. **异步治理**：在源 issue 对话中产生系统消息指向新条目，用户空闲时决定是否启动治理对话

## 非目标

- 不实现基于 NLP 的情绪分析（依赖 agent 自身的语义理解能力）
- 不实现自动优化（优化仍需治理对话和人工确认）
- 不实现批量反馈处理（每条反馈独立治理）

## 设计

### 反馈信号识别

Agent 在处理用户消息时应识别以下反馈信号：

| 信号类型 | 触发条件 | 示例 |
|---------|---------|------|
| **用户不满** | 用户明确表达对系统行为的不满意、生气、失望 | "这个不好用"、"我不喜欢这样"、"太糟糕了" |
| **用户困惑** | 用户表示不理解、困惑、不清楚 | "这是什么意思？"、"我不明白"、"为什么这样？" |
| **用户纠正** | 用户纠正 agent 的行为或输出 | "不是这样"、"你应该..."、"错了" |
| **重复问题** | 用户反复提出同一问题或要求（第三次及以上） | 同一问题第三次出现 |
| **功能缺失** | 用户期望的功能不存在（多次出现或明确影响工作流） | "又不能导出"、"为什么总是没有..." |

### 信号过滤规则

以下情况**不应**创建 evolution 条目：

| 过滤条件 | 示例 |
|---------|------|
| 审美偏好（颜色、样式等） | "这个颜色不好看" |
| 首次出现的 feature request | "能不能导出"（首次） |
| 用户随口一说的建议 | "要是能...就好了" |
| 与系统行为无关的抱怨 | "今天天气不好" |

### 触发机制

采用 **prompt 规则 + agent 主动调用** 的方案：

1. **触发时机**：在处理用户消息时识别，而非生成回复时
2. **重复检测**：识别到反馈信号后，先搜索已有 evolution 条目判断是否重复
3. **自动创建**：不重复则调用 `create_candidate` 创建 item（Candidate 状态）
4. **上下文关联**：通过 metadata 记录创建上下文（消息 ID、issue ID、stage ID）
5. **异步通知**：在源 issue 对话中产生系统消息，指向新创建的 item，用户空闲时决定是否启动治理

### 数据模型

**不修改 EvolutionItem 模型**。自动创建的上下文信息存储在 `metadata` 字段中，使用约定的 key：

```typescript
// metadata 中约定 key
metadata: {
  auto_generation?: {
    source_type: "auto";
    trigger_reason: "user_dissatisfied" | "user_confused" | "user_corrected" | "repeat_problem" | "feature_missing";
    related_message_id: number;
    related_issue_id: string;
    related_stage_id: string;
  }
}
```

**手动创建路径不受影响**：手动调用时 `metadata` 中不包含 `auto_generation` key，与自动路径自然区分。

### MCP 工具

`create_candidate` 工具参数不变（title、content、workspace_id、tags、metadata）。自动创建时通过 metadata 传递上下文：

```typescript
// 自动创建时的 metadata 结构
metadata: {
  auto_generation: {
    source_type: "auto",
    trigger_reason: "user_dissatisfied",
    related_message_id: 123,
    related_issue_id: "issue-xxx",
    related_stage_id: "stage-xxx"
  }
}
```

**workspace_id 来源**：agent 从 `SNAIL_CTX_WORKSPACE_PATH` 环境变量获取工作区路径作为 `workspace_id` 参数。

### 闭环治理流程

```
用户反馈 → Agent 识别信号 → 搜索已有条目（重复检测）
                                    ↓
                            不重复 → create_candidate（Candidate 状态）
                                    ↓
                            源 issue 对话中产生系统消息（指向新条目）
                                    ↓
                            用户空闲时查看待处理条目
                                    ↓
                            用户决定启动治理对话（createIssue）
                                    ↓
                            治理对话启动（evo-executor）
                                    ↓
                            用户确认 + 根因分析
                                    ↓
                    ┌───────────────┼───────────────┐
                    ↓               ↓               ↓
                优化 prompt    优化 skill       优化工具
                    ↓               ↓               ↓
                    └───────────────┼───────────────┘
                                    ↓
                            验证优化效果
                                    ↓
                            更新 evolution 条目状态
```

**设计原则**：
- 遵循 2026-06-29 收权改造的设计意图，`create_candidate` 只创建 item，治理 issue 由独立流程创建
- 不打断用户当前工作，用户有自主权决定何时启动治理
- 治理启动时机由用户控制，避免在工作流程中产生干扰

### Prompt 规则

在 `data/file/prompts/T-01-行为准则.md` 中添加：

```markdown
## 反馈识别与 Evolution 自动生成

当识别到以下反馈信号时，应主动创建 evolution 条目：

1. **用户不满**：用户明确表达对系统行为的不满意、生气、失望
2. **用户困惑**：用户表示不理解、困惑、不清楚
3. **用户纠正**：用户纠正你的行为或输出
4. **重复问题**：用户反复提出同一问题或要求（第三次及以上）
5. **功能缺失**：用户期望的功能不存在（多次出现或明确影响工作流）

**不应创建的情况**：
- 审美偏好（颜色、样式等）
- 首次出现的 feature request
- 用户随口一说的建议
- 与系统行为无关的抱怨

**执行步骤**：
1. 识别到反馈信号后，先搜索已有 evolution 条目判断是否重复
2. 如果重复：不创建新条目，在回复中说明"此问题已在治理中"
3. 如果不重复：
   a. 调用 `create_candidate`，参数：
      - title：问题简述
      - content：问题描述 + 用户原始反馈 + 改进建议
      - workspace_id：从 SNAIL_CTX_WORKSPACE_PATH 环境变量获取
      - metadata：包含 auto_generation 结构（source_type、trigger_reason、related_message_id、related_issue_id、related_stage_id）
   b. 在回复中产生系统消息，指向新创建的 item（如："已记录此反馈，待处理演进项：{item_id}"）
4. 继续生成回复
```

## 生效路径

- `src/domain/snail-mcp-server/_internal/servers/evolution.ts`：参数校验支持 metadata 中的 auto_generation 结构
- `data/file/prompts/T-01-行为准则.md`：添加反馈识别规则
- `data/file/skills/evo-executor/SKILL.md`：更新治理流程说明，增加"误触发"裁决选项

## 改动范围

预计改动：
- MCP 工具：evolution server（参数校验）
- Prompt：行为准则
- Skill：evo-executor
- **不改动**：evolution model / port / adapter / repository / 数据库 schema

## 验证

- [ ] 用户表达对系统行为的不满意时，agent 自动创建 evolution 条目
- [ ] 用户困惑时，agent 自动创建 evolution 条目
- [ ] 用户纠正 agent 行为时，agent 自动创建 evolution 条目
- [ ] 重复问题（第三次及以上）时，agent 自动创建 evolution 条目
- [ ] 功能缺失（多次出现）时，agent 自动创建 evolution 条目
- [ ] 审美偏好、首次 feature request 不触发创建
- [ ] 重复检测：已有条目时不创建新条目
- [ ] 自动创建的条目 metadata 包含正确的 auto_generation 结构
- [ ] 源 issue 对话中产生系统消息，指向新创建的 item
- [ ] 用户空闲时可查看待处理条目并决定是否启动治理
- [ ] 治理对话能正确处理自动创建的条目
- [ ] 治理对话中可标记"误触发"并关闭
- [ ] 手动创建的条目功能不受影响

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|-----------|------|------|
| 1 | 识别准确性 | 依赖 agent 语义理解，可能存在误判。通过治理对话人工确认 + "误触发"裁决来兜底 | 2026-07-01 |
| 2 | 性能影响 | 仅在检测到反馈信号后才搜索已有条目，非反馈场景零开销 | 2026-07-01 |
| 3 | 数据模型兼容性 | 不修改数据模型，使用 metadata 约定 key，完全兼容现有数据 | 2026-07-01 |
| 4 | 误触发处理 | 治理对话中可标记为"误触发"并关闭，不影响系统 | 2026-07-01 |
| 5 | 治理启动时机 | 遵循 2026-06-29 收权改造，create_candidate 只创建 item，治理 issue 由独立流程创建。采用异步通知方案：源 issue 对话中产生系统消息，用户空闲时决定是否启动治理 | 2026-07-01 |
| 6 | 噪声过滤 | 添加严重程度阈值和过滤规则，排除审美偏好、首次 feature request 等 | 2026-07-01 |
