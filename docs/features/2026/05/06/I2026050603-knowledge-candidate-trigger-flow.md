---
id: I2026050603
title: 知识候选触发流程
from_ids: []
tags: [knowledge, governance]
modules: [knowledge_governance]
---
# I2026050603 知识候选触发流程

## 背景

“清理文件”feature 中，用户明确提出了 `docs` 目录准则、`core` 与 `features` 的职责边界、后续 feature 文档先行流程和编号规则。这些内容具备长期复用价值，命中知识候选的触发条件，但实际没有生成任何知识候选。

复盘后确认，现有知识提炼入口只提供“自行评估”和“按需使用”的弱提醒，没有成为研发或检视阶段的收尾检查；当研发任务同时包含 worktree、文档、实现、验证、PR 和检视处理时，知识候选判断容易被跳过。

## 目标

1. 让用户明确表达的长期偏好、项目规则、流程约束、设计决策、失败教训和开放治理问题成为知识候选强触发场景。
2. 让研发者在提交 PR 或完成检视处理前必须检查本轮是否出现可复用知识。
3. 让检视者在最终复检结论前检查本轮 review 是否暴露新的可复用知识。
4. 保持知识候选仍然进入待审批队列，不直接变成生效知识。
5. 保留“不为一次性任务状态、工具日志和临时闲聊创建候选”的边界，避免知识噪音。

## 非目标

1. 不实现自动扫描对话并生成候选的系统级机制。
2. 不改变 `knowledge-candidate` 脚本的数据模型、审批流或知识生效规则。
3. 不为“清理文件”feature 事后补录候选知识；本 feature 只修复后续触发流程。
4. 不要求每个阶段都必须创建候选；没有长期复用价值时可以不创建。

## 设计

知识候选触发分为两层：

1. 会话级入口定义通用触发判断，面向所有 snail 生效。
2. 角色级提示词定义研发者和检视者在各自阶段的兜底检查责任。

会话级入口不复制 `knowledge-candidate` skill 的全部字段说明，只固化触发强度和边界：当用户明确表达长期规则、偏好或决策时，应默认创建候选；如果判断不创建，必须能说明它为什么只是一次性状态或缺少长期复用价值。

研发者职责聚焦在开发闭环：提交 PR 前、处理检视意见后或回复 PR 前，检查需求讨论、设计取舍、实现教训和验证结果中是否出现候选知识。

检视者职责聚焦在 review 闭环：提交检视评论或最终复检结论前，检查 review 是否暴露角色职责、失败模式、检视标准或系统不变量等候选知识。

这种设计避免把知识提取变成无条件总结任务，也避免在 prompt 中重复脚本参数、字段定义和审批规则；具体创建方式仍由 `knowledge-candidate` skill 维护。

## 生效路径

1. `.meta/prompts/scene/conversation/SYS-CONV-KNOWLEDGE-CANDIDATE-knowledge-candidate.md` 定义知识候选的强触发、阶段收尾检查和不创建边界。
2. `.meta/prompts/global/roles/PRM-GLOBAL-IMPLEMENTATION-EXECUTION-implementation-execution.md` 要求 Implementation Snail 在 PR 或检视处理收口前执行知识候选检查。
3. `.meta/prompts/global/roles/PRM-GLOBAL-REVIEW-REPORTING-review-reporting.md` 要求 Acceptance Snail 在检视评论和最终复检前执行知识候选检查。
4. `AGENTS.md` 同步记录 Snail Shell 本仓库的长期工作规则，避免仓库说明与 `.meta/prompts` 规则漂移。
5. `docs/issues/I2026050603-knowledge-candidate-trigger-flow.md` 记录本 feature 的目标、设计、范围和验证。

## 改动范围

1. 新增 `docs/issues/I2026050603-knowledge-candidate-trigger-flow.md`。
2. 更新 `.meta/prompts/scene/conversation/SYS-CONV-KNOWLEDGE-CANDIDATE-knowledge-candidate.md`。
3. 更新 `.meta/prompts/global/roles/PRM-GLOBAL-IMPLEMENTATION-EXECUTION-implementation-execution.md`。
4. 更新 `.meta/prompts/global/roles/PRM-GLOBAL-REVIEW-REPORTING-review-reporting.md`。
5. 更新 `AGENTS.md`。

## 验证

1. 确认本 feature 文档编号符合 `docs/README.md` 规则。
2. 确认知识候选触发规则没有复制 skill 的命令字段细节，职责边界清晰。
3. 确认 `AGENTS.md` 与 `.meta/prompts` 均包含阶段收尾知识候选检查要求，且表达不冲突。
4. 运行 `npm run check`，确认 prompt 和文档调整未破坏 lint、build 和 test。

## 风险与决策记录

当前没有未经确认的问题。

决策记录：本 feature 选择先强化 prompt 与角色职责，不引入自动扫描器。原因是当前缺陷来自明确触发点被弱提示词跳过；自动扫描会扩大数据流、误报治理和审批体验范围，需要后续单独设计。

## 范围变更记录

当前没有范围变更。
