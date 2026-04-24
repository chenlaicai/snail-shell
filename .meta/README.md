# .meta

## 目录含义

`.meta/` 用于存放 Snail Shell 的系统规范文件。

这些文件不是业务运行数据，也不是用户工作产物，而是系统启动和运行所依赖的内置规则定义。

换句话说：

`.meta/` 存放的是系统规范源，而不是项目实例数据。

## 文件边界

本目录下的每个文件都应只负责一种稳定规范。

README 只负责说明：

1. 各文件负责什么
2. 各文件的数据格式是什么
3. 各字段的含义是什么

README 不负责重复记录某个文件里的具体内容。

例如：

1. 可以说明 `stages.json` 定义 stage 规范以及字段含义
2. 不应在 README 中重复列出当前具体有哪些 stage

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

#### 字段说明

##### 顶层 key

表示一个 `stage type`。

##### `title`

表示该 stage type 的显示名称。

##### `order`

表示该 stage type 在固定阶段链中的顺序位置。

这个字段用于让系统从规范源中推导“下一个 stage 是什么”，避免在代码中单独硬编码阶段顺序。

##### `formal_artifact_types`

表示该 stage type 对应的正式交付 artifact type 要求。

##### `snails`

表示该 stage type 的固定参与 snail 集合。

当前运行时实现中，列表中的第一个 snail 会作为该阶段 conversation 的主 snail。

##### `input`

表示该 stage 的输入要求。

当前阶段先采用简化形式：使用 artifact type 数组表达该阶段应接收什么类型的输入。

其中：

1. `init` 阶段的 `input` 应为空数组
2. 其他阶段的 `input` 由当前固定规则直接写死

##### `output`

表示该 stage 的输出契约。

这是当前阶段对“下一个阶段应提前知道什么”的固定模板表达。

它不是运行时动态生成结果，而是当前系统规范直接定义的模板。

###### `output.summary`

表示该 stage 输出的总体说明。

###### `output.required_artifacts`

表示该 stage 的输出中，必须形成哪些正式 artifact type。

###### `output.artifact_requirements`

表示该 stage 输出 artifact 在内容、格式、质量方面的要求。

##### `acceptance_focus`

表示该 stage 在完成时，当前系统重点关注哪些验收点。

这是阶段级关注点，不等同于 artifact 正文本身。

### 2. `snails.json`

用于定义系统内置 snail。

它负责表达：

1. snail 是谁
2. snail 的能力要求
3. snail 的工作方式要求
4. snail 对应哪份 system prompt 资产

#### 数据格式

```json
{
  "<snail_name>": {
    "title": "<display title>",
    "description": "<text>",
    "runtime": "claude-cli",
    "capability_expectations": ["..."],
    "working_rules": ["..."],
    "preferred_artifact_types": ["..."],
    "system_prompt_asset": "<system-prompt-asset-id>"
  }
}
```

#### 字段说明

##### 顶层 key

表示一个 `snail_name`。

##### `title`

表示该 snail 的显示名称。

##### `description`

表示该 snail 的简要说明。

##### `runtime`

表示该 snail 当前使用的底层运行时。

##### `capability_expectations`

表示对该 snail 的能力预期。

##### `working_rules`

表示该 snail 在工作中应遵守的工作方式要求。

##### `preferred_artifact_types`

表示该 snail 更偏向产出的 artifact 类型。

##### `system_prompt_asset`

表示该 snail 关联的 system prompt 资产 id。

snail 的角色提示正文不再内嵌在 `snails.json` 中，而是单独放在 `.meta/prompts/system/snails/*.md` 中。

### 3. `artifacts.json`

用于定义系统内置 artifact type。

它负责表达：

1. artifact type 是什么
2. artifact type 的显示名称是什么
3. artifact type 默认偏向的存储方式是什么
4. artifact type 是否可以作为正式交付物

#### 数据格式

```json
{
  "<artifact_type>": {
    "title": "<display title>",
    "description": "<text>",
    "storage_type": "inline_text",
    "formal": true
  }
}
```

#### 字段说明

##### 顶层 key

表示一个 `artifact_type`。

##### `title`

表示该 artifact type 的显示名称。

##### `description`

表示该 artifact type 的用途说明。

##### `storage_type`

表示该 artifact type 默认偏向的存储方式。

##### `formal`

表示该 artifact type 是否可作为正式交付物。

### 4. `prompts/`

用于定义所有提示词相关系统资产。

其下明确分为三类：

1. `prompts/system/`
   存放系统提示词资产
