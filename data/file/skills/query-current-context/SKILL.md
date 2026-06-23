---
name: query-current-context
description: 查询当前 conversation 关联的 stage、issue、role、workspace 运行时上下文详情。用于在系统提示词仅提供最小锚点信息时，按需获取完整上下文。
---

# Query Current Context

## Purpose

查询当前 Snail Shell conversation 关联的完整运行时上下文，包括 Stage 进度与产物、Issue 详情、角色列表与工作规则、Conversation 元信息。

系统提示词中的工作区上下文块仅提供最小"锚点"信息（工作区名、Stage 名、当前角色）。当需要了解 Stage 的输入/输出产物要求、参与角色列表和各自工作规则、Issue 任务锚等详细信息时，使用本 skill 查询。mention 权限、剩余协作轮次等调用期运行时状态由系统提示词直接注入，不在本 skill 查询范围内。

## When To Use

- 需要了解当前 Stage 的完整输入/输出产物要求时
- 需要确认参与角色列表、各角色描述和工作规则时
- 需要查看 Issue 任务锚或详情时
- 需要确认 Conversation 的上下文来源时
- 系统提示词的锚点信息不足以支撑判断时

## Communication Boundary

本 skill 是只读查询工具，不会修改任何数据库状态。查询结果反映调用时刻的数据库快照。

## Instructions

调用 MCP Tool `snail-issue.query_context`，传入以下参数：

- `conversation_id`（可选）：Conversation ID。如果未传入，将从环境变量 `SNAIL_CTX_CONVERSATION_ID` 自动获取。

## Output

输出为 JSON 格式，包含以下字段（仅输出存在数据的字段）：

```json
{
  "conv": {
    "id": "...",
    "issue_id": "...",
    "stage_id": "...",
    "workspace_id": "...",
    "title": "...",
    "kind": "...",
    "summary": "...",
    "participating_roles": ["role1", "role2"],
    "from_conversation_ids": ["conv1", "conv2"],
    "created_at": "..."
  },
  "stage": {
    "id": "...",
    "key": "...",
    "title": "...",
    "description": "...",
    "sequence": 1,
    "output_artifacts": {...},
    "entered_at": "...",
    "left_at": null
  },
  "stageDef": {
    "id": "...",
    "key": "...",
    "title": "...",
    "description": "...",
    "input_description": "...",
    "output_description": "...",
    "acceptance_focus": ["focus1", "focus2"]
  },
  "stageRoles": [
    {
      "id": "...",
      "name": "...",
      "description": "...",
      "working_rules": ["rule1", "rule2"]
    }
  ],
  "issue": {
    "id": "...",
    "title": "...",
    "summary": "...",
    "task_anchor": "...",
    "created_at": "...",
    "closed_at": null
  },
  "workspace": {
    "id": "...",
    "name": "...",
    "summary": "..."
  },
  "inputArtifacts": {...}
}
```
