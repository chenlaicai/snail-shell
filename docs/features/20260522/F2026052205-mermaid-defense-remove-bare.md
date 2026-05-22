# F2026052205 Mermaid 渲染防御 + 移除 Claude `--bare` 模式

## 背景

### 问题一：Mermaid 非法内容导致全页崩溃

Agent 在 Markdown 回复中使用了 ` ```mermaid ` 代码块，但内容不是合法的 mermaid 语法（缺少 `graph TD` / `flowchart` 等类型声明），导致 mermaid 11.15.0 解析失败，渲染出 2412×512 的巨大错误 SVG（含爆炸图标和 "Syntax error in text / mermaid version 11.15.0"），占据整个页面。

根本原因是 markdown-renderer 对 ` ```mermaid ` 块做了零信任处理——只要语言标签是 `mermaid` 就传递给 mermaid 库渲染，不做任何前置校验。mermaid 自身的错误处理也是渲染一个巨型 SVG（而非抛出异常），导致 `showMermaidFallback` 的 catch 路径根本不会触发。

### 问题二：`--bare` 模式剥夺了 Claude hooks 能力

当前 `claude-code.ts` 和 `claude-code-stateful.ts` 使用 `--bare` 启动 Claude Code CLI，目的是：
- 隔离 Claude 内置的 memory、CLAUDE.md auto-discovery 等机制
- 确保 `--system-prompt` 是唯一指令源

但 `--bare` 同时也禁用了 **hooks 系统**——而 hooks（尤其是 PreToolUse hook）恰恰是解决 worktree 路径守卫问题（见下文"远期方案"）的物理拦截手段。

**核心判断**：`--bare` 的两个保留理由都可以通过替代参数等价实现：
- "单一指令源" → `--system-prompt`（覆盖式）等价达成
- "memory 隔离" → 不单独启用 auto-memory 即可

而 hooks 能力无法在 `--bare` 下等效替代。

## 目标

1. 在 markdown-renderer 中增加 mermaid 内容前置校验，非法内容作为普通代码块渲染
2. 从 Claude Code Agent 启动参数中移除 `--bare`，恢复 hooks 和 MCP 扩展能力

## 非目标

- 不在此 feature 中实现完整的 worktree 安全守卫（见"远期方案"）
- 不修改其他 agent（Codex、OpenCode、Gemini）的启动参数
- 不修改 Mermaid 库本身或升级版本

## 设计

### 1. Mermaid 前置校验

在 `upgradeMermaidBlocks()` 中增加 `isMermaidSource()` 函数，使用正则匹配 ` ```mermaid ` 块内容的第一行（跳过空行和注释 `%%`），验证其是否以合法 mermaid 图表类型关键字开头：

合法的 mermaid 图表类型关键字（与 mermaid 11.x detector 列表一致）：
`graph`、`flowchart`、`flowchart-elk`、`sequenceDiagram`、`classDiagram`、`stateDiagram`、`erDiagram`、`gantt`、`pie`、`gitGraph`、`journey`、`quadrantChart`、`xychart`、`requirement`、`requirementDiagram`、`mindmap`、`timeline`、`sankey`、`block`、`packet`、`architecture`、`kanban`、`C4Context`、`C4Container`、`C4Component`、`C4Dynamic`、`C4Deployment`、`radar-beta`、`treeView-beta`、`venn-beta`、`wardley-beta`、`treemap`、`ishikawa`、`info`

不匹配的内容：移除 `<code>` 上的 `language-mermaid` class，让其作为普通 fenced code block 渲染，不再触发 mermaid 渲染管线。

### 2. 移除 `--bare`

| 文件 | 改动 |
|------|------|
| `claude-code.ts` | args 数组中删除 `"--bare"`，更新注释 |
| `claude-code-stateful.ts` | `buildArgs()` args 数组中删除 `"--bare"` |

`--no-session-persistence` 保留——Snail Shell 自己管理会话状态。

## 生效路径

- `src/web/markdown-renderer.js`：新增 `isMermaidSource()` / `MERMAID_DIAGRAM_START`，修改 `upgradeMermaidBlocks()`
- `src/agent/claude-code.ts`：移除 `--bare`，更新注释
- `src/agent/claude-code-stateful.ts`：移除 `--bare`

## 不兼容更新

无。`--bare` 移除后 Claude Code 会话使用默认模式（比 `--bare` 多 hooks/MCP/LSP 等能力），这些新增能力不影响 Snail Shell 的 `--system-prompt` 覆盖行为。

## 远期方案：Worktree 安全操作守卫

> 本 feature 移除 `--bare` 是 worktree 安全守卫的前置条件（需要 hooks 的 PreToolUse 拦截能力）。

### 问题分析

Agent 执行非只读操作时存在两类路径污染：

**问题一：忘记进入 worktree**
Agent 跳过 worktree 创建/进入步骤，直接在主仓库目录执行 Write/Edit/Bash 操作，污染主仓库。

根因：规则仅有提示词层面的声明性约束（B-01 [HARD]），无工具层或进程层的技术门禁。

**问题二：文件工具路径与 Bash CWD 脱节**
Agent 用 Bash `cd` 进入了 worktree（CWD 正确），但 Read/Write/Edit/Glob 等工具的绝对路径仍按主仓库路径构造。Bash CWD 和文件工具路径是两个互不知晓的独立维度。

### 方案设计（三层分层方案）

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

Layer 3: spawn cwd = worktree（三 Agent 通用）
  子进程 cwd 设为 worktree，Bash 命令天然在 worktree 内执行
```

### 三 Agent 适用性

| 能力 | Claude Code | Codex | OpenCode |
|------|------------|-------|----------|
| spawn cwd | ✅ | ✅ | ✅ |
| MCP server | ✅ | ✅ | ✅ |
| 工具黑白名单 | ✅ --tools/--disallowedTools | ✅ --enable/--disable | ✅ --tools |
| 系统提示词注入 | ✅ --system-prompt | ✅ | ✅ agent prompt |
| 文件系统沙箱 | ❌ | ✅ --sandbox workspace-write + --cd | ❌ |
| Pre-tool hook | ✅（本 PR 恢复） | ✅ via plugin | ❓ |

### 落地次序

1. **本 PR（Layer 2 前置）**：移除 `--bare`，恢复 hooks 能力
2. **后续 PR：Layer 3**：spawn 时设置 cwd 为 worktree 路径
3. **后续 PR：Layer 0**：prompt builder 动态注入 worktree 上下文
4. **后续 PR：Layer 2**：开发 MCP server + 工具集限制
