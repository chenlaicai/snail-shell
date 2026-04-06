# Snail Shell 工作流模型

## 目的

本文档用于沉淀当前阶段已经拍板确定的 Snail Shell 工作流模型。

它不是过程记录，也不是阶段性执行计划，而是 Snail Shell 自身工作流设计的稳定说明。

## 工作流定位

Snail Shell 的工作流不是一个通用审批流，也不是简单的任务状态流。

它是一条围绕软件生产建立的阶段链，用来约束 project 如何推进、conversation 如何发生、artifact 如何沉淀。

工作流的意义不是制造流程感，而是让软件生产过程：

- 可组织
- 可检查
- 可多轮迭代
- 可保留痕迹

## 工作流核心初衷

### 1. 软件生产必须有固定阶段链

Snail Shell 不采用完全自由流的工作方式。

软件工作必须在一条明确的 stage chain 上推进。

这条 stage chain 不是为了形式化，而是为了让每一类工作在其合理阶段发生，并且留下对应产物。

### 2. 阶段推进不是一次性线性前进

Snail Shell 当前明确不把阶段反复理解成“回滚”。

更准确的理解是：

project 会在固定 stage chain 上进行多轮迭代推进。

因此一个 project 的真实推进链可能是：

`stage1 -> stage2 -> stage3 -> stage2 -> stage3 -> stage4 -> stage3 -> stage4 -> stage5`

这代表的是多轮迭代，而不是简单状态退回。

### 3. Conversation 必须落在某个 stage 之下

工作流不是挂在 conversation 外面的可选标签。

相反，conversation 本身必须发生在某个 stage 之下。

也就是说：

1. 先有 stage
2. 再有该 stage 下的 conversation
3. 再由 conversation 产生 artifact

### 4. 正式交付与实际痕迹必须分开表达

一个 stage 在真实工作中会产生很多中间产物，但最终只有一部分会被认定为正式交付物。

因此工作流模型必须同时表达：

1. 实际过程中发生过什么
2. 最终正式交付了什么

### 5. 阶段推进必须依赖产物，而不是凭空变化

当前阶段已经明确：

一个 stage 要进入下一步，必须有产物支撑。

也就是说，stage 不能凭空放行，也不能在没有结论性产物的情况下结束。

这里的“产物”包括两种：

1. 通过的正式交付产物
2. 不通过的结论 / 报告 / 分析产物

因此，stage 的变化不是单纯状态机跳转，而是基于产物的推进。

## 当前固定阶段链

Snail Shell 当前阶段拍板的固定阶段类型如下：

1. `init`
   项目初始化

2. `discuss`
   需求讨论

3. `coding`
   代码

4. `check`
   验收

5. `publish`
   正式推出

这里强调的是：

这是阶段类型集合，不是“每个 project 只能有 5 条 stage 记录”。

一个 project 在真实推进中，可以多次进入同一个阶段类型，因此最终会形成 stage 实例链。

并且每一种 stage type 都有自己对应的固定正式交付要求。

当前这些系统规范不直接写在业务数据中，而是由根目录 `.meta/` 下的规范文件定义。

也就是说：

1. `.meta/stages.json`
   定义阶段类型与正式交付要求

2. `.meta/stage-snails.json`
   定义阶段类型与固定参与 snail

## Stage 在工作流中的地位

Stage 是工作流模型的核心骨架。

它承担三个作用：

1. 规定当前工作属于哪类阶段
2. 规定该阶段下 conversation 的归属
3. 规定该阶段最终正式交付的 artifact 集合

## Stage 的三个层次含义

一个 stage 在 Snail Shell 中同时有三个含义：

### 1. 阶段类型含义

例如：

- init
- coding
- publish

这表示工作性质。

### 2. 阶段实例含义

同一个类型可以在一个 project 中出现多次。

因此 stage 不是抽象定义，而是 project 真实经历过的实例节点。

### 3. 阶段交付含义

每个 stage 最终要形成一组正式交付 artifact。

这就是 `formal_artifacts` 字段的意义。

并且这些 `formal_artifacts` 不是任意挑选的，而必须对应当前 stage type 的固定正式交付要求。

## Conversation 在工作流中的地位

Conversation 是 stage 下的具体工作过程。

它的地位不是“附属聊天记录”，而是：

1. stage 内部工作的真实推进单元
2. artifact 的直接来源
3. project 痕迹链中的核心节点

### 当前约束

1. conversation 不跨 stage
2. 一个 conversation 只属于一个 stage
3. 如果工作跨阶段继续，必须新建 conversation
4. 新 conversation 可通过 `from_conversation_ids` 记录来源关系

## Artifact 在工作流中的地位

Artifact 是工作流中的统一产物。

工作流模型中不再区分“文档流”“代码流”“提交流”三套平行体系，而是统一由 artifact 承载。

### 工作流中 artifact 的两种角色

#### 1. 全量过程产物

通过：

`Stage -> Conversations -> Artifacts`

记录某一阶段真实工作过程中实际生成的全部产物。

#### 2. 正式交付产物

通过：

`Stage.formal_artifacts`

记录该阶段最终正式交付的 artifact ids。

一个 stage 要进入下一阶段时，应确保：

1. 已存在结论性产物
2. 该产物已被选入 `formal_artifacts`
3. `formal_artifacts` 满足当前 stage type 的固定正式交付要求

当前阶段例如：

1. `discuss` 应至少形成需求分析类正式产物
2. `coding` 应至少形成代码交付记录类正式产物
3. `check` 应至少形成验收类正式产物
4. `publish` 应至少形成正式推出类结论产物

## 为什么不用“回滚模型”

当前阶段明确不把流程设计成“某阶段失败后回滚到前阶段”的思维模型。

原因是这会让系统过于强调状态回退，而忽略软件设计过程中真实存在的多轮往返推进。

在 Snail Shell 中，更准确的表达是：

1. project 总是在固定阶段链上工作
2. 但同一阶段类型可以多次重新出现
3. 每一次重新进入，都是一个新的 stage 实例

这比“回滚”更贴近真实的软件设计与实现过程。

## 当前明确放弃的工作流方案

### 1. 仅用 project.current_stage 表达工作流

放弃原因：

这只能表达“现在在哪”，不能表达“是怎么走到这里的”。

Snail Shell 要保存的是经历过的阶段链，而不是只有一个当前指针。

### 2. 让 conversation 自由漂浮，不挂 stage

放弃原因：

这样 conversation 就失去流程位置，系统会重新退化成聊天工具。

### 3. 用单一线性阶段流，不允许阶段重复出现

放弃原因：

真实的软件生产经常在若干阶段之间多轮往返。

如果模型不允许这一点，就会强迫用户把真实过程塞进错误结构里。

### 4. 用“回滚”作为唯一解释框架

放弃原因：

这会让阶段反复只被理解为错误修复，而不是正常的多轮迭代推进。

## 一句话总结

Snail Shell 当前阶段的工作流模型，不是简单审批流，而是：

`以固定阶段类型为骨架、以 stage 实例链表达真实推进、以产物驱动阶段推进、以 conversation 承载具体工作过程、以 artifact 沉淀阶段结果的多轮迭代工作流模型。`
