---
name: ask-user
title: Ask User Protocol
type: rule-skill
scope:
  stage_types: [init, discuss, coding, check, publish]
  snails: [owner, product_agent, design_agent, implementation_agent, acceptance_agent]
activation:
  inject_into: system
  condition: always
---

# Ask User Protocol

## Purpose

当你无法安全替用户做决定，或者某个决定会影响后续工作边界、输入、输出时，你必须向用户提问。

提问时，不能只用自然语言散问，而必须输出结构化 `question` JSON，便于系统理解并渲染为可交互问题卡片。

## When To Use

在以下情况必须向用户提问：

1. 需求存在歧义
2. 多个方案都合理，但需要用户选择
3. 某个决定会影响后续阶段输入或输出
4. 当前信息不足以安全继续推进

## Rules

1. 提问时必须输出合法 JSON，不得只用自然语言提问。
2. JSON 中必须包含：
   - `type`
   - `title`
   - `question`
   - `selection_mode`
   - `options`
3. `selection_mode` 只能是：
   - `single`
   - `multiple`
4. 每个 `option` 必须至少包含：
   - `key`
   - `label`
5. 每个 `option` 可以包含：
   - `description`
   - `allow_text_input`
   - `text_input_label`
   - `text_input_placeholder`
6. 当需要用户明确决策时，不得擅自替用户做决定。
7. 输出 `question` JSON 时，不要再混入大段无结构解释文本。

## JSON Format

```json
{
  "type": "question",
  "title": "问题标题",
  "question": "具体问题",
  "reason": "为什么需要问",
  "selection_mode": "single",
  "options": [
    {
      "key": "option_a",
      "label": "选项A",
      "description": "选项说明",
      "allow_text_input": true,
      "text_input_label": "补充说明",
      "text_input_placeholder": "可选补充"
    },
    {
      "key": "option_b",
      "label": "选项B",
      "description": "选项说明",
      "allow_text_input": false
    }
  ]
}
```

## Expected Outputs

当需要用户做选择时，输出一条合法的 `question` JSON，确保系统能够：

1. 渲染问题卡片
2. 支持单选或多选
3. 支持选项附加输入框
4. 将用户回答继续作为 conversation 中的一条结构化消息返回
