# Gemini Agent Integration

本文档说明如何在 Snail Shell 中使用 Gemini CLI 作为 agent runtime。

## 前置要求

### 安装 Gemini CLI

确保系统中已安装 Gemini CLI：

```bash
# 检查是否已安装
which gemini

# 如果未安装，请访问 Gemini CLI 官网安装
# https://geminicli.com
```

### 配置 Gemini CLI

Gemini CLI 需要配置 API key 和模型。请参考 Gemini CLI 官方文档进行配置。

## 配置 Snail

### 在 .meta/snails.json 中配置

将某个 snail 的 `runtime` 设置为 `"gemini-cli"`：

```json
{
  "my_snail": {
    "title": "My Snail",
    "description": "使用 Gemini 的 snail",
    "runtime": "gemini-cli",
    "capability_expectations": ["分析", "总结"],
    "working_rules": ["保持简洁"],
    "preferred_artifact_types": ["report"],
    "system_prompt": {
      "identity": "你是一个使用 Gemini 的 AI 助手。",
      "principles": ["准确", "高效"],
      "output_expectations": ["清晰的结论"]
    }
  }
}
```

## 技术实现

### 架构

Gemini agent 实现了 `SnailRuntime` 和 `StatefulAgentInvoker` 接口：

- **Stateful 模式**：类似 OpenCode，支持会话管理
- **CLI 调用**：通过 `spawn` 调用本地 `gemini` 命令
- **流式响应**：支持实时流式输出（`--output-format stream-json`）
- **会话管理**：使用 `--resume` 参数恢复会话
- **自动批准**：使用 `--approval-mode yolo` 自动批准工具调用

### 核心文件

- `src/agent/gemini.ts`：Gemini agent 实现
- `src/agent/interface.ts`：添加 `"gemini-cli"` runtime 类型
- `src/main.ts`：注册 Gemini agent

### CLI 参数

Gemini agent 使用以下 CLI 参数：

```bash
gemini -p "<prompt>" \
  --output-format stream-json \
  --approval-mode yolo \
  [--resume <session-id>]
```

- `-p`：非交互模式，传入 prompt
- `--output-format stream-json`：JSON 流式输出
- `--approval-mode yolo`：自动批准所有工具调用
- `--resume`：恢复已有会话（stateful 模式）

### 消息格式

与 OpenCode 类似，Gemini agent 将消息格式化为：

```
SYSTEM:
<system prompt>

USER:
<user message>

ASSISTANT:
<assistant message>
```

### 会话管理

- 首次调用：发送完整的 bootstrap 上下文（system prompt + 历史消息）
- 后续调用：仅发送增量消息，使用 `--resume <session-id>` 恢复会话
- Session ID 从 Gemini CLI 的 JSON 输出中提取

## 示例

启动服务器后，Gemini agent 会自动注册：

```bash
npm start
```

查看健康检查端点确认 Gemini agent 已加载：

```bash
curl http://localhost:3000/health
# 输出应包含 "gemini" 在 agents 列表中
```

## 故障排查

### Gemini CLI 未找到

检查：
1. 运行 `which gemini` 确认 CLI 已安装
2. 确保 `gemini` 在 PATH 中

### Gemini CLI 配置问题

检查：
1. Gemini CLI 是否已配置 API key
2. 运行 `gemini -p "hello"` 测试 CLI 是否正常工作

### 会话恢复失败

常见错误：
- Session ID 无效：可能是会话已过期
- 查看服务器日志中的 "Gemini session updated" 消息

## 与其他 Runtime 的对比

| 特性 | Claude Code | OpenCode | Gemini |
|------|-------------|----------|--------|
| 模式 | Stateless | Stateful | Stateful |
| CLI | `claude` | `opencode` | `gemini` |
| 输出格式 | stream-json | json (line-delimited) | stream-json |
| 流式处理 | 是 | 是 | 是 |
| 会话管理 | 无 | `--session` | `--resume` |
| 工具批准 | `--permission-mode bypassPermissions` | `--dangerously-skip-permissions` | `--approval-mode yolo` |

## 未来改进

- [ ] 支持更多 Gemini CLI 选项（model, temperature 等）
- [ ] 添加重试和错误恢复机制
- [ ] 优化会话管理策略
- [ ] 支持 Gemini CLI 的扩展和技能系统
