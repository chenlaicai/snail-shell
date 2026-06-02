---
id: I2026052007
title: 强化模块边界 lint 规则并消除 Claude 原生机制依赖
from_ids: [I2026052001]
tags: [refactor, architecture, security]
modules: [project_management]
---
# I2026052007 强化模块边界 lint 规则并消除 Claude 原生机制依赖

## 背景

1. 上次 I2026052001 修复了 22 个模块边界 `no-restricted-imports` warning，但规则设为 `"warn"` 级别导致回归无法在 CI/commit 阶段拦截。本次重构 snail 和 agent 后再次触发越界依赖（message-bus → llm），因 warn 级别未阻断而被忽略。
2. Snail Shell 通过 `--system-prompt` 覆盖注入所有行为指令（研发者手册等），但 Claude Code 的 auto-memory 机制在启动时自动加载 `~/.claude/projects/.../memory/`，导致两套指令系统并存，指令权威性被稀释，agent 在 worktree 流程上连续违规。

## 目标

1. 将全部 6 处 `no-restricted-imports` 规则从 `"warn"` 升级为 `"error"`，确保越界依赖在 lint 阶段即被阻断
2. 修复 message-bus 模块对 `llm` 的越界依赖（`MessageContextSummaryGenerator` 应来自 `shared` 而非 `llm`）
3. Claude Code CLI 调用添加 `--bare` 参数，禁用 auto-memory 等 Claude 原生机制，确保 Snail Shell 注入的 system prompt 为唯一指令来源

## 非目标

- 不调整模块依赖拓扑结构
- 不修改 Snail Shell 注入的系统提示词内容

## 设计

### warn → error

`no-restricted-imports` 规则覆盖 shared、persistence、prompt-center、skill-center、snail-den、message-bus 六个模块。原 `"warn"` 级别在 CI 中不会失败，导致越界依赖可被合入。改为 `"error"` 后，lint 失败即阻断。

### message-bus 越界修复

`MessageContextSummaryGenerator` 接口定义在 `src/shared/types.ts`，`llm/summary.ts` 从 shared 导入并 re-export。`message-bus/collaboration.ts` 和 `message-protocol.ts` 直接从 `llm` 导入属于不必要的越界——应直接从定义源 `shared/types` 导入。

### --bare 参数

`claude --bare` 禁用：auto-memory、CLAUDE.md 自动发现、hooks、LSP、plugin sync 等。Snail Shell 通过 `--system-prompt` 覆盖注入完整行为规范，无需这些机制。

## 生效路径

- `eslint.config.mjs`：模块边界 no-restricted-imports 规则级别
- `src/agent/claude-code.ts`：无状态 agent CLI 参数
- `src/agent/claude-code-stateful.ts`：有状态 agent CLI 参数
- `src/message-bus/collaboration.ts`、`src/message-bus/message-protocol.ts`：import 路径

## 改动范围

- `eslint.config.mjs` — 6 处 `"warn"` → `"error"`
- `src/message-bus/collaboration.ts` — import `../llm` → `../shared/types`
- `src/message-bus/message-protocol.ts` — import `../llm` → `../shared/types`
- `src/agent/claude-code.ts` — args 添加 `"--bare"`
- `src/agent/claude-code-stateful.ts` — args 添加 `"--bare"`

## 验证

- `npm run lint` — 0 errors, 0 warnings
- `tests/agent/claude-code-test.ts` — 7 测试全过
- `tests/agent/claude-code-stateful-test.ts` — 2 测试全过
- `npm run check` — 全量测试通过

## 风险与决策记录

- `--bare` 参数会影响所有 Claude Code 调用（无状态和有状态），如后续需要启用特定 Claude 原生机制，需评估是否移除 `--bare` 或改用更细粒度的控制。
- 已确认 `--bare` 不影响 `--system-prompt` 和 `--resume` 等核心参数的正常工作。

## 范围变更记录

（暂无）
