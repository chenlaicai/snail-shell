# F2026052503 Agent 操作安全隔离：Guard Profile 与权限配置分发

## 背景

Snail Shell 当前所有 agent adapter 使用 `bypassPermissions`（或等价 flag）跳过 agent 原生的权限审批系统。意图是 Snail Shell 自己集中控制权限，但实际结果是：

1. **Agent 可以执行任意操作**，包括直接修改数据库（`Bash(sqlite3:*)` 在白名单中）
2. **Agent 原生成熟的安全机制被全部绕过**（Claude Code 的 allow/deny 列表、PreToolUse hooks、Codex 的默认 sandbox）
3. **提示词层面的规则不可靠**——业界共识是模型在 15+ 次工具调用后会放松遵守

本 feature 将安全模型从"Snail Shell 自己当警察"转为"Snail Shell 当安全策略的配置分发器"——在 ACP 协议层定义安全策略，翻译为各 agent 的原生配置，让 agent 用自己的成熟机制执行策略。

### 参考事故

- Replit/PocketOS (2026.04): Claude agent 9 秒内删除整个生产库 + 备份
- Railway (2025.07): AI agent 在代码冻结期抹掉线上库
- Snail Shell (2026.05.20): worktree 中的迁移在指向生产库时被自动触发，数据库被摧毁

### 业界最佳实践（四大模式）

| 模式 | 机制 | 代表 |
|---|---|---|
| Pre-Action Authorization Gate | 工具调用前由模型外策略引擎判定 | Open Agent Passport, permit0 |
| Draft-First Write Pipeline | 写操作默认生成草稿，直接执行需放行 | OpenPort Protocol |
| Capability Scoping | 限制工具参数范围 | AgentWard |
| Session-Aware Risk Scoring | 跨调用模式检测，触发断路器 | permit0 |

**核心共识**：不要依赖模型自我约束，结构控制不退化。

## 目标

1. ACP 协议新增 `GuardProfile`——按领域（database/filesystem/network/git）定义安全策略
2. 新建 `guard-config.ts`——ACP `GuardProfile` → agent 原生配置翻译器
3. 改造 4 个 agent adapter：从 `bypassPermissions` 改为 agent 原生权限模式（Claude Code `acceptEdits`、Codex 恢复默认 sandbox、OpenCode 恢复默认权限）
4. 更新 `settings.local.json`：添加 `deny` 规则，移除危险白名单条目
5. 新建 PreToolUse hook：`guard-bash.js` 对 Bash 命令做参数级语义拦截
6. Project 数据模型新增 `guard_profile` 字段，支持不同 project 不同策略

## 非目标

- 不实现 Session-Aware Risk Scoring（跨调用累积评分），保留为后续扩展
- 不改造 Codex/OpenCode 的 PreToolUse hook（它们不支持）
- 不实现 OpenCode 的 OS sandbox（无内置支持，需外部 Docker，不在本 feature 范围）
- 不修改 Snail Shell 系统提示词中的安全相关宪法规则（它们是纵深防御的一层，继续保留）

## 设计

### 架构：Snail Shell = 配置分发器，不是安全警察

```
ACP GuardProfile (Snail Shell 统一策略描述)
       │
       ▼
guard-config.ts (翻译层)
       │
       ├──→ .claude/settings.local.json  → Claude Code 原生权限系统
       ├──→ codex.yaml                   → Codex 原生权限系统
       └──→ opencode.json                → OpenCode 原生权限系统
```

### GuardProfile 领域模型

```typescript
interface GuardProfile {
  database: {
    mode: "allow" | "deny" | "ask";
    readOnlyPatterns: string[];   // SELECT, .schema, .dump, .tables
    denyPatterns: string[];       // DROP, ALTER, PRAGMA writable
  };
  filesystem: {
    mode: "allow" | "deny" | "ask";
    protectedPaths: string[];     // /etc, ~/.ssh, ~/.aws
    denyPatterns: string[];       // chmod 777, rm -rf /
  };
  network: {
    mode: "allow" | "deny" | "ask";
    allowedDomains: string[];     // github.com, npmjs.org, docs.anthropic.com
  };
  git: {
    mode: "allow" | "deny" | "ask";
    denyPatterns: string[];       // push --force main, reset --hard
  };
}
```

### agent adapter 权限模式变更

