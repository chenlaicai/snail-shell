# F2026052206 Agent Capability 协议层

## 背景

### 问题现象

Snail Shell 作为多 agent 编排系统，需要在每次 agent 调用前组装完整的能力注入。当前实现中，frame 模板通过 `{{prompt:B-01}}` 引用展开 prompt 模块，prompt 通过 `skill_references` 声明依赖的 skill，最终所有内容收敛为一个 system prompt 文本字符串注入到 agent。

这个流程在项目初期（1-2 个 runtime、少量 skill）运转正常。但随着 runtime 从 1 个（Claude Code）扩展到 5 个（Claude Code、OpenCode、Gemini、Codex、Stateful），skill 从 2 个增长到 10+ 个，纯文本方案的系统性问题开始暴露。

**具体症状**：

1. **调试盲区**：当 agent 行为异常（如强制使用了不该用的 skill），无法从 system prompt 中直接定位是哪个 prompt 模块、哪个 `skill_references` 导致了该行为。system prompt 只是合并后的扁平文本。

2. **重复实现**：新增 Gemini runtime 时，skill 注入逻辑在 adapter 中独立实现了一遍（与 Claude Code adapter 的注入逻辑不共享）。后续 OpenCode、Codex 又是各自的实现——同一语义分散在 5 个文件里，修改时必须逐一手动对齐。

3. **文件读取浪费**：当前 skill 在 system prompt 中以文件路径引用（"路径: .meta/skills/message-out/SKILL.md"），agent 在需要时必须调用文件读取工具获取完整内容。对于 `mode: required` 的 skill，这把一个确定性动作变成了 I/O 延迟。

4. **测试脆弱**：`collaboration-test.ts` 的 mock 不得不硬编码 `{ systemPrompt: "system prompt", capability: { systemPrompt: "system prompt", prompts: [], skills: [] } }`——测试无法感知 capability 的结构变化，协议变更的回归覆盖完全依赖人工。

### 根因：三个独立但互相放大的失败模式

表面看是"skill 多了、runtime 多了导致代码重复"，但拆开来看是三个独立的架构退化模式，彼此级联放大。

#### 失败模式 1：能力的声明和消费塌缩为同一个文本动作（Declaration-Consumption Collapse）

当前流水线：`Frame 模板 → prompt 展开 → skill 引用拼接 → system prompt 字符串`。问题在于最后一步——一旦生成字符串，**所有结构化元数据就丢失了**。

用类比说明：C 编译器把源代码编译成机器码后，symbol table（函数名、变量类型、调用关系）如果不单独保存，调试时只能面对 hex dump 猜测"这段指令是哪个函数生成的"。

Capability 流水中同样如此：
- `buildConversationCapability()` 内部调用了 `renderFrame()`、`collectActivePrompts()`、`collectActiveSkills()`，这些函数都知道"哪些 prompt 被激活""哪些 skill 被引用"
- 但最终返回值退化为单个字符串 `systemPrompt`，结构信息被丢弃
- 下游消费者（runtime adapter、logger、tests）只能拿到字符串，无法知道能力构成

这不是实现 bug，而是**数据模型的设计缺陷**——能力声明（"这个 agent 有哪些能力"）和能力注入（"能力以什么格式给到 agent"）被强制合并为一个动作，且以丢失前者为代价。

#### 失败模式 2：下游消费方被锁定在"全部能力 = 文本拼接"的注入策略（Injection Strategy Lock-in）

不同 runtime 有各自原生的能力注入机制：

| Runtime | 原生 capability 机制 |
|---|---|
| Claude Code | 原生 skills 目录、`.mcp.json` 用于 MCP |
| OpenCode | `opencode.json` 的 `mcp`/`permissions` 段 |
| Gemini CLI | `gemini.json` 配置项 |
| Codex | `codex.yaml` 能力声明 |

但当前系统将所有能力强制注入到 system prompt 文本中。这意味着：
- Claude Code 的 native skills 目录机制无法使用——skill 只能作为文本嵌入 system prompt
- 新增 MCP 支持时，不能写入 `.mcp.json`，只能把 MCP 配置转为自然语言描述嵌入到 prompt 里
- 每个 runtime adapter 独立理解"如何把 capability 文本转回为它的原生格式"——但因为这个"转回"逻辑不在协议层中，它实际上根本不会发生

用类比：给五个人发同一封"请帮我买咖啡"的邮件，但五个人分别习惯用 Slack、微信、飞书、Teams、短信接收指令。每个人都得自己解析邮件→ 翻译到自己的工具，而且翻译结果因人而异。

