---
id: F2026061705
title: fix-claude-code-stateful-system-reminder-injection
from_ids: [F2026061602]
tags:
  - acs
  - claude-code
  - system-reminder
  - bugfix
modules:
  - acs
doc_kind: spec
---

# F2026061705 [acs] claude-code-stateful 注入 system-reminder

## 背景

F2026061602 优化了 system-reminder 的结构（identity + handbook + context），由 `collaboration.ts` 的 `buildSystemReminder()` 构建完整内容，包含角色实例列表、阶段信息、协作规则等。

但在实际运行中，架构师-1（claude-code-stateful 驱动）回复「当前会话里只有我一个 Agent」，不知道架构师-2 的存在。

排查发现：`claude-code-stateful.ts` 的 agent 适配器**完全忽略了 `systemReminder`**，只注入了 `systemPrompt`（tenet prompts）。

### 对比验证

| Agent | systemPrompt | systemReminder | 角色实例可见 |
|-------|-------------|----------------|-------------|
| opencode | ✅ renderStatefulPrompt | ✅ renderStatefulPrompt | ✅ 可见 |
| claude-code-stateful | ✅ --append-system-prompt-file | ❌ **被丢弃** | ❌ 不可见 |

数据库查询确认：所有 issue 的 design 阶段，架构师-2 的 `snail_instance_id` 均为 `null`（未被调用过），唯一的例外是用户手动 `@架构师-2` 触发的 test06。

## 目标

1. 修复 claude-code-stateful agent 的 system-reminder 注入
2. 保持与 opencode agent 的行为一致性

## 非目标

1. 不改变 collaboration 层的 system-reminder 构建逻辑
2. 不改变 snail adapter 层的透传逻辑
3. 不改变消息路由逻辑（default_role_instance 仍然是架构师-1）

## 设计

### 问题定位

`PromptSpec` 接口定义了两个字段：

```typescript
interface PromptSpec {
  systemPrompt: string;    // 静态系统提示词（tenet prompts）
  systemReminder: string;  // 动态运行时上下文（角色实例、阶段信息等）
}
```

opencode agent 的 `invokeFirstCall` 正确使用了两者：

```typescript
// opencode.ts:60-61
const statefulInput = buildStatefulPromptInput(true, request.prompt.systemPrompt, request.prompt.systemReminder, request.messages);
const promptText = renderStatefulPrompt(statefulInput, { skipSystemPrompt: false });
```

claude-code-stateful agent 只使用了 `systemPrompt`：

```typescript
// claude-code-stateful.ts (修复前)
private addPromptFileArg(args: string[], prompt: FirstCallRequest["prompt"]): string | null {
  if (!prompt.systemPrompt) return null;  // 只检查 systemPrompt
  const filePath = join(tmpdir(), `snail-system-prompt-${randomUUID()}.txt`);
  writeFileSync(filePath, prompt.systemPrompt, "utf-8");  // 只写入 systemPrompt
  args.push("--append-system-prompt-file", filePath);
  return filePath;
}
```

### 修复方案

**注入通道分工**：
- `systemPrompt`（静态系统提示词）→ 通过 `--append-system-prompt-file` 注入（首次调用）
- `systemReminder`（动态运行时上下文）→ 通过 user message content block 注入（首次 + resume 均如此）

**首次调用（invokeFirstCall）**：`addPromptFileArg` 保持原样只处理 `systemPrompt`，`systemReminder` 作为 user message 的第一个 content block 通过 stdin 发送。

**后续调用（invokeResume）**：`systemReminder` 同样作为 user message 的第一个 content block 通过 stdin 发送。

两条路径行为一致：`systemReminder` 始终放在 user message 中，以 `<system-reminder>` 标签包裹：

```xml
<system-reminder>
{collaboration.buildSystemReminder() 的完整输出}
</system-reminder>
```

### 改动文件

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/infra/acs/_internal/agents/claude-code-stateful.ts` | 修改 | 2 处改动 |

#### 改动 1：invokeFirstCall 调用 writeMessages

```typescript
// 修复前
this.writeMessages(proc, request.messages);

// 修复后
this.writeMessages(proc, request.messages, request.prompt.systemReminder);
```

#### 改动 2：invokeResume 调用 writeMessages

```typescript
// 修复前
this.writeMessages(proc, request.messages);

// 修复后
this.writeMessages(proc, request.messages, request.systemReminder);
```

#### 改动 3：writeMessages 方法签名和实现

```typescript
// 修复前
private writeMessages(proc: ChildProcess, messages: Message[]): void {
  const contentBlocks = messages.map(msg => ({ ... }));
  // ...
}

// 修复后
private writeMessages(proc: ChildProcess, messages: Message[], systemReminder?: string): void {
  const contentBlocks: Array<{ type: string; text: string }> = [];
  if (systemReminder) {
    contentBlocks.push({ type: "text", text: `<system-reminder>\n${systemReminder}\n</system-reminder>` });
  }
  contentBlocks.push(...messages.map(msg => ({ ... })));
  // ...
}
```

### 设计约束

- `<system-reminder>` 标签格式与 opencode 的 `renderStatefulPrompt` 一致
- `writeMessages` 的 `systemReminder` 参数为 optional，向后兼容
- 首次调用的 systemReminder 在 prompt 文件中，resume 时在消息中（因为 resume 不重新注入 system prompt）

## 验证

- [x] TypeScript 编译通过（`npx tsc --noEmit`）
- [x] ESLint 通过（`npx eslint src/infra/acs/_internal/agents/claude-code-stateful.ts`）
- [x] `npm run build` 通过
- [ ] 实际运行：架构师-1 能看到架构师-2 的存在

## 关联

- **前置**: F2026061602 — 优化 system-reminder 结构和身份锚定（构建了完整的 system-reminder 内容）
- **修复**: claude-code-stateful agent 未注入 system-reminder 的 bug

## 变更记录

### 2026-06-17: 初始修复

- 修复 `addPromptFileArg`：首次调用注入 systemReminder
- 修复 `writeMessages`：resume 调用注入 systemReminder
- 创建特性文档
