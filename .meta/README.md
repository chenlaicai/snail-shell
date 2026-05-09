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

用于定义所有会进入 system prompt 的提示词文档。

这些文档统一由同一个 Prompt Registry 扫描、缓存、筛选和构造。

当前目录结构：

1. `prompts/prompt.md.template`
   所有 prompt 文档的统一模板
2. `prompts/base/`
   存放 AI 基础系统提示词
3. `prompts/scenarios/`
   存放项目推进会话、后台任务等场景提示词

#### `prompts/` 文档格式

所有 prompt 文档统一采用：

1. `---` 包裹的 JSON frontmatter
2. Markdown 正文

其中：

1. 文档正文负责自然语言提示词内容
2. frontmatter metadata 负责声明该文档适用于哪个 target、在提示词中的顺序、是否命中额外条件、语义层级以及该位置应引用哪些 skill
3. AI base、工作上下文、阶段角色手册、后台任务是语义分组，不是互相覆盖的兼容层
4. 各场景的提示词构造器会直接从 Prompt Registry 读取当前 target 下命中的文档，按 metadata 排序并构造最终提示词

#### prompt id 编号规则

prompt id 使用 `P<层级编号>`，编号按提示词语义树逐层展开，编号内部不使用横杆：

1. `P00XX`：AI Base System Prompt。
2. `P0101XX`：Project Conversation / Work Context。
3. `P0102XX`：Project Conversation / Stage Role Playbook。
4. `P02XX`：Task Runtime Prompts。

示例：

1. `P0001` 表示 AI Base 下第 1 条 prompt。
2. `P010101` 表示 Project Conversation / Work Context 下第 1 条 prompt。
3. `P010201` 表示 Project Conversation / Stage Role Playbook 下第 1 条 prompt。
4. `P0201` 表示 Task Runtime 下第 1 条 prompt。

文件名和 `title` 继续承载语义说明；`id` 只表达稳定编号，不再使用大片英文命名。

prompt 文件名必须以 `id-` 开头并包含简短可读标题，例如 `P010107-历史能力入口.md`。目录负责表达所属层级，文件名负责稳定排序、定位和快速识别，`title` 负责表达完整语义。

#### prompt 写法建议

1. 使用 Markdown 和短句重点表达
2. 不要写两三句的大长段解释
3. 尽量用 bullet 点出真正长期生效的重点

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
