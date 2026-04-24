# Snail Shell 系统模型

## 目的

本文档用于沉淀当前阶段已经拍板确定的 Snail Shell 核心系统模型。

它的职责不是记录讨论过程，而是把目前已经确认的设计结论、设计初衷和被放弃的方案整合为一份稳定设计说明。

后续 `docs/meta/` 目录将承载 Snail Shell 自身的稳定设计内容。

## 产品定位

Snail Shell 不是一个聊天工具，不是一个简单 shell，不是一个通用工作流引擎，也不是一个 IDE 替代品。

Snail Shell 当前被定义为：

`一个全员 agent 的软件生产工作室`

它的价值不在于“让模型回答问题”，而在于把软件生产过程组织成一套：

- 有阶段
- 有职责
- 有产物
- 有痕迹
- 可回溯

的工作系统。

## 核心设计初衷

Snail Shell 当前阶段最重要的设计初衷有三条：

### 1. 做减法，维持工作室规模

Snail Shell 不是为了模拟一个庞大的公司流程系统，而是为了维持一个紧凑、清晰、可控的软件工作室。

因此模型必须尽量抓住真正重要的主干对象，而不是为了完整感不断增加抽象层。

### 2. 相信 agent 能力，但系统要抓住产物与过程

Snail Shell 不应过度侵入 agent 内部思维或执行细节。

它真正要管理的是：

- project 如何推进
- stage 如何变化
- conversation 如何衍生
- artifact 如何沉淀

系统聚焦工作结构与产物留痕，而不是 agent 内部认知过程本身。

### 3. 保留 Snail Shell 活过的痕迹

Snail Shell 的核心不是文档本身，而是“系统如何活过、如何演进、如何留下痕迹”。

因此模型必须优先表达：

- 最外层工作对象
- 阶段推进链
- 讨论链路
- 产物沉淀
- 来源关系

而不是首先围绕“文档管理”建模。

## 最终拍板的核心模型

当前阶段拍板后的核心系统模型是：

`Project -> Stage -> Conversation -> Message -> Artifact`

这是 Snail Shell 当前阶段唯一的主模型主轴。

## 为什么是这条主轴

### Project 是第一层

Snail Shell 的最外层组织单元不是 session，不是 conversation，而是 `Project`。

原因是：

1. 一个软件工作对象需要长期存在
2. 一个 project 可能经历多个阶段
3. 一个 project 下会有多个 conversation
4. 一个 project 下会沉淀多个 artifact

如果最外层不是 project，整个系统就会退化成“聊天线程上外挂一些结构”，而不是软件生产工作室。

此外，Snail Shell 自身也被视为一个长期存在、原则上不完结的 project。

### Stage 是第二层约束框架

Project 不是平铺工作对象，而是被 stage chain 约束的。

这里的重点不是“当前在哪个阶段”，而是：

项目如何沿固定阶段链推进，并且在推进过程中允许多轮反复。

例如：

`stage1 -> stage2 -> stage3 -> stage2 -> stage3 -> stage4 -> stage3 -> stage4 -> stage5`

这不被理解为“回滚”，而被理解为：

同一个 project 在固定阶段链中的多轮迭代推进。

所以 stage 在模型中必须是“实例链”，而不是一个 project 上挂的单个状态字段。

### Conversation 是第二层工作对象

某一个 feature、某一个话题、某一次讨论，本质上对应一条 `Conversation`。

Conversation 不是附属记录，而是主工作对象之一。

因为真实工作主要发生在：

- 讨论
- 澄清
- 推进
- 修正
- 提炼

而这些都首先发生在 conversation 中。

### Message 是 conversation 的内容流

`Message` 不是独立业务层，而是 conversation 的内容明细层。

它承担的是消息轨迹保存职责，而不是主组织职责。

### Artifact 是统一产物对象

当前阶段已经明确：

不要把 document 视为系统核心。

真正的核心产物对象是 `Artifact`。

文档只是 artifact 的一种载体，代码也是 artifact 的一种形式。

因此：

1. 不单独建立 document 作为主对象
2. 不单独建立 commit 作为主对象
3. 统一进入 artifact 模型，通过类型和存储方式区分

## 各核心实体的定位

## 1. Project

Project 是最外层工作容器。

它承载：

- 项目身份
- 项目边界
- stage chain
- conversations
- artifacts

当前 project 的两个主要类型：

1. `system_self`
   表示 Snail Shell 自身

2. `product_delivery`
   表示由 Snail Shell 组织生产的某个具体软件项目

## 2. Stage

Stage 表示 project 的真实阶段实例链中的某一个节点。

它不是抽象定义层，而是项目真实经历过的阶段实例。

Stage 当前核心字段语义：

1. `type`
   表示固定流程中的阶段类型

   当前阶段类型采用：

   - `init`
   - `discuss`
   - `coding`
   - `check`
   - `publish`

2. `sequence`
   表示该 stage 在该 project 中真实出现的顺序

3. `status`
   表示该阶段实例当前状态

4. `formal_artifacts`
   表示该 stage 最终被认定为正式交付物的 artifact id 数组

