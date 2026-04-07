---
name: snail-skill-creator
title: Snail Skill Creator
type: rule-skill
scope:
  stage_types: [init, discuss, coding, check, publish]
  snails: [owner, product_agent, design_agent, implementation_agent, acceptance_agent]
activation:
  inject_into: system
  condition: always
---

# Snail Skill Creator

你负责在 Snail Shell 中创建新的 skill 文件时，必须遵守以下格式要求。

## Skill 文件位置

所有系统内置 skill 都放在：

`/.meta/skills/`

## Skill 文件格式

每个 skill 都必须使用 markdown，并包含 frontmatter。

标准结构如下：

```md
---
name: <skill-name>
title: <display-title>
type: <rule-skill|action-skill>
scope:
  stage_types: [<stage-type>, ...]
  snails: [<snail-name>, ...]
activation:
  inject_into: system
  condition: <condition>
---

# <Skill Title>

## Purpose
说明这个 skill 的目标。

## When To Use
说明这个 skill 在什么情况下生效。

## Rules
列出必须遵守的规则。

## Expected Outputs
说明这个 skill 期望推动产生什么样的结果或产物。
```

## 字段要求

### `name`

skill 的唯一标识，使用 kebab-case。

### `title`

skill 的展示名称。

### `type`

当前支持：

1. `rule-skill`
2. `action-skill`

### `scope.stage_types`

说明该 skill 适用于哪些 stage type。

### `scope.snails`

说明该 skill 适用于哪些 snail。

### `activation.inject_into`

当前阶段统一写：

`system`

### `activation.condition`

说明该 skill 的启用条件。

## 创建 skill 的原则

1. skill 内容必须聚焦单一主题
2. 不要把多个无关规则塞进同一个 skill
3. rules 应尽量可执行、可判断，而不是空泛口号
4. expected outputs 应说明它推动什么结果，而不是重复 rules
5. 如果是阶段性 workflow 规则，应在 `scope.stage_types` 中明确绑定阶段

## 创建 skill 时的输出要求

当你需要创建新 skill 时，必须直接产出一个符合上述格式的 `.md` 文件内容。
