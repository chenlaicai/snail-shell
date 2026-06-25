---
id: F20260625e5tj
title: streaming-tool-summary-display
from_ids: [F20260624ax7k]
tags: [web, streaming, ux, bugfix, infra, workflow]
modules: [web, infra]
doc_kind: spec
---

# F20260625e5tj [web/infra] 流式 tool_call 展示优化 + 设计规则补强

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

基于 F20260624ax7k 的 EventItem 结构化格式实现，当前 `tool_call` 事件的展示存在两个问题：

1. **tool_call 只显示工具名**：EventStream 中的 tool_call 事件仅显示原始工具名（如 "bash"、"Read"），无法区分同一工具的多次调用。而 text、command 等类型已实现"摘要 + 折叠详情"模式
2. **`title` 字段从未被填充**：根因排查发现，Agent adapter 硬编码 `title: null`，collaboration 层映射时丢弃 `title`，domain model 中无 `title` 字段定义——整条管线中 `title` 始终为 null，前端读取永远是 undefined

此外，在设计过程中发现 cd-design skill 的 Gotchas 规则存在两个漏洞，导致架构师可以将绕过方案包装为完整方案：

3. **缺少跨层修复约束**：当问题根因跨越多个架构层时，无规则阻止"仅修其中一层"作为完整方案呈现
4. **"未来扩展"规则被反向利用**：措辞过宽，可被曲解为"选更简单的方案"，合理化跳过已有问题链路中的断点

在本次设计阶段执行中，还发现 GATE-1（进入 worktree）被完全跳过：

5. **GATE-1 失效**：cd-design skill 明确要求"严禁在主目录进行任何文件修改（包括 feature 文档）"，但两位架构师均未执行 GATE-1，feature 文档直接写在主仓库中

## 目标

1. tool_call 事件在 EventStream 中展示摘要文本（从 `tool_input` 派生），与 text/command 的展示模式对齐
2. 清理 `title` 死字段：从 ACS model 和 Agent adapter 中移除未使用的 `title` 字段
3. cd-design Gotchas 新增"跨层问题必须跨层修"规则
4. cd-design Gotchas 收窄"未来扩展"规则的适用范围
5. 架构师角色定义新增"方案完整性优先于改动量"约束
6. 修复 design 阶段 GATE-1 失效：将 GATE-1 约束注入阶段描述，防止跳过 worktree
7. cd-design Gotchas 新增"用户明确指令优先"规则：当用户明确说"纳入"、"要做"、"必须"等指令时，不得提出替代方案或反对意见
8. cd-design Gotchas 新增"审视中的设计问题必须当下解决"规则：设计层面的问题（规则歧义、验证缺失、流程未定义）必须在当前 feature 文档中解决，不得标记为"非阻塞"或"后续迭代"；代码实现细节属于 development 阶段

## 非目标

- 不改变 tool_call 事件的生成和推送逻辑（adapter emit 行为不变，只是清理死字段）
- 不改变 domain model 的 ToolCallPayload 结构（`tool_input: unknown` 已正确）
- 不改变 collaboration 层的 mapAgentEvent 映射逻辑（已正确传递 `tool_input`）
- 不改变 WebSocket 推送协议
- 不为 tool_call 引入独立的 `title` 或 `summary` 字段到 domain model

## 核心业务行为

