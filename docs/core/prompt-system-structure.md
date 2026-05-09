# 系统提示词结构设计

## 定位

本文档定义 Snail Shell 系统提示词的语义结构原则。它用于判断一段提示词规则应归属到哪里、如何避免重复和冲突、如何在 Prompt Center 中解释提示词组成。

本文档只描述长期模型和归属规则，不描述本轮实现步骤，不定义运行时装配顺序，不替代 `.meta/prompts/` 的具体内容、skill 正文、知识治理实现或 Stage 定义。

## 分类定义

### 第一层：AI Base System Prompt（AI 基础系统提示词）

归属规则：只要一条规则对所有 Snail 底层 AI 都成立，且不依赖 Project、Feature、Stage、Conversation 或 Task，就归入该分类。

属于：

1. 用户决策边界。
2. 事实与上下文使用边界。
3. 结构化消息协议。
4. skill reference 的基础使用边界。
5. 提示词治理和知识治理的基础边界。
6. 获取更早对话事实的能力入口使用边界；如果该入口以 skill 形式提供，则按 skill reference 处理，不另立“历史访问”分类。

不属于：

1. 当前 Project、Feature、Stage 或 Conversation 的实例事实。
2. 某角色在某 Stage 的行动手册。
3. 后台任务的输入输出格式。
4. 只服务项目推进场景的代码仓、PR、测试或文档规则。

示例：

1. “需要用户明确决策时，不得擅自替用户做决定”。
2. “系统提示词只引用 skill 能力边界，不复制 skill 正文”。

### 第二层：Scenario System Prompts（场景系统提示词）

归属规则：只要一组提示词描述某类 AI 调用的上下文结构、任务边界或行为模型，就归入该分类。场景提示词共享 AI 基础系统提示词，但不重复基础契约。

属于：

1. 项目推进会话。
2. 后台任务或专用运行时。
3. 未来非项目闲聊或问答场景。

不属于：

1. 所有 AI 都必须遵守的基础契约。
2. 某个场景内部的单条事实。
3. skill 正文。

示例：

1. `Project Conversation Prompt（项目推进会话提示词）`。
2. `Task Runtime Prompts（任务运行时提示词）`。
3. `Chat Prompt（闲聊提示词，预留）`。

#### Project Conversation Prompt（项目推进会话提示词）

归属规则：只要一组提示词服务 Project、Feature、Stage 和多 Snail 协作推进，就归入该分类。它由 `Work Context（工作上下文）` 和 `Stage Role Playbook（阶段角色行动手册）` 组成，并共享 `AI Base System Prompt（AI 基础系统提示词）`。

属于：

1. 当前 Project、Feature、Stage、Conversation 和参与者事实。
2. 当前角色在当前 Stage 的行动手册。
3. 项目推进所需的正式产物和可追溯要求。

不属于：

1. 与项目推进无关的闲聊规则。
2. 后台任务独立输入输出格式。
3. 所有 AI 都必须遵守的基础契约。

示例：

1. 研发迭代会话的 Feature、Stage、PR 和参与 Snail 信息。
2. 检视阶段中 Implementation Snail 如何处理 Acceptance Snail 的检视意见。

##### Work Context（工作上下文）

归属规则：只要内容是项目推进当前调用的实例事实，就归入该分类，并按事实类型继续拆分。

属于：

1. `Project Scope（项目范围）`：当前 Project 的名称、摘要和边界。
2. `Feature Scope（Feature 范围）`：当前 Feature 的标题、状态、分支、worktree 和 PR。
3. `Stage Scope（Stage 范围）`：当前 Stage 的输入、输出产物要求和验收关注点。
4. `Conversation Scope（Conversation 范围）`：当前 Conversation 的标题、类型、来源和摘要。
5. `Participant Scope（参与者范围）`：当前响应 Snail、默认 Snail、参与 Snails 和 mention 边界。

不属于：

