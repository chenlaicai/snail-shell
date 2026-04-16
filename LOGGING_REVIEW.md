# 日志审查报告

## 审查范围

审查了项目中所有使用 `logger.*` 和 `console.*` 的代码文件，重点关注：
1. 日志是否有价值、便于排查问题
2. 日志级别是否合理
3. Snail Shell 与底层 agent 的交互数据日志

## 发现的问题

### 1. **collaboration.ts - 日志过于冗余**

**问题：**
- 几乎每个函数入口都打印 info 日志，包含大量重复信息
- 函数名作为日志前缀（如 `[sendStructuredMessage]`、`[drainMentionBus]`）显得啰嗦
- 很多 debug 日志打印的是显而易见的信息（如 "Skipped boss mention"）

**具体位置：**
- L131-133: `sendStructuredMessage` 开始时打印 info + debug
- L148-154: 创建 user message 后立即打印 debug，然后又打印 mention 解析结果
- L168-171: `drainMentionBus` 开始时打印 info
- L184: 每个 batch 都打印 info
- L189: "Skipped boss mention" 这种 debug 没有价值
- L270-285: `invokeSnailBatch` 中打印过多重复信息
- L291-293: mention 解析后又打印一次

**改进建议：**
- 只在关键决策点打印日志（如：强制 wrap-up、mention 解析失败、agent 调用失败）
- 合并相关日志，减少碎片化
- debug 日志应该包含诊断价值的数据，而不是流程追踪

### 2. **stateful-cli-agent.ts - 日志结构合理但可精简**

**问题：**
- L364-373: `logInvocationStart` 打印了大量字段，但很多在正常情况下用不到
- L270: session 更新的 debug 日志价值不大
- L282-283: 每个 text event 都打印 debug，高频且低价值

**改进建议：**
- `logInvocationStart` 只在 debug 级别打印详细信息，info 级别只打印关键摘要
- 移除 session 更新的 debug 日志（这是正常流程）
- text event 的 debug 日志可以移除或改为 trace 级别

### 3. **server.ts - 日志级别不合理**

**问题：**
- L56, L148, L310, L334: 成功创建资源时打印 info，但这是正常操作
- L59, L82, L151, L313, L337: 失败时打印 warn，但应该是 error（因为会返回 4xx 错误）
- L255: "Conversation message request" 打印 debug，但没有实际价值
- L266: "Conversation message failed" 打印 error，这是合理的

**改进建议：**
- 成功创建资源改为 debug 级别
- 业务错误（如参数校验失败）改为 warn，系统错误改为 error
- 移除无价值的 debug 日志（如 L255）

### 4. **manager.ts - 日志合理但可优化**

**问题：**
- L78: 项目初始化打印 info，合理
- L130-136: stage advance 打印 info，合理

**改进建议：**
- 保持现状，这些是关键业务操作

### 5. **mention-extractor.ts - debug 日志过多**

**问题：**
- L55: 每次提取都打印 raw LLM output，在高频场景下会产生大量日志
- L63: 解析结果的 debug 日志价值不大

**改进建议：**
- L55 的 raw output 只在解析失败时打印（移到 catch 块）
- L63 的解析结果可以移除，或者只在有 mention 时打印

### 6. **agent 实现文件 - 日志基本合理**

**claude-code.ts:**
- L94: process closed 打印 info，合理
- L172: stdin drain 打印 debug，合理
- L176: stdin 写入失败打印 warn，合理

**codex.ts:**
- L183, L270, L289, L301, L314: debug 日志合理，包含诊断价值
- L144-154, L195-208: info 日志合理，记录关键操作

**gemini.ts:**
- L31, L57, L62: info/warn 日志合理

**改进建议：**
- 保持现状，这些日志对排查 agent 交互问题很有价值

### 7. **main.ts - 日志合理**

- L31, L33, L74, L78, L89: 启动和关闭日志，合理

### 8. **测试文件 - 使用 console.log**

**问题：**
- 测试文件中使用 `console.log` 而不是 `logger`
- 这是合理的，测试输出不应该进入日志系统

## 改进优先级

### P0 - 必须修复
1. **collaboration.ts**: 大幅精简日志，只保留关键决策点
2. **server.ts**: 修正日志级别（成功操作降为 debug，错误提升为 error）

### P1 - 建议修复
3. **stateful-cli-agent.ts**: 精简高频 debug 日志
4. **mention-extractor.ts**: 只在异常时打印 raw output

### P2 - 可选优化
5. 考虑引入结构化日志字段（如 `conversationId`、`snailName`），便于过滤和分析

## 关键原则

1. **info 级别**：只记录关键业务操作（创建项目、推进阶段、agent 调用开始/结束）
2. **debug 级别**：记录诊断信息（agent 输出解析、mention 提取、工具调用）
3. **warn 级别**：记录可恢复的异常（CLI 不可用、解析失败但有 fallback）
4. **error 级别**：记录不可恢复的错误（agent 调用失败、数据库错误）

5. **避免高频低价值日志**：
   - 不要在循环或流式处理中打印每个 chunk
   - 不要记录显而易见的流程步骤
   - 不要重复记录相同信息

6. **日志应该回答的问题**：
   - 发生了什么关键决策？（强制 wrap-up、fallback 到 default snail）
   - 为什么失败？（错误原因、上下文）
   - 性能瓶颈在哪？（耗时操作的开始/结束）
