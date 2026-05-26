---
id: F2026052001
title: 修复模块边界 lint warning
from_ids: []
tags: [security]
modules: [project_management]
---
# F2026052001 修复模块边界 lint warning

## 背景

`npm run lint` 存在 22 个 `no-restricted-imports` warning。这些 warning 来自 eslint 配置中定义的模块边界守护规则与实际代码的导入关系不一致。部分 warning 是因为类型定义位置不合理导致跨层导入，部分是因为 eslint 规则未反映功能上真实存在的合法依赖。

## 目标

1. **lint 清零**：`npm run lint` 0 errors, 0 warnings
2. **tsc 通过**：`npx tsc --noEmit` 0 errors
3. **循环依赖消除**：消除 agent ↔ message-bus 之间的循环依赖
4. **模块边界修正**：eslint 规则反映实际功能依赖关系

## 非目标

- 不改变模块目录结构或功能行为
- 不引入新的循环依赖

## 设计

### 类型归位

将以下类型从非 shared 模块移入 shared，消除跨层类型导入：

| 类型 | 原位置 | 新位置 |
|---|---|---|
| runtime-error | agent/runtime-error.ts | shared/runtime-error.ts |
| MessageContextSummaryGenerator/Input | shared/message-context-utils.ts | shared/types.ts（接口定义） |

agent 模块通过 re-export 保持向后兼容。

### 循环依赖消除

`agent/prompt-mapper.ts` 原本从 `message-bus/message-events.ts` 导入 `formatMessageContextForPrompt`，而 `message-bus` 又依赖 `agent` 的类型，形成循环。解决方案：`formatMessageContextForPrompt` 已在 shared 中定义，prompt-mapper 直接从 shared 导入。

### 模块边界规则修正

| 模块 | 旧允许依赖 | 新允许依赖 | 原因 |
|---|---|---|---|
| prompt-center | shared | shared, agent | 评估 prompt 需要 AgentRuntime 等 agent 类型 |
| snail-den | shared, agent | shared, agent, llm | snail 定义需要 LLM 接口等 llm 类型 |
| message-bus | shared, persistence | shared, persistence, agent | 消息生成需要 AgentMessage 等 agent 类型 |

logger 从 internalModules 移除（跨切面基础设施，不是模块边界守护对象）。

### Review 修复：content_block 支持

检视者指出 `buildLatestUserMessage()` 只读取 `payload.text`，会静默丢失 `content_block` 事件的内容。修复方案：

1. 将 `extractTextFromBlocks` 及事件文本提取逻辑抽取到 `shared/event-content-utils.ts`
2. `buildLatestUserMessage` 改用 `extractEventText`，正确处理 text 和 content_block 事件
3. `message-bus/message-events.ts` 内部复用 shared 的实现，消除重复

### 设计决策

模块边界放宽原因已通过设计决策 `c1001cd8-fac7-4314-94fc-9035244046c8` 正式记录。

## 依赖方向（最终）

```
shared ← persistence
shared ← prompt-center (← agent) ← skill-center
shared ← snail-den (← agent, llm)
shared ← message-bus (← persistence, agent)
以上全部 ← project-workflow / knowledge-center / interaction-entry
logger: 无限制（跨切面）
```

## 生效路径

- `eslint.config.mjs`：模块边界守护规则
- `src/shared/`：新增 event-content-utils.ts、runtime-error.ts
- `src/agent/prompt-mapper.ts`：解耦并支持 content_block
- 设计决策 `c1001cd8-fac7-4314-94fc-9035244046c8`：记录模块边界放宽的治理依据

## 改动范围

| 文件 | 变更类型 |
|---|---|
| eslint.config.mjs | 修改（边界规则） |
| src/shared/types.ts | 修改（新增接口定义） |
| src/shared/runtime-error.ts | 新增 |
| src/shared/event-content-utils.ts | 新增（review 修复） |
| src/shared/index.ts | 修改（新增导出） |
| src/agent/interface.ts | 修改（类型引用更新） |
| src/agent/runtime-error.ts | 修改（re-export） |
| src/agent/prompt-mapper.ts | 修改（解耦 + content_block 支持） |
| src/message-bus/message-events.ts | 修改（从 shared 导入） |
| src/message-bus/message-context.ts | 修改 |
| src/message-bus/message-protocol.ts | 修改 |
| src/message-bus/collaboration.ts | 修改 |
| src/prompt-center/builder.ts | 修改 |
| src/prompt-center/evaluation-registry.ts | 修改 |
| src/prompt-center/evaluation-runner.ts | 修改 |
| src/prompt-center/registry.ts | 修改 |
| src/llm/summary.ts | 修改 |
| src/interaction-entry/gateway.ts | 修改 |

## 验证

- [x] `npm run lint` — 0 errors, 0 warnings
- [x] `npx tsc --noEmit` — 0 errors
- [x] `buildLatestUserMessage` 对 content_block 事件正确处理（text 和 question 等块类型）
- [x] 无循环依赖
- [x] 设计决策已创建（c1001cd8-fac7-4314-94fc-9035244046c8）

## 范围变更记录

| 日期 | 变更 | 原因 |
|---|---|---|
| 20260520 | 检视意见修复：抽取 shared/event-content-utils.ts，修正 buildLatestUserMessage 的 content_block 处理 | 检视者指出 content_block 事件静默丢失内容 |
| 20260520 | 检视意见修复：创建设计决策 c1001cd8-fac7-4314-94fc-9035244046c8 记录模块边界放宽 | 检视者指出缺少治理记录 |
| 20260520 | 复检意见修复：修正改动范围列表中不存在的文件，统一使用设计决策完整 UUID | 检视者指出文档与 diff 不一致，短 ID 无法追溯 |
