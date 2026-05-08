---
name: knowledge-candidate
description: 将 agent 在工作中识别到的可复用知识写入 Snail Shell 待审批知识候选。用于沉淀用户偏好、长期规则、设计决策、流程约束、失败教训、术语定义、可复用模式或开放问题。候选只进入审批队列，不会自动生效。
---

# Knowledge Candidate Protocol

## Purpose

你负责把工作过程中识别到的可复用知识写入 Snail Shell 知识中心的待审批队列。

本 skill 只通过候选入口写入知识。候选入口会先检查当前知识库中同项目、同作用域、同类型且语义重复的已有知识：没有重复时创建 `candidate` + `L0`；命中待审批 candidate 时通过语义合并更新既有候选；命中已治理知识时只记录重复提取反馈。候选知识必须经人工审批后才可能反哺 prompt、skill、工具或检查器；不要声称候选已经生效。

## When To Use

当你在对话、实现、检视、验证或复盘中识别到以下内容时使用：

1. 用户明确表达的长期偏好或工作原则。
2. 可复用的项目规则、流程约束或角色职责边界。
3. 已确认的设计决策、架构取舍或系统不变量。
4. 失败教训、事故原因、反模式或后续应避免的做法。
5. 术语定义、稳定事实、可复用操作步骤或工作模式。
6. 需要后续治理或追踪的开放问题。

## When Not To Use

不要为以下内容创建候选知识：

1. 一次性任务状态、普通进度汇报、工具日志或临时闲聊。
2. 缺少长期复用价值的内容。
3. 当前 feature 正在交付的目标、验收内容或范围变更。
4. 已经通过本轮正式 diff 写入 `AGENTS.md`、`.meta/prompts/`、`docs/README.md`、`core/`、`user-manual/`、代码或脚本等长期入口的同一规则、决策或操作要求。

当前 feature 和 PR 已覆盖的内容应由 feature 文档与 PR 追溯；候选知识只用于沉淀超出当前交付范围、具备后续复用价值且尚未被本轮变更直接固化的内容。

## Command

统一命令路径：`.meta/scripts/knowledge-candidate`

推荐用 heredoc 传入 JSON，避免 shell 转义污染正文：

```bash
.meta/scripts/knowledge-candidate --db-path "<db-path>" <<'JSON'
{
  "project_id": null,
  "scope_type": "snail",
  "scope_ref": "Acceptance Snail",
  "kind": "rule",
  "title": "检视需具备全链路意识",
  "content": "Acceptance Snail 检视 PR 时不能只看本次改动本身，还必须关注能力上下游是否支撑实际生效。",
  "rationale": "用户明确纠偏检视职责边界，具备后续复用价值。",
  "created_by": "Acceptance Snail",
  "sources": [
    {
      "source_type": "message",
      "source_id": "156",
      "quote": "要有全链路意识！虽然本次pr内容是增加清理能力"
    }
  ]
}
JSON
```

命令成功后会输出：

```json
{
  "ok": true,
  "knowledge_id": "...",
  "status": "candidate",
  "action": "created",
  "duplicate_of": null
}
```

如果命中重复知识，`action` 为 `merged`，`knowledge_id` 和 `duplicate_of` 指向既有知识；这表示本次提取被记录为对既有知识的反馈，而不是创建了一条新的候选。

## Required Fields

1. `title`: 候选知识标题，简短描述核心结论。
2. `content`: 可长期复用的知识正文，写清楚规则、经验、决策或事实。
3. `scope_type`: 生效范围类型。
4. `kind`: 知识类型。

## Optional Fields

1. `project_id`: 所属 project id；项目内知识应填写当前 project id。
2. `scope_ref`: 具体范围引用，如 feature id、stage type、snail name。
3. `rationale`: 为什么值得沉淀。
4. `created_by`: 创建者，通常填写当前 snail name。
5. `metadata`: 结构化补充信息。
6. `sources`: 来源列表；强烈建议填写。

## Scope Selection

1. 用户全局偏好或跨项目规则：`global`，`scope_ref = null`。
2. 当前项目长期规则或设计决策：`project`，`scope_ref = project id`。
3. 只对当前 feature 成立的方案或约束：`feature`，`scope_ref = feature id`。
4. 某类阶段通用经验：`stage_type`，`scope_ref = stage type`。
5. 对某个 snail 的职责、工作方式或检视标准要求：`snail`，`scope_ref = snail name`。
6. 工作流机制规则：`workflow`，`scope_ref = null`。
7. 仅当前 conversation 有意义的临时知识：`conversation`，`scope_ref = conversation id`。

## Kind Selection

1. 必须遵守的工作方式或流程约束用 `rule`。
2. 用户偏好用 `preference`。
3. 已确认设计取舍用 `decision`。
4. 缺陷、事故或失败复盘用 `incident`。
5. 应避免的错误模式用 `anti_pattern`。
6. 可复用做法用 `procedure` 或 `pattern`。
7. 稳定事实用 `fact`。
8. 术语定义用 `glossary`。
9. 未决问题用 `open_question`。

## Source Rules

1. 候选必须可追溯，优先保留原始消息、artifact、PR 或检视评论来源。
2. 来自对话消息时，使用 `source_type: "message"` 和真实 message id。
3. 不确定 message id 时，先使用 conversation-history 查询；不要编造来源。
4. `quote` 应截取最能支撑候选知识的原文短引文。

## Hard Rules

1. 不要绕过审批直接创建 `active` 知识。
2. 不要把候选知识写入 stage formal artifacts。
3. 不要为缺少长期复用价值的内容创建候选。
4. 如果脚本调用失败，说明失败原因并继续当前主任务；知识提炼不能阻塞主工作流。
