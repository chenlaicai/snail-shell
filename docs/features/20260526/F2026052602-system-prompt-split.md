# F2026052602 系统提示词按稳定性拆分为 systemPrompt/systemReminder

## 背景

当前系统提示词将所有内容（静态规则 + 动态运行时上下文）合并为单一 `systemPrompt` 注入。这带来两个问题：

1. **缓存失效**：Anthropic API 对 system prompt 做 prompt caching。动态上下文（如 stage_id、remaining_rounds、mention_allowed）每次调用都可能变化，导致整个 system prompt 缓存失效。
2. **注入通道单一**：所有内容走 `--system-prompt` / system message 通道，缺少对动态上下文的差异化处理能力。

## 目标

- 将系统提示词按 `stability` 拆分为 `systemPrompt`（静态规则）和 `systemReminder`（动态上下文）两条独立通道
- 静态规则通过 `--append-system-prompt-file` 注入 Claude Code，利用 Anthropic API prompt caching
- 动态上下文通过 `<system-reminder>` 标签注入用户消息
- Stateful agent 仅在 systemReminder hash 变化时注入，减少重复上下文

## 非目标

- 不修改 Frame 模板的 `{{#when}}`/`{{#if}}` 条件渲染逻辑
- 不修改 Skill 引用和注册机制
- 不修改单个 prompt 文档的内容结构

## 设计

### stability 元数据

为每个 prompt 文档的 frontmatter 新增 `stability` 字段：

| stability | 含义 | 注入通道 | 示例 |
|---|---|---|---|
| `static` | 整场对话不变 | `--system-prompt` / `--append-system-prompt-file` | 身份契约、宪法规则、协议 |
| `dynamic` | 随 stage/conversation 变化 | `<system-reminder>` 标签 | 项目上下文、阶段进度、角色信息 |

默认值：`static`（兼容未声明 stability 的 prompt）

### 拆分渲染管线

`renderFrameSplit()` 替代 `renderFrame()`，输出 `{ systemPrompt, systemReminder }`：

1. 按 `stability` 构建 lookup map
2. 两路独立渲染：`renderStabilityPass(content, stabilityMap, "static")` 和 `renderStabilityPass(content, stabilityMap, "dynamic")`
3. 每路只展开匹配 stability 的 `{{prompt:ID}}` 引用，不匹配的替换为空
4. 条件块（`{{#when}}`/`{{#if}}`）两边都评估，变量替换两边都做
5. 清理因 prompt 过滤产生的空段落

### ACP 协议变更

`AgentCapability` 接口新增 `systemReminder` 字段：

```typescript
interface AgentCapability {
  systemPrompt: string;    // 静态规则（已有）
  systemReminder: string;  // 动态上下文（新增）
  // ...
}
```

移除 `systemPrompts` 冗余字段（原用于 stateful/stateless 差异化，拆分后不再需要）。

### systemReminder hash 跟踪

`collaboration.ts` 按 session 跟踪 systemReminder hash，仅变化时注入：

```typescript
const systemReminderHashBySession = new Map<string, string>();

function resolveEffectiveSystemReminder(session, systemReminder) {
  if (session.context_provider === "shell") return systemReminder;  // stateless 每次注入
  const hash = sha256(systemReminder);
  if (hash === lastHash) return "";  // stateful 已注入过
  return { reminder: systemReminder, pendingHash: hash };  // hash 仅在 agent 成功后提交
}
```

**关键时序**：hash 在 agent 调用**成功后**才写入 `systemReminderHashBySession`。如果 agent 调用失败/超时/中断，下一次重试仍会注入相同的 systemReminder，避免动态上下文被吞掉。

### Agent adapter 适配

