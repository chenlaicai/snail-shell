# Snail Shell UI 模型

## 目的

本文档用于沉淀当前阶段已经拍板确定的 Snail Shell UI 模型。

这里的重点不是记录页面长什么样，而是记录：

- 页面为什么要这样组织
- 信息层级为什么这样分配
- 主工作区为什么这样定义
- 哪些方案被明确放弃了

这份文档属于稳定设计说明，而不是某一轮界面实现记录。

## UI 设计的核心初衷

Snail Shell 的界面不是一个普通后台系统，也不是一个单纯聊天工具界面。

它必须同时满足两件事：

1. 对话是实际工作的主场景
2. project / stage / artifact 又必须始终作为结构化上下文存在

因此，UI 的核心任务不是“把信息全部铺开”，而是建立正确的信息优先级。

## 最核心的设计判断

当前阶段，Snail Shell UI 最重要的判断是：

`对话必须是主工作面，项目与阶段是结构化上下文，而不是页面中心主角。`

这是当前 UI 模型最重要的一条设计原则。

## 为什么对话必须是主工作面

因为 Snail Shell 的真实工作过程首先发生在 conversation 中。

用户最频繁、最重要的动作是：

1. 和 agent 讨论
2. 推动 agent 产生产物
3. 在讨论中澄清、修正、推进设计与实现

因此，对话区不能被降级成“附属窗口”或“辅助面板”。

如果对话不在页面中心，系统就会逐渐退化成一个记录型后台，而不是一个真正的工作台。

## 为什么 project 必须在左侧作为最外层入口

当前已经拍板：Snail Shell 的最外层工作对象是 `Project`。

因此 UI 也必须体现同样的层级结构。

左侧导航的职责是表达真实工作层级，而不是表达视觉分类。

所以左侧结构应保持：

`Project -> Conversations`

这意味着：

1. 用户先进入某个 project
2. 再进入该 project 下的具体 conversation

而不是反过来先从 conversation 进入，再去补挂 project 语义。

## 为什么 stage / artifact 不应占据页面中间主区域

当前阶段已经明确：

project 的流转、阶段状态、每个阶段的正式产物，这些都很重要，但它们通常属于相对稳定的信息。

一旦某个阶段达到，或者某个结构已经明确，它就不会像 conversation 那样持续高速变化。

因此：

1. stage 信息应持续可见
2. artifact 信息应持续可见
3. 但它们不应占据页面中间的大头区域

它们更适合作为：

- 右侧常驻 context panel
- 或顶部/侧边的结构化信息区

而不是中间主工作面。

## 当前拍板的页面信息架构

当前阶段已经拍板的 UI 主结构为三栏：

### 左侧

`Project -> Conversations`

这是导航层，不是内容主区。

左侧负责表达：

1. 当前工作属于哪个 project
2. 当前 project 下有哪些 conversation

### 中间

`Conversation Workspace`

这是主工作区，也是页面最大区域。

中间负责承载：

1. 当前对话
2. 消息流
3. 输入区
4. agent 流式输出

### 右侧

`Stage / Artifact Context`

这是结构化上下文区。

右侧负责承载：

1. stage chain
2. 当前阶段状态
3. 当前阶段的正式交付信息
4. 当前阶段下已有 artifacts

## 为什么右侧先常驻显示

当前阶段已拍板：右侧上下文区先常驻显示。

原因是：

1. 需要让 project / stage / artifact 的结构感稳定存在
2. 需要让用户逐渐建立“始终在某个结构下工作”的认知
3. 当前阶段优先保证结构清晰，而不是优先压缩视觉空间

后续是否折叠，可以作为交互优化问题处理；但当前阶段不应先把结构信息藏起来。

## UI 与系统模型的对应关系

当前 UI 模型必须严格对应系统模型：

### 1. Project 是最外层

因此左侧第一层是 project。

### 2. Conversation 是主工作对象

因此中间必须是 conversation workspace。

### 3. Stage 是 project 的阶段链

因此右侧必须能表达 stage chain，而不是只显示单个当前状态。

### 4. Artifact 是统一产物对象

因此右侧 artifact 区域不应只服务“文档”，而应服务统一 artifact 概念。

## 当前明确放弃的 UI 方案

### 1. 以 project board 作为中间主界面

放弃原因：

这会让 workflow / status 的视觉优先级高于真实工作过程。

而 Snail Shell 的真实工作过程首先发生在 conversation 中。

### 2. 继续使用 session 作为左侧导航主入口

放弃原因：

这会破坏已经拍板的 project-first 模型，让界面和系统模型脱节。

### 3. 把 stage / artifact 收得太深，只在点击时再出现

放弃原因：

这样会削弱结构化工作感，使用户重新回到“只是在聊天”的体验。

### 4. 把页面做成纯文档管理界面

放弃原因：

Snail Shell 的核心不是读文档，而是在 conversation 中推进工作，并让文档/代码等 artifact 成为可追溯的沉淀。

## UI 模型的一句话总结

Snail Shell 当前阶段的 UI 模型是：

`左侧用 Project -> Conversations 表达工作层级，中间用 Conversation 作为主工作面，右侧用 Stage / Artifact 表达结构化上下文的三栏工作台模型。`
