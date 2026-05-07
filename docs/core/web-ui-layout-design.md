# Snail Shell Web UI 布局核心设计

## 文档定位

本文档定义 Snail Shell Web UI 的核心布局设计，重点服务桌面 Web 工作台。它用于约束后续 UI 实现、测试和评审，不是对当前已实现页面的复述。

后续凡是涉及以下内容的设计、实现、测试、评审与重构，都必须以本文档为准：

1. Web 信息架构与一级功能分层
2. Project、Feature、Stage、Conversation 的工作流导航
3. 对话主界面、消息列表与 composer
4. Knowledge、Prompt、System State 等跨工作流治理与诊断面板
5. 高空间利用率布局、去冗余信息呈现与上下文密度控制
6. 结构化消息内容在 UI 中的默认呈现层级

本文档不要求本轮实现移动端 UI。现有代码中存在小屏 `@media` 降级规则，但该事实只说明已有实现做过响应式兼容；本文档的核心目标仍是桌面 Web 工作台。后续若要正式设计移动端，应单独创建 feature 并补充移动端专属设计。

## 裁决优先级

当不同信息源对 Web UI 布局给出不同说法时，裁决优先级固定如下：

1. 本文档定义的信息架构、布局不变量、功能分层和主路径约束
2. 与本文档一致的 Web 实现、测试和截图
3. 其他系统文档
4. 历史设计稿、旧 CSS、当前已实现布局、临时讨论结论

如果现有代码与本文档冲突，后续 UI 实现应以本文档为目标修正代码，而不是通过局部样式补丁延续冲突。

## 设计问题基线

当前 Web UI 的主要问题不是单个“发送”按钮占行，而是信息架构和空间分配仍偏原型化：

1. 一级功能没有清晰分层：项目管理、知识中心、Prompt、系统状态等入口混在左侧栏或 Inspector 中，缺少稳定的全局导航模型。
2. 顶部空间利用率低：页面上方中间存在大面积空白，而关键状态和操作分散在左右两侧。
3. 信息重复：Workspace/Project/Feature/Stage 信息在左上摘要和右上/顶部状态中重复出现。
4. 左侧栏过载：Project、Feature、Conversation 纵向堆叠，列表增长后会挤压定位效率。
5. 右侧上下文栏价值不足：长期占用宽度，但只展示摘要，和顶部/左侧信息重复。
6. Composer 空间浪费：输入框和发送按钮纵向排布，导致底部操作区高度过大。
7. 管理任务与对话任务混杂：Deliverables、Prompt、Repository Context、System State 的入口分散，且产物这种 Feature/Stage 强绑定能力容易被误归类为全局治理能力。

## 当前功能面

Snail Shell Web UI 当前至少承载以下功能面。布局设计必须覆盖这些功能，但不应把它们全部堆进同一侧栏。

| 层级 | 功能面 | 用户任务 | 新布局归属 |
| --- | --- | --- | --- |
| 一级 | 工作台 | 围绕 Project/Feature/Stage/Conversation 协作 | 全局顶部导航 `Workspace` |
| 一级 | 知识中心 | 浏览知识库、待审批知识、当前项目知识 | 全局顶部导航 `Knowledge` |
| 一级 | 治理与配置 | 查看 Prompt、System State、Runtime 等跨 feature 治理和诊断信息 | 全局顶部导航 `Governance` |
| 工作台二级 | Project/Feature 选择 | 选择当前工作对象、新建/归档 Feature | 左侧对象栏 |
| 工作台二级 | Stage/Conversation 选择 | 切换阶段对话、查看待处理 mention | 左侧对象栏的 Stage/Conversation 区 |
| 工作台主路径 | Conversation | 阅读消息、发送消息、回复、@ snail、中断运行 | 中央对话画布 |
| 工作台辅助 | Stage 状态 | 查看当前阶段、交付要求、下一步、参与者 | 顶部上下文条和右侧详情抽屉 |
| 工作台辅助 | Deliverables | 创建 artifact、设为正式交付、查看产物 | Workspace 的 Feature/Stage 详情面板 |
| 治理 | Prompt Center | 搜索 prompt、按 target 浏览、查看详情 | Governance 工作区 |
| 工作台辅助 | Repository Context | 记录当前 Feature 的分支、worktree、PR | Workspace 的 Feature 详情面板 |
| 治理 | System State | 查看 dispatch/bus 诊断 | Governance 工作区 |
| 消息内容 | 结构化问题 | 查看 question 并提交 question_response | 中央对话画布中的高优先级卡片 |

