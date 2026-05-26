# Snail Shell 文档目录准则

## 目录定位

`docs` 只存放需要随仓库长期维护的用户手册和 feature 设计文档。

文档读者是 Snail Shell 的使用者和协作 agent。文档必须真实、准确、可执行，避免主观评价、宣传式表述和无法检验的描述。

## 目录结构

```text
docs/
  README.md
  user-manual/
  features/
    YYYYMMDD/
```

## 长期规则入口

长期规则、核心原则、事实基线和模型不变量不再通过 `docs/core` 设计文档生效。

这类内容必须进入最贴近执行边界的长期入口：

1. AI 运行时行为规则进入 `.meta/prompts/`。
2. 独立能力协议、命令和操作步骤进入 `.meta/skills/`。
3. 代码模型、数据协议、runtime 映射和安全边界进入 `src/` 类型、实现、测试和必要 why 注释。
4. 提示词效果评估规则进入 `.meta/prompt-evaluations/`、评估 runner 和相关测试。
5. 已确认的架构取舍进入设计决策库，而不是新增长期设计文档。

feature 文档可以记录本次设计取舍和迁移过程，但不能替代上述长期入口。

## user-manual

`docs/user-manual` 存放面向使用者的长期操作手册。

进入 `user-manual` 的文档必须同时满足：

1. 面向 Snail Shell 的使用者，而不是只面向单次 feature 的实现或检视。
2. 描述可以按步骤执行的安装、配置、接入、日常使用或排障流程。
3. 内容需要随仓库长期维护，并且应与实际代码、配置示例和系统边界保持一致。
4. 不记录单次阶段结论、PR 摘要、临时决策过程或仅对某个 feature 生命周期有效的验收信息。

用户手册可以引用 feature 文档中的设计背景，但不能替代 feature 文档记录需求收敛、设计取舍、改动范围和验证结果。

## features

`docs/features` 按创建日期分目录存放单个 feature 的设计文档，也是该 feature 合入前的需求、设计、验证和范围变化记录。

后续每个 feature 开发前，应先创建一份 feature 文档，再按文档推进实现、验证和 PR。feature 文档可以随该 feature 的需求收敛、设计取舍和检视反馈更新。

feature 文档在对应 PR 合入后即视为历史交付记录，后续 feature 不得二次修改已合入 feature 文档来追写新结论、更新旧范围或让历史记录适配当前实现状态。后续行为、规则或实现发生变化时，必须创建新的 feature 文档记录本次变化；需要长期维护的事实、规则或操作说明，应沉淀到 `user-manual/`、`AGENTS.md`、`.meta/prompts/`、`.meta/skills/`、代码、测试或脚本等长期入口，而不是改写已完成 feature 的历史记录。

feature 文档编号规则：

1. 格式为 `FYYYYMMDDNN`。
2. `YYYYMMDD` 使用创建文档当天日期。
3. `NN` 是当天从 `01` 开始的两位自然数递增编号。
4. 日期目录格式为 `docs/features/YYYY/MM/DD/`。
5. 文件名格式为 `FYYYYMMDDNN-kebab-case-title.md`。
6. 计算当天 `NN` 时，只扫描对应日期目录 `docs/features/YYYY/MM/DD/` 下已有的 `FYYYYMMDDNN-*.md` 文件。

示例：

```text
docs/features/2026/05/06/F2026050601-docs-structure.md
```

feature 文档应使用以下结构：

```markdown
---
id: FYYYYMMDDNN
title: kebab-case-title
from_ids: []
tags: []
modules: []
---

# FYYYYMMDDNN [module] 标题

## 背景

说明为什么需要做这个 feature，以及它解决的真实问题。

## 目标

列出本 feature 必须达成的结果。

## 非目标

列出本 feature 明确不处理的范围。

## 设计

描述目录、数据、接口、流程或交互层面的设计取舍。

## 生效路径

说明本 feature 的规则、约束或工作方式通过哪些长期入口生效，例如代码、配置、`AGENTS.md`、`.meta/prompts`、脚本、CI 或工作流产物要求。

## 改动范围

列出预计修改或新增的文件、模块或文档。

## 验证

说明需要执行的自动化检查、测试或人工验证。

## 风险与决策记录

记录已识别风险、迁移影响、疑问和遗留事项的沟通结论。feature 文档不应残留未经确认的问题；如最终决定暂时遗留，必须记录参与决策者、接受该遗留的原因、后续处理条件或跟进方式。

## 范围变更记录

记录本 feature 在实现或检视过程中发生的目标、非目标、设计、改动范围或验证范围变化，以及变化原因。
```

## 根目录规则

`docs` 根目录只允许保留：

1. `README.md`
2. `user-manual/`
3. `features/`

其他文档必须进入 `user-manual` 或 `features`；如果无法判断归属，应先作为 feature 文档沉淀，不应直接放在根目录。
