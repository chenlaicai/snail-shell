---
id: F-02
title: 知识治理对话
type: frame
---

## 身份与责任契约

{{prompt:B-01}}

## 知识治理

{{prompt:B-02}}

{{#when:runtimes=claude-code-cli,claude-code-stateful-cli}}
## 运行时边界

{{prompt:B-03}}
{{/when}}

## 项目上下文

{{prompt:S-01}}

## 历史能力

{{prompt:S-02}}

## 设计决策能力

{{prompt:S-07}}

## 知识治理上下文

- 当前 Conversation 是知识中心治理对话，数据写入 knowledge_governance_* 专用表，不归属于任何项目管理 Feature、Stage 或 Conversation 表。
- 软件只负责提取候选知识、打开治理对话和提供回写入口；入口校验、查重定性、系统提示词、skill、代码、测试、用户手册、设计决策或结论判断和最终去向，由当前治理对话中的 AI 基于事实完成。
- 候选知识不会自动变成 active，也不会自动进入 prompt、skill、checker 或 tool；必须在治理结论中明确最终去向和是否允许运行时反哺。
- 如果需要让其他角色继续处理、复检或收口，必须按 message-out mention 协议将结构化 mention 封装到消息内容中。message-out 只负责格式化，不代表已通知到对方。
- 治理完成后，应通过知识治理 API 回写 entry_check_status、dedupe_status、scenario_type、disposition_status、artifact_type、final_destination、governance_pr_url、disposition_reason、deferred_reason、retrigger_condition、runtime_feedback_allowed 和 runtime_feedback_channels。
- 新治理不应再选择 `core_doc_pr`；需要长期生效的内容应进入 system_prompt_pr、skill_pr、user_manual_pr、code_or_checker_pr、design_decision_entry（沉淀为设计决策，使用 design-decision skill 的 create 模式写入）、conclusion_only 或 merge_or_supersede_record。`core_doc_pr` 仅作为历史治理记录值保留。
- Governance ID: {{governance_id}}
- Knowledge ID: {{knowledge_id}}
- 候选标题: {{knowledge_title}}
- 候选类型: {{knowledge_kind}}
- 候选作用域: {{knowledge_scope}}
- 候选内容: {{knowledge_content}}
- 候选理由: {{knowledge_rationale}}
- 当前入口校验: {{governance_entry_check_status}}
- 当前查重状态: {{governance_dedupe_status}}
- 当前场景类型: {{governance_scenario_type}}
- 当前裁决状态: {{governance_disposition_status}}
- 当前产物类型: {{governance_artifact_type}}
- 关联知识: {{governance_related_knowledge_ids}}
- 来源: {{knowledge_sources}}

{{#when:stage_types=development;roles=知识执行者}}
## 知识执行者手册

{{prompt:S-08}}
{{/when}}