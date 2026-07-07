---
name: snail-skill-creator
description: 创建或维护 Snail Shell 内置 skill 时使用。用于确保新 skill 遵循 Claude Code skill 规范与本仓库目录约束。
---

# Snail Skill Creator

## Purpose

你负责在 Snail Shell 中创建新的 skill 时，必须遵守 Claude Code skill 目录规范与本仓库的组织边界。

## When To Use

以下场景应使用本 skill：

1. 需要为 Snail Shell 添加新的独立能力包时。
2. 现有 skill 需要重大重构或拆分时。
3. 需要验证某个 skill 是否符合规范时。

以下场景不应使用本 skill：

1. 修改现有 skill 的内容（直接修改即可）。
2. 修改系统提示词（应使用提示词治理流程）。

## Instructions

### 创建新 skill 的步骤

1. **确定 skill 边界**：这个 skill 解决什么独立动作问题？是否与现有 skill 重叠？

2. **创建目录结构**：
   ```
   data/file/skills/<skill-name>/
   ├── SKILL.md          # 必须，skill 入口
   ├── <script-name>     # 可选，附属脚本
   └── ...               # 其他附属文件
   ```

3. **编写 SKILL.md**：必须包含以下部分：
   - `---` frontmatter：`name` 和 `description`
   - `## Purpose`：说明这个 skill 的独立能力边界
   - `## When To Use`：什么情况下应该调用这个 skill
   - `## Instructions`：调用 skill 后应遵循的步骤
   - `## Output`：说明预期结果

4. **命名规范**：
   - 目录名使用 kebab-case：`my-skill`
   - frontmatter `name` 字段与目录名一致
   - 附属脚本使用相同前缀或语义名称

5. **验证**：确认 skill 可以被系统正确加载和识别。

### SKILL.md 模板

```markdown
---
name: skill-name
description: 简要说明这个 skill 提供什么能力，以及在什么情况下应使用它。
---

# Skill Name

## Purpose

说明这个 skill 解决什么独立动作问题。

## When To Use

说明什么情况下应该调用这个 skill。

## Instructions

1. 写清楚调用这个 skill 后应遵循的步骤。
2. 如需依赖附属文件，在这里明确引用相对路径。
3. 如需参数，使用 `$ARGUMENTS` 或命名参数。

## Supporting Files

- 如有附属文档、样例、脚本、模板，请放在当前 skill 目录下并在此列出。

## Output

- 说明该 skill 预期产出什么结果。
```

## Rules

1. 所有内置 skill 放在 `data/file/skills/<skill-name>/SKILL.md`。
2. 每个 skill 是一个目录，`SKILL.md` 为入口。
3. 如需附属脚本、样例、模板、参考文档，放在同一 skill 目录下。
4. skill 是独立能力包，不要把系统提示词正文复制进 skill。
5. 如果某项约束属于长期系统身份或场景边界，应进入 prompt 文档，而不是 skill。
6. 附属脚本中计算工作区根目录时，使用 `$(dirname "$0")/../../..`（因为 skill 目录在 `data/file/skills/<skill-name>/` 下）。

## Output

新创建的 skill 目录结构完整，SKILL.md 包含所有必要部分，可以被系统正确加载。

## Supporting Files

- SKILL.md.template：skill 模板文件，位于 `data/file/skills/SKILL.md.template`。