## 设计原则

1. 一级功能横向分层：`Workspace`、`Knowledge`、`Governance` 是一级入口，不堆在左侧栏中段。
2. 工作流对象纵向分层：Project、Feature、Stage、Conversation 是工作台内部层级，位于对象栏，不与一级入口混放。
3. 中央空间优先给对话：消息阅读、问题决策和输入闭环是 Workspace 主路径。
4. 顶部空间必须承载有效信息：全局导航、当前位置、状态摘要和高频动作应共享一条紧凑顶部栏，禁止大面积空白。
5. 单一事实单一位置：Project/Feature/Stage 的完整路径只在顶部上下文条展示一次；左侧列表只展示局部选择项，右侧详情只展示展开信息。
6. 右侧不常驻低价值摘要：右侧宽度应留给可操作详情、差异、产物、诊断或引用；纯摘要默认收起。
7. Composer 必须紧凑：输入框、发送、中断和快捷动作同一行组织，不允许发送按钮默认独占整行。
8. 借鉴成熟工作台模式：整体采用类似 GitHub / Linear / Slack / Notion 的“顶部一级导航 + 左侧对象列表 + 中央主工作区 + 按需详情面板”模式，而不是固定三栏信息堆叠。

## 新版桌面布局

新版桌面布局采用四层结构：顶部全局栏、左侧对象栏、中央工作画布、按需右侧详情面板。

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ Global Bar                                                                                   │
│ Snail Shell | Workspace | Knowledge | Governance        Search/Command   Sync  User/Runtime  │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ Context Bar                                                                                  │
│ Project: Snail Shell  /  Feature: ui布局优化...  /  Stage: 研发迭代 in_progress  [Next Step] │
├──────────────────────┬──────────────────────────────────────────────────────┬────────────────┤
│ Object Rail          │ Conversation Canvas                                  │ Detail Panel   │
│                      │                                                      │ (collapsible)  │
│ Project Switcher     │ ┌──────────────────────────────────────────────────┐ │                │
│ Feature List         │ │ Conversation Header                              │ │ Stage Detail   │
│ - active             │ │ title · default snail · participants · actions   │ │ Deliverables   │
│ - in review          │ └──────────────────────────────────────────────────┘ │ Repo Context   │
│ - archived           │                                                      │ References     │
│                      │ Mention / Decision Inbox                            │                │
│ Stage Strip          │                                                      │                │
│ [需求] [研发] [检视] │ ┌──────────────────────────────────────────────────┐ │                │
│                      │ │ Message Timeline                                  │ │                │
│ Conversation List    │ │ assistant / user / question / artifact refs       │ │                │
│ - current            │ │ process folded, final content prominent           │ │                │
│ - related            │ └──────────────────────────────────────────────────┘ │                │
│                      │                                                      │                │
│ Quick Create         │ ┌──────────────────────────────────────────────────┐ │                │
│                      │ │ Compact Composer                                  │ │                │
│                      │ └──────────────────────────────────────────────────┘ │                │
└──────────────────────┴──────────────────────────────────────────────────────┴────────────────┘
```

布局不变量：

1. `Global Bar` 只放一级入口和全局命令，不显示重复的 workspace 摘要卡片。
2. `Context Bar` 是当前工作路径的唯一完整展示位置，消除左上和右上重复信息。
3. `Object Rail` 只解决“我在哪个 Project/Feature/Stage/Conversation”问题，不承载 Knowledge 或 Governance 一级入口。
4. `Conversation Canvas` 是唯一主滚动区域，Composer 固定在画布底部。
5. `Detail Panel` 默认可收起；只有查看 Feature 信息、Stage 规则、Deliverables、Repo Context、引用详情或当前消息详情时打开。
6. 如果用户正在写消息，布局不得因右侧详情打开而导致 composer 重排或丢失输入状态。

## 一级导航

一级导航从左侧栏迁移到顶部全局栏。

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Snail Shell  Workspace  Knowledge  Governance      ⌘K Search   Status      │
└────────────────────────────────────────────────────────────────────────────┘
```

