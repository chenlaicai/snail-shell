# Snail Shell 核心消息数据模型

## 文档状态

本文档已废弃。

旧版 `message_part` 四段式模型不再作为新设计、实现、测试、评审与重构的规范入口。

当前消息模型规范以以下文档为准：

1. `docs/core-message-model-v2.md`

runtime 事实基线以以下文档为准：

1. `docs/runtime-cli-response-baselines.md`

旧版与新版模型的临时对比说明见：

1. `docs/core-message-model-v1-v2-diff.md`

## 处理要求

1. 新增消息相关实现不得以本文档的旧四段式模型为依据。
2. 迁移完成后，本文档必须被 `docs/core-message-model-v2.md` 替换，或直接移除。
3. 若本文档与 `docs/core-message-model-v2.md` 冲突，以 `docs/core-message-model-v2.md` 为准。
