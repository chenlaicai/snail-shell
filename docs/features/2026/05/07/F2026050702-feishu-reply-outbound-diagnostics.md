---
id: F2026050702
title: 飞书回复出站诊断
from_ids: []
tags: [integration, error-handling]
modules: [project_management]
---
# F2026050702 飞书回复出站诊断

## 背景

用户在“飞书test01”中发现：手机飞书消息能进入 Snail Shell，Snail Shell 也生成了 assistant 响应，但响应没有返回到手机飞书。

本地数据库显示飞书 chat 已绑定到 conversation `154613dc-e015-4906-84d2-ce45c395d000`，飞书入站消息 `hi`、`ping` 均以 `feishu:<tenant>:<chat>:<message>` client id 成功写入，随后产生了 Implementation Snail 的 assistant 文本回复。因此问题边界不在入站绑定或协作生成，而在 assistant 消息事件推送回飞书的出站链路。

用户随后在飞书开发平台 API 调用日志中确认实际失败原因：应用调用发送消息接口时返回 `Access denied. One of the following scopes is required: [im:message:send, im:message, im:message:send_as_bot]`，开通发送消息权限后重试，手机飞书已经可以收到 Snail Shell 回复。这说明本次线上故障根因是飞书应用权限缺失；本 feature 保留为出站失败日志与失败隔离能力，避免后续类似外部 API 拒绝只能依赖飞书后台排查。

## 目标

1. 确认“飞书test01”的入站、协作生成和出站问题边界。
2. 让飞书出站发送失败具备服务端可追溯日志，避免手机端收不到回复时只能从数据库推断。
3. 确保单次飞书出站发送失败不会破坏后续 conversation 事件推送。
4. 补充自动化测试覆盖出站发送失败后的恢复路径。
5. 记录用户已验证的权限根因，并明确本 feature 与用户手册 PR 的边界。

## 非目标

1. 不变更飞书绑定配置格式。
2. 不实现飞书卡片、按钮或非文本消息回复。
3. 不改变默认不回显 Boss Snail 输入的行为。
4. 不在数据库新增出站投递状态表；本轮先补齐运行时日志与失败隔离。

## 设计

`FeishuConversationChannel` 已通过 `ConversationGateway.subscribe` 订阅绑定 conversation 的 `message_event_appended` 事件，并把 assistant `text`/`content_block` 发送到飞书 chat。

原实现直接在订阅回调中 `void this.handleOutboundEvent(...)`，如果飞书 SDK 发送 API 抛错，错误只会变成未处理的异步失败，无法在 Snail Shell 日志中定位是鉴权、权限、chat、内容还是飞书 API 问题。

本轮将出站处理拆成显式调度函数：

1. 订阅回调只调度后台出站处理，不阻塞 gateway 事件发布。
2. 后台处理捕获所有发送错误并写入 `Feishu outbound message push failed` 日志。
3. 日志带上 `conversationId`、`chatId`、`messageId`、`eventId` 和错误摘要，保证可以从数据库中的 assistant 事件追溯到飞书发送失败点。
4. 发送失败只影响当前事件，不取消订阅，也不影响后续 assistant 消息继续推送。

## 生效路径

1. `src/integrations/feishu/channel.ts` 负责飞书出站事件调度、发送和失败日志。
2. `tests/integrations/feishu-channel-test.ts` 覆盖发送失败后后续消息仍可推送。
3. 运维排查时可结合 `message_event` 表中的 assistant 内容事件与 `logs/snail-shell-*.log` 中的 `Feishu outbound message push failed` 定位飞书 API 失败原因。
4. 飞书权限开通步骤和用户操作排障说明由 PR #117 的 `docs/user-manual/feishu-integration-guide.md` 承载；本 feature 只维护运行时失败可观测性。

## 改动范围

1. 调整 `FeishuConversationChannel` 出站调度与错误捕获。
2. 更新飞书 channel 测试中的 fake transport，支持模拟发送失败。
3. 新增本 feature 文档记录问题边界、设计取舍和验证范围。

## 验证

1. 运行 `npm run test`。
2. 自动化覆盖：assistant 出站正常推送到绑定 chat。
3. 自动化覆盖：Boss Snail 输入默认不回显到飞书。
4. 自动化覆盖：飞书出站单次发送失败后，后续 assistant 出站仍能继续发送。
5. 用户人工验证：飞书开发平台返回缺少发送消息 scope 后，开通权限并重试，手机飞书可收到 Snail Shell 回复。

## 风险与决策记录

当前没有未经确认的问题。

决策记录：本轮不新增持久化出站投递状态。原因是现有故障首先缺少运行时失败可见性，且飞书发送是实时外部副作用；在没有明确重试、补偿和幂等投递需求前，新增数据库状态会扩大协议边界。后续如果需要可靠投递，再单独设计 outbox、重试和投递状态模型。

决策记录：本轮不把权限开通说明重复写入运行时代码 feature 的用户操作文档。原因是 PR #117 已新增飞书用户手册并承载长期操作步骤；本 PR 只记录故障边界和运行时诊断能力，避免两个文档入口漂移。

## 范围变更记录

1. 用户通过飞书 API 调用日志确认实际根因是应用缺少发送消息权限，并在开通权限后验证回复链路恢复。因此本 feature 文档从“只能定位到出站链路”更新为“根因已确认，同时保留出站失败日志作为后续诊断能力”。
2. 发现 PR #117 已使用当天 feature 编号 `F2026050701`，因此本 feature 文档改为 `F2026050702`，避免同日编号冲突。