| # | 场景 | 预期行为 |
|---|------|----------|
| B1 | 当 tool_call 事件到达且 `tool_input` 包含 `command` 字段时（如 Bash） | EventStream 显示 `[Tool] Bash · {command 摘要}` 格式，可展开查看完整 tool_input JSON |
| B2 | 当 tool_call 事件到达且 `tool_input` 包含 `file_path` 字段时（如 Read/Write/Edit） | EventStream 显示 `[Tool] {工具名} · {file_path}` 格式。Read 工具额外显示行号范围：取 `input.offset` 和 `input.limit`，显示为 `L{offset}-{offset+limit}` 格式（如 `L10-60`）；offset 或 limit 缺失时不显示行号 |
| B3 | 当 tool_call 事件到达且 `tool_input` 包含 `pattern` 字段时（如 Glob/Grep） | EventStream 显示 `[Tool] {工具名} · {pattern}` 格式，Grep 额外显示 path |
| B4 | 当 tool_call 事件到达且工具名为 MCP 格式（`mcp__*__*`）时 | EventStream 显示 `[Tool] {server}.{tool} · {摘要}` 格式。摘要取 `Object.values(input)` 中第一个 `typeof === 'string'` 的值；无 string 值时降级到 `JSON.stringify(input).slice(0, 60)` |
| B5 | 当 tool_call 事件到达且工具名不属于已知工具时 | EventStream 显示 `[Tool] {工具名} · {摘要}` 格式。摘要取 `Object.values(input)` 中第一个 `typeof === 'string'` 的值；无 string 值时降级到 `JSON.stringify(input).slice(0, 60)` |
| B6 | 当 tool_call 事件到达且 `tool_input` 为 null、undefined、空对象 `{}`、或提取的摘要值为 undefined/null 时 | 降级到仅显示工具名（无摘要、无展开箭头） |
| B7 | 当 tool_call 摘要文本超过 60 字符时 | 截断并显示 `...`，提供展开箭头 |
| B8 | 当用户点击 tool_call 项的展开箭头时 | 显示格式化的完整 tool_input JSON，最大高度 300px，超出滚动 |

## 设计

### 问题分析

**tool_call 展示问题的完整数据流**：

```
Agent Adapter (claude-code.ts)
  emits: { kind: "tool_call", payload: { tool_name: "Bash", input: {command:"ls"}, title: null } }
                                    ↓
ACS Model
  defines: { tool_name, call_id, input, title: string | null }
  实际值: title 始终为 null
                                    ↓
collaboration.ts :: mapAgentEvent()
  maps to: { type: "tool_call", tool_name: "Bash", tool_input: {command:"ls"} }
  title 字段被丢弃（未映射）
                                    ↓
domain/message :: ToolCallPayload
  定义: { type: "tool_call", tool_name: string, tool_input: unknown }
  无 title 字段
                                    ↓
前端 EventItem
  reads: p.tool_name = "Bash", p.title = undefined
  renders: [Tool] Bash   （无摘要，无展开）
```

**对比 text/command 事件**：它们直接从 payload 内容派生 label（`truncateText(text, 60)`），不依赖外部字段，所以有摘要+折叠。

**`tool_call` 的问题**：完全依赖一个从未被填充的 `title` 字段，而没有像 text/command 那样从 payload 内容本身提取摘要。

### 设计方案

#### 变更点 1：前端 EventItem 从 tool_input 派生摘要

**设计决策：不引入 `title` 字段到 domain model**

理由：
1. `tool_input` 是 canonical 数据，始终可用（流式 + 历史持久化）
2. 从 canonical 数据派生展示文本是前端职责，不是后端职责
3. 如果 domain model 存 `title`，需要保证它和 `tool_input` 一致——引入数据冗余和同步问题
4. ACS model 的 `title` 字段从未被使用，是死代码，应清理

**摘要提取策略**：

按 `tool_name` 分三档提取摘要：

已知工具（结构化提取）：

| tool_name | summary 来源 | 示例 |
|---|---|---|
| `Bash` | `input.command` | `git status` |
| `Read` | `input.file_path` + `input.offset`/`input.limit` | `src/foo.ts L10-60` |
| `Edit` | `input.file_path` | `src/foo.ts` |
| `Write` | `input.file_path` | `src/foo.ts` |
| `Glob` | `input.pattern` | `**/*.ts` |
| `Grep` | `input.pattern` + path | `TODO in src/` |
| `Agent` | `input.prompt` | `Run tests for auth...` |
| `WebFetch` | `input.url` | `https://example.com` |
| `WebSearch` | `input.query` | `React hooks best...` |
| `TodoWrite` | todos 数量 | `3 items` |
| `Skill` | `input.skill` | `cd-design` |

