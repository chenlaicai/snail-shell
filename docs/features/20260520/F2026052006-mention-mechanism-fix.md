# F2026052006 修复 Stateful CLI Agent 的 mention 提取失败

## 背景

研发者（使用 Claude Code Stateful Agent）通过 `message-out` 协议 mention 检视者时，结构化路由失败。根因是 Claude Code 将 message-out JSON 包裹在 markdown 代码围栏（`` ```json ... ``` ``）中输出，而 `extractEmbeddedMessageOutCandidate` 在扫描嵌入 JSON 时，尾部 `` ``` `` 导致 `JSON.parse` 失败，使结构化 mention 提取退化到不可靠的 LLM fallback。

检视者（使用 OpenCode Agent）没有此问题，因为 OpenCode 输出不包裹代码围栏，或输出格式不同。

数据库分析确认：
- 研发者所有使用 `message-out` 工具的输出都被包在 ```` ```json ```` 围栏中
- `extractEmbeddedMessageOutCandidate` 扫描每个 `{` 并尝试 `JSON.parse`，但每个候选都包含尾部 `` ``` `` 导致解析失败
- 退化为纯文本后，结构化 mentions 为空；仅当文本中出现 `@检视者` 且 LLM fallback 成功才能路由

## 目标

修复 `extractEmbeddedMessageOutCandidate` 使其能正确提取被 markdown 代码围栏包裹的 message-out JSON 负载。

## 非目标

- 不修改 Claude Code 的输出格式偏好
- 不修改 `message-out` SKILL.md 的使用协议
- 不影响 OpenCode 或其他 agent 的现有正确行为

## 设计

### 修改位置

`src/message-bus/message-out.ts` 中的 `extractEmbeddedMessageOutCandidate` 函数。

### 方案

在尝试 `JSON.parse(candidate)` 之前，先剥离候选文本首尾可能存在的 markdown 代码围栏标记：

```typescript
function stripMarkdownCodeFence(text: string): string {
  return text
    .replace(/^```[\w-]*\s*\n?/, '')   // 剥离首行 ```json 等
    .replace(/\n?```\s*$/, '');         // 剥离尾行 ```
}
```

将剥离后的文本用于 `parseMessageOutPayload` 尝试。

### 为什么不用更复杂的平衡括号提取

- 代码围栏剥离是确定性问题，匹配模式明确
- 平衡括号提取在处理嵌套 JSON 时更脆弱（需处理字符串内 `{`/`}`、转义等）
- 剥离围栏后 `JSON.parse` 对完整 JSON 对象最可靠

### 为什么不在更上层修复

在 `getMentionSourceEvents` 或 `parseMessageOutTextIfPresent` 层修复会增加不必要的耦合。代码围栏是文本格式化问题，应在最接近文本解析的位置处理。

## 生效路径

本 feature 的修复仅通过代码生效，不涉及配置、提示词、CI 或工作流产物变更：

- `src/message-bus/message-out.ts`：`extractEmbeddedMessageOutCandidate` 函数是 message-out 嵌入 JSON 提取的唯一路径，修复后所有通过 message bus 的 mention 路由均自动受益，无需 Agent 侧配合改动。

## 改动范围

- `src/message-bus/message-out.ts`：修改 `extractEmbeddedMessageOutCandidate` 函数

## 验证

- 单元测试：覆盖 markdown 代码围栏包裹的 message-out JSON 提取
- 单元测试：回归覆盖无围栏的原始嵌入 JSON 提取
- 单元测试：覆盖代码围栏内外有其他文本的场景

## 风险与决策记录

- 剥离围栏使用正则 `/^```[\w-]*\s*\n?/`，language identifier 仅匹配 `[\w-]*`（字母、数字、下划线、连字符）。如果未来出现特殊 language identifier 包含非 `[\w-]` 字符，剥离可能不完整。当前已覆盖所有常见 identifier：json、javascript、bash 等。
- 剥离尾围栏使用 `/\n?```\s*$/`，仅移除文本末尾的围栏标记。如果候选文本中 JSON 之后还有其他内容（如 "text after\n```"），剥离可能不完整。`extractEmbeddedMessageOutCandidate` 从第一个 `{` 切片到文本末尾，`JSON.parse` 要求整个字符串是有效 JSON，尾随非空白内容会导致解析失败。此场景下，JSON 之后的非围栏文本也会导致 `JSON.parse` 失败，函数继续扫描下一个 `{`，这是安全的降级行为。

## 范围变更记录

- 检视阶段（2026-05-20）：检视者指出 feature 文档缺少 `## 生效路径` 和 `## 范围变更记录` 章节，且 `## 风险与决策记录` 最后一条括号内表述不完整。已补齐两项缺失章节并修正风险记录表述；本次变更不涉及代码、测试或 PR diff 范围变化。
- 检视阶段（2026-05-20）：检视者指出文档编号 `F2026052005` 与 `origin/main` 上已有的 `F2026052005-claude-runtime-error-resilience.md` 重号，违反 `docs/README.md` 编号规则。已将文档重编号为 `F2026052006`（当天下一个可用编号）。
