# Lite AI 模块分析（v1 遗留，原 llm/）

> 本文档基于 `v1/src/llm/` 目录下的遗留代码分析，用于指导 v2 重写。

---

## 一、业务场景

### 1.1 Lite AI 是什么

Lite AI 是 Snail Shell 的**内嵌小模型系统**，用于系统内部的轻量辅助任务。与主 Agent 运行时（Claude Code CLI、OpenCode、Codex）不同，Lite AI 直接调用 OpenAI 兼容的 chat completions API，处理 mention 提取和对话摘要等辅助任务。

核心定位：**系统助手，非 Agent 运行时**。通过 `SystemAISnail` 门面类暴露能力，注入到 WorkspaceManager。

### 1.2 核心业务场景

| 场景 | 说明 | 状态 |
|------|------|------|
| **Mention 提取** | 从用户消息文本中提取 @role mention，作为结构化 mention 的 LLM 兜底 | **已启用** |
| **对话摘要** | 压缩最近 8 条消息为 220-320 字符的会话概览 | **已禁用**（注入 no-op） |
| **消息上下文摘要** | 压缩单条消息的终端上下文（>12000 字符时触发，目标 3000 字符） | **已禁用**（注入 null） |

### 1.3 Lite AI 与其他模块的关系

- **IM（消息协作）**：`resolveMentions()` 调用 `systemAI.extractMentions()` 作为 LLM 兜底
- **Message Context**：`buildTerminalMessageContext()` 可选调用 `summaryGenerator` 压缩长消息
- **Conversation**：`refreshConversationSummary()` 可选调用摘要生成（当前禁用）
- **Snail Den**：`SystemAISnail` 是 Snail Den 中的特殊成员，使用直接 OpenAI 调用而非 CLI Agent
- **配置**：读取 `config/llm.json`，用户本地文件，不提交

---

## 二、数据模型

### 2.1 配置格式

`config/llm.json`：
```json
{
  "provider": "openai",
  "openai": {
    "api_key": "sk-...",
    "model": "gpt-4.1-mini",
    "base_url": "https://api.openai.com/v1",
    "timeout_ms": 60000
  }
}
```

**LlmConfig 类型**：
```typescript
interface LlmConfig {
  provider: "openai";
  openai: {
    api_key: string;
    model: string;
    base_url: string;
    timeout_ms: number;
  };
}
```

### 2.2 无数据库表

Lite AI 纯运行时调用，不入库。

---

## 三、核心组件

### 3.1 OpenAIClient（openai.ts）

裸 HTTP 客户端，无 SDK 依赖：

| 特性 | 值 |
|------|-----|
| 重试 | 指数退避，最多 3 次，仅 5xx/429/timeout |
| 基础延迟 | 1000ms，每次翻倍 |
| 超时 | 默认 15000ms，可配置 |
| Temperature | 硬编码 0.2（低随机性，适合确定性提取/摘要） |
| 响应解析 | 4 种格式兼容：choices[0].message.content / delta.content / text / output_text |
| 内容格式 | 支持纯字符串和 {type, text} 数组 |

### 3.2 MentionExtractor（mention-extractor.ts）

**用途**：从用户消息文本中提取 @role mention，作为结构化 mention 的 LLM 兜底。

**输入**：
```typescript
{ messageText: string; participatingRoles: Array<{ name: RoleName }> }
```

**输出**：
```typescript
{ mentions: Array<{ role: RoleName; raw: string }> }
```

**System Prompt 要点**（中文）：
- `@` 指向候选角色 → 视为 mention
- 请求角色参与/确认/审查/响应/处理 → 视为 mention
- 直接分配任务给角色 → 视为 mention
- 自我介绍、职责描述、历史回顾、纯事实陈述 → **不视为** mention
- 仅输出候选列表中精确匹配的角色
- 严格 JSON 输出：`{"mentions":[{"role":"...","raw":"..."}]}` 或 `{"mentions":[]}`

**防御性解析**：
- JSON.parse try/catch → 失败返回空 mentions
- 过滤不在候选列表中的角色
- 过滤缺少 role/raw 字段或为空的条目

### 3.3 ConversationSummaryGenerator（summary.ts）

**方法一：generateConversationSummary**（对话摘要）

