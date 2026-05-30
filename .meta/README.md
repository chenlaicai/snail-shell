# .meta

## 目录含义

`.meta/` 用于存放 Snail Shell 的系统规范文件。

这些文件不是业务运行数据，也不是用户工作产物，而是系统启动和运行所依赖的内置规则定义。

`.meta/` 存放的是系统规范源，而不是项目实例数据。

## 文件边界

本目录下的文件分为两类：

1. 结构化系统配置
2. 提示词、模板与 skill 资产

README 只负责说明：

1. 各文件负责什么
2. 各文件的数据格式是什么
3. 各字段的含义是什么

README 不负责重复记录某个文件里的具体内容。

## 当前文件

### 1. `workspace-config-seed.json`

系统内置项目的种子配置，启动时加载到数据库。

它负责表达：

1. 项目定义（id、kind、name、summary）
2. Stage 定义（key、title、sequence、输入输出描述、验收要点）
3. 角色定义（name、snail_template_id、is_primary、description、working_rules）

#### 数据格式

```json
{
  "workspace": { "id": "...", "kind": "system_self", "name": "...", "summary": "..." },
  "stage_definitions": [
    {
      "id": "...",
      "key": "development",
      "title": "研发迭代",
      "sequence": 1,
      "input_description": null,
      "output_description": "...",
      "acceptance_focus": ["..."],
      "roles": [
        {
          "id": "...",
          "name": "研发者",
          "snail_template_id": "opencode-default",
          "is_primary": true,
          "description": "...",
          "working_rules": ["..."]
        }
      ]
    }
  ]
}
```

### 2. `prompts/`

用于定义所有会进入 system prompt 的提示词文档和组装架子。

这些文档统一由同一个 Prompt Registry 扫描、缓存和构造。

当前目录结构：

1. `prompts/_template-prompt.md`
   提示词文档模板
2. `prompts/_template-frame.md`
   架子文档模板
3. `prompts/prompts/`
   存放提示词内容文档（B-01、S-03 等）
4. `prompts/frames/`
   存放组装架子文档（F-01、F-02 等）

#### 提示词文档格式

提示词文档只声明内容，不声明生效条件：

1. `---` 包裹的 YAML frontmatter，包含 `id`、`title`
2. Markdown 正文，包含规则内容

生效条件由架子文件统一管理。

#### 架子文档格式

架子文档是系统提示词的模板：

1. `---` 包裹的 YAML frontmatter，包含 `id`、`title`、`type: frame`
2. Markdown 正文即系统提示词骨架，支持以下模板标记：
   - `{{prompt:ID}}`：嵌入提示词内容
   - `{{#when:field=value}}...{{/when}}`：条件段落
   - `{{#if:var}}...{{/if}}`：变量条件段落
   - `{{variable}}`：变量替换

#### prompt id 编号规则

prompt id 使用 `{layer_prefix}-{module_number}` 格式，layer_prefix 表示生效模式，module_number 表示模块编号：

1. `B-01` ~ `B-99`：Base 层模块（始终注入）。
2. `S-01` ~ `S-99`：Scenario 层模块（条件注入）。

示例：

1. `B-01` 表示 Base 层第 1 个模块（身份与责任契约）。
2. `S-01` 表示 Scenario 层第 1 个模块（项目上下文）。
3. `S-03` 表示 Scenario 层第 3 个模块（研发者手册）。

模块内规则以 `- ` 开头，直接描述约束内容，不再使用统一编号。

文件名和 `title` 继续承载语义说明；`id` 只表达稳定编号。

prompt 文件名必须以 `id-` 开头并包含简短可读标题，例如 `S-02-历史能力.md`。目录负责表达所属层级，文件名负责稳定排序、定位和快速识别，`title` 负责表达完整语义。

#### prompt 条数约束

每条 prompt 只表达一个稳定模块的职责。单次会话注入的 prompt 总数受架构约束：

1. **Base 层**：不超过 3 条（当前 B-01、B-02、B-03）。
2. **Project/Scenario 层**：单次会话不超过 3 条（含角色手册注入）。当前项目推进对话为 S-01 + S-02 + 角色手册（S-03/S-04）= 3 条。

总条数目标 3+3=6。超出此数时，应优先将次级约束移入 prompt-constraints skill 或知识库，而非新增 prompt 文件。

此约束的合理性：
- Base 层三条覆盖正交的三类通用规则：身份行为、知识治理触发、平台边界
- Scenario 层三条覆盖正交的三类上下文规则：当前工作锚点、能力引用入口、角色行为手册
- 6 条之上每增加一条，边际收益下降而上下文压力上升
- 次级约束通过渐进式披露（skill / 知识库）按需查阅，不始终占用上下文

