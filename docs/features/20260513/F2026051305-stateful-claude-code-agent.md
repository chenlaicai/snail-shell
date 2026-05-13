# F2026051303 有状态 Claude Code Agent

## 背景

当前 Snail Shell 的 Claude Code agent（`ClaudeCodeAgent`）是无状态的，每次调用都会创建全新的会话。虽然这保证了 Snail Shell 对对话状态的完全控制，但在某些场景下，利用 Claude Code 自身的会话管理能力（如上下文压缩、长期记忆等）会更有优势。

## 目标

- 新增支持会话恢复（resume）的 Claude Code agent 实现
- 在 Snail Den 模板池中添加新的模板配置
- 整理 agent -> den -> 上层业务使用的架构文档

## 非目标

- 不修改现有的无状态 Claude Code agent
- 不修改其他 agent 的实现

## 设计

### 架构层次

```
┌─────────────────────────────────────────────────────────────┐
│                    上层业务（ProjectManager）                 │
│                         │                                    │
│         ┌───────────────┼───────────────┐                   │
│         ▼               ▼               ▼                   │
│  CollaborationDeps  SnailRegistry   SnailDen                │
│  (resolveRuntime    (snail定义)    (模板池)                  │
│   resolveModel)                                             │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Agent Resolver 层                         │
│  RuntimeSnailAgentResolver: Map<AgentRuntime, SnailRuntime> │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Agent Runtime 层                          │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐ │
│  │ ClaudeCodeAgent │  │ClaudeCodeStateful│  │ OpenCode... │ │
│  │ (Stateless)     │  │ (Stateful)      │  │ (Stateful)  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────┘ │
│                                                             │
│  共同接口: SnailRuntime                                     │
│  实现方式: StatelessAgentInvoker 或 StatefulAgentInvoker    │
└─────────────────────────────────────────────────────────────┘
```

### Agent Runtime 类型

| Runtime 类型 | Agent 类 | 调用方式 | 会话管理 |
|-------------|---------|---------|---------|
| `claude-code-cli` | `ClaudeCodeAgent` | Stateless | Snail Shell 管理 |
| `claude-code-stateful-cli` | `ClaudeCodeStatefulAgent` | Stateful | Claude Code 管理 |
| `opencode-cli` | `OpenCodeAgent` | Stateful | OpenCode 管理 |
| `codex-cli` | `CodexAgent` | Stateful | Codex 管理 |
| `gemini-cli` | `GeminiAgent` | Stateful | Gemini 管理 |

### 有状态 vs 无状态 Agent

#### 无状态 Agent（StatelessAgentInvoker）

- **特点**：每次调用都接收完整的对话上下文
- **优势**：
  - Snail Shell 完全控制对话状态
  - 不依赖外部 agent 的会话管理
  - 更容易调试和复现问题
- **劣势**：
  - 每次调用都需要重建完整上下文
  - 无法利用 agent 自身的上下文压缩和长期记忆
- **适用场景**：
  - 需要精确控制上下文的场景
  - 短期任务
  - 需要可重复性的测试场景

#### 有状态 Agent（StatefulAgentInvoker）

- **特点**：首次调用接收完整上下文，后续调用只接收增量消息
- **优势**：
  - 利用 agent 自身的会话管理能力
  - 支持上下文压缩和长期记忆
  - 减少重复传输的数据量
- **劣势**：
  - 依赖外部 agent 的会话管理
  - 调试和复现问题更复杂
  - 需要管理 session ID
- **适用场景**：
  - 长时间运行的任务
  - 需要跨多轮对话的工作
  - 需要利用 agent 自身记忆能力的场景

### Claude Code Stateful Agent 实现

#### 核心特性

1. **会话恢复**：使用 `--resume <sessionId>` 参数恢复会话
2. **系统提示词**：使用 `--append-system-prompt` 传递系统提示词
3. **流式输出**：使用 `--output-format stream-json` 和 `--input-format stream-json`
4. **权限模式**：使用 `--permission-mode bypassPermissions` 绕过权限检查

#### 输出格式处理

Claude Code 的输出格式与其他 agent 不同：
- `type: "assistant"` - 包含 `message.content` 数组（text 和 tool_use）
- `type: "result"` - 最终结果

