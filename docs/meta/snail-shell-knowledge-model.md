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

## Stage 收尾知识提炼机制

当前阶段新增明确约束：

1. 知识沉淀不是独立 snail 的显式工作
2. 知识沉淀是 stage 生命周期中的内建后处理动作
3. 触发粒度以 stage 为主，而不是 project 结束时统一处理
4. 系统先自动识别知识候选，再由用户决定是否正式沉淀

这意味着在 Snail Shell 中，知识沉淀流程应理解为：

`Stage 完成 -> 系统自动提炼 knowledge proposals -> 用户确认是否接纳`

### 为什么以 stage 为触发粒度

因为 project 往往跨很多轮迭代，如果等 project 结束再统一沉淀：

1. 上下文会过大
2. 证据会被稀释
3. 用户审阅成本会明显升高
4. 不同类型的经验会被混杂在一起

而 stage 天然就是：

1. 一轮工作边界
2. 一组 formal artifacts 边界
3. 一次可验证结论边界

因此 stage 是知识候选最自然的识别窗口。

## Knowledge Proposal 在知识模型中的位置

当前阶段明确引入：

- `KnowledgeProposal`

它不是最终知识条目，而是：

1. 系统在 stage 收尾时自动识别出的候选知识
2. 仍然附着在 project / stage / conversation / artifact 主链之上
3. 在用户确认前，不进入正式知识库

因此当前链路变为：

`Project -> Stage -> Conversation -> Artifact -> KnowledgeProposal(候选)`

其中 `KnowledgeProposal` 的证据仍然必须能回溯到：

1. conversation
2. artifact
3. formal artifacts

## Knowledge Proposal 的职责边界

`KnowledgeProposal` 的作用不是替代 artifact，也不是替代正式知识条目。

它承担的是两层缓冲职责：

1. 把“本轮值得复用的模式”从一般工作痕迹中提炼出来
2. 在系统自动识别和用户正式确认之间建立治理缓冲层

这样可以避免两类问题：

1. 所有工作记录都被误升级为知识
2. 系统自动沉淀未经确认的错误规则

## 正式知识条目在模型中的位置

当前阶段进一步明确：

1. `KnowledgeProposal` 是候选层
2. `KnowledgeEntry` 是正式知识层

因此当前链路变为：

`Project -> Stage -> Conversation -> Artifact -> KnowledgeProposal -> KnowledgeEntry`

其中：

1. `KnowledgeProposal`
   表示系统自动识别并提交用户审核的候选知识

2. `KnowledgeEntry`
   表示已经被用户确认接纳的正式知识条目

### 为什么要把 proposal 和 entry 分开

因为当前已经明确：

1. 自动识别不等于正式成立
2. 用户确认不应直接覆盖原始候选痕迹
3. 系统需要保留“候选是什么、最后接纳了什么”这两层信息

这样才能让知识体系既保留治理过程，又保留正式结果。

## 后台临时多视角评审

当前阶段进一步明确：

1. 知识评审不一定总是单模型完成
2. 对于较重要或较复杂的 stage，系统可以临时组建后台多视角评审
3. 这类评审不是长期存在的可见 snail，而是一次性的系统内建评审动作

当前多视角评审的典型视角包括：

1. 设计视角
2. 实现视角
3. 验收视角

它们的输出不会直接成为知识，而是作为 proposal review 的一部分被保留下来，供用户判断是否采纳。

## 正式知识的消费闭环

当前阶段进一步明确：

1. 正式知识不能只被存储，必须能进入后续执行上下文
2. 知识消费的默认入口是 conversation 的 system prompt 构建过程
3. 系统需要基于 stage、snail、project kind 对正式知识做筛选，再分层注入

因此当前闭环补充为：

`Stage 结束 -> 自动提炼 proposal -> 用户确认 -> 生成 knowledge entry -> 后续 prompt 注入`

### 当前知识注入分层

当前阶段至少分为三层：

1. `mandatory`
   必须遵守的知识

2. `recommended`
   优先参考的知识

3. `reference`
   按需参考的知识

### 当前知识筛选维度

当前 system prompt 注入至少考虑：

1. 当前 stage type
2. 当前 active snail
3. 当前 project kind

这样正式知识才不是静态档案，而是能参与后续实际工作的系统内建上下文。

## 知识验证与演进

当前阶段进一步明确：

1. 正式知识被注入 prompt 后，系统应记录命中事件
2. 知识在后续工作中可以被验证，也可以被挑战
3. 新知识可以替代旧知识，形成演进链

因此当前系统在正式知识层继续补充：

1. `KnowledgeEvent`
   表示知识在运行期被注入、被验证、被挑战或被替代的事件

2. `KnowledgeEntry.supersedes_entry_id`
   表示当前知识替代了哪条旧知识

3. `KnowledgeEntry.superseded_by_entry_id`
   表示当前知识已被哪条新知识替代

### 当前事件类型

当前至少包括：

1. `prompt_injected`
2. `validated`
3. `contested`
4. `superseded`

这样 Snail Shell 的知识体系就不再只是“积累知识”，而开始具备：

1. 追踪知识是否被实际使用
2. 追踪知识是否被后续工作验证
3. 追踪知识是否已经被更新替代

## 当前知识提炼的判定结果

当前阶段，stage 收尾后的知识候选至少可能落入以下几类结果：

1. 接纳为正式知识
2. 接纳为项目局部知识
3. 延后决策
4. 拒绝沉淀

这说明当前系统并不把“是否沉淀知识”理解为简单的二元判断，而是一个受治理的确认过程。

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
