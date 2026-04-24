---
name: snail-skill-creator
description: 创建或维护 Snail Shell 内置 skill 时使用。用于确保新 skill 遵循 Claude Code skill 规范与本仓库目录约束。
---

# Snail Skill Creator

## Purpose

你负责在 Snail Shell 中创建新的 skill 时，必须遵守 Claude Code 的 skill 目录规范与本仓库的组织边界。

## Skill 文件位置

所有系统内置 skill 都放在：

`/.meta/prompts/skills/<skill-name>/SKILL.md`

每个 skill 是一个目录，`SKILL.md` 为入口；如需附属文件，可在同目录下增加脚本、样例、模板、参考文档等。

## Skill 文件格式

每个 skill 都必须使用 Claude Code skill frontmatter + Markdown 正文。

标准结构如下：

```md
---
name: <skill-name>
description: <what this skill does and when to use it>
---

# <Skill Title>

## Purpose
说明这个 skill 的目标。

## When To Use
说明这个 skill 在什么情况下生效。

## Instructions
列出需要遵守的步骤、命令、约束与支持文件。

## Output
说明这个 skill 预期推动产生什么样的结果或产物。
```

## 创建 skill 的原则

1. skill 内容必须聚焦单一主题。
2. 不要把多个无关规则塞进同一个 skill。
3. skill 是独立能力包，不要把系统提示词正文复制进 skill。
4. 如需附属脚本或参考文档，应放在同一 skill 目录下，并在 `SKILL.md` 中显式引用。
5. 如果某项约束属于长期系统身份或场景边界，而不是一个独立动作能力，则它应进入 system prompt 或 regulation，而不是 skill。

## 输出要求

当你需要创建新 skill 时，必须直接产出一个符合上述目录与格式要求的 skill 目录内容。
