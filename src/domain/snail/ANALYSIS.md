# Snail Den 模块分析（v1 遗留）

> 本文档基于 `v1/` 目录下的遗留代码分析，用于指导 v2 重写。

---

## 一、业务场景

### 1.1 Snail 是什么

Snail（蜗牛模板）是 Snail Shell 的 **AI Agent 运行时配置抽象**。一个 Snail Template 绑定了 agent runtime、model 和 context 设置，是"一个可调用的 AI Agent"的完整声明。

隐喻：蜗牛背壳 = 运行时环境。每个 Snail Template 代表一个准备好被调用的 Agent 配置。

### 1.2 核心业务场景

| 场景 | 说明 |
|------|------|
| **模板定义** | 在 `config/snail-den.json` 中定义可用的 Agent 运行时模板 |
| **模板 → 运行时解析** | `SnailDen.getSnailRuntime(templateId)` 将模板 ID 解析为具体的 `SnailRuntime` 实例 |
| **Role → Template 映射** | `role_snail_mapping` 将 SOP 中的角色映射到具体的 Snail Template |
| **Session 管理** | `snail_agent_session` 表跟踪每个 conversation+role 的 Agent 会话 |
| **模板展示** | Web 端 Snail Den 页面展示所有可用模板 |

### 1.3 Snail Den 与其他模块的关系

- **Agent（ACS）**：`SnailTemplate.runtime` 通过 `SnailAgentResolver` 解析为具体的 `SnailRuntime` 实现
- **SOP**：SOP Stage 定义中的 `snail_template_id` 引用 Snail Template
- **Issue**：`issue.role_snail_mapping` 存储 stage+role → templateId 的映射
- **Conversation**：Agent 调用时通过 `resolveRuntimeByRole()` 查询 template → runtime
- **Agent Session**：`snail_agent_session` 表跟踪 session 状态（external_session_id 用于有状态 Agent 恢复）

---

## 二、数据模型

### 2.1 SnailTemplate 类型

```typescript
interface SnailTemplate {
  id: string;                    // 模板 ID（如 "claude-code-sonnet"）
  name: string;                  // 显示名称（如 "Claude Code + Sonnet"）
  runtime: AgentRuntime;         // 运行时类型
  model: string;                 // 模型标识（如 "opus[1m]", "my-mimo-plan/mimo-v2.5-pro"）
  contextWindow?: number;        // 上下文窗口大小（token 数，fallback）
  contextProvider: "shell" | "agent";  // 上下文管理方
  invocationTimeoutMs?: number;  // 调用超时（默认 30 分钟）
}
```

### 2.2 AgentRuntime 类型

```typescript
type AgentRuntime =
  | "claude-code-cli"            // 无状态
  | "claude-code-stateful-cli"   // 有状态
  | "opencode-cli"               // 有状态
  | "codex-cli";                 // 有状态
```

### 2.3 contextProvider 语义

| 值 | 含义 | 行为 |
|----|------|------|
| `"shell"` | Snail Shell 管理上下文 | 无状态，每次调用重建完整上下文窗口 |
| `"agent"` | Agent 自管理上下文 | 有状态，通过 sessionId 恢复，只发增量消息 |

### 2.4 SnailRuntimeInstance（解析结果）

```typescript
interface SnailRuntimeInstance {
  readonly runtime: SnailRuntime;         // 具体运行时实现
  readonly model: string;                 // 模型标识
  readonly contextWindow: number | null;  // 上下文窗口
  readonly invocationTimeoutMs: number | null;  // 调用超时
  readonly template: SnailTemplate;       // 原始模板
}
```

### 2.5 数据库表

**snail_agent_session 表**：
```sql
CREATE TABLE snail_agent_session (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  role_name TEXT NOT NULL,
  runtime TEXT NOT NULL,
  model TEXT NOT NULL,
  context_provider TEXT NOT NULL,
  external_session_id TEXT,        -- Agent 返回的 sessionId（用于有状态恢复）
  handoff_from_id TEXT REFERENCES snail_agent_session(id),  -- session 交接
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- 索引: (conversation_id, role_name, created_at DESC)
```

**issue 表的 role_snail_mapping 列**：
```sql
role_snail_mapping TEXT NOT NULL DEFAULT '{}'
-- JSON: { stageKey: { roleKey: snailTemplateId } }
```

### 2.6 配置文件格式

`config/snail-den.json`：
```json
{
  "snails": [
    {
      "id": "claude-code-sonnet",
      "name": "Claude Code + Sonnet",
      "runtime": "claude-code-cli",
      "model": "sonnet",
      "contextWindow": 200000,
      "contextProvider": "shell"
    },
    {
      "id": "opencode-default",
      "name": "OpenCode + GPT-5.5",
      "runtime": "opencode-cli",
      "model": "my-geek/gpt-5.5",
      "contextWindow": 270000,
      "contextProvider": "shell"
    }
  ]
}
```

文件不存在时系统正常启动（空模板列表）。用户本地文件，不提交到仓库。

---

