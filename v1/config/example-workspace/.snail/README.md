# .snail 目录结构

工作区级配置目录，每个 workspace 根下放置一个 `.snail/`。
由 `snail-loader.ts` 统一加载为 `WorkspaceContext`。

## 目录结构

```
.snail/
├── init.json                    # 工作区元数据（name, summary, guard_profile）
├── mcp.json                     # MCP 服务声明（独立加载，不属于 WorkspaceContext）
├── config/
│   └── sop/
│       ├── <sop-key>.yaml       # SOP 定义，文件名即 key
│       └── *.handbook.md        # 角色手册，通过 @filename 在 yaml 中引用
├── prompts/
│   └── *.md                     # 工作区级 prompt 文档（frontmatter + markdown）
└── skills/
    └── <skill-name>/
        └── SKILL.md             # 工作区级 skill 定义（frontmatter + markdown）
```

## 文件格式

### init.json

`SnailWorkspaceConfig` schema，`name` 必填。

```json
{
  "name": "工作区名称",
  "summary": "用途简述",
  "guard_profile": null
}
```

### config/sop/*.yaml

SOP 定义，key 从文件名派生（不含扩展名）。必填字段：`name`、`stage_definitions`。

stage 内必填：`key`、`title`、`sequence`、`roles`（至少一个）。
role 内必填：`key`、`name`。

`handbook` 字段支持 `@filename.md` 引用同目录下的文件，加载时由 manager 层 resolve 内联。

### config/sop/*.handbook.md

纯 markdown，无 frontmatter。通过 SOP yaml 中的 `@filename` 引用。

### prompts/*.md

frontmatter 必填：`id`、`title`。可选：`layer`、`priority`、`when`、`stability`。
body 为 prompt 正文，支持 `{{variable}}` 模板变量。

### skills/*/SKILL.md

frontmatter 必填：`name`、`description`。
body 为 skill 正文。skill name 全局唯一，workspace 级与 platform 级同名会报错。

### mcp.json

标准 MCP server 声明。支持 stdio（`command`+`args`+`env`）和 HTTP（`url`）两种模式。
