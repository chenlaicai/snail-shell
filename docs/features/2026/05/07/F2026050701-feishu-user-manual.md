---
id: F2026050701
title: 飞书用户手册
from_ids: [F2026050607]
tags: [feishu, docs, governance]
modules: [knowledge_governance]
---
# F2026050701 飞书用户手册

## 背景

飞书对话接入能力已经在 `F2026050607 飞书接入` 中实现，但用户在实际接入时需要一份可以逐步执行的操作文档，并明确该文档不仅覆盖 Snail Shell 本系统内的配置，还要覆盖飞书开放平台和手机飞书侧的操作。

上一轮实现把操作步骤直接追加到已完成的飞书接入 feature 文档中，这会混淆已完成 feature 的设计记录和面向用户的长期操作手册。用户已明确纠正：本轮应单独创建 feature 文档，操作步骤文档属于用户手册，应在 `docs/` 下新增用户手册类目录承载。

## 目标

1. 在 `docs/` 下新增用户手册类目录，用于存放面向使用者的长期操作指南。
2. 新增飞书接入操作指导文档，覆盖飞书侧、本系统侧和手机飞书验证闭环。
3. 为本轮文档治理和用户手册补充单独创建 feature 文档，记录需求结论、设计取舍、改动范围和验证结果。
4. 确认已完成的 `F2026050607 飞书接入` feature 文档只保留实现设计记录边界，本轮不再把用户手册内容写回旧 feature 文档。
5. 把用户实测确认的飞书发送消息权限缺失根因写入用户手册，降低后续接入时只能依赖开发者后台错误信息排查的成本。
6. 固化已合入 feature 文档不得二次修改的文档治理规则，并同步到研发和检视提示词，确保后续 PR 能执行和检视该规则。

## 非目标

1. 不修改飞书运行时代码、配置格式或接入行为。
2. 不引入新的用户手册构建系统、站点导航或发布机制。
3. 不把所有既有使用说明一次性迁移到用户手册目录。
4. 不回写或改写 `F2026050607 飞书接入` 中已经完成并合入的实现设计结论。
5. 不追溯修改任何已经合入的历史 feature 文档来适配本轮新增规则。

## 设计

新增 `docs/user-manual/` 作为长期用户操作手册目录。目录定位写入 `docs/README.md`，与 `core/`、`features/` 并列：

1. `core/` 继续承载系统核心模型、边界、不变量和事实基线。
2. `features/` 继续承载单个 feature 的需求收敛、设计取舍、改动范围、验证和风险记录。
3. `user-manual/` 承载面向使用者、可按步骤执行、需要随仓库长期维护的安装、配置、接入、日常使用和排障流程。

飞书操作指导文档放入 `docs/user-manual/feishu-integration-guide.md`，因为它的读者是想通过手机飞书完成 Snail 对话的使用者，而不是检视某个实现 PR 的研发者。该文档可以引用既有飞书实现的配置和边界，但不承担记录本轮 PR 设计取舍和验证结果的职责。

已合入的 `docs/features/` 文档作为历史交付记录固化，不再承担长期事实页、用户手册或当前规则入口职责。后续 feature 如果需要改变既有行为或补充规则，应创建新的 feature 文档记录本次变化，并把长期生效内容同步到 `docs/README.md`、`core/`、`user-manual/`、`AGENTS.md`、`.meta/prompts/`、代码或脚本等长期入口。

## 生效路径

1. `docs/README.md` 定义 `docs/user-manual/` 的目录定位和根目录允许项。
2. `docs/user-manual/feishu-integration-guide.md` 成为飞书接入操作指导的长期入口。
3. `docs/features/F2026050701-feishu-user-manual.md` 记录本轮 feature 的需求结论、设计取舍、改动范围和验证。
4. `docs/features/F2026050607-feishu-integration.md` 在当前基线中已保持飞书接入实现 feature 的设计记录边界，本轮 PR 不修改该旧 feature 文档。
5. `docs/README.md` 固化已合入 feature 文档不得二次修改的文档治理规则。
6. `AGENTS.md` 与 `.meta/prompts/global/roles/` 同步研发和检视侧执行规则，避免规则只停留在文档说明中。

## 改动范围

