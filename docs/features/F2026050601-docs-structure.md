# F2026050601 文档结构清理

## 背景

当前 `docs` 根目录混放了核心模型、特性设计、讨论记录和 runtime 采样基线。用户期望文档目录只保留长期有效、真实准确、高效可读的内容，并建立后续 feature 文档先行的工作方式。

## 目标

1. `docs/core` 只保留当前已固化的核心设计文档 `core-message-model`。
2. `docs/features` 存放 feature 级设计文档。
3. 新增 `docs/README.md`，准确描述文档目录存放准则。
4. 建立 feature 文档编号规则：`FYYYYMMDDNN`，其中 `NN` 为当天两位自然数递增编号。
5. 本文作为第一个 feature 文档，编号为 `F2026050601`。

## 非目标

1. 不重新设计核心消息模型内容。
2. 不实现自动生成 feature 文档编号的脚本。
3. 不补充知识系统、runtime 采样或其他未固化特性的设计文档。
4. 不调整 `.meta/prompts`、AGENTS 规则或工作流阶段定义。

## 设计

`docs` 采用三层结构：

```text
docs/
  README.md
  core/
    core-message-model.md
  features/
    F2026050601-docs-structure.md
```

`core` 的准入标准是长期核心模型、系统边界或不变量。普通特性、阶段讨论、一次性设计、PR 摘要和验证日志不进入 `core`。

`features` 的准入标准是单个 feature 的需求、目标、设计取舍、改动范围、验证和风险记录。后续 feature 工作应先创建该目录下的文档，再按文档实现。

`core-message-model.md` 原先依赖 `docs/runtime-cli-response-baselines.md` 作为独立 runtime 事实基线。由于本次清理后 `docs` 不再保留该基线文档，需要删除对已移除文件的裁决引用，避免核心文档指向不存在的文档。核心消息模型中已经包含 runtime 映射章节，本次不改写该章节的事实内容。

## 改动范围

1. 移动 `docs/core-message-model.md` 到 `docs/core/core-message-model.md`。
2. 删除 `docs/knowledge-system-discussion.md`。
3. 删除 `docs/knowledge-system.md`。
4. 删除 `docs/runtime-cli-response-baselines.md`。
5. 新增 `docs/README.md`。
6. 新增 `docs/features/F2026050601-docs-structure.md`。
7. 更新 `docs/core/core-message-model.md` 中对已删除 runtime baseline 的引用。

## 验证

1. 确认 `docs` 根目录只包含 `README.md`、`core/`、`features/`。
2. 确认 `docs/core` 只包含 `core-message-model.md`。
3. 确认 `docs/features` 包含本 feature 文档。
4. 运行项目检查命令，确认文档结构调整未破坏构建、lint 和测试。

## 风险与待确认

当前没有待用户确认事项。

已删除的知识系统和 runtime baseline 文档不再作为长期文档保留；如果后续相关能力重新进入开发，应按 feature 文档流程重新创建对应设计文档。
