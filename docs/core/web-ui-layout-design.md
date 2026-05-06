# Snail Shell Web UI 布局核心设计

## 文档定位

本文档定义 Snail Shell Web UI 的核心布局设计。

后续凡是涉及以下内容的设计、实现、测试、评审与重构，都必须以本文档为准：

1. Web 页面信息架构
2. 项目、Feature、Stage、Conversation 的导航与上下文呈现
3. 对话主界面、消息列表与 composer
4. Stage、Deliverables、Prompt Center、System State、Repository Context 的管理入口
5. 知识中心布局
6. 桌面、窄屏和移动端响应式布局
7. 结构化消息内容在 UI 中的默认呈现层级

本文档不定义具体 CSS token、像素级视觉稿或前端实现细节。具体实现可以在不破坏本文档布局不变量的前提下调整颜色、间距、动效和组件细节。

## 裁决优先级

当不同信息源对 Web UI 布局给出不同说法时，裁决优先级固定如下：

1. 本文档定义的信息架构、布局不变量、响应式规则和主路径约束
2. 与本文档一致的 Web 实现、测试和截图
3. 其他系统文档
4. 历史设计稿、旧 CSS、临时讨论结论

如果现有代码与本文档冲突，后续 UI 实现应以本文档为目标修正代码，而不是通过局部样式补丁延续冲突。

## 当前功能面

Snail Shell Web UI 当前至少承载以下功能面：

| 功能面 | 当前用户任务 | 布局归属 |
| --- | --- | --- |
| 项目管理 | 查看、新建和切换 Project | 左侧工作区导航 |
| Feature 管理 | 查看、新建、切换和归档 Feature | 左侧工作区导航 |
| Conversation 管理 | 查看、新建和切换当前 Stage 下的 Conversation | 左侧工作区导航 |
| Conversation 主界面 | 阅读消息、发送消息、回复消息、@ snail、查看 Boss mention | 中央主工作区 |
| 消息运行状态 | 查看 assistant streaming、过程事件、最终上下文、错误和中断入口 | 中央消息列表 |
| 结构化问题 | 查看 question 卡片并提交 question_response | 中央消息列表中的高优先级卡片 |
| Stage 上下文 | 查看当前阶段、状态、下一步和参与者 | 右侧上下文栏与 Inspector |
| Deliverables | 创建 artifact、选择正式交付、查看阶段产物 | Inspector 的 Deliverables 面板 |
| Prompt Center | 搜索 prompt、按 target 浏览、查看 prompt 详情 | Inspector 的 Prompt Center 面板 |
| System State | 查看 dispatch / bus 状态 | Inspector 的 System State 面板 |
| Repository Context | 记录 feature 分支、worktree 和 PR | Inspector 的 Stage 面板 |
| 知识中心 | 浏览知识库、待审批知识和当前项目知识 | 独立主视图 |

## 设计原则

1. 对话是主路径：中央区域优先保证消息阅读、结构化决策和输入闭环。
2. 上下文是辅助路径：Stage、Participants、Deliverables 以摘要形式常驻，完整管理进入 Inspector。
3. 管理动作不挤占阅读路径：产物创建、Prompt 浏览、系统诊断和仓库上下文记录进入 Inspector。
4. 输入区必须紧凑：composer 只占用必要高度，发送按钮与输入框同一行排布。
5. 状态必须可见：当前 Project、Feature、Stage、Conversation、下一步、运行中消息和只读状态必须在主路径可见。
6. 移动端优先保留闭环：小屏上先保留标题、消息列表和输入，导航与上下文通过抽屉或切换入口承载。

## 桌面布局

