---
id: F2026062207
title: snail-issue-mcp-server
from_ids: []
tags: [mcp, issue, stage, skill-migration]
modules: [domain/snail-mcp-server, domain/issue, app/issue-collaboration]
doc_kind: spec
---

# F2026062207 [mcp] snail-issue MCP Server — 替代 skill + 合并 set_final_body

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

当前三个 agent 操作各自走不同机制：

| 能力 | 机制 | 问题 |
|------|------|------|
| `record-issue-repo-context` | Skill (CLI 脚本 → v1 db-bridge) | bash 子进程，无结构化错误，agent 需读 SKILL.md 后手动执行 |
| `set-task-anchor` | Skill (CLI 脚本 → v1 db-bridge) | v2 领域层完全缺失（IssuePort 无此方法，Issue 模型无此字段） |
| `set_final_body` | MCP tool (snail-final-response) | 独占一个 MCP server，可合并 |

三个操作都是 agent 发言周期中的实体写入操作，应统一到 MCP 层。

## 目标

创建 `snail-issue` MCP Server，聚合三个 tool：

| Tool | 替代 | 领域端口 |
|------|------|---------|
| `record_output_artifacts` | `record-issue-repo-context` skill | `StagePort.addOutputArtifacts` |
| `set_task_anchor` | `set-task-anchor` skill | `IssuePort.setTaskAnchor`（新增） |
| `set_final_body` | `snail-final-response` MCP server | `MessagePort.setContext` |

同时在 v2 Issue 模型补 `task_anchor` 字段，system reminder 条件注入。

## 设计

### MCP Server 结构

```
snail-issue (MCP Server)
├── record_output_artifacts   — 写 stage.output_artifacts
├── set_task_anchor           — 写 issue.task_anchor
└── set_final_body            — 写消息最终答复
```

依赖注入：`StagePort` + `IssuePort` + `MessagePort`。

### stage_id / issue_id 传递

MCP HTTP transport 不支持传递 env vars 到 server 端。context 传递链路：

```
Collaboration → contextEnv → Claude Code 子进程 (SNAIL_CTX_STAGE_ID 等)
  → agent 读取 env vars → 作为 tool arguments 传入 → MCP handler
```

`stage_id` 和 `issue_id` 为 required 参数，description 指导 agent 从环境变量读取后传入。

### output_artifacts 合并语义

**浅合并**（与 v1 一致）：顶层 key 覆盖，嵌套对象整体替换。

```typescript
// 事务内 read-modify-write，保证原子性
const current = JSON.parse(row.output_artifacts);
const merged = { ...current, ...artifacts };
```

不使用 SQL `json_patch`（深合并），因为 `{value, keep}` 对象需要整体替换语义。

### task_anchor 注入

注入为独立 `<task_anchor>` 块，与 `<identity>`/`<handbook>`/`<context>` 并列：

```xml
<task_anchor>
[HARD] 以下任务锚在每次关键决策前必须重新对照，不得静默偏离：

{task_anchor 内容}
</task_anchor>
```

仅当 `issue.task_anchor` 非 null 时注入。

### task_anchor 长度限制

2000 字符上限，防止 agent 写入超长文本导致 system prompt 超出 token 限制。

## 非目标

- v1 代码修改（v1 是废弃代码）
- 数据库迁移脚本（新建数据库 schema 已包含 task_anchor 列）
- 单元测试补充（follow-up）
- MCP HTTP transport 层改造（context 自动注入）

## 不兼容变更

- `snail-final-response` MCP server 删除，`set_final_body` 迁入 `snail-issue`
- `StagePort.addOutputArtifacts` 签名从 `Record<string, string>` 改为 `Record<string, unknown>`
- `record-issue-repo-context` / `set-task-anchor` skill 不再被 v2 系统使用（v1 文件保留）