MCP 工具（通用处理）：
- 解析 `mcp__<server>__<tool>` 格式，显示 `{server}.{tool}`
- 摘要：取 `Object.values(input)` 中第一个 `typeof === 'string'` 的值
- 无 string 值时降级到 `JSON.stringify(input).slice(0, 60)`

完全未知工具：
- 摘要：取 `Object.values(input)` 中第一个 `typeof === 'string'` 的值
- 无 string 值时降级到 `JSON.stringify(input).slice(0, 60)`

展开详情：
- 始终显示格式化的完整 `tool_input` JSON
- 最大高度 300px，超出部分滚动（继承 F20260624ax7k 规范）

#### 变更点 2：清理 title 死字段

从 ACS model 和 3 个 Agent adapter 中移除 `title` 字段：
- ACS model `tool_call` payload 类型：移除 `title: string | null`
- claude-code adapter：移除 `title: null` 赋值
- claude-code-stateful adapter：移除 `title: null` 赋值
- opencode adapter：移除 `title: null` 赋值

理由：`title` 从未被填充，从未被传递到 domain 层，从未被前端使用。保留死字段会误导后续开发者认为这是一个已实现的功能。

#### 变更点 3：cd-design Gotchas 规则补强

**A. 新增跨层修复规则**

在 cd-design Gotchas 中增加：

> **跨层问题必须跨层修**：当排查发现根因跨越多个架构层（如 adapter → model → collaboration → frontend），修复方案必须覆盖完整链路。不得将"仅修其中一层"作为完整方案呈现。

**B. 收窄"未来扩展"规则**

当前措辞：
> "未来扩展"不是过度设计的借口：必须证明 (1) 扩展需求已确认 (2) 当前方案是扩展的必要前置 (3) 没有更简单的方案。无法满足则选更简单的方案。

修改为：
> "未来扩展"不是过度设计的借口：必须证明 (1) 扩展需求已确认 (2) 当前方案是扩展的必要前置 (3) 没有更简单的方案。无法满足则选更简单的方案。**但"更简单"指消除不必要的抽象层，不指跳过已有问题链路中的断点。**

**C. 新增用户明确指令优先规则**

在 cd-design Gotchas 中增加：

> **用户明确指令不得推翻**：当用户明确说"纳入"、"要做"、"必须"、"就这样"等指令时，不得提出替代方案或反对意见。架构师可以补充细节和风险提示，但不得用理由推翻用户的明确决策。如果用户重复同一指令，说明第一次回应已经越界。**边界定义**：用户指令适用于设计决策（是否纳入某个 feature、是否采用某个方案）。技术事实陈述（"当前系统用的是 PostgreSQL，切 MongoDB 有迁移成本"）不视为反对意见，而是补充信息；但技术事实不得作为拒绝执行用户决策的理由——陈述完事实后必须继续执行用户决策。

**D. 新增审视中设计问题必须当下解决规则**

在 cd-design Gotchas 中增加：

> **审视中的设计问题必须当下解决**：交叉审视中发现的设计层面问题（规则歧义、验证缺失、流程未定义），必须在当前 feature 文档中给出解决方案，不得标记为"非阻塞"或"后续迭代"。代码实现细节（具体文件行号、函数签名、类型定义）属于 development 阶段，设计阶段不越界。

#### 变更点 4：架构师角色定义补强

**问题分析**：

架构师在分析 tool_call 展示问题时，将"仅改前端"方案包装为"前端自愈方案，改动最小、影响面可控"，以改动量作为推荐理由。这是越界——架构师的职责是产出完整正确的设计，成本优化是开发者的决策域。

根因：架构师角色定义说"不得越界到实现细节"，但没有约束"不得越界到成本优化"。角色定义缺少"方案完整性优先于改动量"的显式约束，导致架构师可以自行衡量改动量并将其作为方案推荐依据。

**修复方案**：

在架构师角色定义中增加约束：

> 方案完整性优先于改动量。不得以"改动最小"作为方案推荐理由。

#### 变更点 5：GATE-1 注入阶段描述

**问题分析**：

