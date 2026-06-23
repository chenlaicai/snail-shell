---
name: query-current-context
description: "[Deprecated] 查询当前 conversation 关联的 stage、issue、role、workspace 运行时上下文详情。请优先使用 MCP 工具 get_context 获取 Issue 上下文。"
---

# Query Current Context

> **Deprecated**：此 skill 已被 MCP 工具 `get_context` 替代。新代码应使用 `get_context` 直接读取 Issue 上下文。本 skill 保留用于向后兼容，仍可查询完整的运行时上下文。

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

## Commands

统一命令路径：`node .meta/skills/query-current-context/scripts/query-current-context.js`

```bash
node .meta/skills/query-current-context/scripts/query-current-context.js \
  --conversation-id <conversation-id>
```

参数说明：
- `--conversation-id`：当前 Conversation ID。可从环境变量 `SNAIL_CTX_CONVERSATION_ID` 自动获取，无需显式传参。

## Output

输出为 Markdown 格式的结构化文本，包含以下块（仅输出存在数据的块）：

```markdown
## 工作区
- 名称: <workspace_name>
- 摘要: <summary>

## Issue
- 标题: <title>
- ID: <id>
- 摘要: <summary>
- 任务锚: <task_anchor>  (如有)

## 当前 Stage
- 名称: <stage_title>
- 类型: <type>
- 进度: <progress_label>
- 下一步动作: <next_action>
- Stage ID: <stage_id>
- Issue ID: <issue_id>
- Stage 输入: <input_description>
- Stage 交付要求: <output_description>
- 验收关注点: ...
- 当前输出产物: <output_artifacts>
- 上一 Stage 输入产物: <inputArtifacts>

## 角色
- 默认主角色: <role_name> (无显式 mention 时默认响应的角色)
- 当前参与角色: <role1>、<role2>
- 角色详情: ... (含工作规则)

## 当前 Conversation
- 标题: <title>
- 类型: <kind>
- 摘要: <summary>
- 来源: <from_conversation_ids>
- Conversation ID: <conversation_id>
```
