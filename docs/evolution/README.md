# Snail Shell 演进知识体系

## 目的

本目录用于记录 Snail Shell 自身的演进过程。

目标不是简单堆积文档，而是建立一套可持续回溯、可结构化索引、可长期维护的知识体系，用来保存：

- 改了什么
- 为什么改
- 当时的问题背景是什么
- 做过哪些权衡
- 产出了哪些稳定结论
- 文档与对话、设计、实现之间如何关联

## 语言规则

本目录下的所有文档默认使用中文编写。

这是明确要求，不是建议。

原因如下：

1. Snail Shell 当前的核心设计讨论主要以中文完成
2. 中文更适合完整保留设计语义和讨论初衷
3. 知识体系的重点是长期回溯和理解，不是为了对外展示而优先选择英文

因此，除非有非常明确的特殊需要，否则：

- 文件内容使用中文
- 标题使用中文
- 正文说明使用中文
- 设计理由、背景、权衡、结论一律用中文表达

文件名仍然采用结构化英文标记风格，是为了便于程序解析和统一命名，这不影响正文必须使用中文。

## 核心原则

Snail Shell 需要记住自己的形成过程。

知识体系不仅要保留当前结论，还要保留形成这些结论的路径。因为未来任何一次修改，都可能需要回到某个历史节点，重新理解：

- 当时遇到的问题是什么
- 为什么不是另一个方案
- 为什么这个决定在当时是合理的
- 这个设计背后的初衷是什么

所以知识体系必须同时保留两类东西：

1. 稳定的结论性产物
2. 这些产物背后的讨论与来源路径

## 范围

`docs/evolution/` 存放的是 Snail Shell 自身的演进知识，而不是使用 Snail Shell 产出的外部产品知识。

这里主要记录：

- 产品定义演进
- 架构演进
- 工作流演进
- 领域模型演进
- 存储模型演进
- 交互与界面设计演进
- 实施计划与实现轮次记录
- 重要里程碑总结
- 重大问题修复与设计回退

## 应该放什么

如果一个内容满足以下任意一种情况，就应该进入这里：

1. 稳定的决策记录
   例如：为什么最外层从 session 改成 project。

2. 稳定的设计意图记录
   例如：为什么界面必须保持“对话居中”。

3. 里程碑总结
   例如：第一轮 project 化改造到底完成了什么。

4. 结构化变更说明
   例如：工作流回滚规则是如何建立的。

5. 某一轮实现的总结性记录
   例如：coding round 1 引入了哪些主干能力。

6. 对一段重要讨论的沉淀性提炼
   例如：从某几个 session 中提炼出的稳定设计结论。

## 不应该放什么

以下内容不应该作为主知识文档放在这里：

1. 临时草稿
2. 没有长期价值的调试碎片
3. 运行日志
4. 本地环境噪音
5. 已经在别处有明确主归属的重复内容

例如：

- console 输出不放这里
- 数据库 dump 不放这里
- 一次性的随手测试结论不放这里

## 两层知识体系

Snail Shell 最终会有两套相互关联的知识体系：

1. Snail Shell 自身演进知识
   也就是本目录当前定义的内容。

2. Snail Shell 工作产出的产品全过程知识
   也就是未来某个具体项目从立项到交付的全过程记录。

这两套知识体系应该共享相同原则：

- 保留稳定产物
- 保留讨论来源
- 保留设计初衷
- 保留可回溯关系

## 文件系统与数据库的职责分工

这套知识体系不是“只靠文档”的体系。

文档和数据库必须分别承担不同职责。

### 数据库：主索引层

数据库应当成为结构化检索和关联的主索引层。

数据库未来应该能索引并查询：

- session
- 文档路径
- 文档标题
- change type
- document type
- related sessions
- related docs
- related project
- related artifact
- 创建时间
- 更新时间
- supersedes / superseded_by

数据库主要回答的是：

`怎么找到它、它和谁有关、它属于哪条演进链`

### 文档：内容载体层

Markdown 文档不是主检索层，而是长文本和非结构化内容的稳定载体。

文档主要承载：

- 长文设计理由
- 里程碑总结
- 决策背景
- 问题与权衡过程
- 稳定结论的解释

文档主要回答的是：

`它到底意味着什么、当时为什么这么做`

简化来说：

- 数据库负责“找到它”
- 文档负责“解释它”

## 文档与 Session 的关系

仅有文档不够。

仅有对话记录也不够。

因此必须同时保留：