#### 失败模式 3：新增能力类型触发 N×M 爆炸（Capability Type × Adapter Matrix）

当前能力 = system prompt 文本。如果要新增一种能力类型（如 `MCP 服务器`、`Hook 定义`、`权限矩阵`）：

- 需要修改 `buildConversationCapability()` 的返回值结构（不再是纯字符串）
- 需要修改 5 个 runtime adapter 各自实现新能力的注入逻辑
- 需要修改 `SnailRuntimeMessageInput` 的类型定义
- 需要修改 `message-flow-logger` 的日志格式

总计：**1 个能力类型 × (1 个 builder + 5 个 adapter + 1 个 interface + 1 个 logger) = 至少 8 处修改**。

这不是单次工作量问题，而是**边际成本恒定的恶性扩展模式**——每增加一个能力类型，成本不变甚至递增。因为在没有统一协议层的情况下，每个 adapter 的实现是独立的，它们之间没有共享验证、共享序列化、共享组合逻辑。

### 因果链：三级放大

```
失败模式 1（声明消费塌缩）
    ↓ 导致
    下游只能拿到扁平的 systemPrompt 文本，失去结构化判断能力
    ↓ 进而形成
失败模式 2（注入策略锁定）
    所有 runtime 被锁定在"文本拼接是唯一注入方式"
    无法使用各 runtime 的原生能力注入机制
    ↓ 最终演化为
失败模式 3（N×M 扩展爆炸）
    每新增一种能力类型或一个 runtime，修改范围线性扩大
    边际成本恒定，无法通过抽象收束
    ↓ 主观影响
    开发者抗拒新增能力类型 → 系统能力停滞 → 知识的价值无法传导到 agent
```

三层各自独立存在：即使没有失败模式 2，失败模式 1 也会导致调试困难；即使没有失败模式 3，失败模式 2 也会让 runtime 能力注入质量参差不齐。但在 Snail Shell 的多 runtime 架构中，三者恰好形成完整的**退化链路**——从数据模型的丢失开始，到消费策略的锁死，再到扩展模式的崩塌。

### 核心矛盾："文本拼接的即时便利"与"结构化能力的可组合性"

更深层的问题是：**"组装一个 system prompt 字符串"的效率和"管理一个多能力 agent"的质量之间存在结构性冲突**。

- **文本拼接的便利**：Frame + Mustache → 字符串，任何接受文本的 agent 都能消费，开发只需管"这段文本写对了没"
- **结构化能力的质量**：需要类型定义、协议约定、能力组合逻辑、消费者适配层

当前的文本拼接路径是所有方案中**实现成本最低**的——作为一个一开始只有 1 个 runtime、少量 skill 的系统，这是正确的起点。但系统演进后，"文本"这条路的本质限制开始显现：

1. **文本不可组合**：你不能把两个 system prompt "合并"成一个——合并后的冲突（哪个规则优先？哪个 skill 覆盖哪个？）需要人工裁决
2. **文本不可判断**：你不能用代码判断"这个 agent 有没有 message-out skill"，只能靠字符串匹配
3. **文本不可适配**：你不能针对不同 runtime 自动翻译能力注入格式，因为文本不携带"这是一个 skill"的语义标签

这不是"文本方案做错了"，而是**文本方案做到了它设计能力的极限**——继续往文本管道里塞更多能力类型，就像往 JSON 字符串里不断拼 `&field=value`，最终变成 query string 地狱。

本 feature 的解决方案不是抛弃文本（`systemPrompt` 仍然是向后兼容字段），而是**在文本之上增加结构化层**——让同样一段数据有"文本"和"结构"两个视图。文本维持最低可用性，结构提供类型安全、能力追溯和运行时适配能力。

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
prompt-center/builder.ts (完整组装点)
  ├── renderFrame() → systemPrompt 文本
  ├── injectRequiredSkills() → 将 skill 内容嵌入 systemPrompt
  ├── collectActiveSkills() → ACP 的 skills[] 列表
  └── return AgentCapability { systemPrompt(出厂即完整), skills }

agent adapter (透传消费)
  └── const prompt = input.capability.systemPrompt;  // 不自行组装
