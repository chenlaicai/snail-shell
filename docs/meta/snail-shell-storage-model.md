# Snail Shell 存储模型

## 目的

本文档用于沉淀当前阶段已经拍板确定的 Snail Shell 存储模型。

这里的重点不是列出某一版 schema 的全部细节，而是明确：

- 系统为什么这样分层存储
- 哪些内容应进入数据库
- 哪些内容应以文件存在
- 存储模型服务于什么样的系统目标

这是一份稳定设计说明，而不是某一轮数据库改造记录。

## 存储模型的核心初衷

Snail Shell 的存储模型不是为了单纯把数据放进数据库，而是为了支持：

1. Project 的长期存在
2. Stage chain 的真实记录
3. Conversation 的可追溯过程
4. Artifact 的统一沉淀
5. Snail Shell 自身演进痕迹的可持续保留

换句话说，存储模型服务的是：

`Snail Shell 活过的痕迹如何被稳定保存`

## 当前存储模型的核心判断

当前阶段，Snail Shell 的存储模型已经明确为：

### 1. 数据库是主结构化存储层

数据库负责保存系统主模型中的结构化对象与关系。

也就是说，数据库优先保存：

- project
- stage
- conversation
- message
- artifact

数据库负责表达的是：

- 它属于谁
- 它和谁有关
- 它处于哪条链上
- 它当前处于什么状态

### 2. 文件系统是内容载体层

文件系统不是主结构化组织层，而是部分 artifact 的内容载体层。

例如：

- markdown 文档
- 长文本设计说明
- 外部文件引用

文件系统负责表达的是：

- 某个 artifact 的正文内容或外部文件形态

而不是：

- 系统主模型的关系结构

## 为什么数据库必须是主结构化层

因为 Snail Shell 当前最重要的，不是“保存某篇文档文本”，而是“保存一条工作痕迹链”。

这条链必须能够表达：

1. 某个 artifact 来自哪个 conversation
2. 某个 conversation 属于哪个 stage
3. 某个 stage 属于哪个 project
4. 某个 stage 的正式交付 artifact 是哪些

这些都属于结构化关系，必须由数据库承担。

## 为什么文件系统不能成为主组织层

如果文件系统成为主组织层，系统很容易退化成“文件夹 + 文档”的管理模型。

这样会有几个问题：

1. project / stage / conversation 的关系会变得隐性
2. conversation 的来源链不容易稳定表达
3. artifact 的正式交付与全量产出不容易同时表达
4. 检索会依赖目录结构和文件名，而不是稳定业务对象

因此当前阶段明确：

文件系统可以是内容载体，但不能是主组织骨架。

## 当前主存储对象

当前阶段，Snail Shell 的主存储对象是：

1. `Project`
2. `Stage`
3. `Conversation`
4. `Message`
5. `Artifact`

这些对象统一进入数据库主结构层。

其中 `Message` 的存储必须进一步拆成两层：

1. `message`
   保存消息实体锚点、归属、路由、引用关系
2. `message_part`
   保存消息生命周期与结构化正文

也就是说，消息不是单表正文模型，而是 append-only 的消息实体加分片模型。

## Artifact 在存储模型中的地位

Artifact 是当前存储模型中的统一产物对象。

这意味着：

1. 不单独为 document 建主表
2. 不单独为 commit 建主表
3. 不单独为 requirements 建主表

这些都通过 `artifact_type` 与内容承载方式来区分。

这是当前存储模型中非常关键的一条原则。

## formal_artifacts 的存储意义

`Stage.formal_artifacts` 是当前存储模型中的关键字段之一。

它存储的是：

`该阶段最终正式交付的 artifact ids`

这意味着：

1. 它不保存正文
2. 它不保存 artifact type 列表
3. 它不保存所有实际产物

它只保存“正式交付集合”的引用。

因此当前存储模型同时支持两层信息：

### 1. 实际全过程产物

通过：

`Conversation -> Artifact`

保存真实工作中产生的全部 artifact。

## Message 在存储模型中的地位

Message 是 conversation 的可追溯痕迹层。

但它不是一个 `content + type + metadata` 的扁平记录。

当前阶段已经拍板采用：

- `message`
- `message_part`

两层结构。

这样做的原因是：

1. 要支持流式过程与正式结论分离
2. 要支持终态独立表达
3. 要支持 question / question_response 作为正式消息持久化
4. 要支持 system notice 与 assistant message 共用同一生命周期模型
5. 要避免上层再次维护独立的 realtime 事件语义和 storage 语义

消息模型的正式规范来源为：

- `docs/core-message-model.md`

### 2. 正式交付产物

通过：

`Stage.formal_artifacts`

保存最终被认定为正式交付的 artifact ids。

## Conversation 来源关系的存储方式

当前阶段已经拍板：

conversation 之间的来源关系不单独拆成独立主关系表，而是在 `Conversation` 上直接存：

- `from_conversation_ids`

当前阶段采用数组字段表达，而不是关系表表达。

### 为什么这样做

因为当前阶段的重点是把主模型先做正确，而不是把所有可能关系都拆成最细的关系表。

对于当前需求而言，conversation 更需要表达：

`我来源于哪些 conversation`

而不是维护一套复杂的图关系系统。

## 当前数组字段的存储判断

当前阶段，以下字段按数组属性处理：

1. `Stage.formal_artifacts`
2. `Conversation.from_conversation_ids`

这类字段当前优先作为结构化属性保存，而不是先拆出独立关系表。

原因是：

1. 当前阶段重点是主模型稳定
2. 这些字段暂时不是高复杂 join 查询的主对象
3. 先作为结构化属性保存，更符合早期重建阶段的简洁性要求

## 与 .meta 系统规范的关系

当前阶段，Snail Shell 的存储模型与根目录 `.meta/` 中的系统规范文件形成分工：

1. `.meta/stages.json`
   定义固定阶段类型及其正式交付要求

2. `.meta/stage-snails.json`
   定义固定阶段类型及其参与 snail 集合

3. 数据库
   保存每个 project 实际经历过的 stage 实例、conversation、artifact 与痕迹链

也就是说：

`.meta` 保存系统规范，数据库保存运行时实例。

## 当前明确放弃的存储方案

### 1. 继续保留旧 session-centric 存储骨架

放弃原因：

当前阶段已经决定不背历史包袱，直接围绕新主模型重建。

### 2. 为 requirements 保留独立特例表

放弃原因：

需求相关内容只是 artifact 的一种，不再单独维持特例模型。

### 3. 为 commit 单独建立主实体表

放弃原因：

代码与提交记录是产物的一种形式，不需要单独成为与 artifact 平级的主存储对象。

### 4. 让文件系统承担主组织职责

放弃原因：

这会让系统重新退化成“文件与目录优先”的模型，而不是 project / stage / conversation / artifact 优先的模型。

### 5. 在 project 上保存大量派生状态字段

放弃原因：

当前阶段更强调通过 stage chain 自身推导过程状态，而不是在 project 上堆积很多派生指针或缓存字段。

## 当前存储模型的一句话总结

Snail Shell 当前阶段的存储模型是：

`以数据库作为主结构化存储层，以文件系统作为部分 artifact 的内容载体层，并围绕 Project -> Stage -> Conversation -> Artifact 这条主链来保存系统活过的痕迹。`