cd-design skill 的 GATE-1 明确要求"使用 `git worktree add` 创建 worktree"且"严禁在主目录进行任何文件修改"。但本次 design 阶段两位架构师均跳过了 GATE-1，feature 文档直接写在主仓库。

根因：阶段描述为空。GATE-1 虽然在 cd-design skill 的 workflow.md 中有定义，但系统提示词的"当前阶段"信息中阶段描述为空。当 skill 内容很长（workflow + gotchas + references 多个章节）时，GATE-1 容易被淹没在细节中。

**修复方案**：

在 design 阶段的阶段描述中显式注入 GATE-1 约束。阶段描述是每个 agent 实例启动时系统提示词的一部分，不依赖 skill 加载。

阶段描述应包含：

```
GATE-1: 必须先创建 worktree 并切换到 worktree 目录，再进行任何文件操作。
验证：pwd 输出必须包含 .snail/worktrees/。
违反 GATE-1 的任何产出（feature 文档、代码）必须迁移到 worktree 后才能继续。
```

**GATE-1 违规迁移流程**：

当发现产出在主仓库而非 worktree 中时，执行以下步骤：
1. 在主仓库中 `git checkout -- <文件>` 或 `git rm --cached <文件>` 撤销主仓库中的变更
2. 将文件内容复制到 worktree 对应路径
3. 在 worktree 中 `git add` 并继续工作
4. 验证：主仓库 `git status` 无残留修改

**变更位置**：Snail Shell 的阶段配置（stage description），属于系统配置变更。

### 核心业务行为决策说明

**B1-B5 的摘要提取是前端行为，不是后端行为**

设计决策：`tool_input` 是 canonical 数据，前端从 canonical 数据派生展示文本。这与 text 事件的 `truncateText(text, 60)` 和 command 事件的 `truncateText(cmd, 60)` 完全一致——都是前端从 payload 内容直接派生，不依赖额外字段。

**B6 的降级行为**

当 `tool_input` 为空时，无法派生摘要，降级到仅显示工具名。这是边界情况，不是正常路径。

**B7 的截断规范**

与 F20260624ax7k 保持一致：按 JS `String.prototype.slice()` 的 Unicode 字符计算，截断后添加 `...`。

**tool_call label 格式与 text/command 的差异**

text/command 事件的 label 和 detail 是同一内容的两种粒度（截断版 vs 完整版）。tool_call 事件的 label 是 `工具名 · 摘要` 混合格式，detail 是 `tool_input` JSON。这个差异的原因是：text/command 的类型信息隐含在内容本身中（文本内容、命令字符串），而 tool_call 的类型信息（Bash/Read/Grep）不隐含在 `tool_input` 中，需要显式展示。label 中的工具名提供了类型上下文，摘要提供了内容上下文，两者缺一不可。

**类型守卫约束**

`tool_input` 的 domain model 类型为 `unknown`。前端提取摘要时必须：
1. 校验 `tool_input` 非 null 且 `typeof === 'object'`
2. 对每个字段访问做 null 检查（如 `input?.command`）
3. 校验失败时降级到仅显示工具名（B6 行为）

## 生效路径

- 代码：`src/web/components/ChatMessage.tsx` — EventItem tool_call 摘要派生逻辑
- 代码：`src/infra/acs/model.ts` — 移除 title 死字段
- 代码：`src/infra/acs/_internal/agents/claude-code.ts` — 移除 title: null
- 代码：`src/infra/acs/_internal/agents/claude-code-stateful.ts` — 移除 title: null
- 代码：`src/infra/acs/_internal/agents/opencode.ts` — 移除 title: null
- 技能：`.claude/skills/cd-design/` — Gotchas 规则补强
- 提示词：架构师角色定义 — 完整性约束
- 配置：Snail Shell 阶段配置 — design 阶段描述注入 GATE-1 约束

## 设计约束摘要

