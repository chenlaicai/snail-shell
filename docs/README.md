# Snail Shell 文档目录准则

## 目录定位

`docs` 只存放需要随仓库长期维护的设计文档。

文档读者是 Snail Shell 的使用者和协作 agent。文档必须真实、准确、可执行，避免主观评价、宣传式表述和无法检验的描述。

## 目录结构

```text
docs/
  README.md
  core/
  features/
```

## core

`docs/core` 存放系统核心设计文档。

进入 `core` 的文档必须同时满足：

1. 描述 Snail Shell 的长期核心模型、边界或不变量。
2. 后续多个 feature 都必须遵循。
3. 不依赖单次 feature 的临时目标、实现节奏或验收记录。
4. 内容可以作为后续设计、实现、测试和评审的裁决依据。

`core` 不用于存放普通特性说明、阶段讨论记录、一次性方案草稿、PR 摘要或测试日志。

当前核心文档：

1. `core/core-message-model.md`: Snail Shell 核心消息数据模型。

## features

`docs/features` 存放单个 feature 的设计文档。

后续每个 feature 开发前，应先创建一份 feature 文档，再按文档推进实现、验证和 PR。feature 文档可以随该 feature 的需求收敛、设计取舍和检视反馈更新。

feature 文档编号规则：

1. 格式为 `FYYYYMMDDNN`。
2. `YYYYMMDD` 使用创建文档当天日期。
3. `NN` 是当天从 `01` 开始的两位自然数递增编号。
4. 文件名格式为 `FYYYYMMDDNN-kebab-case-title.md`。

示例：

```text
docs/features/F2026050601-docs-structure.md
```

feature 文档应使用以下结构：

```markdown
# FYYYYMMDDNN 标题

## 背景

说明为什么需要做这个 feature，以及它解决的真实问题。

## 目标

列出本 feature 必须达成的结果。

## 非目标

列出本 feature 明确不处理的范围。

## 设计

描述目录、数据、接口、流程或交互层面的设计取舍。

## 改动范围

列出预计修改或新增的文件、模块或文档。

## 验证

说明需要执行的自动化检查、测试或人工验证。

## 风险与待确认

记录已知风险、迁移影响或仍需用户决策的问题。
```

## 根目录规则

`docs` 根目录只允许保留：

1. `README.md`
2. `core/`
3. `features/`

其他文档必须进入 `core` 或 `features`；如果无法判断归属，应先作为 feature 文档沉淀，不应直接放在根目录。