桌面端使用三栏工作台。左侧负责定位工作对象，中间负责当前 conversation，右侧负责轻量上下文摘要。

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ Header: Snail Shell                                      当前 Project · Feature · Stage       │
├──────────────────────┬──────────────────────────────────────────────────────┬────────────────┤
│ Left Navigation      │ Main Conversation                                    │ Context Rail   │
│                      │                                                      │                │
│ Workspace Summary    │ ┌──────────────────────────────────────────────────┐ │ Stage          │
│ Primary Nav          │ │ Conversation Title / Breadcrumbs                 │ │ - 当前阶段     │
│ - Projects           │ │ Stage Badge · Next Step              [Context]   │ │ - 状态         │
│ - Knowledge          │ └──────────────────────────────────────────────────┘ │ - 下一步       │
│                      │                                                      │                │
│ Projects             │ Boss Mentions Banner                                │ Participants   │
│ - project A          │                                                      │ - Boss Snail   │
│ - project B          │ ┌──────────────────────────────────────────────────┐ │ - 主响应 snail │
│                      │ │ Message List                                     │ │ - 协作 snail   │
│ Features             │ │                                                  │ │                │
│ - active feature     │ │  assistant / user / system messages             │ │ Deliverables   │
│ - in review          │ │  event stream / final context / question card   │ │ - 正式交付数   │
│ - archived group     │ │                                                  │ │ - 必需产物     │
│                      │ └──────────────────────────────────────────────────┘ │                │
│ Conversations         │                                                      │                │
│ - current conv        │ ┌──────────────────────────────────────────────────┐ │                │
│ - other conv          │ │ Composer                                         │ │                │
│                      │ └──────────────────────────────────────────────────┘ │                │
│ Footer Actions        │                                                      │                │
│ - Prompt Center       │                                                      │                │
│ - System State        │                                                      │                │
└──────────────────────┴──────────────────────────────────────────────────────┴────────────────┘
```

桌面布局不变量：

1. 左侧导航可滚动，但 Header 和中央 composer 不应被左侧内容高度影响。
2. 中央消息列表是主要滚动容器。
3. composer 固定在中央主工作区底部，不随消息列表滚走。
4. 右侧上下文栏只显示摘要与跳转入口，不承载高密度管理表单。
5. 当宽度不足以可靠展示三栏时，右侧上下文栏先收起，主对话保留。

## 对话主界面

对话主界面由标题区、提醒区、消息区和 composer 组成。

```text
┌────────────────────────────────────────────────────────────────┐
│ Conversation Title                                              │
│ Project / Feature / Stage / Default Snail                       │
│ [Stage Badge] 下一步说明                              [Context] │
├────────────────────────────────────────────────────────────────┤
│ Boss Mentions Banner                                            │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────────────────────┐                              │
│  │ Acceptance Snail             │                              │
│  │ assistant message            │                              │
│  └──────────────────────────────┘                              │
│                                      ┌────────────────────────┐ │
│                                      │ Boss Snail             │ │
│                                      │ user message           │ │
│                                      └────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Question Card                                             │  │
│  │ 选项 / 补充说明 / 提交回答                                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│ Composer                                                       │
└────────────────────────────────────────────────────────────────┘
```

对话主界面不变量：

1. 标题区必须同时表达 conversation 标题、层级路径、当前 Stage 状态和下一步。
2. Boss mention 提醒必须在消息列表上方，不应混入普通消息流导致遗漏。
3. 消息列表必须支持 user、assistant、system、question、error、running 等状态差异。
4. 结构化 question 卡片必须比普通过程事件更显眼，且不能默认藏在折叠流中。
5. assistant 完成态可以折叠过程事件，但最终上下文或面向用户的正文必须默认可见。

## Composer 布局

Composer 的主要问题是输入区与发送按钮纵向堆叠造成空间浪费。优化后的 composer 必须将输入框、发送按钮和中断按钮组织在同一操作行。

```text
普通状态
┌────────────────────────────────────────────────────────────────┐
│ Reply Banner: 回复 Implementation Snail ...              [取消]│
├────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────┐ ┌──────────┐ │
│ │ 输入 @Design Snail 与指定 snail 对话...       │ │ 发送     │ │
│ │ 支持多行，Enter 发送，Shift+Enter 换行        │ └──────────┘ │
│ └──────────────────────────────────────────────┘              │
│ mention status / suggestion chips                              │
└────────────────────────────────────────────────────────────────┘