```

### 协议层

`src/agent/capability/spec.ts` 定义 ACP 核心类型。协议只包含 agent 需要的字段，不携带 Snail Shell 内部概念：

- **AgentCapability**：`{ systemPrompt: string; skills: SkillCapability[] }` — agent 关注的只有"完整指令文本"和"可用能力列表"
- **SkillCapability**：`{ name, description, content, filePath, directory }` — skill 的完整信息，不含 mode/reason/title

精简理由：
- `prompts[]` 剔除 — agent 不区分 B-01/B-02，那是 Snail Shell 内部追溯信息
- `mode` 剔除 — "required/conditional" 是 prompt 引用层的概念，agent 没有这个机制
- `PromptCapability` / `PromptMode` / `SkillMode` 类型移除

### Builder

`src/agent/capability/builder.ts` 唯一导出 `collectActiveSkills()`，职责单一：从 prompt 的 `skill_references` 翻译为 ACP 的 `SkillCapability[]`。不做 systemPrompt 组装。

### 组装入口

`src/prompt-center/builder.ts::buildConversationCapability()` 是唯一的能力组装入口：

1. `renderFrame()` — 渲染 frame + prompt 为 systemPrompt 文本
2. `collectActiveSkills()` — 收集 ACP 协议的 skills[] 列表
3. `injectRequiredSkills()` — 将所有 skill 完整内容嵌入 systemPrompt 末尾
4. 返回 `AgentCapability { systemPrompt, skills }`

`systemPrompt` 出厂即完整。agent adapter 消费时只做 `input.capability?.systemPrompt ?? fallback`，不调任何组装函数。

### Agent 消费方式

```typescript
// 所有 5 个 agent adapter 的统一模式
const systemPrompt = input.capability.systemPrompt;

// 未来 Claude Code native skills 注入时：
// if (input.capability.skills.length > 0) createNativeSkillsDir(input.capability.skills);
```

## 改动范围

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `src/agent/capability/spec.ts` | 新增 | ACP 核心类型定义：AgentCapability、SkillCapability |
| `src/agent/capability/builder.ts` | 新增 | collectActiveSkills：从 prompt skill_references → ACP SkillCapability[] |
| `src/agent/capability/index.ts` | 新增 | 模块导出 |
| `src/prompt-center/builder.ts` | 修改 | buildConversationCapability 成为唯一组装入口：renderFrame + injectRequiredSkills + collectActiveSkills |
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

1. SkillCapability 类型不含 mode/reason/title 等 Snail Shell 内部字段
2. AgentCapability 类型不含 prompts 等 Snail Shell 内部字段
3. `collectActiveSkills` 从 prompt skill_references 收集 SkillCapability[]
4. 多个 prompt 引用同一 skill 时去重
5. prompt 无 skill_references 时返回空数组
6. 未知 prompt ID 被静默忽略

## 剩余风险

1. capability 层新增的性能开销（每次 agent 调用都要构建完整 AgentCapability）未经压测
2. 未来新增 capability 字段（mcpServers 等）时的协议版本兼容策略未定义
3. conditional skill 的按需激活机制不在本 PR 范围内，当前仅通过 system prompt 文本引用

## 范围变更记录

### 变更 1（检视修复：补齐 feature 文档 + 行为测试）

- 新增 `docs/features/20260522/F2026052203-agent-capability-protocol.md`
- 新增 `tests/agent/capability-protocol-test.ts`（8 个行为测试）
- 修正 `scripts/check-feature-doc-numbering.ts` 以允许同一 Feature 多个文档共存

### 变更 2（编号顺延）

- **原编号**：F2026052203
- **现编号**：F2026052206
- **原因**：`origin/main` 已合入 F2026052204（兼容残留清理）和 F2026052205（Mermaid 渲染防御），当前 Feature 编号顺延

### 变更 3（根因分析充实）

- 补充三层失败模式分析：声明消费塌缩 → 注入策略锁定 → N×M 扩展爆炸
- 补充因果链和核心矛盾分析
- 参考 F2026052105 的结构化根因分析方法论

### 变更 4（ACP 协议精简：剔除 Snail Shell 内部概念）

- 移除 `PromptCapability` / `PromptMode` / `SkillMode` 类型
- `AgentCapability` 移除 `prompts[]` 字段
- `SkillCapability` 移除 `mode` / `reason` / `title` 字段
- 删除 `capability/runtime-adapter.ts`（注入逻辑上移到 prompt-center/builder）
- `capability/builder.ts` 简化为 `collectActiveSkills`
- 5 个 agent adapter 全部改为直接读 `input.capability.systemPrompt`，不复用任何组装函数
- 原因：ACP 是 agent 协议，不是 Snail Shell 内部追溯工具