| Adapter | 当前 | 改为 |
|---|---|---|
| Claude Code stateless | `--permission-mode bypassPermissions` | `--permission-mode acceptEdits` |
| Claude Code stateful | `--permission-mode bypassPermissions` | `--permission-mode acceptEdits` |
| Codex | `--dangerously-bypass-approvals-and-sandbox` | 移除该 flag，恢复默认 sandbox + 审批 |
| OpenCode | `--dangerously-skip-permissions` | 移除该 flag，恢复默认权限模式 |

### Project 级策略隔离

`Project` 表/类型新增 `guard_profile` 字段。不同 project 可以有不同策略：
- Snail Shell（system_self）：较宽松（需要改自己的 DB、发 PR）
- 外部交付项目（product_delivery）：严格（不能碰 Snail Shell 的 DB）

策略通过 worktree 自然隔离：每个 worktree 下生成对应的 agent 配置文件，agent 从 cwd 读取，不同 project 的 worktree 获得不同配置。

### 各 agent 覆盖能力矩阵

| 能力 | Claude Code | Codex | OpenCode |
|---|---|---|---|
| allow/deny 列表 | settings.json | codex.yaml | opencode.json |
| PreToolUse hooks | 原生支持 | 不支持 | 不支持 |
| OS sandbox | `--sandbox` | 默认开启 | 不支持（需 Docker） |
| 权限模式 | `acceptEdits` | 默认审批 | 默认权限 |

## 生效路径

- ACP 协议定义：`src/agent/capability/spec.ts`
- 翻译层：`src/agent/guard-config.ts`（新建）
- Agent adapter：`src/agent/claude-code.ts`, `claude-code-stateful.ts`, `codex.ts`, `opencode.ts`
- Claude Code 配置：`.claude/settings.local.json`
- PreToolUse hook：`.meta/hooks/guard-bash.js`（新建）
- Project 数据模型：`src/shared/domain-types.ts` + DB schema migration（手工）
- 研发者手册更新：`.meta/skills/developer-handbook/SKILL.md`

## 改动范围

| 文件 | 改动 |
|---|---|
| `src/agent/capability/spec.ts` | 新增 `GuardProfile`, `GuardDomain`, `GuardMode` 类型；扩展 `AgentCapability` |
| `src/agent/guard-config.ts` | **新建**：ACP → agent 配置翻译器 |
| `src/prompt-center/builder.ts` | 构建 `guardProfiles` 并传入 `AgentCapability` |
| `src/agent/claude-code.ts` | `bypassPermissions` → `acceptEdits`；启动前生成 settings |
| `src/agent/claude-code-stateful.ts` | 同上 |
| `src/agent/codex.ts` | 移除 `--dangerously-bypass-approvals-and-sandbox` |
| `src/agent/opencode.ts` | 移除 `--dangerously-skip-permissions` |
| `.claude/settings.local.json` | 添加 `deny` 规则，移除危险条目 |
| `src/shared/domain-types.ts` | `Project` 类型新增 `guard_profile` 字段 |
| `.meta/hooks/guard-bash.js` | **新建**：Bash 命令语义拦截 hook |
| `.meta/skills/developer-handbook/SKILL.md` | 更新数据库安全约束说明 |
| `docs/features/20260525/F2026052503-agent-guard-profile.md` | 本文档 |

## 验证

1. TypeScript 编译通过：`npx tsc --noEmit`
2. 现有测试通过：`npm test`
3. Agent adapter 单元测试：验证 args 中不含 `bypassPermissions` / `--dangerously-bypass-approvals-and-sandbox` / `--dangerously-skip-permissions`
4. `guard-config.ts` 单元测试：验证 ACP → settings.json 翻译正确性
5. `guard-bash.js` 单元测试：验证危险命令被拦截、安全命令放行
6. 人工验证：在 worktree 中确认 agent 启动时使用正确的 settings.json

## 风险与决策记录

- **风险**：`acceptEdits` 模式可能导致某些合法操作被 Claude Code 分类器误判为危险而拒绝。决策：先上线，观察被拒 case，再调整 allow 列表。
- **风险**：Codex 移除 `--dangerously-bypass-approvals-and-sandbox` 后，非交互模式下审批请求自动被拒，可能导致某些操作无法执行。决策：需要审批的操作本就不应在非交互模式下执行，如确实需要，应在 codex.yaml 中显式放行。
- **风险**：OpenCode 无内置 sandbox，安全等级低于 Claude Code 和 Codex。决策：不在本 feature 解决，后续通过 Docker 容器运行 OpenCode adapter。

## 范围变更记录

（实现过程中如有范围变化，在此记录）
