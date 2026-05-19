# F2026051906 Role 语义残留字段清理

## 背景

上一轮 Role 与 Snail Den 分离已明确项目管理工作流中的职责身份是 role，而 snail 是包装具体 agent runtime 与 model 的实际运行承担者。当前仍需要再次排查 message、conversation、dispatch 和 event 链路中的 `snail` 语义字段，避免职责角色继续以 snail 命名传播。

## 目标

1. 全仓排查 message、conversation、dispatch 和 event 相关链路中表示职责角色的 `snail` 命名。
2. 将职责角色语义字段改为 `role`，保持 snail 仅用于 runtime/template/den 等实际执行承担者语义。
3. 同步更新受影响的类型、持久化字段、API、前端展示、测试与提示词资产。
4. 不引入旧字段兼容层或过渡包装，直接建立 role/snail 的正确语义边界。

## 非目标

1. 不改变 Snail Den 的 runtime/template 管理机制。
2. 不改变 agent runtime 或 model 的选择逻辑，除非字段命名直接混淆职责角色语义。
3. 不迁移既有本地数据库历史数据；本仓当前按最终 schema 与 seed 推进。

## 设计

本 feature 以语义归属为判断标准：

1. conversation/message/dispatch/event 中表示参与者、默认回复对象、发送者、目标接收者、当前响应身份等职责角色的字段使用 `role`。
2. 表示 Snail Den template、runtime 或具体 agent 执行承担者的字段继续使用 `snail`。
3. 类型、DB schema、store 映射、消息协议、API payload 与前端渲染必须同向调整，避免内部仍用 `snail` 再对外映射成 `role` 的临时状态。
4. 测试和提示词资产同步使用 role 语义，以便后续检视能从长期入口看到正确模型。

## 生效路径

本 feature 通过源码类型、持久化 schema、消息/协作链路、Web API、前端字段消费、提示词资产、核心消息模型文档、测试和本文档生效。

## 改动范围

1. `src/shared/`：删除 `SnailName` 职责角色别名，conversation/message/event/dispatch 类型统一使用 `RoleName` 和 `*_role` 字段。
2. `src/persistence/`：schema、store、read model、dispatch、knowledge governance conversation 和 search index 字段从 `*_snail` 改为 `*_role`。
3. `src/message-bus/`、`src/project-workflow/`、`src/interaction-entry/`：消息发送、mention、dispatch、runtime session、实时事件和 API payload 使用 role 字段。
4. `src/agent/`：runtime 输入中的职责身份字段从 `snail` 改为 `role`，Snail Den/runtime/template 类型继续保留 snail 命名。
5. `src/web/`：conversation、message、dispatch、mention composer 和参与者展示消费 `role` 字段。
6. `README.md`、`README.en.md`、`.meta/prompts/prompts/S-05-mention提取.md`、`docs/core/core-message-model.md` 和相关测试同步更新为 role 语义。

## 验证

1. `npx tsc --noEmit` 通过。
2. `npm run test` 通过，38 个 compiled test files 全部通过。
3. `npm run test` 中 lint 0 error，保留仓库既有 22 条模块边界 warning。
4. 已检查 `default_snail`、`participating_snails`、`from_snail`、`to_snails`、`to_snail`、`snail_name`、`SnailName`、`fromSnail`、`toSnails`、`defaultSnail`、`participatingSnails`、`activeSnail`、`producer_snail`、`asker_snail` 残留，源码与前端目标范围无命中。
5. 已复核剩余 `snail` 命名，保留 Snail Shell 品牌、Snail Den、snail template/runtime、`snail_template_id`、配置文件 `snails` 数组和运行中 agent 展示语义。

## 风险与决策记录

已确认语义边界：role 是项目管理工作流职责角色；snail 是包装具体 agent runtime 与 model 的实际运行承担者。本轮不保留旧 `snail` 职责字段兼容层，避免继续制造混合模型。

风险：本轮直接改最终 schema 与协议字段，不提供旧 `*_snail` 字段兼容读取；符合当前 feature 的非目标，但已有外部消费者或历史数据库如仍依赖旧字段，需要通过独立迁移 feature 处理。

## 范围变更记录

1. 实现中发现 mention 提取提示词与 message-out mention record 仍把职责对象命名为 `snail`；已纳入本轮范围并改为 `role`。
2. 实现中发现 agent runtime 输入对象仍用 `snail` 字段承载 `RoleDefinition`；已改为 `role`，保留 `SnailRuntime` 类型名称表达 Snail Den 对 runtime 的包装语义。
3. 实现中发现知识治理 conversation/message 复用消息模型字段；已同步从 `*_snail` 改为 `*_role`，避免治理链路继续传播旧职责字段。
4. 复检发现根 README API 示例、核心消息模型字段说明和 start 事件展示仍残留职责对象的 snail 表达；已同步改为 role 表达，并让中英文 README 保持一致。