1. 更新 `docs/README.md`，新增 `user-manual` 目录规则，并调整根目录规则。
2. 新增并更新 `docs/user-manual/feishu-integration-guide.md`，明确 `chat_id` 的首选获取路径是手机飞书会话设置中的“会话 ID”，把 Snail Shell 未匹配绑定日志法调整为备用排障路径，并补充发送消息所需的 `im:message:send_as_bot`、`im:message:send` 或 `im:message` 权限。
3. 新增 `docs/features/F2026050701-feishu-user-manual.md`。
4. 不修改 `docs/features/F2026050607-feishu-integration.md`；该旧 feature 文档在当前基线中已不承载本轮用户手册内容。
5. 更新 `AGENTS.md`、`.meta/prompts/global/roles/PRM-GLOBAL-IMPLEMENTATION-EXECUTION-implementation-execution.md` 和 `.meta/prompts/global/roles/PRM-GLOBAL-REVIEW-REPORTING-review-reporting.md`，让研发和检视阶段都能执行“已合入 feature 文档不得二次修改”的规则。

## 验证

1. `npm run lint` 通过，确认文档重构未引入代码检查问题。
2. 已检查 PR diff，确认飞书操作步骤只存在于 `docs/user-manual/feishu-integration-guide.md`，本轮 feature 记录只存在于 `docs/features/F2026050701-feishu-user-manual.md`。
3. 已检查 `.meta/prompts/` 中与文档治理相关的提示词；本轮新增 `user-manual` 目录规则与既有“按 `docs/README.md` 对照 feature 文档和实际 diff”的检视要求不冲突。
4. 用户已实测确认：飞书 API 调用日志提示缺少 `[im:message:send, im:message, im:message:send_as_bot]` 后，开通发送消息权限并重试，手机飞书可以收到 Snail Shell 回复。
5. 已检查 `AGENTS.md` 与 `.meta/prompts/` 的规则同步，确认已合入 feature 文档不得二次修改的研发和检视规则边界一致。

## 风险与决策记录

当前没有未经确认的问题。

决策记录：按用户纠正，用户操作步骤不应放入已完成 feature 文档。原因是 feature 文档用于记录单个 feature 的需求、设计和验证，用户手册用于长期指导实际使用，两者读者和生命周期不同。

决策记录：新增 `docs/user-manual/`，而不是把操作指南放入 `docs/core/` 或 `docs/features/`。原因是该文档面向使用者按步骤接入飞书，既不是核心模型裁决依据，也不是单次 feature 的阶段交付记录。

决策记录：已合入 feature 文档不得二次修改。原因是 feature 文档描述某一次特性修改的需求、设计、范围和验证，合入后应作为历史交付记录固化；后续特性更新或规则变化应通过新的 feature 文档和长期入口生效，不能改写历史记录。

## 范围变更记录

1. 用户明确指出上一轮文档归属错误，要求另开本次 feature 文档，并在 `docs/` 下新增用户手册类目录放置飞书接入操作指导。因此本轮范围从“补充飞书 feature 文档”调整为“新增用户手册目录、迁移操作指南、补充本轮 feature 文档”；旧飞书接入 feature 文档在当前基线中已保持实现记录边界，本轮 PR 不再修改它。
2. 用户实际操作时发现飞书开发者后台只看到 `eventId`，没有直接看到 `chatId`。因此用户手册补充说明 `eventId` 不能作为 `chat_id`，应打开事件详情查看原始 payload 中的 `event.message.chat_id`，或通过 Snail Shell 未匹配绑定日志获取 `chatId`。
3. 用户进一步指出事件日志包含 `errorInfo: "app not online"`，且在飞书未连到 Snail Shell 前不可能通过本地日志获取 `chatId`。因此用户手册修正 `chat_id` 获取流程：先用真实 App ID/App Secret 和临时 `chat_id` 启动 Snail Shell 飞书长连接，确认应用在线后再发送消息，通过未匹配绑定日志或成功投递事件详情获取真实 `chat_id`。
4. 用户在手机飞书会话设置中找到了“会话 ID”，确认这就是所需 `chatId`。因此用户手册再次调整 `chat_id` 获取主路径：优先从手机飞书会话设置复制会话 ID，Snail Shell 未匹配绑定日志法只作为备用排障路径。
5. 用户通过飞书 API 调用日志确认回复失败根因是应用缺少发送消息权限，并在开通权限后验证回复可回到手机飞书。因此用户手册补充明确的发送消息 scope 和对应排障说明。
6. 用户指出检视意见暴露了更通用的文档治理问题：`docs/features/` 下已完成的 feature 文档是某次特性修改的内容描述，合入后必须固化，即使后续特性更新也不能随之二次修改。因此本轮范围增加为固化该规则，并同步到 `docs/README.md`、`AGENTS.md` 和 `.meta/prompts/` 的研发/检视规则。
