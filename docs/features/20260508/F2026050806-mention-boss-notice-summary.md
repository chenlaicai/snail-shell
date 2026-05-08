# F2026050806 mention Boss 时系统提示精简

## 背景

当 agent 消息 mention 到 Boss Snail 时，系统会生成一条 system 消息提示老大需要人工回复。当前提示会把触发 mention 的消息正文也拼接进去，导致同一信息在对话流中重复展示，系统提示承担了“提醒”和“对话记录展示”两种职责。

## 目标

- Boss Snail mention 触发的 system 消息只承担提醒作用。
- 提醒文本不再列出触发 mention 的消息正文或多条对话记录。
- 保留原有路由语义：mention 到 Boss Snail 后仍跳过自动执行并等待人工回复。
- 保留其他系统提醒，例如协作轮数耗尽时的收口提醒。

## 非目标

- 不调整 message-out mention 协议。
- 不调整 Conversation history 工具、消息上下文摘要或前端消息渲染逻辑。
- 不改变 Boss Snail 是否为人工角色、是否参与 conversation 或 dispatch 状态流转。

## 设计

Boss Snail mention 的系统提示应是稳定、短文本的系统状态提示。触发 mention 的原消息本身已经存在于对话记录中，agent 需要更早上下文时也有 conversation-history 工具，因此 system notice 不应复制消息正文。

实现上将 `persistBossMentionNotice` 从依赖触发消息列表构造摘要，改为写入固定提醒文本。`drainMessageBus` 仍可把当前 batch 的消息传入 handler，保持消息总线接口对其他调用方的可扩展性，但 Boss mention notice 不再消费这些消息正文。

## 生效路径

- 代码：`src/project/collaboration.ts` 中 Boss Snail mention notice 的持久化逻辑。
- 测试：项目协作流程测试覆盖 Boss mention notice 内容与 wrap-up notice 原有行为。

## 改动范围

- 新增 feature 文档：`docs/features/20260508/F2026050806-mention-boss-notice-summary.md`。
- 调整 `src/project/collaboration.ts`。
- 补充或更新相关测试。

## 验证

- 运行相关项目协作测试，确认 Boss mention notice 不包含触发消息正文。
- 运行完整检查 `npm run check`，确认 lint、build、test 全部通过。

## 风险与决策记录

- 决策：系统 notice 只保留提醒职责；触发消息正文由原消息记录和 history 工具承担追溯职责。
- 风险：如果用户只看系统 notice 可能不知道是哪条消息 mention 了 Boss Snail。该风险可接受，因为 notice 出现在同一对话流中，且复制正文会制造重复和噪音。

## 范围变更记录

- 初始范围：精简 Boss Snail mention 触发的系统提示，并补充验证。
