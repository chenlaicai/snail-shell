---
id: F2026050601
title: 文档结构清理
from_ids: []
tags: [docs, convention]
modules: [project_management]
---
# F2026050601 文档结构清理

## 背景

当前 `docs` 根目录混放了核心模型、特性设计、讨论记录和 runtime 采样基线。用户期望文档目录只保留长期有效、真实准确、高效可读的内容，并建立后续 feature 文档先行的工作方式。

## 目标

1. `docs/core` 保留当前已固化的核心设计文档和底层事实基线。
2. `docs/features` 存放 feature 级设计文档。
3. 新增 `docs/README.md`，准确描述文档目录存放准则。
4. 建立 feature 文档编号规则：`FYYYYMMDDNN`，其中 `NN` 为当天两位自然数递增编号。
5. 本文作为第一个 feature 文档，编号为 `F2026050601`。

## 非目标

1. 不重新设计核心消息模型内容。
2. 不实现自动生成 feature 文档编号的脚本。
3. 不补充知识系统、runtime 采样或其他未固化特性的设计文档。
4. 不调整工作流阶段定义。

## 设计

`docs` 采用三层结构：

```text
docs/
  README.md
  core/
    core-message-model.md
    runtime-cli-response-baselines.md
  features/
    F2026050601-docs-structure.md
```

`core` 的准入标准是长期核心模型、系统边界、不变量或底层事实基线。普通特性、阶段讨论、一次性设计、PR 摘要和验证日志不进入 `core`。

`features` 的准入标准是单个 feature 的需求、目标、设计取舍、改动范围、验证和风险记录。后续 feature 工作应先创建该目录下的文档，再按文档实现。

为了让 feature 文档先行规则在 Snail 的实际工作中生效，本次必须同步更新 `AGENTS.md` 和 Implementation Snail 的研发执行 prompt。`docs/README.md` 只定义目录准则；`AGENTS.md` 与 `.meta/prompts` 才是 agent 工作时会读取并执行的规则入口。

`runtime-cli-response-baselines.md` 记录真实 agent CLI 调用参数与响应数据，是核心消息模型必须解释的底层事实基线。它不应继续放在 `docs` 根目录，但也不能删除；本次将它移入 `docs/core`，让核心消息模型和 runtime 事实基线在同一长期文档边界内互相支撑。

## 生效路径

1. `docs/README.md` 定义长期目录准则、feature 文档模板、编号规则、生效路径记录要求和范围变更记录要求。
2. `AGENTS.md` 和 `.meta/prompts/global/roles/PRM-GLOBAL-IMPLEMENTATION-EXECUTION-implementation-execution.md` 要求 Implementation Snail 在 Snail Shell 本仓库 feature 开发前检查或创建 feature 文档，并在 scope 变化时回写 feature 文档。
3. `.meta/prompts/global/roles/PRM-GLOBAL-REVIEW-REPORTING-review-reporting.md` 要求 Acceptance Snail 在文档治理类 PR 和最终复检中对照 feature 文档与实际 diff 的一致性。

## 改动范围

1. 移动 `docs/core-message-model.md` 到 `docs/core/core-message-model.md`。
2. 删除 `docs/knowledge-system-discussion.md`。
3. 删除 `docs/knowledge-system.md`。
4. 移动 `docs/runtime-cli-response-baselines.md` 到 `docs/core/runtime-cli-response-baselines.md`。
5. 新增 `docs/README.md`。
6. 新增 `docs/features/F2026050601-docs-structure.md`。
7. 更新 `docs/core/core-message-model.md` 中对 runtime baseline 新路径的引用。
8. 更新 `AGENTS.md` 和 `.meta/prompts/global/roles/PRM-GLOBAL-IMPLEMENTATION-EXECUTION-implementation-execution.md`，接入 feature 文档先行规则。
9. 更新 `.meta/prompts/global/roles/PRM-GLOBAL-REVIEW-REPORTING-review-reporting.md`，接入文档治理类 PR 的 feature 文档一致性检视规则。

## 验证

1. 确认 `docs` 根目录只包含 `README.md`、`core/`、`features/`。
2. 确认 `docs/core` 包含 `core-message-model.md` 和 `runtime-cli-response-baselines.md`。
3. 确认 `docs/features` 包含本 feature 文档。
4. 确认 feature 文档先行规则已同时出现在 `AGENTS.md` 和 Implementation Snail 研发执行 prompt。
5. 确认 Acceptance Snail 检视 prompt 已要求对照 feature 文档与实际 diff 的一致性。
6. 运行项目检查命令，确认文档结构和 prompt 调整未破坏构建、lint 和测试。

## 风险与决策记录

当前没有未经确认的问题。

决策记录：已删除的知识系统文档不再作为长期文档保留；如果后续相关能力重新进入开发，应按 feature 文档流程重新创建对应设计文档。runtime baseline 属于真实接口交互证据，经用户反馈和本轮修正后移入 `core`，继续作为长期事实基线维护。

## 范围变更记录

1. 原计划删除 `docs/runtime-cli-response-baselines.md`，后确认该文档记录真实 runtime 交互事实，属于核心消息模型必须解释的长期事实基线；范围调整为将其移入 `docs/core` 并更新裁决关系。
2. 原非目标包含“不调整 `.meta/prompts`、AGENTS 规则”，后确认“建立后续 feature 文档先行的工作方式”必须接入 agent 可读取的长期规则入口；范围调整为同步更新 `AGENTS.md` 和 Implementation Snail 研发执行 prompt。
3. 复检后确认只接入研发侧仍不足以规避文档目标、非目标与实际 diff 冲突；范围调整为同步更新 Acceptance Snail 检视规则，并在 feature 模板中增加“生效路径”和“范围变更记录”。
4. 复检后确认在 `AGENTS.md` 和 `.meta/prompts` 中逐项复制 feature 模板章节会导致模板调整时出现霰弹修改；范围调整为让长期执行规则引用 `docs/README.md` 当前 feature 模板，并只固化生效路径、范围变化、风险决策和实际 diff 一致性等关键不变量。