### formal_artifacts 的定位

`formal_artifacts` 不是产物内容，不是 artifact type 列表，也不是 stage 下全部产物。

它保存的是：

`该阶段最终正式交付了哪些 artifact ids`

这是规范层与正式交付层的表达。

阶段本身的类型定义、显示名称、正式交付要求，不直接依赖业务数据推断，而应由 `.meta/stages.json` 提供系统规范定义。

而 stage 下真实工作过程中产生的全部产物，则通过：

`Stage -> Conversations -> Artifacts`

这条链表达。

## 3. Conversation

Conversation 是第二层的主工作对象。

它表示某个 stage 下的一次具体工作推进过程。

关键约束：

1. 每个 conversation 只属于一个 project
2. 每个 conversation 只属于一个 stage
3. conversation 不跨 stage
4. 如果工作跨阶段继续，应该新建 conversation，而不是让旧 conversation 横跨多个 stage

### from_conversation_ids 的定位

conversation 之间不单独维护 `conversation_link` 表。

而是在 conversation 自身上记录：

- `from_conversation_ids`

它表达的是：

`当前这条 conversation 来源于哪些历史 conversation`

这是单向来源表达，不记录未来谁依赖它。

例如：

1. B 来源于 A
2. B 来源于 A1 和 A2

那么只需在 B 中记录来源即可，不需要在 A、A1、A2 中反写未来关系。

## 4. Message

Message 是 conversation 的内部消息流。

它负责保存：

- 用户消息
- agent 回复
- system 消息
- 统一消息生命周期痕迹

但它不是上层工作模型的核心组织单元。

当前阶段需要特别强调：

1. Message 不是扁平的 `content + message_type` 记录
2. Message 只作为消息实体锚点
3. 过程、正式结论、终态都通过 `message_part` 表达

也就是说，conversation 内部的消息流应统一理解为：

- `message`
- `message_part(start / delta / result / end)`

其中：

1. `delta` 表示过程态
2. `result` 表示正式结论态
3. `end` 表示终态

这套模型的正式规范来源为：

- `docs/core-message-model.md`

## 5. Artifact

Artifact 是统一产物对象。

当前已经明确：

1. 文档属于 artifact
2. 代码提交属于 artifact
3. 代码变更记录属于 artifact
4. 设计结果属于 artifact
5. 验收结果属于 artifact

### 为什么把 commit 并入 artifact

因为代码只是工作产物的一种形式，而不是与文档平级的另一套核心模型。

因此不再使用：

1. `commit` 独立主实体
2. `conversation_commit` 中间表

而是通过 `Artifact` 来表达代码提交类产物。

例如：

- `artifact_type = code_commit`
- `metadata` 中记录 `commit_hash`、`branch_name`、`commit_message` 等信息

## snail_name 的定位

`snail_name` 不是权限角色，不是用户角色，而是工作室中的 snail 身份。

它表达的是：

`这条 conversation 主要由哪个 snail 驱动`

当前建议值：

1. `owner`
2. `product_agent`
3. `design_agent`
4. `implementation_agent`
5. `acceptance_agent`

也就是说，snail_name 的作用是记录工作责任归属，而不是权限控制。

## 当前明确放弃的方案

当前阶段已经明确放弃以下方案：

### 1. Session 作为顶层模型

放弃原因：

它会让系统一直停留在“聊天线程外挂结构”的状态，无法真正形成 project 驱动的软件工作模型。

### 2. 把 document 作为知识体系核心

放弃原因：

文档只是内容载体，不是系统主对象。

真正核心是工作过程如何组织，以及产物如何沉淀。

### 3. document-to-document 主关系模型

放弃原因：

当前阶段最重要的链路不是文档如何引用文档，而是 conversation 如何来源于 conversation。

### 4. conversation_link 独立表

放弃原因：

当前阶段只需要记录“当前 conversation 来源于哪些历史 conversation”，不需要额外建独立关系表。

因此用 `from_conversation_ids` 即可。

### 5. commit 独立主实体

放弃原因：

代码是产物的一种形式，不需要单独成为与 artifact 平级的核心对象。

### 6. project.current_stage_id

放弃原因：

当前阶段更强调 stage chain 自身的真实推进顺序，而不是 project 上挂一个派生性的“当前阶段指针”。

### 7. 以回滚思维理解阶段反复

放弃原因：

当前模型更准确的理解是固定 stage chain 上的多轮迭代推进，而不是简单的状态回退。

## 当前实现方向

当前系统已经按“无迁移、直接重建”的方式切入新主模型。

当前实现方向强调：

1. 删除旧模型包袱
2. 不维护兼容层
3. 直接围绕 `Project -> Stage -> Conversation -> Message -> Artifact` 建新系统

## 一句话总结

Snail Shell 当前阶段的系统模型，不是文档中心模型，也不是聊天中心模型，而是：

`以 Project 为最外层，以 Stage 形成固定迭代链，以 Conversation 作为主工作过程，以 Artifact 统一沉淀产物的系统模型。`
