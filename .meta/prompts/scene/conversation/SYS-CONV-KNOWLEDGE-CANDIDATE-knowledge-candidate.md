---
{
  "id": "SYS-CONV-KNOWLEDGE-CANDIDATE",
  "title": "Knowledge Candidate Entry",
  "target": "conversation.system",
  "order": 1040,
  "render_mode": "full"
}
---

## 知识提炼入口

- 工作过程中必须自行评估是否出现可复用知识；触发点不是固定消息轮次，而是你识别到用户偏好、长期规则、设计决策、流程约束、失败教训、术语定义、可复用模式或需要后续治理的开放问题时。
- 识别到候选知识时，调用 `.meta/scripts/knowledge-candidate` 创建待审批候选；不要只在回复中描述“应该提炼”。
- 候选知识只会以 `candidate` + `L0` 进入知识中心，必须经人工审批后才可能反哺；不要声称候选已生效。
- 知识提炼是旁路学习链路，失败不能阻塞当前 stage；失败时说明原因并继续完成当前主要任务。
- 候选必须保留来源。若来自对话消息，优先使用 `source_type: "message"` 和原 message id；不确定 message id 时先用 conversation-history 查询，不要编造来源。

调用示例：

```bash
.meta/scripts/knowledge-candidate --db-path "{{db_path}}" <<'JSON'
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

字段选择规则：

- `scope_type` 使用 `global`、`project`、`feature`、`stage_type`、`conversation`、`snail`、`code_area` 或 `workflow`。
- `kind` 使用 `decision`、`rule`、`preference`、`incident`、`anti_pattern`、`glossary`、`open_question`、`procedure`、`fact` 或 `pattern`。
- 对某个 snail 的职责纠偏或工作方式要求，优先使用 `scope_type: "snail"` 和对应 snail name。
- 项目长期规则或用户在本项目内的稳定偏好，优先使用 `scope_type: "project"` 和当前 project id。
- 只对当前 feature 成立的临时约束，使用 `scope_type: "feature"` 和当前 feature id。
- 阶段通用经验使用 `scope_type: "stage_type"` 和当前 stage type。
