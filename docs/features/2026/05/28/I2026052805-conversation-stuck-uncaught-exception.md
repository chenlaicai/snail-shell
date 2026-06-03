---
id: I2026052805
title: conversation-stuck-uncaught-exception
from_ids: []
tags: [bugfix, agent, error-handling]
modules: [agent]
doc_kind: spec
---

# I2026052805 [agent] 修复对话卡住：uncaughtException 空错误对象

## 背景

系统日志中出现大量 `Uncaught exception {"error":{}}` 空错误对象，伴随对话卡住现象。多个对话的 assistant 消息长时间停留在 `streaming` 状态无法完成，用户被迫多次中断（SIGINT）。

根因分析：
1. 空错误对象 `{}` 被 `process.on("uncaughtException")` 捕获
2. 错误集中在 agent 调用时段发生，且总是在 EADDRINUSE 之后大量出现
3. **根因确认**：当 Node.js readable stream 被 destroy 且没有 `error` 事件处理器时，会触发 `uncaughtException` 并产生空错误对象 `{}`

受影响的代码路径：
- `claude-code-stateful.ts` 的 `readOutput` 函数中 `stdout` stream 缺少 `error` 事件处理器
- `claude-code-stateful.ts` 的 `spawnClaudeProcess` 方法缺少 `proc.on("error")` 处理器
- `claude-code.ts` 的 `readOutput` 函数中 `stdout` stream 缺少 `error` 事件处理器

## 目标

1. 为 `claude-code-stateful.ts` 和 `claude-code.ts` 的 `stdout` stream 添加 `error` 事件处理器
2. 为 `claude-code-stateful.ts` 的子进程添加 `proc.on("error")` 处理器
3. 消除 `Uncaught exception {"error":{}}` 空错误对象

## 非目标

- 不改变 Claude Code CLI 的调用方式或参数
- 不修改其他 agent（codex、opencode）的错误处理逻辑

## 设计

### P1 详设

**修复 1：`claude-code-stateful.ts` 的 `readOutput` 函数**

在 `readOutput` 函数中添加 `stdout.on("error")` 处理器，使用 `reject` 而非 `resolve`：

```typescript
private async readOutput(
  proc: ChildProcess,
  stdout: Readable,
  callbacks: { ... },
  contextWindow?: number | null
): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = "";

    stdout.on("data", (data: Buffer) => { ... });

    /**
     * 捕获 stdout stream 错误并 reject。
     * reject 而非 resolve：若 stream error 发生在已收到部分事件但无 result 的场景，
     * resolve 会把截断输出当作成功收口；reject 确保调用方感知到异常并走失败路径。
     */
    stdout.on("error", (error) => {
      logger.warn("ClaudeCodeStateful stdout stream error", { error: error.message });
      reject(new Error(`ClaudeCodeStateful stdout stream error: ${error.message}`));
    });

    stdout.on("end", () => resolve());
  });
}
```

**修复 2：`claude-code-stateful.ts` 的 `spawnClaudeProcess` 方法**

添加 `proc.on("error")` 处理器：

```typescript
private spawnClaudeProcess(args: string[], options: AgentInvocationOptions, cwd?: string) {
  const proc = this.spawnFn("claude", args, { cwd, stdio: ["pipe", "pipe", "pipe"], detached: true });

  /** 捕获 spawn 错误（如命令不存在、权限不足等） */
  proc.on("error", (error) => {
    logger.error("ClaudeCodeStateful spawn error", { error });
  });

  const processController = manageInvocationProcess({ ... });
  return { proc, processController };
}
```

**修复 3：`claude-code.ts` 的 `readOutput` 函数**

同样添加 `stdout.on("error")` 处理器。

## 生效路径

代码修改，通过 `src/agent/claude-code-stateful.ts` 和 `src/agent/claude-code.ts` 生效。

## 改动范围

- `src/agent/claude-code-stateful.ts` - 添加 `proc.on("error")` 和 `stdout.on("error")` 处理器
- `src/agent/claude-code.ts` - 添加 `stdout.on("error")` 处理器

## 验证

### P1

- [x] 修复后，stdout stream 错误被正确捕获并记录日志
- [x] 不再出现 `Uncaught exception {"error":{}}` 空错误对象
- [x] 对话不再因未处理的 stream 错误而卡住
- [x] stdout stream error 在已有部分输出但无 result 时 reject（避免静默成功收口）
- [x] stdout stream error 在已有 result 后不影响成功收口（promise 已 resolve，reject 被忽略）

## 关联

无

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | 空错误对象根因 | Node.js readable stream 被 destroy 且无 error 处理器时，触发 uncaughtException 并产生空错误对象 `{}` | 2026-05-28 |

## 范围变更记录

| 日期 | 变更内容 | 原因 |
|---|---|---|
| 2026-05-28 | 扩展修复范围：增加 stdout stream error 处理器，增加 claude-code.ts 修复 | 根因分析确认空错误来自 stream destroy 而非 spawn 失败 |
| 2026-05-29 | stdout error handler 从 resolve 改为 reject，补充测试用例 | 检视意见：resolve 会在部分输出但无 result 时静默成功收口 |
