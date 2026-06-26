---
name: evolution-candidate
description: |
  将 agent 在工作中识别到的可演进项写入待治理演进候选。用于沉淀用户偏好、长期规则、设计决策、流程约束、失败教训、术语定义、可复用模式、发现的问题/bug、待演进项或 idea。候选只进入治理队列，不会自动生效。
  存在两种运行场景：Snail Shell 环境（`issue_id` 环境变量存在）下写入数据库演进队列；原生环境下 agent 可将演进项记录在本地文件或其他合适的位置，待后续导入。
  agent 应先识别当前环境，再决定记录方式。
---

# Evolution Candidate Protocol

## 环境识别

- **`issue_id` 环境变量存在**：Snail Shell 环境，使用下方 Command 脚本将演进候选写入数据库治理队列。
- **`issue_id` 环境变量不存在**：原生环境，本脚本不可用。agent 应将识别到的演进项记录在本地文件中（如 `.evolution-candidates.md`），待后续导入 Snail Shell 系统。

## Purpose

你负责把工作过程中识别到的可演进项写入 Snail Shell 演进中心的待治理队列。

本 skill 只创建待治理候选。候选必须经治理对话后才可能反哺 prompt、skill、工具、检查器或知识库；不要声称候选已经生效。

## When To Use

当你在对话、实现、检视、验证或复盘中识别到以下内容时使用：

1. 用户明确表达的长期偏好或工作原则。
2. 可复用的工作区规则、流程约束或角色职责边界。
3. 已确认的设计决策、架构取舍或系统不变量。
4. 失败教训、事故原因、反模式或后续应避免的做法。
5. 术语定义、稳定事实、可复用操作步骤或工作模式。
6. 发现的问题、bug 或待演进项。
7. 需要后续治理或追踪的 idea 或开放问题。

## When Not To Use

不要为以下内容创建演进候选：

1. 一次性任务状态、普通进度汇报、工具日志或临时闲聊。
2. 缺少长期复用价值的内容。
3. 当前 issue 正在交付的目标、验收内容或范围变更。
4. 已经通过本轮正式 diff 写入长期入口的同一规则、决策或操作要求。

## Command

统一命令路径：`node .meta/skills/evolution-candidate/scripts/evolution-candidate.js`

推荐用 heredoc 传入 JSON，避免 shell 转义污染正文：

```bash
node .meta/skills/evolution-candidate/scripts/evolution-candidate.js <<'JSON'
{
  "workspace_id": "snail-shell",
  "title": "检视需具备全链路意识",
  "content": "审查者检视 PR 时不能只看本次改动本身，还必须关注能力上下游是否支撑实际生效。",
  "tags": ["检视", "规则"]
}
JSON
```

命令成功后会输出：

```json
{
  "ok": true,
  "evolution_item_id": "...",
  "issue_id": "...",
  "conversation_id": "..."
}
```

## Side Effects

一次调用会原子性地创建 **4 条记录**：

| 记录 | workspace | 说明 |
|---|---|---|
| `evolution_item` | 调用方传入的 `workspace_id` | 演进候选本体 |
| `issue` | 调用方传入的 `workspace_id` | 治理对话专用 Issue |
| `stage` | 调用方传入的 `workspace_id` | 治理对话 Stage（`status` 为 `in_progress`） |
| `conversation` | 调用方传入的 `workspace_id` | 治理对话（`owner_type` 为 `"evolution"`） |

输出中的 `issue_id` 和 `conversation_id` 是自动创建的治理对话关联 ID，不是调用方当前的 issue 或 conversation。

所有 4 条记录均挂到调用方传入的 `workspace_id`（来源 ws），使用 evolution SOP（`config/sop/evolution/`）的 stage 定义。

## Required Fields

1. `title`: 候选标题，简短描述核心内容。
2. `content`: 可长期复用的正文，写清楚规则、经验、决策、问题或 idea。
3. `workspace_id`: 所属 workspace id（必填）。

## Optional Fields

1. `tags`: 标签列表，用于分类和检索。
2. `metadata`: 结构化补充信息。

## Hard Rules

1. 不要绕过治理直接创建已生效的规则。
2. 不要把演进候选写入 stage formal artifacts。
3. 不要为缺少长期复用价值的内容创建候选。
4. 如果脚本调用失败，说明失败原因并继续当前主任务；演进项提炼不能阻塞主工作流。