2. `prompts/regulations/`
   存放 regulation 规约资产
3. `prompts/skills/`
   存放 skill 能力资产

三者边界如下：

1. system prompt
   定义身份、上下文、系统边界和对 skill 的引用要求
2. regulation
   定义按角色或场景命中的稳定 policy
3. skill
   定义独立能力包，包含 `SKILL.md` 和可选附属文件

#### `prompts/system/`

当前包含：

1. `system/system-prompt.md.template`
   system section 模板
2. `system/system-assembly.md.template`
   system assembly 模板
3. `system/assemblies/*.md`
   定义某个系统提示词由哪些 section、regulation、skill 引用组成
4. `system/conversation/*.md`
   conversation system prompt 的 section 资产
5. `system/snails/*.md`
   各 snail 的角色提示资产
6. `system/tasks/*.md`
   独立任务使用的 system prompt，例如 mention extractor、summary generator

#### `prompts/system/` 文档格式

system section 与 assembly 统一采用：

1. `---` 包裹的 JSON frontmatter
2. Markdown 正文

其中：

1. section 文档负责最终注入的系统提示词片段
2. assembly 文档负责声明装配结构，不直接承载大量正文

#### `prompts/regulations/`

用于定义系统内置的通用规约。

它负责表达：

1. 哪些规约属于系统级通用约束
2. 每条规约适用于哪些角色或场景
3. 当前 prompt 应按什么规则渐进式披露这些规约

#### 当前结构

1. `prompts/regulations/regulation.md.template`
   负责定义 regulation 文档统一模板
2. `prompts/regulations/roles/*.md`
   负责存放按角色命中的规约全文
3. `prompts/regulations/scenarios/*.md`
   负责存放按场景命中的规约全文

#### 文档格式

每个 regulation 文档都必须采用：

1. 机器头：使用 `---` 包裹的 JSON frontmatter，声明 `id`、`title`、`match`
2. 人类正文：显式区分 `Policy` 与 `Guidance`
3. `id` 是 regulation 的稳定主键，必须全局唯一，并采用 `RG` + 三位数字格式，例如 `RG001`

其中：

1. `Policy`
   表示命中后必须持续生效的原则，会固定注入系统提示词
2. `Guidance`
   表示对 policy 的说明、适用边界、正反例和补充细则，不会默认注入，需要时通过 expand loader 读取

索引中的 `summary` 不再手写存放于机器头，而是由 `Policy` 的首条自动派生。

系统启动时会遍历 `.meta/prompts/regulations/**/*.md`，构建 regulation 索引并缓存到内存中。

注意：

1. 缓存的是索引信息和 policy，不是整篇原始 markdown 正文
2. 如需读取完整 guidance，应通过 `.meta/scripts/regulation-expand --id <regulation-id>` 动态展开

#### `prompts/skills/`

用于定义独立 skill 能力包。

每个 skill 都必须是一个目录，目录入口为 `SKILL.md`，格式遵循 Claude Code / Agent Skills 规范。

#### 当前结构

1. `prompts/skills/SKILL.md.template`
   skill 模板
2. `prompts/skills/<skill-name>/SKILL.md`
   某个 skill 的入口文件
3. `prompts/skills/<skill-name>/...`
   可选附属文件，例如脚本、模板、参考文档、样例

#### skill 与 system prompt 的关系

1. skill 是独立能力包，不是 system prompt 正文的一部分
2. system prompt 可以引用 skill，并声明何时必须使用该 skill
3. 如需描述 skill 详细步骤、命令、支持文件，应写在 skill 自己目录中的 `SKILL.md`，而不是复制进 system prompt

#### 设计原则

1. 规约属于系统通用资产，不归属某个具体 project
2. `project / stage / conversation / snail` 只负责帮助判断当前命中哪些规约
3. 系统提示词应固定注入命中的 policy，再通过 expand loader 按需读取 guidance
4. skill 应保持独立能力边界，不与 regulation 或 system prompt 正文混写

## 文件之间的关系

### `stages.json`、`snails.json` 与 `artifacts.json`

两者共同定义系统规范。

1. `stages.json`
   定义阶段规范

2. `snails.json`
   定义 snail 规范

3. `artifacts.json`
   定义 artifact type 规范

也就是说：

1. `stages.json` 说清“某个阶段需要什么”
2. `snails.json` 说清“某个 snail 是什么、如何工作”
3. `artifacts.json` 说清“某种 artifact 是什么、如何被系统理解”

系统启动后，会同时读取这两类规范，并在运行时把它们组合起来。

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