| Agent | static 注入方式 | dynamic 注入方式 |
|---|---|---|
| Claude Code | `--append-system-prompt-file` | `<system-reminder>` 标签（user message 前缀） |
| Claude Code Stateful | `--append-system-prompt-file` (bootstrap) | `<system-reminder>` 标签（hash 去重） |
| OpenCode Stateful | system message | `<system-reminder>` 标签（hash 去重） |
| Gemini | system message | `<system-reminder>` 标签 |
| Codex | system message | `<system-reminder>` 标签 |

## 改动范围

| 层 | 文件 | 变更说明 |
|---|---|---|
| 数据 | 11 个 `.meta/prompts/prompts/*.md` | 新增 `stability: static\|dynamic` frontmatter |
| 渲染 | `src/prompt-center/registry.ts` | 新增 `renderFrameSplit()`、`renderStabilityPass()`、`cleanupEmptySections()` |
| 渲染 | `src/prompt-center/builder.ts` | 调用 `renderFrameSplit()` 替代 `renderFrame()` |
| 协议 | `src/agent/capability/spec.ts` | `AgentCapability` 新增 `systemReminder`，移除 `systemPrompts` |
| 协议 | `src/agent/interface.ts` | `StatelessInvocationInput` 新增 `systemReminder` |
| 编排 | `src/message-bus/collaboration.ts` | session 级 systemReminder hash 跟踪；hash 延迟提交 |
| Agent | `src/agent/claude-code.ts` | `--append-system-prompt-file` + `<system-reminder>` 注入 |
| Agent | `src/agent/claude-code-stateful.ts` | 同上 + hash 去重 |
| Agent | `src/agent/opencode.ts` | `<system-reminder>` 注入 |
| Agent | `src/agent/gemini.ts` | `<system-reminder>` 注入 |
| Agent | `src/agent/codex.ts` | `<system-reminder>` 注入 |
| 辅助 | `src/agent/prompt-mapper.ts` | `StatelessInvocationInput` 类型更新 |
| 辅助 | `src/agent/stateful-prompt-format.ts` | `StatelessInvocationInput` 类型更新 |
| 辅助 | `src/agent/message-flow-logger.ts` | systemReminder 日志输出 |
| 测试 | 8 个测试文件 | 适配新协议和渲染行为 |

## prompt stability 分配

| ID | 标题 | stability | 理由 |
|---|---|---|---|
| B-01 | 身份与责任契约 | static | 整个对话期间不变 |
| B-02 | 知识治理 | static | 整个对话期间不变 |
| B-03 | 运行时边界 | static | 整个对话期间不变 |
| S-01 | 项目上下文 | dynamic | 包含 stage/feature/conversation 变量 |
| S-02 | 历史能力 | dynamic | 包含 conversation-id 变量 |
| S-03 | 研发者手册 | static | 角色规则文本固定，由 `{{#when:roles=...}}` 在渲染时选择 |
| S-04 | 检视者手册 | static | 同上 |
| S-05 | mention 提取 | static | 协议规则固定，不随调用变化 |
| S-06 | 会话摘要 | static | 协议规则固定，不随调用变化 |
| S-07 | 知识库能力 | static | 协议规则固定，不随调用变化 |
| S-08 | 知识执行者手册 | static | 协议规则固定，不随调用变化 |

## 验证

- [x] TypeScript 编译零错误
- [x] ESLint 零错误
- [x] 全部 8 项测试通过（capability-protocol、claude-code、claude-code-stateful、codex-buildargs、opencode-parser、stateful-prompt-format、collaboration、stage-cycle）

## 风险

- **systemReminder 吞没风险**（已修复）：初版实现在 agent 调用前写入 hash，失败重试时 hash 已标记为 "已发送" 导致 reminder 被吞。修复方案：hash 延迟到 agent 调用成功后提交。
- **拆分一致性**：`renderFrameSplit()` 两路独立渲染，如果 `expandPromptReferencesFiltered` 逻辑与 `expandPromptReferences` 不一致，可能导致内容丢失。缓解：核心条件评估和变量替换管线共享同一套函数。