1. AI 基础契约。
2. skill 使用规则。
3. 角色阶段行动规则。
4. 知识自身的长期分类。
5. 未经确认的推断。

示例：

1. “当前 Feature PR 是 https://github.com/...”。
2. “当前 Stage 输出产物要求是 pull_request_record”。

##### Stage Role Playbook（阶段角色行动手册）

归属规则：只要内容描述某角色在某 Stage 应该如何判断、行动和收口，就归入该分类。角色行为必须绑定 Stage，不维护脱离 Stage 的大段角色行为清单。

属于：

1. `Implementation Snail / development`。
2. `Implementation Snail / review`。
3. `Acceptance Snail / review`。
4. `Boss Snail / decision point`。
5. PR 评论签名、代码注释、测试覆盖、检视留痕等只在特定角色执行特定 Stage 动作时有意义的规则。

不属于：

1. 当前 Feature 的 PR URL 或 worktree 路径。
2. 所有 AI 都必须遵守的基础规则。
3. 不依赖 Stage 的泛化角色介绍。

示例：

1. “Implementation Snail 在 review 阶段必须先理解检视意见的问题本质，再判断修复方式”。
2. “Acceptance Snail 在 review 阶段必须把发现的问题留在 PR 评论中”。

#### Task Runtime Prompts（任务运行时提示词）

归属规则：只要提示词服务后台任务或专用运行时，而不是面向 Snail 参与的项目推进会话，就归入该分类。它描述任务输入、处理规则、输出格式和边界。

属于：

1. mention extractor。
2. conversation summary。
3. 后续单一后台任务 prompt。

不属于：

1. Project、Feature、Stage 和多 Snail 协作上下文。
2. 研发者或检视者的阶段行动手册。
3. PR、worktree 或正式产物要求，除非该任务明确需要这些输入。

示例：

1. `task.mention-extractor.system`。
2. `task.conversation-summary.system`。
3. mention extractor 只需要识别提及语义和输出结构，不需要 PR、worktree 或 Stage 产物要求。

#### Chat Prompt（闲聊提示词，预留）

归属规则：只要提示词服务未来非项目推进会话，就归入该分类。它共享 AI 基础系统提示词，但不注入 Project、Feature、Stage、PR、worktree 或正式产物要求。

属于：

1. 普通问候。
2. 非项目问题回答。
3. 不需要正式产物追踪的轻量对话。

不属于：

1. 项目推进协作。
2. 后台任务。
3. 需要 Feature、Stage 或 PR 追踪的工作。

示例：

1. “解释一个通用概念”。
2. “不进入 Feature 工作流的普通交流”。

## 现有文件映射规则

规则：现有文件无需立刻重命名，但后续整理时必须按语义归属拆分，不能继续因为现有目录或 target 把多种职责混在一个文件中。

示例：