一级导航规则：

1. `Workspace` 是默认入口，承载项目协作和 conversation。
2. `Knowledge` 是知识中心一级入口，不应混入工作台左侧对象列表。
3. `Governance` 承载 Prompt Center、System State、Runtime 等跨 feature 治理/诊断能力，不承载当前 Feature 的产物链路。
4. 全局栏右侧可以放命令搜索、运行状态和账户/runtime 状态，利用当前页面上方中间空白。
5. 顶部不重复展示完整 Project/Feature/Stage 路径；该路径只进入 `Context Bar`。

## Workspace 视图

Workspace 是高频工作区，应当最大化对话空间，同时保留快速定位对象的能力。

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Context Bar: Project / Feature / Stage        pending @2   [Artifacts] [PR]  │
├───────────────────┬────────────────────────────────────────────┬─────────────┤
│ Object Rail       │ Conversation Canvas                        │ Detail      │
│                   │                                            │             │
│ Feature selector  │ Title: ui布局优化... · Implementation Snail│ Stage       │
│ Status filters    │ Participants: Boss, Implementation         │ checklist   │
│                   │                                            │             │
│ Stage strip       │ Decision Inbox: 1 question needs answer    │ Formal      │
│ [Dev] [Review]    │                                            │ artifacts   │
│                   │ Message Timeline                           │             │
│ Conversation list │                                            │ Repo / PR    │
│                   │ Compact Composer                           │             │
└───────────────────┴────────────────────────────────────────────┴─────────────┘
```

Workspace 规则：

1. 左侧 `Object Rail` 宽度应小于当前左侧栏，避免 Project、Feature、Conversation 三段等权堆叠。
2. Project 选择使用顶部或对象栏顶部的紧凑 switcher；不需要在列表和顶部同时展示完整信息。
3. Stage 用横向 strip 表示流程位置，Conversation 列表只展示当前 Stage 下对话。
4. Boss mention、待回答 question、运行中 snail 是“待办 inbox”，应在 Conversation Header 下方集中呈现。
5. Deliverables 与 PR 状态是当前 Feature/Stage 的工作上下文动作，可在 Context Bar 右侧以按钮/徽标出现，点击打开 Detail Panel。

## Compact Composer

Composer 采用 Slack/Linear 类似的紧凑输入栏：输入、发送、中断、附件/结构化动作在同一块中完成。

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Reply: Acceptance Snail · 这条评论需要处理...                         [x]    │
├──────────────────────────────────────────────────────────────────────────────┤
│ +  @  ┌──────────────────────────────────────────────────────┐  [中断] [发送] │
│       │ 输入消息，@ snail 指定目标；Shift+Enter 换行          │                │
│       └──────────────────────────────────────────────────────┘                │
│ mention suggestions / send disabled reason / keyboard hint                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

Composer 不变量：

1. 发送按钮与输入框同一行，位于输入框右侧。
2. 中断按钮与发送按钮同属右侧动作区，运行中才突出显示。
3. 左侧 `+` 可作为后续结构化动作入口，例如引用 artifact、生成 question_response、插入模板；本轮只定义布局位置。
4. `@` 是目标选择入口，和文本内 mention 互补，不强迫用户只靠输入 `@` 发现 snail。
5. mention suggestions 在输入框下方浮层或内联提示展示，不得把发送按钮挤到下一行。
6. Composer 最大高度受限；长文本在输入框内部滚动，不能吞掉消息列表。

## Conversation Canvas

Conversation Canvas 应类似 Slack thread + GitHub timeline 的结合：按时间阅读，同时能区分正文、过程、决策和产物引用。

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Conversation Header                                                          │
│ title · stage · default snail · participants       [New Artifact] [Context]  │
├──────────────────────────────────────────────────────────────────────────────┤
│ Decision Inbox                                                               │
│ [Question] 需要 Boss 决策: UI 一级导航方案                                    │
├──────────────────────────────────────────────────────────────────────────────┤
│ Timeline                                                                     │
│                                                                              │
│ 09:12 Implementation Snail                                                   │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ Final answer / Message Out / Markdown                                    │ │
│ │ [Process 8 events folded] [Artifacts 1] [Reply]                          │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│ 09:15 Boss Snail                                                             │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ user message                                                             │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

消息呈现规则：

1. assistant 消息默认突出最终内容，过程事件折叠为一行摘要。
2. question、error、interrupted、failed 不能被折叠到不可见区域。
3. 工具和命令输出默认摘要，详情可展开或进入右侧 Detail Panel。
4. Artifact/reference/table/chart 等结构化内容用卡片表示，卡片应能打开详情，而不是把所有内容铺在 timeline 中。
5. 用户消息不需要占据过大的气泡宽度；短消息紧凑显示，长消息进入正文卡片。

## Detail Panel

右侧 Detail Panel 是 Workspace 内按需打开的详情区，不再常驻展示重复摘要。它承载当前 Feature、Stage、Conversation 或 Message 的上下文详情，不是全局 Governance 的替代入口。

```text
┌──────────────────────────────────────────────┐
│ Detail Panel                            [x]  │
├──────────┬────────────┬──────────┬──────────┤
│ Feature  │ Stage      │ Artifacts│ Message  │
├──────────┴────────────┴──────────┴──────────┤
│ 当前 tab 的详情、表单、诊断或引用内容          │
└──────────────────────────────────────────────┘
```

Detail Panel 规则：

1. `Feature` 显示当前 Feature 摘要、状态、Repository Context、branch、worktree 和 PR。
2. `Stage` 显示阶段契约、参与 snail、正式交付要求和推进动作。
3. `Artifacts` 显示当前 Stage 的产物创建表单、正式交付选择和产物列表。
4. `Message` 显示选中消息的完整事件、工具输出、引用关系或上下文。
5. Detail Panel 可由 Context Bar、消息卡片、artifact 卡片或快捷键打开。
6. Detail Panel 关闭后，中央对话宽度恢复，避免长期牺牲阅读空间。
7. Artifacts/Deliverables 必须始终追溯到当前 Feature/Stage，禁止作为全局 Governance 资源脱离工作流上下文管理。

## Knowledge 视图

Knowledge 是一级工作区，采用“列表 + 详情 + 审批动作”的高密度布局。

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Global Bar: Snail Shell | Workspace | Knowledge(active) | Governance          │
├──────────────────────────────────────────────────────────────────────────────┤
│ Knowledge Toolbar: [Library] [Candidates] [Project Knowledge]  Search  Filter │
├──────────────────────────────┬───────────────────────────────────────────────┤
│ Knowledge List               │ Knowledge Detail                              │
│ status / scope / snippet     │ content / rationale / sources / usage policy  │
│                              │ [Approve] [Reject] [Deprecate]                │
└──────────────────────────────┴───────────────────────────────────────────────┘
```