运行中状态
┌────────────────────────────────────────────────────────────────┐
│ ┌──────────────────────────────────────────────┐ ┌──────────┐ │
│ │ Snail 正在响应，输入可保留草稿或按只读策略禁用 │ │ 发送禁用 │ │
│ └──────────────────────────────────────────────┘ ┌──────────┐ │
│                                                  │ 中断 Snail│ │
│ mention status / running target                  └──────────┘ │
└────────────────────────────────────────────────────────────────┘
```

Composer 布局规则：

1. 输入框与“发送”按钮必须在同一行，发送按钮位于输入框右侧。
2. “发送”按钮不得默认独占一整行。
3. “中断 Snail”在运行中状态出现，优先与发送按钮形成右侧操作栈；宽度足够时可与发送按钮同列或相邻。
4. 回复 banner 位于输入行上方，作为当前消息的局部上下文。
5. mention 状态与 suggestions 位于输入行下方，不能把发送按钮挤到单独整行。
6. 输入框最小高度为两行文本，允许随内容增长到有限高度；超过上限后输入框内部滚动。
7. 空内容、归档 Feature、assistant 运行中等不可发送状态必须禁用发送按钮并保留原因提示。

## Inspector 布局

Inspector 是右侧抽屉，用于承载低频但高密度的管理与诊断任务。

```text
┌──────────────────────────────────────────────────────┐
│ Inspector                                      [关闭] │
│ 按需查看规则、产物、提示词和系统状态                 │
├──────────┬──────────────┬──────────────┬─────────────┤
│ Stage    │ Deliverables │ Prompt Center│ System State│
├──────────┴──────────────┴──────────────┴─────────────┤
│ Active Pane                                           │
│                                                      │
│ Stage: Repository Context / Stage Chain / Contract    │
│ Deliverables: Artifact Type / Content / Artifact List │
│ Prompt: Search / Target Filter / Prompt Detail        │
│ System: Dispatch Groups / Message Preview            │
└──────────────────────────────────────────────────────┘
```

Inspector 边界规则：

1. Stage 面板承载 Repository Context、Stage Chain 和 Stage Contract。
2. Deliverables 面板承载 artifact 创建、正式交付选择和 artifact 列表。
3. Prompt Center 面板承载 prompt 搜索、target 分组和详情阅读。
4. System State 面板承载 dispatch/bus 诊断信息。
5. Inspector 打开时可覆盖右侧上下文栏和部分主区，但不得破坏当前 conversation 状态。

## 知识中心布局

知识中心是与项目工作台并列的一级主视图，不是 Inspector 子页。

```text
┌──────────────────────┬──────────────────────────────────────────────┐
│ Left Navigation      │ Knowledge Center                             │
│                      │                                              │
│ Workspace Summary    │ ┌──────────────────────────────────────────┐ │
│ Primary Nav          │ │ Hero: 知识中心 / 当前项目知识             │ │
│ - 项目管理           │ │ Stats: 已生效 / 待审批                   │ │
│ - 知识中心(active)   │ └──────────────────────────────────────────┘ │
│                      │ [知识库] [待审批] [当前项目知识]             │
│ Projects / Features  │                                              │
│ 可隐藏或降级         │ ┌──────────────────┬───────────────────────┐ │
│                      │ │ Knowledge List   │ Knowledge Detail      │ │
│                      │ │ title / meta     │ content / rationale  │ │
│                      │ │ snippet          │ sources / actions    │ │
│                      │ └──────────────────┴───────────────────────┘ │
└──────────────────────┴──────────────────────────────────────────────┘
```

知识中心规则：

1. 知识中心与项目工作区通过一级导航切换。
2. 知识库、待审批和当前项目知识是知识中心内部模式，不应挤入 conversation 主界面。
3. 审批操作必须靠近知识详情，不能只在列表项上出现。
4. 移动端知识中心优先显示列表，详情可在列表下方或后续抽屉中呈现。

## 消息与结构化内容布局

消息 UI 必须映射核心消息模型的事件语义，但不能把所有事件同等显著地铺满主路径。

```text
Assistant Message
┌──────────────────────────────────────────────────────┐
│ Header: Implementation Snail                  time   │
├──────────────────────────────────────────────────────┤
│ [流式过程] 12 条过程记录                       >      │
├──────────────────────────────────────────────────────┤
│ 最终文本 / Message Out / LLM 摘要                    │
│                                                      │
│ Markdown、table、artifact/reference card 等结构化内容 │
├──────────────────────────────────────────────────────┤
│ Actions: 回复 / 中断运行中消息                       │
└──────────────────────────────────────────────────────┘

