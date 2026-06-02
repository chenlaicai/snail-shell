---
id: I2026050703
title: 启动时收敛孤儿运行消息
from_ids: []
tags: [startup, recovery, conversation]
modules: [project_management]
---
# I2026050703 启动时收敛孤儿运行消息

## 背景

Snail Shell 的消息运行态同时存在于持久化数据库和服务进程内存中。前端通过持久化消息状态判断是否还有 Snail 正在运行，而中断接口依赖当前进程内的 `AbortController` 注册表。

当服务被强制重启、进程崩溃或在 agent 输出终态前退出时，数据库中可能残留 `status = streaming` 的 assistant message。重启后的新进程没有对应的中断 controller，导致 UI 仍显示 Snail 正在运行、禁止继续发送消息，但点击“中断 Snail”又返回没有正在运行的 Snail。

## 目标

1. 服务启动时识别上一次进程遗留的 `streaming` assistant message。
2. 将这些孤儿运行消息收敛为明确终态，解除 UI 发送阻塞。
3. 为恢复动作写入可追溯的终态 signal 和 message context，保留历史解释能力。
4. 自动化测试覆盖启动恢复、既有完成路径和无孤儿消息路径。
5. 基于最新 `main` 更新 PR 分支，并将 `docs/features` 调整为按日期分目录组织。

## 非目标

1. 不恢复或继续执行重启前的外部 agent 进程。
2. 不改变正常运行中的中断协议；仍以 message 级 `AbortController` 作为实时中断边界。
3. 不在本 feature 中实现分布式运行租约、跨进程接管或多服务实例协同。
4. 不直接清理当前生产数据库中的具体残留记录；本 feature 提供长期启动恢复机制。
5. 不改写已合入历史 feature 文档正文来适配新路径；历史正文中记录的旧路径保持其当时交付记录语义。

## 设计

服务启动完成 schema 初始化和默认项目 seed 后，创建 `ProjectManager` 时执行一次孤儿运行消息恢复。

恢复范围仅限 `role = assistant` 且 `status = streaming` 的消息。user/system 消息由同步流程即时完成，若出现异常应单独分析，避免启动恢复误改协议边界。

对每条孤儿消息追加 `message_interrupted` 终态 signal，并将状态更新为 `interrupted`。终止原因固定标识为服务启动恢复，说明上一次服务进程在该消息完成前退出，当前进程无法再中断或继续原运行。

恢复后基于现有事件流构建 terminal message context。若消息已有部分文本输出，context 保留最后可用正文；若只有工具调用或过程事件，context 生成事件摘要并包含终止原因。

历史脏数据可能出现两类缺失 `start` 的形态：完全没有事件、或已经写入 text/tool/command 等非 `start` 事件。前者可以安全补入合成 `start` 后复用正常终态写入；后者不能倒插 `start` 改写事件顺序，只追加终态 signal 并更新状态，确保启动恢复能解除 UI 阻塞且不破坏既有事件事实。

单条消息恢复失败不应阻断服务启动。恢复过程记录失败 message id 和错误日志，继续处理其他孤儿消息；避免一条不可恢复的历史脏数据让 `waitForStartupRecovery()` reject 并阻塞 HTTP server 启动。

`docs/features` 按 `YYYYMMDD` 增加一层日期目录。历史 feature 文档整体移动到对应日期目录；长期规则入口改为要求后续 feature 文档创建在 `docs/features/YYYYMMDD/` 下，并在对应日期目录内计算当天编号。

## 生效路径

1. `ProjectManager` 构造期间执行启动恢复，覆盖 Web、API、飞书通道共享的服务初始化入口。
2. `ConversationStore` 提供按状态查询与终态收敛能力，保证恢复逻辑不绕过消息事件不变量。
3. 消息终态仍通过既有 `completeMessageWithEvent` 写入，复用“终态消息不可再追加事件”的持久化约束。
4. `docs/README.md` 定义 `docs/features/YYYYMMDD/` 日期目录和当天编号扫描规则。
5. `AGENTS.md`、Implementation Snail 研发提示词和 Acceptance Snail 检视提示词同步日期目录约束。

## 改动范围

1. 新增或调整 `src/project` 中的启动恢复逻辑。
2. 扩展 `src/persistence/store.ts` 的消息查询能力。
3. 补充 `tests/project` 或 `tests/persistence` 中的恢复测试。
4. 新增本 feature 文档，并迁移到 `docs/features/20260507/`。
5. 将既有 `docs/features/F*.md` 迁移到对应 `docs/features/YYYYMMDD/` 日期目录。
6. 更新 `docs/README.md`、`AGENTS.md` 和 `.meta/prompts/` 中的 feature 文档路径规则。

## 验证

1. 构造残留 `streaming` assistant message，创建 `ProjectManager` 后确认状态变为 `interrupted`。
2. 确认恢复消息包含 `message_interrupted` signal 和可用于展示/搜索的 context。
3. 确认没有孤儿消息时启动恢复不写入新事件。
4. 覆盖缺失 `start` 的零事件消息、已有非 `start` 事件的历史脏消息和既有完成消息路径。
5. 确认 `docs/features` 根目录不再直接包含 `F*.md` 文档，所有 feature 文档均位于对应日期目录。
6. 运行 `npm run test`。

验证结果：`npx tsx tests/project/startup-recovery-test.ts` 通过；`npm run test` 通过，31 个编译后测试文件全部通过。

## 风险与决策记录

将孤儿消息收敛为 `interrupted` 而不是 `failed`：该场景的本质是运行被服务进程生命周期打断，用户看到的是“上次运行无法继续/中断”，不是 agent 自身执行失败。使用 `interrupted` 可以避免把外部 runtime 误判为失败，同时解除前端发送阻塞。

恢复只处理 assistant message：当前 UI 阻塞和中断矛盾由 assistant 运行态触发；user/system 的 streaming 残留如果存在，可能表示其他持久化路径异常，不应被同一恢复策略静默吞掉。

## 范围变更记录

PR 检视发现已有非 `start` 事件但缺失 `start` 的 streaming assistant 脏数据会触发存储层首事件约束，导致启动恢复 reject 并阻塞服务启动。范围扩展为显式支持该历史脏数据形态，并隔离单条恢复失败，避免不可恢复记录阻断整体启动。

用户要求基于最新 `main` rebase，并看到 `docs/features` 下文档变多后要求增加一层日期目录。范围扩展为迁移 feature 文档目录结构，并同步长期规则入口；已合入历史 feature 文档只移动路径，不改写正文内容。

范围扩展复检发现 `AGENTS.md` 的 `docs/features` 检视规则没有同步 `.meta/prompts` 中新增的 `docs/features/YYYYMMDD/` 日期目录检查要求，违反双线规则一致性。已将 `AGENTS.md` 对应检视规则补齐为与 Acceptance Snail 检视提示词一致。