- 输入：conversation title, kind, previous summary, 最近 8 条消息（每条截断 400 字符）
- 输出：220-320 中文字符，最多 400
- 格式：`## 会话概览`（最多 2 句）+ `## 当前进展`（当前状态 + 后续动作）
- 保留：目标、约束、已确认决策、关键冲突、未解决问题、下一步
- 压缩：已有摘要中的稳定信息
- 禁止：逐字引用消息、流水账

**方法二：generateMessageContextSummary**（消息上下文摘要）

- 输入：目标字符数 + 原始上下文文本
- 输出：压缩后的中文摘要
- 保留：用户指令、结论、失败原因、关键文件/命令/artifact 引用
- 删除：冗余日志、重复文本、无关过程

**阈值**（定义在 message-context.ts）：
- `MESSAGE_CONTEXT_LLM_SUMMARY_THRESHOLD_CHARS = 12000` — 超过此长度才触发 LLM 摘要
- `MESSAGE_CONTEXT_LLM_SUMMARY_TARGET_CHARS = 3000` — 压缩目标
- LLM 失败时降级为确定性截断（12000 字符 + "[上下文因摘要不可用被安全截断]"）

---

## 四、核心流程

### 4.1 启动初始化

```
main.ts
  → loadLlmConfig() → 读取 config/llm.json
  → createOpenAIClient(llmConfig) → OpenAIClient(api_key, model, base_url, timeout_ms)
  → new SystemAISnail(openAIClient) → 门面类，封装 extractMentions + generateSummary
  → new WorkspaceManager(store, agentResolver, { systemAI, snailDen })
```

### 4.2 Mention 提取流程（已启用）

```
用户发送消息
  → resolveMentions(events, participatingRoles)
    → 优先：从事件中提取结构化 mention（text/content_block 的 mentions 字段）
    → 兜底：如果文本含 @ 但无结构化 mention
      → systemAI.extractMentions(messageText, participatingRoles)
        → OpenAIClient.chat([{ system, user }], { temperature: 0.2 })
        → parseExtractionResult(response) → 防御性解析 + 过滤
      → 结果过滤为 conversation.participating_roles 中的角色
```

### 4.3 对话摘要流程（已禁用）

```
Agent 回复完成后
  → refreshConversationSummary() ← 当前注入为 no-op
  → 实际实现：summary-input.ts
    → 获取最近 8 条消息
    → systemAI.generateConversationSummary({ title, kind, previousSummary, messages })
    → store.updateConversationSummary(conversationId, summary)
```

### 4.4 消息上下文摘要流程（已禁用）

```
消息完成后 buildTerminalMessageContext()
  → deterministicContext = buildDeterministicMessageContext(events)
  → if len > 12000 && summaryGenerator !== null ← 当前注入为 null
    → summaryGenerator.generateMessageContextSummary(3000, deterministicContext)
    → kind = "llm_summary"
  → else → 硬截断 12000 字符
```

---

## 五、关键设计决策（v1）

1. **裸 HTTP 客户端** — 无 SDK 依赖，手写 OpenAI 兼容 HTTP 调用
2. **Temperature 0.2** — 低随机性，适合确定性提取和摘要
3. **单模型共享** — 所有辅助任务使用同一个 gpt-4.1-mini 模型，无 per-task 模型区分
4. **防御性解析** — JSON.parse try/catch + 字段校验 + 候选列表过滤
5. **中文 Prompt** — 所有 system prompt 使用中文，输出格式严格约束
6. **功能可独立禁用** — 通过依赖注入 no-op/null 独立禁用各功能
7. **重试策略** — 仅对 5xx/429/timeout 重试，4xx 不重试
8. **配置文件驱动** — `config/llm.json` 用户本地文件，不提交

---

## 六、v2 重写待决问题

1. **是否需要 SDK？** 当前裸 HTTP，是否需要引入 OpenAI SDK 或统一 LLM 抽象层？
2. **模型是否需要 per-task 配置？** 当前单模型共享，mention 提取和摘要是否需要不同模型？
3. **对话摘要是否重新启用？** 当前禁用，依赖 Agent 侧状态追踪，是否需要恢复？
4. **消息上下文摘要是否重新启用？** 当前禁用，是否需要恢复 LLM 压缩？
5. **是否需要支持更多 provider？** 当前仅 OpenAI 兼容，是否需要 Azure/Anthropic/本地模型？
6. **Temperature 是否需要可配置？** 当前硬编码 0.2
7. **是否需要流式调用？** 当前非流式，摘要场景是否需要流式？
8. **缓存策略？** 相同输入的提取/摘要结果是否需要缓存？
