# F2026052203 Agent Capability 协议层

## 背景

当前 Snail Shell 将所有 agent 能力（prompt、skill、MCP 等）通过 system prompt 文本拼接注入。随着 skill 数量增长和 runtime 多样化（Claude Code、OpenCode、Gemini、Codex），纯文本方案存在以下问题：

1. **能力不可追溯**：system prompt 是合并后的扁平文本，无法区分哪些 prompt/skill 被激活、以什么模式激活
2. **注入方式不可控**：所有 runtime 都通过相同文本注入 skill 引用，无法利用各 runtime 的原生能力注入机制
3. **扩展性差**：未来新增 mcpServers/hooks/permissions/tools/subAgents 等能力类型时，需要修改所有 adapter

## 目标

1. 定义 AgentCapability 结构化协议，作为 orchestration 和 runtime adaptation 之间的能力传递层
2. 将当前 prompt-center 的文本输出升级为结构化 `{ systemPrompt, capability }` 返回
3. 所有 runtime adapter 消费 `AgentCapability`，实现 required skill 的直接内容注入（而非文件路径引用）
4. 保持完全向后兼容：`capability.systemPrompt` 仍然是纯文本，不依赖 capability 的 runtime 不受影响

## 非目标

- 不实现 mcpServers/hooks/permissions/tools/subAgents（仅保留接口注释作为 future extension）
- 不改变 frame/prompt 的 Mustache 模板渲染逻辑
- 不改变 skill SKILL.md 的文件格式或 frontmatter schema

## 设计

### Architecture

```
Frame Assembler → AgentCapability {
                    systemPrompt: string (向后兼容)
                    prompts: PromptCapability[] (能力追溯)
                    skills: SkillCapability[] (结构化注入)
                  }
                →
  SnailRuntimeMessageInput.capability
                →
  runtime adapter 独立消费 capability
  buildSystemPromptFromCapability()
```

### 协议层

`src/agent/capability/spec.ts` 定义核心类型：

- **AgentCapability**：顶层结构，包含 `systemPrompt`（向后兼容文本）、`prompts[]`（激活的 prompt 模块）、`skills[]`（激活的 skill 能力）
- **PromptCapability**：`{ id, title, mode: "base"|"scenario" }` — B-* prompt 为 base，S-* prompt 为 scenario
- **SkillCapability**：`{ name, description, filePath, directory, mode, reason, content, title }` — 保留完整 SKILL.md 内容，让 runtime adapter 可选直接注入或路径引用

### Builder

`src/agent/capability/builder.ts` 核心函数 `buildAgentCapability()`：

1. 调用 `renderFrame()` 生成 systemPrompt
2. 从 frame 引用中收集 active prompts（过滤条件未激活的）
3. 从 active prompts 的 `skill_references` 中收集激活的 skills
4. 返回完整的 `AgentCapability`

能力发现策略：
- prompt 激活判断：通过特征标题行匹配检查 prompt 内容是否实际出现在 rendered systemPrompt 中 — 因为 `{{#when:...}}` 条件可能会过滤掉某些 prompt
- skill 激活判断：有至少一个 active prompt 在其 `skill_references` 中引用了该 skill

### Runtime Adapter

`src/agent/capability/runtime-adapter.ts` 的 `buildSystemPromptFromCapability()`：

- 当 capability 存在且包含 `mode === "required"` 的 skill 时，将完整 SKILL.md 内容嵌入 system prompt 末尾
- conditional skill 不强制注入（它们通过现有 skill 引用机制按需使用）
- 每个 required skill 添加 `[CAPABILITY-SKILL:name]` 标记用于能力追溯

### Prompt Center 集成

`src/prompt-center/builder.ts` 的 `buildConversationSystemPrompt()` 现在返回 `{ systemPrompt, capability }` 而非原来的纯字符串。所有调用方通过解构获取所需部分。

## 改动范围

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `src/agent/capability/spec.ts` | 新增 | 核心类型定义：AgentCapability、PromptCapability、SkillCapability 及 future extensions |
| `src/agent/capability/builder.ts` | 新增 | 从 frame/prompt/skill 构建 AgentCapability |
| `src/agent/capability/runtime-adapter.ts` | 新增 | buildSystemPromptFromCapability：将 required skills 嵌入 system prompt |
| `src/agent/capability/index.ts` | 新增 | 模块导出 |
| `src/prompt-center/builder.ts` | 修改 | buildConversationSystemPrompt 返回 `{ systemPrompt, capability }` |
| `src/prompt-center/index.ts` | 修改 | 导出 buildConversationCapability |
| `src/agent/interface.ts` | 修改 | SnailRuntimeMessageInput 新增 capability 字段 |
| `src/agent/claude-code.ts` | 修改 | 消费 capability 构建 system prompt |
| `src/agent/claude-code-stateful.ts` | 修改 | 消费 capability 构建 system prompt |
| `src/agent/opencode.ts` | 修改 | 消费 capability 构建 system prompt |
| `src/agent/gemini.ts` | 修改 | 消费 capability 构建 system prompt |
| `src/agent/codex.ts` | 修改 | 消费 capability 构建 system prompt |
| `src/agent/message-flow-logger.ts` | 修改 | 输出 capability 摘要 |
| `src/message-bus/collaboration.ts` | 修改 | 构建 capability 并传递给 runtime |
| `src/project-workflow/manager.ts` | 修改 | 传递 capability |
| `src/knowledge-center/governance-prompt.ts` | 修改 | 传递 capability |
| `src/roles/index.ts` | 修改 | 传递 capability |
| `src/index.ts` | 修改 | 导出 capability 模块 |

## 验证

1. **类型检查**：`npx tsc --noEmit` 通过
2. **Lint**：`npm run lint` 通过
3. **现有测试**：35 个测试文件通过
4. **行为测试**：新增 `tests/agent/capability-protocol-test.ts` 覆盖核心契约（见下方测试覆盖说明）
5. **手动验证**：runtime 日志输出 capability 摘要

### 测试覆盖

`tests/agent/capability-protocol-test.ts` 覆盖以下行为契约：

1. `buildSystemPromptFromCapability` 在无 capability 或空 skills 时原样返回 base system prompt
2. required skill 被注入 system prompt 并附加 `[CAPABILITY-SKILL:name]` 标记
3. conditional skill 不被 `buildSystemPromptFromCapability` 强制注入
4. `buildAgentCapability` 的 prompts 字段正确区分 base 和 scenario mode

## 剩余风险

1. capability 层新增的性能开销（每次 agent 调用都要构建完整 AgentCapability）未经压测
2. 未来新增 capability 字段（mcpServers 等）时的协议版本兼容策略未定义
3. conditional skill 的按需激活机制不在本 PR 范围内，当前仅通过 system prompt 文本引用