1. 文件系统中的稳定知识文档
2. 数据库中的原始 session / message 轨迹

规则如下：

- 文档保存稳定结论
- 数据库存原始对话轨迹
- 文档必须能够回链到相关 session
- session 也应能够追溯到它产出的文档

## 关联规则

每一份重要的演进文档，未来都应能够追溯到一个或多个 source sessions。

最低要求：

1. 每个稳定演进文档都应包含 `related_sessions`
2. 每个 `related_session` 都应能在数据库中查询到
3. 如果一个文档替代了旧文档，也应明确写出 `supersedes`

推荐在 markdown 文件头使用 metadata block，例如：

```md
---
title: 对话居中的工作区
change_type: Feature-Update
document_type: design_rationale
status: active
created_at: 2026-04-03
updated_at: 2026-04-03
related_sessions:
  - <session-id-1>
related_docs:
  - ../implementation-plan-v1.md
supersedes: []
---
```

格式以后可以调整，但“必须能关联 session 与文档”这个原则不能变。

## 目录结构规则

`docs/evolution/` 默认尽量保持扁平。

不要以 `decisions/`、`ui/`、`milestones/` 这类主观目录来组织主文档，因为随着时间推移，这些分类会不断膨胀并且越来越模糊。

因此默认规则是：

1. 文件直接放在 `docs/evolution/` 下
2. 依靠固定命名规则区分文档
3. 依靠 metadata 和数据库结构化索引做真正分类

推荐结构：

```text
docs/evolution/
  README.md
  [20260403][New-Feature]project-first-studio-spine.md
  [20260403][Feature-Update]conversation-centered-workspace.md
  [20260403][Feature-Update]workflow-rollback-rules.md
  [20260403][Bugfix]build-static-web-output.md
```

除非未来出现非常明确且不依赖主观判断的硬边界，否则不新增二级目录。

## 命名规则

文件名采用固定结构：

`[YYYYMMDD][Change-Type]short-title.md`

当前允许的 `Change-Type`：

1. `New-Feature`
2. `Feature-Update`
3. `Bugfix`

示例：

- `[20260403][New-Feature]project-first-studio-spine.md`
- `[20260403][Feature-Update]conversation-centered-workspace.md`
- `[20260403][Bugfix]build-static-web-output.md`

规则：

1. 日期必须使用 `YYYYMMDD`
2. 类型必须使用固定允许值之一
3. `short-title` 不能包含 `[` 或 `]`
4. 文件名应尽量避免 `notes`、`misc`、`temp`、`thoughts` 这类无检索价值的命名

## 文档内部类型

虽然文件名按 change type 命名，但文档内部仍应在 metadata 中记录更准确的文档类型。

例如：

1. `decision_record`
2. `design_rationale`
3. `round_record`
4. `milestone_record`
5. `evolution_summary`

这些分类不应该体现在目录结构里，而应体现在 metadata 和数据库索引中。

## 每份稳定文档至少应包含什么

每份稳定演进文档至少应尝试回答：

1. 它解决什么问题
2. 最终结论是什么
3. 为什么是这个结论
4. 有没有考虑过其他方案
5. 这个结论带来了什么变化
6. 它来自哪些 session
7. 它依赖或替代了哪些文档

否则文档就会变成脱离上下文的孤立结论。

## 对话记录如何使用

数据库中的 session / message 记录，不应该机械地整段复制到 markdown 中。

正确做法是：

1. 原始讨论保留在数据库中
2. 重要结论提炼成稳定文档
3. 文档通过 `related_sessions` 回链到原始讨论

这样既能保持知识库可阅读，也能保留完整追溯链。

## 后续数据库索引方向

知识文档索引层应逐步补上至少以下结构化字段，例如：

- document id
- file path
- title
- change type
- document type
- related session ids
- related docs
- related project id
- related artifact ids
- created_at
- updated_at
- supersedes
- superseded_by

这些结构化字段应优先进入数据库，而 markdown 文档继续承担详细内容载体角色。

## 最终判断规则

当你判断某个内容要不要进入 Snail Shell 演进知识体系时，可以问四个问题：

1. 它是否保留了一个长期有效的设计或实现真相？
2. 未来修改时，我们是否需要回来看它的设计初衷？
3. 它是否能与相关 session 建立关联？
4. 它是否足够有组织，而不是临时碎片？

如果答案是“是”，它就应该进入这里。

如果答案是否，则它更可能属于：

- 原始 session 历史
- 运行日志
- 临时草稿
- 或者根本不需要保存