#### prompt 写法要求

系统提示词不是普通制度文档，也不是设计文档的上下文备份。prompt 正文只包含 AI 必须执行的行为规则。

编写或调整 prompt 时必须遵守：

1. 先判断规则归属，再编辑文件；不能只依据当前现象、用户表述或待修改文件位置直接放入 Base 层。
2. 对所有 Snail 底层 AI 都成立、且不依赖 Project、Feature、Stage、Conversation 或 Task 的规则，才放入 `B-` Base 模块。
3. 描述某类上下文结构、角色行动手册或后台任务行为的规则，放入 `S-` Scenario 模块，并由 frame 管理生效条件。
4. 提示词文件只声明内容，不声明生效条件；生效条件只写在 frame 文件中。
5. 一条规则只能有一个主归属；重复规则应合并到最稳定、最贴近责任边界的位置。
6. 一条 bullet 只表达一个稳定约束；触发条件、行动、例外或禁止项混杂时应拆分。
7. 规则必须写成可执行判断或行动，不写抽象口号、说服性论述、PR 解释或单次 feature 过程。
8. 拆分文件时不能让模型必须跨多个短文件才能理解一个完整判断流程。
9. Base 层不超过 3 条，Scenario 层单次会话不超过 3 条（含角色手册）。超出此数时优先将次级约束移入 prompt-constraints skill 或知识库。
10. 调整提示词时必须判断是否需要同步 `.meta/prompt-evaluations/`、评估 runner 或相关测试。
11. 评估提示词效果时，必须分别考虑 `opencode-cli`、`claude-code-cli`、`codex-cli`，不能把多个 runtime 混成单一结论。

### 5. `skills/`

用于定义独立 skill 能力包。

skill 不属于 prompt 体系，而是独立体系，由单独的 Skill Registry 扫描和缓存。

每个 skill 都必须是一个目录，目录入口为 `SKILL.md`，格式遵循 Claude Code / Agent Skills 规范。

当前结构：

1. `skills/SKILL.md.template`
   skill 模板
2. `skills/<skill-name>/SKILL.md`
   某个 skill 的入口文件
3. `skills/<skill-name>/...`
   可选附属文件，例如脚本、模板、参考文档、样例

#### skill 与 prompt 的关系

1. skill 是独立能力包，不是 prompt 正文的一部分
2. prompt 可以引用 skill，并声明何时必须使用该 skill
3. 如需描述 skill 详细步骤、命令、支持文件，应写在 skill 自己目录中的 `SKILL.md`，而不是复制进 prompt 文档
4. 只有纯自然语言约束、长期角色边界或流程规则时，应放入 prompt，不应注册为 skill
5. skill 依赖的脚本、模板和样例必须放在同一 skill 目录下，保持能力包自包含

### 6. `templates/`

用于存放系统流程中需要被多个角色稳定引用的文本模板。

模板文件只记录可直接复用的格式、适用范围和使用规则；角色何时必须使用模板仍由 `.meta/prompts/` 中对应角色手册约束。

当前模板：

1. `templates/pr-comment-signature.md`
   定义研发者和检视者写入 GitHub PR 普通评论时的"评论正文 + 空行 + 独立签名末行"模板。

## 文件之间的关系

### `stages.json`、`snails.json` 与 `artifacts.json`

这三者共同定义系统结构配置：

1. `stages.json`
   定义阶段规范
2. `snails.json`
   定义 snail 规范
3. `artifacts.json`
   定义 artifact type 规范

### `prompts/`、`templates/` 与 `skills/`

1. `prompts/`
   定义会进入 system prompt 的提示词文档
2. `skills/`
    定义独立 skill 能力包
3. `templates/`
   定义可被 prompt 或人工流程引用的稳定文本模板

prompt 可以引用 skill，但 skill 不属于 prompt 文档。

## 与业务数据的区别

`.meta/` 中的文件不是项目运行数据。

例如：

1. workspace 实例不存这里
2. stage 实例不存这里
3. conversation 不存这里
4. artifact 不存这里
5. message 不存这里

这些都属于数据库中的运行时业务数据。

`.meta/` 只存放系统级稳定规范。

## 一句话总结

`.meta/` 存放的是：

`Snail Shell 启动和运行所依赖的稳定系统规范文件，以及这些规范文件的数据格式与边界说明。`
