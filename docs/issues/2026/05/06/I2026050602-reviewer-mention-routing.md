---
id: I2026050602
title: 检视结论回传研发者
from_ids: []
tags: [review, messaging, workflow]
modules: [project_management]
---
# I2026050602 检视结论回传研发者

## 背景

“清理文件”Feature 的 review 对话中，Acceptance Snail 多次完成检视或复检后没有把消息投递给 Implementation Snail，导致研发者不会被自动唤起处理检视结论。

实际消息记录显示，这些 Acceptance Snail 的 assistant 消息 `to_snails` 为空。Snail Shell 当前协作模型只会把 assistant 消息投递给显式 mention 的参与者，不会把 agent 消息自动 fallback 到默认 Snail。这个行为保护多 Snail 协作边界，但要求需要他人继续处理的消息必须正确声明 mention。

## 目标

1. 明确需要其他 Snail 继续处理、复检、回应或收口时，必须通过 `message-out` 的 `mentions` 声明目标 Snail。
2. 让 Acceptance Snail 在检视结论、问题已提交、复检通过或仍需研发者响应时，把 `Implementation Snail` 放入 `mentions`。
3. 保持协作路由不变量：agent 消息没有显式 mention 时不自动转交给默认 Snail。
4. 用测试覆盖 `message-out` mention 示例、提示资产规则和协作路由不变量。

## 非目标

1. 不把 review 阶段的 Acceptance Snail 消息自动转发给 Implementation Snail。
2. 不改变 mention 抽取、message bus 或 dispatch 的底层路由模型。
3. 不要求所有普通进度说明都使用 `message-out` 包装；只有结构化呈现、带 mention、问题卡片或引用卡片等场景需要使用。
4. 不处理历史对话中已经漏投递的旧消息。

## 设计

跨 Snail 协作的通用规则应放在消息输出协议，而不是只写在某个角色提示中。`message-out` skill 是结构化消息内容的长期入口，已经负责说明带 mention 文本应如何编码，因此本次把“需要他人干活就是 mention 场景”和可执行 CLI 示例补到该 skill。

Acceptance Snail 的角色提示和 review 全局提示只负责定义本角色何时需要回传研发者：完成检视、提交问题、给出复检结论或仍需研发者处理时，应按 `message-out` mention 协议把 `Implementation Snail` 放入 `mentions`。这样不会复制结构化 payload 细节，也避免与 `message-out` 的协议说明漂移。

路由层保持现状。agent 消息没有显式 mention 时不 fallback 到默认 Snail，是为了避免一个 Snail 的普通结论意外触发另一个 Snail 继续执行。该不变量通过协作测试固定，防止后续为解决单个角色漏 mention 而引入隐式转发。

## 生效路径

1. `.meta/skills/message-out/SKILL.md` 定义通用 mention 场景、`mentions` 字段要求和 `text --payload` 示例。
2. `.meta/prompts/scene/snails/SYS-SNAIL-ACCEPTANCE-acceptance-snail.md` 定义 Acceptance Snail 回传研发者的角色触发条件。
3. `.meta/prompts/global/roles/PRM-GLOBAL-REVIEW-REPORTING-review-reporting.md` 在 review 阶段检视规则中要求按 `message-out` mention 协议回传 Implementation Snail。
4. `.meta/prompts/scene/conversation/SYS-CONV-SNAIL-snail-context.md` 要求跨 Snail 继续处理必须遵循 `message-out` mention 协议，不向 agent 暴露自然文本 `@<Snail Name>` 兜底抽取机制。
5. `tests/meta/prompt-assets-test.ts` 验证提示和 skill 资产包含必要规则，并防止通用 Snail 上下文暴露自然文本 `@` 兜底或退回到旧路由规则。
6. `tests/project/message-out-test.ts` 验证 CLI 生成的 mentioned text payload 可被解析。
7. `tests/project/collaboration-test.ts` 验证无显式 mention 的 agent 消息不会自动触发默认 Snail。

## 改动范围

1. 更新 `.meta/skills/message-out/SKILL.md`。
2. 更新 `.meta/prompts/scene/snails/SYS-SNAIL-ACCEPTANCE-acceptance-snail.md`。
3. 更新 `.meta/prompts/global/roles/PRM-GLOBAL-REVIEW-REPORTING-review-reporting.md`。
4. 更新 `.meta/prompts/scene/conversation/SYS-CONV-SNAIL-snail-context.md`。
5. 更新 `tests/meta/prompt-assets-test.ts`。
6. 更新 `tests/project/message-out-test.ts`。
7. 更新 `tests/project/collaboration-test.ts`。
8. 新增 `docs/features/I2026050602-reviewer-mention-routing.md`。

## 验证

1. `npx tsx tests/meta/prompt-assets-test.ts`
2. `npx tsx tests/project/message-out-test.ts`
3. `npx tsx tests/project/collaboration-test.ts`
4. `npm run lint`
5. `npm run test`

## 风险与决策记录

当前没有未经确认的问题。

决策记录：本次不做自动路由兜底。原因是 assistant 消息自动 fallback 到默认 Snail 会把普通结论、阶段说明和无需处理的信息错误转成新任务，破坏多参与者会话中“显式 mention 才投递”的边界。检视者漏 mention 的根因是消息输出协议和角色触发条件不够明确，因此通过 `message-out` 协议和 Acceptance Snail 提示修复。

## 范围变更记录

1. 初始修复只在 Acceptance Snail 和 review 全局提示中要求 `@Implementation Snail`；用户指出带 mention 的结构化消息应遵循 `message-out` skill。范围调整为把“何时需要 mention、如何生成 mentioned text payload”放入 `message-out` skill，检视者提示只引用协议和角色触发条件。
2. rebase 到最新 `origin/main` 后，主干新增 feature 文档先行要求。本 feature 已在实现后补建文档，并按当前 `docs/README.md` 模板补齐背景、目标、非目标、设计、生效路径、改动范围、验证、风险决策和范围变更记录。
3. PR 检视指出通用 Snail 上下文仍把继续处理场景单独指向自然文本 `@<Snail Name>`，会与本 feature 新增的 `message-out` mention 协议并行生效并形成规则冲突。范围补充为同步调整通用 Snail 上下文，并用 prompt 资产测试锁住不能退回旧规则。
4. 用户进一步指出自然文本 @ 抽取属于系统兜底机制，不应暴露给 AI，否则会鼓励绕过 `message-out` 协议。范围补充为从面向 agent 的通用 Snail 上下文删除兜底机制描述，测试同步断言不得出现自然文本 @ 兜底或兼容识别表述。
