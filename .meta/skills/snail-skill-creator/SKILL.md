---
name: snail-skill-creator
description: 创建或维护 Snail Shell 内置 skill 时使用。用于确保新 skill 遵循 Claude Code skill 规范与本仓库目录约束。
---

# Snail Skill Creator

## Purpose

你负责在 Snail Shell 中创建新的 skill 时，必须遵守 Claude Code skill 目录规范与本仓库的组织边界。

## Rules

1. 所有内置 skill 放在 `/.meta/skills/<skill-name>/SKILL.md`。
2. 每个 skill 是一个目录，`SKILL.md` 为入口。
3. 如需附属脚本、样例、模板、参考文档，放在同一 skill 目录下。
4. skill 是独立能力包，不要把系统提示词正文复制进 skill。
5. 如果某项约束属于长期系统身份或场景边界，应进入 prompt 文档，而不是 skill。