- **边界**：前端 EventItem 从 `tool_input` 派生摘要，不引入 `title` 字段到 domain model；清理 ACS model 和 adapter 中的死字段；GATE-1 约束注入阶段描述
- **关键决策**：`tool_input` 是 canonical 展示数据源，不引入 `title` 到 domain model；前端按 tool_name 分三档提取摘要；MCP 工具名解析为 `server.tool` 格式；GATE-1 约束放在阶段描述而非 skill workflow；用户明确指令不可被架构师推翻；审视中的设计问题必须当下解决，代码实现细节属于 development 阶段
- **非目标约束**：不改变 adapter 的 emit 行为（只是清理死字段赋值）；不改变 domain model 的 ToolCallPayload 结构
- **语义不变量**：`tool_input` 始终包含完整输入数据（流式 + 历史）；前端从 `tool_input` 派生的摘要文本是展示层职责，不影响数据层；design 阶段必须在 worktree 中执行，任何违反此约束的产出必须迁移
- **类型安全**：`tool_input: unknown`，前端提取摘要时必须先校验非 null 且为 object，字段访问需 null 检查，校验失败降级到仅显示工具名

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `src/web/components/ChatMessage.tsx` | 修改 | EventItem tool_call case 从 tool_input 派生摘要+详情 |
| `src/infra/acs/model.ts` | 修改 | 移除 tool_call payload 中的 title 死字段 |
| `src/infra/acs/_internal/agents/claude-code.ts` | 修改 | 移除 title: null 赋值 |
| `src/infra/acs/_internal/agents/claude-code-stateful.ts` | 修改 | 移除 title: null 赋值 |
| `src/infra/acs/_internal/agents/opencode.ts` | 修改 | 移除 title: null 赋值 |
| `.claude/skills/cd-design/` | 修改 | Gotchas 新增跨层修复规则 + 收窄未来扩展规则 |
| 架构师角色定义（提示词） | 修改 | 新增方案完整性约束 |
| Snail Shell 阶段配置 | 修改 | design 阶段描述注入 GATE-1 约束 |

## 验证

### P1 — tool_call 展示

- [ ] B1: Bash 工具调用显示 `[Tool] Bash · {command}` 格式
- [ ] B2: Read 工具调用显示 `[Tool] Read · {file_path} L{offset}-{limit}` 格式
- [ ] B3: Glob/Grep 工具调用显示 pattern 摘要
- [ ] B4: MCP 工具调用显示 `server.tool · {摘要}` 格式
- [ ] B5: 未知工具调用显示首个 string 值摘要
- [ ] B6: tool_input 为 null/undefined/空对象/提取值为 undefined 时降级到仅显示工具名
- [ ] B7: 摘要超过 60 字符时截断并显示 `...`
- [ ] B8: 点击展开显示格式化 tool_input JSON，max-height 300px
- [ ] tool_call 展示模式与 text/command 一致（摘要+折叠详情）
- [ ] tool_input 为非 object 类型时无 TypeError，正确降级
- [ ] MCP 工具无 string 值时降级到 JSON.stringify 截断

### P2 — 死字段清理

- [ ] ACS model tool_call payload 类型无 title 字段
- [ ] claude-code adapter 无 title: null 赋值
- [ ] claude-code-stateful adapter 无 title: null 赋值
- [ ] opencode adapter 无 title: null 赋值
- [ ] TypeScript 编译无类型错误

### P3 — 规则补强

- [ ] cd-design Gotchas 包含"跨层问题必须跨层修"规则
- [ ] cd-design Gotchas 的"未来扩展"规则包含"不指跳过已有断点"限定
- [ ] cd-design Gotchas 包含"用户明确指令不得推翻"规则
- [ ] cd-design Gotchas 包含"审视中的设计问题必须当下解决"规则
- [ ] 架构师角色定义包含"方案完整性优先于改动量"约束

### P4 — GATE-1 阶段描述注入

- [ ] design 阶段描述包含 GATE-1 约束（worktree 创建 + pwd 验证 + 违规迁移）
- [ ] 阶段描述配置文件中包含 `worktree` 关键字（可自动化 grep 验证）
- [ ] 新 design 阶段启动时，系统提示词中"阶段描述"字段非空

## 关联