Question Message
┌──────────────────────────────────────────────────────┐
│ 需要你的确认                                         │
│ 问题正文                                             │
│ reason                                               │
│ ○ 选项 A                                             │
│ ○ 选项 B                                             │
│ [提交回答]                                           │
└──────────────────────────────────────────────────────┘
```

消息布局规则：

1. `text`、`content_block`、`tool_call`、`tool_result`、`command`、`command_result`、`signal`、`error` 都必须可追溯。
2. 普通过程事件默认可以折叠，避免噪音淹没最终内容。
3. `question` 与需要用户决策的结构化内容默认展开。
4. `message.status` 必须在 running、failed、interrupted、cancelled 等状态中有可见表达。
5. 工具和命令的大型输出默认显示摘要，详情区域可滚动。

## 响应式布局

### 窄屏桌面和平板

当宽度不足以同时展示三栏时，右侧 Context Rail 先收起，Context 按钮和 Stage Badge 继续打开 Inspector。

```text
┌──────────────────────────────────────────────────────────────┐
│ Header                                                       │
├──────────────────────┬───────────────────────────────────────┤
│ Left Navigation      │ Main Conversation                     │
│ Projects / Features  │ Header / Messages / Composer          │
│ Conversations        │ [Context opens Inspector]             │
└──────────────────────┴───────────────────────────────────────┘
```

### 移动端

移动端必须优先保留 conversation 闭环。左侧导航和右侧上下文均不常驻。

```text
┌────────────────────────────────────────┐
│ Snail Shell                [Project]   │
├────────────────────────────────────────┤
│ Conversation Title                      │
│ Stage Badge · Next Step       [Context]│
├────────────────────────────────────────┤
│ Boss Mentions                           │
├────────────────────────────────────────┤
│ Message List                            │
│                                        │
│ user / assistant / question / error     │
│                                        │
├────────────────────────────────────────┤
│ Reply Banner                            │
│ ┌──────────────────────────┐ ┌───────┐ │
│ │ 输入消息                 │ │ 发送  │ │
│ └──────────────────────────┘ └───────┘ │
│ mention status                         │
└────────────────────────────────────────┘
```

移动端规则：

1. 不能因为隐藏左侧导航而让用户无法切换项目、Feature 或 Conversation；后续实现必须提供抽屉、顶部切换器或等价入口。
2. composer 仍保持输入框与发送按钮同一行；极窄屏可缩短按钮文案或使用图标，但不能回退为发送按钮默认独占整行。
3. Inspector 在移动端以全屏抽屉呈现。
4. 消息最大宽度应扩大到接近全宽，减少窄屏横向浪费。

## 后续实现检查点

后续 UI 实现或重构必须至少检查以下事项：

1. `src/web/ui-shell.js` 的 DOM 区块是否仍符合主导航、主对话、上下文和 Inspector 的边界。
2. `src/web/styles.css` 是否保证 composer 输入框与发送按钮同一行。
3. 移动端是否存在项目、Feature、Conversation 的可达切换入口。
4. assistant 运行中时，发送禁用、中断入口和运行状态是否同时可见。
5. question 卡片是否默认可见并可提交结构化回答。
6. 右侧 Context Rail 收起后，Stage、Deliverables、Prompt Center 和 System State 是否仍可通过 Inspector 到达。
7. 知识中心是否保持一级主视图，不被混入 conversation 或 Inspector。

## 非目标与开放边界

本文档暂不规定：

1. 最终视觉主题、品牌插画或图标体系。
2. 具体 CSS class 命名。
3. 是否使用原生 DOM、Web Components、React 或其他前端框架。
4. 具体断点数值，除非后续实现需要把断点固化为测试契约。

以上内容可以在后续 feature 中继续细化，但不得破坏本文档已定义的信息架构和布局不变量。
