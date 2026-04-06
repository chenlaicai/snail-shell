# Snail Shell 知识模型

## 目的

本文档用于沉淀当前阶段已经拍板确定的 Snail Shell 知识模型。

这里的“知识模型”不是指文档存储方式本身，而是指 Snail Shell 如何组织、保留、检索和回溯自身活过的痕迹。

## 知识模型定位

Snail Shell 的知识模型不是文档中心模型。

当前阶段已经明确：

1. 文档不是核心
2. 文档只是内容载体
3. 真正的核心是这套痕迹组织体系本身

因此，知识模型首先是：

- project 如何组织
- stage 如何推进
- conversation 如何衍生
- artifact 如何沉淀
- 文档如何作为 artifact 的一种载体存在

## 核心设计初衷

### 1. Snail Shell 要保留自己活过的痕迹

Snail Shell 不只是要保存当前结论，还要保存“这些结论是怎么长出来的”。

也就是说，未来某次修改一个设计点时，系统应能支持回看：

- 当时的 project 是什么
- 属于哪个 stage
- 是在哪些 conversation 中讨论出来的
- 最终沉淀成了哪些 artifact

### 2. 知识组织必须优先围绕工作对象，而不是文件对象

如果知识体系以 document 为中心，就会自然滑向“文档库”思维。

但 Snail Shell 要表达的是：

工作如何发生，痕迹如何组织，产物如何沉淀。

因此，知识模型必须首先围绕：

1. `Project`
2. `Stage`
3. `Conversation`
4. `Artifact`

## 当前知识模型主轴

当前拍板后的知识模型主轴与系统主模型一致：

`Project -> Stage -> Conversation -> Artifact`

其中：

1. `Project`
   代表最外层知识边界

2. `Stage`
   代表知识产生时所在的阶段位置

3. `Conversation`
   代表知识是在哪次具体工作过程中形成的

4. `Artifact`
   代表知识最终以何种稳定产物形式沉淀

## 文档在知识模型中的地位

文档不是知识模型的顶层对象。

文档只是 artifact 的一种表现形式。

也就是说：

1. 某个 markdown 文件不是系统核心
2. 它只是某个 artifact 的内容载体
3. 这个 artifact 仍然归属于某个 conversation
4. 这个 conversation 仍然归属于某个 stage 和 project

因此知识回溯链应该是：

`Artifact -> Conversation -> Stage -> Project`

而不是：

`Document -> Document -> Document`

## 为什么不维护 document-to-document 主关系

当前阶段已经明确放弃把知识主关系建立在 document 之间。

原因是：

1. 文档只是内容载体
2. 真正决定知识生长路径的是 conversation 之间的来源关系
3. 如果从一开始就围绕 document 间关系建模，系统会过早偏向“文档知识库”而不是“工作痕迹系统”

## Conversation 来源关系在知识模型中的作用

当前知识模型中，conversation 是主要的过程节点。

因此 conversation 之间的来源关系，是知识演进链的重要组成部分。

### 当前表达方式

不单独建立 `conversation_link` 主表，而是在 conversation 自身记录：

- `from_conversation_ids`

这表达的是：

`当前 conversation 来源于哪些历史 conversation`

例如：

1. B 来源于 A
2. B 来源于 A1 和 A2

### 为什么这样设计

因为当前知识模型更需要表达“我的来源是什么”，而不是“未来谁会依赖我”。

这种单向来源表达已经足够描述大多数设计与实现演进链。

## formal_artifacts 在知识模型中的意义

`Stage.formal_artifacts` 是当前知识模型中一个关键字段。

它的意义不是保存内容，而是保存“这个阶段最终被正式认定的交付 artifact ids”。

因此知识模型中有两层产物概念：

### 1. 实际产物全集

通过：

`Conversation -> Artifact`

表达某次真实工作过程产生的全部 artifact。

### 2. 正式交付产物集

通过：

`Stage.formal_artifacts`

表达某个 stage 最终正式交付的 artifact ids。

这两层同时存在，才能让知识体系既保留全过程，又保留正式交付边界。

## 数据库与文件系统在知识模型中的职责

当前阶段已经明确职责分工：

### 数据库

数据库负责结构化组织与索引。

也就是说，数据库负责回答：

- 某个 artifact 属于哪个 conversation
- 某个 conversation 属于哪个 stage
- 某个 stage 属于哪个 project
- 某个阶段正式交付了哪些 artifact

### 文件系统

文件系统负责作为一部分 artifact 的内容载体。

例如：

- markdown 文档
- 某些长文本说明
- 某些外部文件引用

文件系统不应成为主组织层。

## Snail Shell 自身与外部产品项目的统一模型

当前阶段已经明确：

Snail Shell 自身也应被视为一个 project。

因此知识模型不区分“系统自身知识”与“外部项目知识”的根模型。

两者共享同一套主结构：

1. `Project`
2. `Stage`
3. `Conversation`
4. `Artifact`

只是 `Project.kind` 不同。

这样可以避免后期形成两套裂开的知识体系。

## 当前明确放弃的知识模型方案

### 1. 文档中心模型

放弃原因：

它会让系统滑向“文档管理系统”，而不是“工作痕迹组织系统”。

### 2. document-to-document 主关系模型

放弃原因：

当前真正重要的是 conversation 的来源关系，而不是文档之间的引用关系。

### 3. 把 commit 作为单独知识对象主链

放弃原因：

代码只是 artifact 的一种形式，commit 只是代码产物的一种表达。

### 4. 让文档脱离 conversation 单独存在

放弃原因：

这样知识就失去“它是从哪次工作过程里长出来的”这条最重要的追溯线。

## 一句话总结

Snail Shell 当前阶段的知识模型，不是以 document 为核心，而是：

`以 Project 作为知识边界，以 Stage 作为知识位置，以 Conversation 作为知识生成过程，以 Artifact 作为知识沉淀产物的统一痕迹模型。`