## 三、核心流程

### 3.1 模板加载流程

```
main.ts
  → initializeAgents() → [ClaudeCodeAgent, ClaudeCodeStatefulAgent, OpenCodeAgent, CodexAgent]
  → new RuntimeSnailAgentResolver(agents) → Map<AgentRuntime, SnailRuntime>
  → new SnailDen(agentResolver)
    → loadSnailDen() → 读取 config/snail-den.json
    → Map<string, SnailTemplate>
```

### 3.2 模板解析流程（getSnailRuntime）

```
SnailDen.getSnailRuntime(templateId)
  → templates.get(templateId) → 校验存在
  → agentResolver.resolve(template.runtime) → 获取具体 SnailRuntime 实现
  → 返回 SnailRuntimeInstance { runtime, model, contextWindow, invocationTimeoutMs, template }
```

### 3.3 Role → Template 映射链

```
SOP YAML 定义角色
  → stage.roles[].snail_template_id（可选，默认 null）
  → 冻结到 issue.sop_snapshot

Issue 创建时
  → role_snail_mapping 传入（stageKey → roleKey → snailTemplateId）
  → 存入 issue.role_snail_mapping（JSON TEXT 列）

运行时解析
  → resolveTemplateId(ctx, roleName, roleDef)
    → issue.role_snail_mapping[stageKey][roleKey]  （优先级 1：issue 级覆盖 by roleKey）
    → issue.role_snail_mapping[stageKey][roleName]  （优先级 2：issue 级覆盖 by roleName）
    → roleDef.snail_template_id                     （优先级 3：SOP 快照默认值）
```

### 3.4 Agent 调用时的模板使用

```
invokeRoleBatch()
  → resolveInvocationContext()
    → resolveConversationRole() → 应用 role_snail_mapping
    → isAgentRole() → 检查 snail_template_id 是否存在
  → resolveRuntimeByRole(role)
    → snailDen.getSnailRuntime(templateId) → SnailRuntimeInstance
  → resolveRoleTemplate(role)
    → 返回 RuntimeBinding { model, contextProvider, contextWindow, invocationTimeoutMs }
  → lookupOrCreateSnailAgentSession(conversationId, roleName, runtime, model, contextProvider)
    → 查找或创建 snail_agent_session 记录
    → 如果 template 的 runtime/model 变更，创建新 session
  → invokeRuntimeMessage()
    → runtime.invokeMessage(input, onEvent, { model, contextWindow, invocationTimeoutMs, signal })
```

### 3.5 Session 管理

```
首次调用（无 sessionId）
  → 创建 snail_agent_session（external_session_id = null）
  → Agent 返回 sessionId
  → updateSnailAgentSessionExternalId(sessionId)

后续调用（有 sessionId）
  → getCurrentSnailAgentSession(conversationId, roleName)
  → 检查 runtime/model 是否变更
    → 变更 → 创建新 session，handoff_from_id 指向旧 session
    → 未变 → 使用现有 session
  → 传入 externalSessionId 给 Agent（--resume sessionId）
```

### 3.6 API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/snail-den` | GET | 列出所有 Snail Template |
| `/api/issues/:issueId/role-snail` | PATCH | 更新 issue 的 role-snail 映射 |
| `/api/workspaces/detect-snail` | POST | 检测 workspace 是否有 .snail 目录 |
| `/api/workspaces/:workspaceId/load-snail` | POST | 从 .snail 目录加载配置 |

---

## 四、关键设计决策（v1）

1. **模板与运行时分离** — SnailTemplate 声明配置，SnailRuntime 是具体实现，通过 Resolver 桥接
2. **文件驱动配置** — `config/snail-den.json` 用户本地文件，不入库，不提交
3. **role_snail_mapping 多级覆盖** — issue 级覆盖优先于 SOP 快照默认值
4. **Session 追踪** — `snail_agent_session` 记录每次 Agent 调用的 session 状态
5. **contextProvider 分流** — "shell"（无状态重建）vs "agent"（有状态恢复）决定上下文管理策略
6. **Session 变更检测** — runtime/model 变更时自动创建新 session，handoff 链追溯
7. **优雅降级** — 配置文件不存在时系统正常启动，空模板列表

---

## 五、v2 重写待决问题

1. **模板是否入库？** 当前纯文件驱动，是否需要数据库支持 CRUD、版本管理？
2. **role_snail_mapping 的 key 不一致** — 创建时用 stageKey，读取时用 stage.id，是否统一？
3. **Session 管理是否简化？** 当前 session 变更检测逻辑较复杂，是否需要更简单的模型？
4. **模板是否需要继承/组合？** 当前扁平结构，是否需要模板继承或组合？
5. **contextProvider 是否需要扩展？** 当前仅 "shell"/"agent"，是否需要更多模式？
6. **模板热更新？** 修改 snail-den.json 后是否需要重启？是否需要热加载？
7. **模板权限控制？** 是否需要按 workspace/role 限制可用模板？
8. **模板版本管理？** 是否需要版本号、变更历史？
