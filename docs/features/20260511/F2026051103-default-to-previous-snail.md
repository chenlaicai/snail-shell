# F2026051103 用户发言默认路由到上一发言 Snail

## 背景

用户在项目推进 conversation 中发言时，如果没有显式指定目标 Snail，当前系统默认投递给 conversation 的 `default_snail`。这会让多 Snail 协作后的追问偏离刚刚发言的 Snail，用户需要默认回复目标优先指向上一条实际发言的 Snail；只有没有可用上一发言 Snail 时，才退回主响应 Snail。

## 目标

1. 用户发言没有显式 mention、没有引用问答目标时，默认 `to_snail` 优先使用上一条可响应的 Snail 发言者。
2. 没有上一条可响应 Snail 时，继续回退到 conversation 的 `default_snail`。
3. 保持显式 mention 和已有引用问答目标优先级不变。
4. 保持 agent 发言无显式 mention 时不自动转发给 default Snail 的约束不变。
5. 该默认路由调整只作用于项目管理范围内的 `project_stage` conversation。

## 非目标

1. 不改变 conversation 的 `default_snail` 定义和 stage 主响应 Snail 选择逻辑。
2. 不改变 agent 间显式 mention 的投递机制。
3. 不调整消息总线的轮次预算、强制收口或 Boss Snail 人工提醒机制。
4. 不调整知识治理 conversation 的默认路由、消息 id 模型或 cutoff 语义。

## 设计

用户消息路由采用以下优先级：

1. 显式 mention 的参与 Snail，排除发言者自身并去重。
2. 引用或问题卡片传入的 `askerSnail`，用于保持已有“回答提问者”的语义。
3. 用户发言前 conversation 中最近一条可响应的 Snail 发言者；该选择必须基于 conversation 末尾状态，不能受消息列表默认分页窗口影响。
4. conversation 的 `default_snail`。

上一发言 Snail 只从用户消息写入前已经存在的项目管理 conversation 消息中选择，避免当前用户消息自身影响路由。候选必须是参与当前 conversation 的非 Boss Snail、非 system 发言者；这样可以避免把用户本人或系统通知作为自动投递目标。

## 生效路径

1. `src/project/collaboration.ts` 的用户消息投递逻辑。
2. `src/persistence/message-read-model.ts` 与 `src/persistence/store.ts` 的项目管理消息末尾查询能力。
3. `tests/project/collaboration-test.ts` 的协作路由回归测试。

## 改动范围

1. 新增当前 feature 文档。
2. 调整 `sendStructuredMessage` 默认路由计算。
3. 补充 collaboration 测试，覆盖上一发言 Snail 优先、长 conversation 不受默认分页窗口影响、无上一发言时回退 default、显式 mention 和 askerSnail 优先级保持不变。

## 验证

1. 已运行 `npm run test -- tests/project/collaboration-test.ts`。
2. 该命令完成 build、lint，并运行 33 个编译后测试文件，全部通过。
3. Review 修复后再次运行 `npm run test -- tests/project/collaboration-test.ts`，全部通过。
4. 已运行 `npm run check`，通过。

## 风险与决策记录

1. 决策：上一发言 Snail 必须是非 Boss、非 system 的参与 Snail。原因是用户要求中的“上一个发言的 snail”用于选择可自动响应的 agent；Boss Snail 是用户本人，system 没有 runtime，不应被自动投递。
2. 风险：如果最近一条 agent 消息是强制收口或系统驱动生成，后续用户追问仍会默认回到该 agent。这符合“上一发言 Snail”语义；显式 mention 可覆盖该默认行为。

## 范围变更记录

1. 实现过程中发现既有 cutoff 测试隐含依赖“用户第二轮无目标时仍回到 default Snail”的旧行为；已将该测试改为显式 mention 目标 Snail，使其继续验证 dispatch inbox cutoff，而不阻碍新的默认路由语义。
2. Review 发现 `getMessages` 默认读取最早 100 条消息，长 conversation 会把无显式目标的用户回复错误路由到很早以前的 Snail；已改为通过专用末尾查询获取最新消息和最近可响应 Snail，并补充超过 100 条历史消息的回归测试。
3. 合并最新 `main` 后一度暴露出 knowledge governance conversation 的独立消息模型会影响共享消息基础设施；当前 feature 已明确收缩为只调整 `project_stage` conversation 的默认 `to_snail` 逻辑，知识治理线另立 feature 处理，不在本次改动范围内。