1. `.meta/prompts/scene/conversation/SYS-CONV-GLOBAL-global.md` 中的 AI 通用规则应归入 `AI Base System Prompt（AI 基础系统提示词）`；仍绑定项目推进的内容应归入 `Project Conversation Prompt（项目推进会话提示词）`。
2. `.meta/prompts/scene/conversation/SYS-CONV-PROJECT-project-context.md` 应归入 `Project Conversation Prompt / Work Context / Project Scope`。
3. `.meta/prompts/scene/conversation/SYS-CONV-FEATURE-feature-context.md` 应归入 `Project Conversation Prompt / Work Context / Feature Scope`。
4. `.meta/prompts/scene/conversation/SYS-CONV-STAGE-stage-context.md` 应归入 `Project Conversation Prompt / Work Context / Stage Scope`。
5. `.meta/prompts/scene/conversation/SYS-CONV-CONVERSATION-conversation-context.md` 应归入 `Project Conversation Prompt / Work Context / Conversation Scope`。
6. `.meta/prompts/scene/conversation/SYS-CONV-SNAIL-snail-context.md` 应归入 `Project Conversation Prompt / Work Context / Participant Scope`。
7. `.meta/prompts/scene/conversation/SYS-CONV-HISTORY-history-access.md` 如果只是描述历史能力入口，应归入 `AI Base System Prompt（AI 基础系统提示词）` 的 skill reference 规则；如果未来实现为 skill，应改为 skill reference，而不是单独保留历史访问分类。
8. `.meta/prompts/scene/conversation/SYS-CONV-KNOWLEDGE-CANDIDATE-knowledge-candidate.md` 中的知识治理基础边界应归入 `AI Base System Prompt（AI 基础系统提示词）`；特定角色阶段触发要求应归入 `Stage Role Playbook（阶段角色行动手册）`。
9. `.meta/prompts/scene/snails/*.md` 是角色基础资料，只能作为 `Stage Role Playbook` 的输入材料，不能替代 stage-specific playbook。
10. `.meta/prompts/global/roles/*.md` 应归入 `Project Conversation Prompt / Stage Role Playbook`。
11. `.meta/prompts/global/scenarios/*.md` 必须继续拆分：AI 通用治理进入 `AI Base System Prompt`，项目推进中角色阶段行为进入 `Stage Role Playbook`。
12. `.meta/prompts/scene/tasks/*.md` 应归入 `Task Runtime Prompts（任务运行时提示词）`。
13. `AGENTS.md` 是双线生效期间的长期规则入口，需要与对应语义归属保持一致。

## 维护规则

### 单一主归属

规则：一条长期规则只能有一个主归属。其他位置如需提及，只能引用或摘要，不复制完整规则。

示例：

1. “不得复制 skill 正文”属于 `AI Base System Prompt`；某个场景提示词可以引用该约束，但不应复制一份不同写法。
2. “Implementation Snail 在 review 阶段处理检视意见”属于 `Stage Role Playbook`；角色 profile 不应再维护另一套完整行为清单。

### 事实与行为分离

规则：事实输入进入 `Work Context`，行动要求进入 `Stage Role Playbook`。

示例：

1. “当前 Stage 是研发迭代”是事实，进入 `Stage Scope`。
2. “研发迭代阶段需要完成实现、自检并提交 PR”是行动要求，进入 `Stage Role Playbook`。

### 能力引用与能力正文分离

规则：系统提示词只引用能力，不内嵌能力正文。历史查询如果是能力入口，应与 skill references 使用同一抽象处理。

示例：

1. `message-out` 的完整命令和协议细节保留在 `.meta/skills/message-out/SKILL.md`。
2. 系统提示词只说明何时必须使用 `message-out`，以及不能手写旧格式。
3. 如果 conversation history 后续以 skill 形式提供，系统提示词只保留 skill reference，不再维护独立历史访问分类。

### 知识按生效方式归属

规则：知识不形成独立提示词分类。知识进入系统提示词时，必须说明它以哪种方式生效，并归入对应分类。

示例：

1. 全局规则型知识进入 `AI Base System Prompt`。
2. 当前事实型知识进入对应 `Work Context` 子块。
3. 角色阶段经验型知识进入 `Stage Role Playbook`。
4. 后台任务规则型知识进入 `Task Runtime Prompts`。

### 双线规则一致

规则：`AGENTS.md` 与 `.meta/prompts/` 双线生效期间，同类强约束必须保持语义一致。

示例：

1. 如果 `.meta/prompts/` 调整了提示词治理规则，必须检查 `AGENTS.md` 是否存在冲突或漂移。
2. 如果后续决定从 `AGENTS.md` 删除重复规则，必须先确认系统提示词已覆盖同等约束。

### Prompt Center 不定义模型

规则：Prompt Center 只能展示语义阅读模型和运行时装配结果，不能为了展示方便新增不真实的 prompt 层或 project 静态副本。

示例：

1. Project 级事实应表达为当前 Project 的运行时注入，不应伪造成每个 Project 都有一份静态 prompt 文件副本。
2. 知识可以展示其生效归属，但不应展示为独立系统提示词分类。