- **前置**: F20260624ax7k（流式 UI 展示问题修复 — EventItem 结构化格式基础）
- **相关**: F2026062204（流式事件实时展示 — EventStream 基础架构）
- **相关**: F20260625swf8（事件驱动路由重构 — collaboration 层事件映射）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | tool_call 摘要数据源选择 | 从 `tool_input` 派生——`tool_input` 是 canonical 数据，始终可用，无冗余 | 从 `title` 字段读取——与 text/command 的 `text`/`command` 字段模式一致 | 从 `tool_input` 派生 | `tool_input` 是唯一 source of truth；引入 `title` 到 domain model 会造成数据冗余和同步问题；前端从 canonical 数据派生展示文本是标准模式 | 架构师-1, 架构师-2 | 2026-06-25 |
| D2 | 是否将 title 引入 domain model | 不引入——数据冗余，需要保证 title 和 tool_input 一致 | 引入——后端可以提供更好的摘要质量 | 不引入 | 展示文本派生是前端职责；后端填充 title 需要为每种工具类型实现摘要逻辑，且与 tool_input 内容重复 | 架构师-1 | 2026-06-25 |
| D3 | 是否清理 ACS model 的 title 死字段 | 清理——误导后续开发者，增加理解成本 | 保留——不影响功能，清理有改动成本 | 清理 | 死字段会造成"这是一个已实现功能"的错误印象；清理成本极低（删除字段+赋值） | 架构师-1 | 2026-06-25 |
| D4 | MCP 工具名展示格式 | `server.tool`——同时显示服务名和工具名，上下文充分 | 仅 `tool`——更简洁 | `server.tool` | MCP 工具名通常有语义（如 `snail-knowledge.search`），服务名帮助用户理解工具来源 | 架构师-1 | 2026-06-25 |
| D5 | 提示词优化是否纳入本 feature | 纳入——同一问题的不同层面，设计规则漏洞是导致上次提出绕过方案的根因 | 分开——代码变更和规则变更是不同关注点 | 纳入 | 设计规则补强是防止同类问题再发生的必要措施，与 tool_call 展示修复构成完整闭环 | 架构师-1, 用户 | 2026-06-25 |
| D6 | tool_call label 格式是否与 text/command 完全对齐 | 混合格式 `工具名 · 摘要`——tool_call 的类型信息不隐含在内容中，需显式展示工具名 | 对齐模式 `truncateText(summary, 60)`——保持一致性 | 混合格式 | text/command 的类型隐含在内容中（文本/命令本身就是类型标识），tool_call 的类型（Bash/Read/Grep）不隐含在 tool_input 中，需在 label 中显式展示 | 架构师-2 | 2026-06-25 |
| D7 | GATE-1 修复方式 | 注入阶段描述——阶段描述是系统提示词的一部分，不依赖 skill 加载，可见性最高 | 改 skill workflow 强制执行——逻辑更集中，但 skill 内容长时仍可能被忽略 | 注入阶段描述 | 阶段描述是 agent 启动时的首要上下文，GATE 级约束必须在此层可见；skill 中的 workflow 保留详细流程，阶段描述保留强制校验点 | 架构师-1, 架构师-2, 用户 | 2026-06-25 |
| D8 | 用户明确指令是否可被架构师推翻 | 不可推翻——用户是最终决策者，"纳入"是明确指令 | 可讨论——架构师有专业判断权，应提出最佳方案 | 不可推翻 | 用户说"我让你纳入"时已经表明了态度，架构师不应再用理由对抗；架构师的职责是执行用户决策并补充细节，不是推翻用户决策 | 架构师-1, 用户 | 2026-06-25 |
| D9 | 审视中发现的问题能否标记为"非阻塞" | 不能——设计层面的问题必须在当前方案中解决 | 可以——代码实现细节属于 development 阶段 | 区分对待 | 设计层面的问题（规则歧义、验证缺失、流程未定义）不得延期；代码实现细节（文件行号、函数签名）属于 development 阶段，设计阶段不越界 | 架构师-1, 架构师-2, 用户 | 2026-06-25 |