`ClaudeCodeStatefulAgent` 覆盖了 `mapEvent()` 方法来处理这些特殊格式。

#### Session ID 提取

Claude Code 可能在 `result` 事件中返回 `session_id`，agent 会从多个位置尝试提取：
- `event.session_id`
- `event.sessionID`

### Snail Den 模板配置

新增的模板配置：

```json
{
  "id": "claude-code-stateful-mimo-v25",
  "name": "Claude Code Stateful + Mimo v2.5",
  "runtime": "claude-code-stateful-cli",
  "model": "my-mimo-plan/mimo-v2.5-pro"
},
{
  "id": "claude-code-stateful-sonnet",
  "name": "Claude Code Stateful + Sonnet",
  "runtime": "claude-code-stateful-cli",
  "model": "claude-sonnet-4-6"
}
```

## 生效路径

- `src/agent/interface.ts`：新增 `claude-code-stateful-cli` runtime 类型
- `src/agent/claude-code-stateful.ts`：新的有状态 agent 实现
- `src/main.ts`：注册新的 agent
- `config/snail-den.json`：新增模板配置

## 改动范围

- 新增：`src/agent/claude-code-stateful.ts`
- 修改：`src/agent/interface.ts`（新增 runtime 类型）
- 修改：`src/main.ts`（注册新 agent）
- 修改：`config/snail-den.json`（新增模板）

## 验证

- `npm run check` 通过
- 新的 runtime 类型正确注册
- Snail Den API 返回新的模板配置

## 使用场景

### 场景 1：长时间运行的任务

当需要执行长时间运行的任务（如大型代码重构、系统设计等）时，有状态 agent 可以：
- 保持上下文连续性
- 利用 Claude Code 的上下文压缩
- 支持任务中断和恢复

### 场景 2：跨多轮对话的工作

当需要跨多轮对话完成一项工作时，有状态 agent 可以：
- 保持对话历史
- 利用 Claude Code 的长期记忆
- 减少重复的上下文传输

### 场景 3：利用 Claude Code 特性

当需要利用 Claude Code 的特定功能时：
- 自动上下文压缩
- 工具使用历史
- 会话级别的配置

## 风险与决策记录

### 决策 1：新增 runtime 类型而非复用

**选择**：新增 `claude-code-stateful-cli` runtime 类型，而非复用 `claude-code-cli`

**理由**：
- 保持架构清晰，每个 runtime 类型对应一个 agent 实现
- 避免 resolver 需要额外逻辑来区分有状态和无状态
- 简化配置和调试

### 决策 2：不继承 StatefulCLIAgent，直接实现接口

**选择**：直接实现 `SnailRuntime` 和 `StatefulAgentInvoker` 接口，而非继承 `StatefulCLIAgent`

**理由**：
- `StatefulCLIAgent` 假设所有 agent 都通过命令行参数传递 prompt，但 Claude Code 使用 stdin 传递 JSON 消息
- Claude Code 的输入机制（stdin JSON）与其他 agent（OpenCode、Gemini、Codex）完全不同
- 继承会导致 prompt 无法传递的根本性架构问题
- 直接实现可以完全控制 stdin/stdout 的处理方式

**发现**：`StatefulCLIAgent` 实际上不是通用的，只适用于通过命令行参数传递 prompt 的 CLI agent。已为其添加适用范围说明注释。

### 风险 1：Claude Code CLI 兼容性

**风险**：Claude Code CLI 的输出格式可能随版本变化

**缓解措施**：
- 覆盖 `mapEvent()` 方法，隔离格式处理逻辑
- 添加详细的日志记录
- 监控 Claude Code CLI 的更新

### 风险 2：会话管理复杂性

**风险**：有状态 agent 的会话管理增加了系统复杂性

**缓解措施**：
- 复用已有的 session ID 管理机制
- 保持与 OpenCode、Gemini 等 agent 的一致性
- 提供清晰的文档和使用指南

## 后续工作

1. **测试覆盖**：添加单元测试和集成测试
2. **监控指标**：添加会话恢复成功率、上下文大小等指标
3. **文档完善**：更新用户手册和开发文档
4. **性能优化**：根据实际使用情况优化会话管理
