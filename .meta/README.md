# .meta

## 目录含义

`.meta/` 用于存放 Snail Shell 的系统规范文件。

这些文件不是业务运行数据，也不是用户工作产物，而是系统启动和运行所依赖的内置规则定义。

`.meta/` 存放的是系统规范源，而不是项目实例数据。

## 文件边界

本目录下的文件分为两类：

1. 结构化系统配置
2. 提示词与 skill 资产

README 只负责说明：

1. 各文件负责什么
2. 各文件的数据格式是什么
3. 各字段的含义是什么

README 不负责重复记录某个文件里的具体内容。

## 当前文件

### 1. `stages.json`

用于定义固定 stage type 的系统规范。

它负责表达：

1. 每种 stage type 的显示名称
2. 每种 stage type 的正式交付要求
3. 每种 stage type 的固定参与 snails
4. 每种 stage type 是否默认涉及代码仓

#### 数据格式

```json
{
  "<stage_type>": {
    "order": 1,
    "title": "<display title>",
    "repo_related": false,
    "formal_artifact_types": ["<artifact_type>", "..."],
    "snails": ["<snail_name>", "..."],
    "input": ["<artifact_type>", "..."],
    "output": {
      "summary": "<text>",
      "required_artifacts": ["<artifact_type>", "..."],
      "artifact_requirements": ["<text>", "..."]
    },
    "acceptance_focus": ["<text>", "..."]
  }
}
```

### 2. `snails.json`

用于定义系统内置 snail。

它负责表达：

1. snail 是谁
2. snail 的能力要求
3. snail 的工作方式要求
4. snail 偏好的正式产物类型

#### 数据格式

```json
{
  "<snail_name>": {
    "description": "<text>",
    "runtime": "claude-code-cli",
    "capability_expectations": ["..."],
    "working_rules": ["..."],
    "preferred_artifact_types": ["..."]
  }
}
```

### 3. `artifacts.json`

用于定义系统内置 artifact type。

它负责表达：

1. artifact type 是什么
2. artifact type 的显示名称是什么
3. artifact type 默认偏向的存储方式是什么
4. artifact type 是否可以作为正式交付物

### 4. `prompts/`

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

1. `---` 包裹的 YAML frontmatter，包含 `id`、`title`、可选 `skill_references`
2. Markdown 正文，包含规则内容

生效条件由架子文件统一管理。

#### 架子文档格式

架子文档是系统提示词的模板：

1. `---` 包裹的 YAML frontmatter，包含 `id`、`title`、`type: frame`、可选 `when`
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

模块内规则使用 `R01`, `R02` 等编号，引用格式为 `B-01-R03` 或 `S-03-R15`。

文件名和 `title` 继续承载语义说明；`id` 只表达稳定编号。

prompt 文件名必须以 `id-` 开头并包含简短可读标题，例如 `S-02-历史能力.md`。目录负责表达所属层级，文件名负责稳定排序、定位和快速识别，`title` 负责表达完整语义。

#### prompt 写法建议

prompt 正文写法必须遵循 `docs/core/prompt-system-structure.md` 中的系统提示词文档编写规范。

`.meta/README.md` 只说明 prompt 文件格式、编号和目录边界，不复制完整编写规范，避免 `.meta/README.md` 与 core 规范长期漂移。

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

## 文件之间的关系

### `stages.json`、`snails.json` 与 `artifacts.json`

这三者共同定义系统结构配置：

1. `stages.json`
   定义阶段规范
2. `snails.json`
   定义 snail 规范
3. `artifacts.json`
   定义 artifact type 规范

### `prompts/` 与 `skills/`

1. `prompts/`
   定义会进入 system prompt 的提示词文档
2. `skills/`
   定义独立 skill 能力包

prompt 可以引用 skill，但 skill 不属于 prompt 文档。

## 与业务数据的区别

`.meta/` 中的文件不是项目运行数据。

例如：

1. project 实例不存这里
2. stage 实例不存这里
3. conversation 不存这里
4. artifact 不存这里
5. message 不存这里

这些都属于数据库中的运行时业务数据。

`.meta/` 只存放系统级稳定规范。

## 一句话总结

`.meta/` 存放的是：

`Snail Shell 启动和运行所依赖的稳定系统规范文件，以及这些规范文件的数据格式与边界说明。`