Knowledge 规则：

1. Knowledge 不复用 Workspace 的对象栏，避免项目协作导航干扰知识治理。
2. `Library`、`Candidates`、`Project Knowledge` 是 Knowledge 内部二级 tab。
3. 审批动作靠近详情，不放在列表行的次要角落。
4. 当前 Project 只作为过滤条件或 scope，不在 Knowledge 页面重复展示完整 Workspace 摘要。

## Governance 视图

Governance 聚合跨 feature 的低频治理、配置和诊断任务，避免这些任务散落在 Workspace 左侧或右侧。它不承载当前 Feature/Stage 的产物管理，因为产物是阶段交付链路的一部分，必须留在 Workspace 上下文中。

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Global Bar: Snail Shell | Workspace | Knowledge | Governance(active)          │
├──────────────────────────────────────────────────────────────────────────────┤
│ Governance Nav: Prompt Center | System State | Runtime | Config             │
├──────────────────────┬───────────────────────────────────────────────────────┤
│ Section List / Filter│ Detail                                                │
│ target groups        │ prompt content / dispatch groups / runtime config     │
└──────────────────────┴───────────────────────────────────────────────────────┘
```

Governance 规则：

1. Prompt Center 不应只是侧栏 footer 按钮；它属于治理一级工作区中的主要 section。
2. System State 是诊断能力，不应和 conversation 主路径并列展示。
3. Repository Context 是当前 Feature 的仓库上下文，完整管理归入 Workspace 的 Feature Detail Panel；Governance 可以提供跨 feature 的诊断视图，但不能成为产物或当前 Feature 仓库上下文的主编辑入口。
4. Deliverables/Artifacts 是当前 Stage 正式交付链路，禁止放入 Governance 一级工作区。
5. Governance 页面允许高密度表格、过滤器、详情阅读，不受 conversation composer 约束。

## 空间利用与去冗余规则

后续实现必须遵守以下空间规则：

1. 顶部两行以内必须完成一级导航、当前位置和关键动作；禁止顶部中间长期空白。
2. 完整 workspace 路径只出现一次，默认在 Context Bar。
3. 左侧栏不展示与 Context Bar 重复的 Project/Feature/Stage 摘要，只展示可切换对象。
4. 右侧栏默认不常驻纯摘要；纯摘要进入 Context Bar，详情按需打开。
5. 列表项默认两行内完成标题、状态和关键徽标，长文本进入 tooltip、详情或展开态。
6. 高频动作靠近对象：发送靠近输入框，Artifact 靠近当前 Stage/Deliverables Detail Panel，PR/Repo 靠近 Feature 上下文。
7. 低频但仍绑定当前 Feature/Stage 的动作进入 Workspace Detail Panel，不进入 Governance。
8. 只有跨 feature、跨项目或系统级治理/诊断动作进入 Governance，不能用 Governance 吸收 Feature/Stage 产物链路。

## 响应式兼容边界

本文档不把移动端作为本轮设计目标，但桌面 Web 实现不能故意破坏窄屏可用性。

窄屏兼容原则：

1. 宽度不足时，先收起 Detail Panel，再压缩 Object Rail。
2. 如果 Object Rail 收起，必须保留 Project/Feature/Conversation 的切换入口。
3. Composer 仍保持输入与发送同组呈现；极窄宽度下可以使用短文案或图标，但不应恢复为发送按钮整行占位。
4. 移动端专属导航、手势、底部 tab 等不在本文档范围内。

## 后续实现检查点

后续 UI 实现或重构必须至少检查以下事项：

1. 是否建立顶部一级导航，并将 `Workspace`、`Knowledge`、`Governance` 从左侧混合入口中分离。
2. 是否消除 Workspace 信息在左上、顶部、右侧的重复展示。
3. 是否提升顶部中间区域的信息密度，承载当前位置、状态和高频动作。
4. 是否将右侧常驻摘要改为按需 Detail Panel。
5. 是否将 composer 改为输入框、发送、中断同组同行的紧凑布局。
6. 是否保留 Project/Feature/Stage/Conversation 的快速定位能力。
7. 是否让 Knowledge 和 Governance 成为清晰的一级工作区，而不是 Workspace 侧栏里的附属按钮。
8. 是否保证 Deliverables/Artifacts 始终绑定当前 Feature/Stage，并通过 Workspace Detail Panel 管理。
9. 是否保证 question、error、running、interrupted 等关键状态在 timeline 中可见。

## 非目标与开放边界

本文档暂不规定：

1. 移动端专属 UI 设计与实现。
2. 最终视觉主题、品牌插画或图标体系。
3. 具体 CSS class 命名。
4. 是否使用原生 DOM、Web Components、React 或其他前端框架。
5. 具体断点数值，除非后续实现需要把断点固化为测试契约。

以上内容可以在后续 feature 中继续细化，但不得破坏本文档已定义的信息架构、功能分层、空间利用和去冗余不变量。
