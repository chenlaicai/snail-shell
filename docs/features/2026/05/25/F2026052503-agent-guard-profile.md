---
id: F2026052503
title: Agent 操作安全隔离：Guard Profile 与权限配置分发
from_ids: [F2026052302]
tags: [security, agent, configuration]
modules: [project_management]
---
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
ACP GuardProfile (Snail Shell 统一策略描述 — 唯一配置源)
       │
       ▼
guard-config.ts (翻译层 — 不做安全决策，只做格式转换)
       │
       ├──→ .claude/settings.local.json + guard-profile.json → Claude Code
       ├──→ .codex/config.toml + CODEX_HOME env               → Codex
       └──→ 默认权限模式（移除 --dangerously-skip-permissions） → OpenCode
```

> OpenCode 使用全局配置 `~/.config/opencode/opencode.jsonc`，无 per-project 配置 CLI 入口。
> 当前通过恢复默认权限模式实现安全控制，待 OpenCode 支持 per-project 配置后补充翻译。

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
- 所有 project 默认继承 `config/guard-profile.json` 的 database.mode = "deny"
- 如需放宽（仅特定 project），可在 seed 或 API 中设置 `guard_profile.database.mode = "allow"`

### 配置来源

| 文件 | 用途 | 缺失行为 |
|---|---|---|
| `config/guard-profile.json` | 系统默认安全策略（四领域 deny/allow 模式 + denyPatterns） | 报错 |
| `config/agent-baseline.json` | agent 运维基线允许列表（可执行的 Bash/Web 操作） | 报错 |
| `Project.guard_profile`（DB/seed） | per-project 策略覆盖 | 继承系统默认 |

**字段级填补偿**：`SCHEMA_DEFAULTS` 不是配置源——配置文件单个字段缺失/非法时提供字段级默认值并 `logger.warn`，如 database.mode 的默认值 `"deny"`。

**合并规则**：`resolveGuardProfile()` 将 Project.guard_profile 按 domain 字段级合并到系统默认；
`seedProjectConfigs()` 对已有 project 做非破坏性回填（`guard_profile IS NULL` 时填充，已有值不覆盖）。

### 各 agent 覆盖能力矩阵

| 能力 | Claude Code | Codex | OpenCode |
|---|---|---|---|
| per-project 配置 | settings.local.json | config.toml (CODEX_HOME) | 无 |
| PreToolUse hooks | 原生支持 | 不支持（仅 --sandbox） | 不支持 |
| OS sandbox | `--sandbox` | 默认开启（sandbox_mode） | 不支持 |
| GuardProfile 生效范围 | 全部 domain（allow/deny + hook） | filesystem（sandbox_mode） | 无参数级执行 |

## 生效路径

- ACP 协议定义：`src/agent/capability/spec.ts`
- 翻译层：`src/agent/guard-config.ts`（新建）
- Claude Code：`.claude/settings.local.json` + `.claude/guard-profile.json` → PreToolUse hook
- Codex：`.codex/config.toml` + `CODEX_HOME` env → sandbox_mode
- OpenCode：默认权限模式（移除 `--dangerously-skip-permissions`）
- PreToolUse hook：`.meta/hooks/guard-bash.js`（新建，GuardProfile 驱动规则激活）
- Project 数据模型：`src/shared/domain-types.ts` + `src/persistence/*.ts` 全链路 JSON 持久化

## 改动范围

| 文件 | 改动 |
|---|---|
| `config/guard-profile.json` | **新建**：系统默认安全策略（四领域 deny/allow + denyPatterns） |
| `config/agent-baseline.json` | **新建**：agent 运维基线允许列表 |
| `src/agent/capability/spec.ts` | 新增 `GuardProfile`, `GuardDomain`, `GuardMode` 类型；扩展 `AgentCapability` |
| `src/agent/guard-config.ts` | **新建**：配置文件加载 + 字段级填补偿 + 三 agent 翻译 + 统一合并写入 |
| `src/prompt-center/builder.ts` | 构建 `guardProfiles` 并注入 `AgentCapability` |
| `src/agent/claude-code.ts` | `bypassPermissions` → `acceptEdits`；启动前生成 settings + guard-profile.json |
| `src/agent/claude-code-stateful.ts` | 同上 |
| `src/agent/codex.ts` | 移除 `--dangerously-bypass-approvals-and-sandbox`；spawn 设置 CODEX_HOME env + 能力日志 |
| `src/agent/opencode.ts` | 移除 `--dangerously-skip-permissions` + 能力日志 |
| `src/shared/domain-types.ts` | `Project` 类型新增 `guard_profile` 字段 |
| `src/persistence/{schema,helpers,store,project-config-model}.ts` | DB 全链路持久化 + JSON 解析 + seed backfill |
| `.meta/project-config-seed.json` | Snail Shell 项目 seed |
| `.meta/hooks/guard-bash.js` | **新建**：Bash 命令语义拦截 hook（GuardProfile 驱动规则激活） |
| `tests/agent/guard-config-test.ts` | **新建**：30 测试（翻译/合并/配置来源/baseline/非法回退） |
| `tests/agent/guard-bash-test.ts` | **新建**：35 测试（危险/安全命令全覆盖 + database.mode=allow） |
| `tests/agent/codex-buildargs-test.ts` | 扩展：+2 测试（CODEX_HOME + --ignore-user-config） |
| `tests/persistence/persistence-test.ts` | 扩展：seed backfill 测试 |
| `docs/issues/20260525/F2026052503-agent-guard-profile.md` | 本文档 |

## 验证

1. TypeScript 编译通过：`npx tsc --noEmit`
2. 全部测试通过：`npm test`（含 guard-bash 行为测试、guard-config 单元测试）
3. Agent adapter 单元测试：验证 args 中不含 `bypassPermissions` / `--dangerously-bypass-approvals-and-sandbox` / `--dangerously-skip-permissions`
4. `guard-config.ts` 单元测试（`tests/agent/guard-config-test.ts`，30 测试）：
   - DEFAULT_GUARD_PROFILE 结构完整性
   - resolveGuardProfile 合并行为（null/undefined/partial/invalid）
   - translateToClaudeSettings 领域模式翻译（database deny → deny 列表；database allow → allow 列表授权 + deny 跳过；filesystem/git deny patterns）
   - writeGuardSettings 合并行为（保留已有非托管字段、新建时正确生成、guard-profile.json 同步写入）
5. `guard-bash.js` 行为测试（`tests/agent/guard-bash-test.ts`，35 测试）：
   - 数据库写操作被拒（INSERT/UPDATE/DELETE/DROP/ALTER/CREATE TABLE/non-readonly PRAGMA）
   - sqlite 只读操作放行（SELECT/.schema/.dump/.tables/readonly PRAGMA）
   - 直接数据库文件访问无只读命令时被拒
   - database.mode=allow 时数据库操作放行（guard-profile.json 存在时，7 assertions）
   - guard-profile.json 缺失时默认严格策略（数据库规则生效）
   - 危险文件系统操作被拒（rm -rf /、chmod 777、chmod SUID）— 硬底线，不受 mode 影响
   - 危险 git 操作被拒（force push main/master、reset --hard、clean -fdx）— 硬底线
   - 安全命令放行（ls/npm test/git status/git diff/curl/echo）
   - 边界情况：非 Bash 工具/空命令/非法 JSON → 保守放行

## 风险与决策记录

- **风险**：`acceptEdits` 模式可能导致某些合法操作被 Claude Code 分类器误判为危险而拒绝。决策：先上线，观察被拒 case，再调整 allow 列表。
- **风险**：Codex 移除 `--dangerously-bypass-approvals-and-sandbox` 后，非交互模式下审批请求自动被拒，可能导致某些操作无法执行。决策：需要审批的操作本就不应在非交互模式下执行，如确实需要，应在 config.toml 中显式放行。
- **风险**：OpenCode 无内置 sandbox，安全等级低于 Claude Code 和 Codex。决策：不在本 feature 解决，后续通过 Docker 容器运行 OpenCode adapter。

## 范围变更记录

- **PR #261 首轮检视**：补齐 Project.guard_profile 持久化链路、writeGuardSettings 改为合并模式、补齐测试。
- **PR #261 复检**：
  - database.mode 语义对齐（allow/deny + hook 三层防护均受 GuardProfile 控制）
  - guard-bash.js hook 通过 guard-profile.json 读取 GuardProfile，denyPatterns/mode 驱动规则激活
  - Codex/OpenCode GuardProfile 翻译链路（Codex: config.toml + CODEX_HOME；OpenCode: 默认权限模式）
  - 运维基线从源码移至 config/agent-baseline.json（`AGENT_BASELINE`），缺失即报错
  - 安全策略全部由配置文件驱动，翻译层不做安全决策
