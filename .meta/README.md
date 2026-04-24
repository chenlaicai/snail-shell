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

#### 数据格式

```json
{
  "<stage_type>": {
    "order": 1,
    "title": "<display title>",
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
4. snail 对应哪份 prompt 文档资产

#### 数据格式

```json
{
  "<snail_name>": {
    "description": "<text>",
    "runtime": "claude-code-cli",
    "capability_expectations": ["..."],
    "working_rules": ["..."],
    "preferred_artifact_types": ["..."],
    "system_prompt_asset": "<prompt-id>"
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
2. `prompts/scene/`
   存放与当前场景、当前系统、当前 agent 直接相关的提示词文档
3. `prompts/global/`
   存放通用类提示词文档，会按当前角色与场景命中后插入 system prompt

#### `prompts/` 文档格式

所有 prompt 文档统一采用：

1. `---` 包裹的 JSON frontmatter
2. Markdown 正文

其中：

1. 文档正文负责自然语言提示词内容
2. frontmatter metadata 负责声明该文档适用于哪个 target、在提示词中的顺序、是否命中额外条件、是否在该位置注入命中的通用 prompt、以及该位置应引用哪些 skill
3. 通用类 prompt 与场景类 prompt 只是内容分组，不是两套加载模块
4. 各场景的提示词构造器会直接从 Prompt Registry 读取当前 target 下命中的文档，按 metadata 排序并构造最终提示词

#### 通用类 prompt 与场景类 prompt

1. `scene/`
   放当前场景、当前系统、当前 agent 相关的提示词文档
2. `global/`
   放跨场景复用的通用类提示词文档

两者都属于 prompt 文档，只是内容用途不同。

通用类 prompt 建议：

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
