---
id: F2026052205
title: Mermaid 渲染防御 + 移除 `--bare` + B-03 同步
from_ids: []
tags: [ui, ui]
modules: [project_management]
---
# F2026052205 Mermaid 渲染防御 + 移除 `--bare` + B-03 同步

## 背景

### 问题一：Mermaid 非法内容导致全页崩溃

Agent 在 Markdown 回复中使用了 ` ```mermaid ` 代码块，但内容不是合法的 mermaid 语法（缺少 `graph TD` / `flowchart` 等类型声明），导致 mermaid 11.15.0 解析失败，渲染出 2412×512 的巨大错误 SVG（含爆炸图标和 "Syntax error in text / mermaid version 11.15.0"），占据整个页面。

根本原因是 markdown-renderer 对 ` ```mermaid ` 块做了零信任处理——只要语言标签是 `mermaid` 就传递给 mermaid 库渲染，不做任何前置校验。mermaid 自身的错误处理也是渲染一个巨型 SVG（而非抛出异常），导致 `showMermaidFallback` 的 catch 路径根本不会触发。

### 设计决策：移除 `--bare`

本 feature 最初计划移除 `--bare` 以恢复 Claude hooks 能力（作为 worktree 安全守卫的前置条件）。检视阶段通过实验验证和源码分析，发现系统提示词覆盖模式不能阻止 CLAUDE.md 注入、且 `CLAUDE_CODE_SIMPLE=1` 也会禁用 hooks。

但用户最终决策：**移除 `--bare`**。理由：

1. `--bare` 关闭了 Claude Code 的 MCP/tool 等核心能力，成本过高，得不偿失。
2. 单一指令源可通过不创建 CLAUDE.md 来保证——只要启动目录下没有 CLAUDE.md，就不会有双指令源问题。
3. 开放 Claude 原生能力（完整工具集、hooks 等）的收益大于 CLAUDE.md 注入风险，因为 CLAUDE.md 注入的前提条件（存在该文件）本身可控。

**结论**：移除 `--bare`。B-03 提示词的 `[HARD]` 规则从防御纵深升级为 EnterPlanMode/ExitPlanMode/AskUserQuestion 的唯一防御层。

## 目标

1. 在 markdown-renderer 中增加 mermaid 内容前置校验，非法内容作为普通代码块渲染。
2. 移除 Claude Code Agent 的 `--bare` 启动参数，恢复 MCP/tool 等 Claude 原生能力。
3. B-03 运行时边界提示词同步调整：constitution 和 protocol 不再引用 `--bare`，改为非交互式调度环境约束，`[HARD]` 规则从防御纵深升级为唯一防御层。

## 非目标

- 不在此 feature 中实现 worktree 安全守卫
- 不修改其他 agent（Codex、OpenCode、Gemini）的启动参数
- 不修改 Mermaid 库本身或升级版本
- 不在此 feature 中实现 CLAUDE.md 自动清理（通过手工保证启动目录无 CLAUDE.md 来维持单一指令源）

## 设计

### Mermaid 前置校验

在 `upgradeMermaidBlocks()` 中增加 `isMermaidSource()` 函数，使用正则匹配 ` ```mermaid ` 块内容的第一行（跳过空行和注释 `%%`），验证其是否以合法 mermaid 图表类型关键字开头：

合法的 mermaid 图表类型关键字（与 mermaid 11.x detector 列表一致）：
`graph`、`flowchart`、`flowchart-elk`、`sequenceDiagram`、`classDiagram`、`stateDiagram`、`erDiagram`、`gantt`、`pie`、`gitGraph`、`journey`、`quadrantChart`、`xychart`、`requirement`、`requirementDiagram`、`mindmap`、`timeline`、`sankey`、`block`、`packet`、`architecture`、`kanban`、`C4Context`、`C4Container`、`C4Component`、`C4Dynamic`、`C4Deployment`、`radar-beta`、`treeView-beta`、`venn-beta`、`wardley-beta`、`treemap`、`ishikawa`、`info`

不匹配的内容：移除 `<code>` 上的 `language-mermaid` class，让其作为普通 fenced code block 渲染，不再触发 mermaid 渲染管线。

## 生效路径

**Mermaid 渲染防御：**
- `src/web/markdown-renderer.js`：新增 `isMermaidSource()` / `MERMAID_DIAGRAM_START`，修改 `upgradeMermaidBlocks()`
- `tests/web/message-renderer-test.ts`：新增非法 mermaid 内容降级测试

**移除 `--bare` + B-03 同步：**
- `src/agent/claude-code.ts`：移除 `"--bare"` 参数及注释
- `src/agent/claude-code-stateful.ts`：移除 `"--bare"` 参数
- `.meta/prompts/prompts/B-03-运行时边界.md`：constitution/protocol 不再引用 `--bare`

## 不兼容更新

- Claude Code Agent 不再使用 `--bare` 启动，model 可用的工具集从 Bash/Edit/Read 3 个恢复为 Claude Code 完整工具列表。
- B-03 的 `[HARD]` 规则依赖从"架构层 `--bare` 过滤"变为"提示词层唯一约束"，EnterPlanMode/ExitPlanMode/AskUserQuestion 现在仅靠提示词规则防止调用。

## 远期方案：Worktree 安全操作守卫

> 本 feature 确认 MCP 路径可行。移除 `--bare` 后 hooks 能力已恢复，为 worktree 安全守卫提供了更多选项。

### 问题分析

Agent 执行非只读操作时存在两类路径污染：

**问题一：忘记进入 worktree**
Agent 跳过 worktree 创建/进入步骤，直接在主仓库目录执行 Write/Edit/Bash 操作，污染主仓库。

根因：规则仅有提示词层面的声明性约束（B-01 [HARD]），无工具层或进程层的技术门禁。

**问题二：文件工具路径与 Bash CWD 脱节**
Agent 用 Bash `cd` 进入了 worktree（CWD 正确），但 Read/Write/Edit/Glob 等工具的绝对路径仍按主仓库路径构造。Bash CWD 和文件工具路径是两个互不知晓的独立维度。

### 方案设计（两层分层方案）

```
Layer 0: 系统提示词注入
  在 prompt builder 中动态注入 worktree 路径为 [HARD] 上下文：
  - 当前 worktree 根路径
  - 所有文件工具绝对路径须以此路径为前缀
  - Bash CWD 已设置为 worktree

Layer 2: MCP Server 安全文件工具（三 Agent 通用）
  开发 snail-worktree-mcp MCP server，提供 safe_read/write/edit/glob：
  - 接收相对路径，自动解析到 worktree 根
  - 写入前检查目标在 worktree 边界内
  - 通过 --tools / --disallowedTools 限制 Agent 工具集
```

### 三 Agent 适用性

| 能力 | Claude Code | Codex | OpenCode |
|------|------------------------|-------|----------|
| spawn cwd | ✅ | ✅ | ✅ |
| MCP server | ✅ --mcp-config | ✅ | ✅ |
| 工具黑白名单 | ✅ --tools/--disallowedTools | ✅ --enable/--disable | ✅ --tools |
| 系统提示词注入 | ✅ --system-prompt | ✅ | ✅ agent prompt |
| 文件系统沙箱 | ❌ | ✅ --sandbox workspace-write + --cd | ❌ |
| Pre-tool hook | ✅ | ✅ via plugin | ❓ |

### 落地次序

1. **后续 PR：Layer 3**：spawn cwd 设为 worktree 路径
2. **后续 PR：Layer 0**：prompt builder 动态注入 worktree 上下文
3. **后续 PR：Layer 2**：开发 MCP server + 工具集限制
