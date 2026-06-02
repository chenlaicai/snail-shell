---
id: I2026051409
title: — pre-commit 事前拦截与 mention 提示词改进
from_ids: [I2026051304]
tags: [prompt, workflow, security]
modules: [project_management]
---
# I2026051409 — pre-commit 事前拦截与 mention 提示词改进

## 背景

1. **流程不生效**：研发检视流程的 26 项 checklist 全部是软约束，agent 可以直接在主目录 main 分支修改代码并提交，没有任何机制阻止。
2. **Mention 不稳定**：agent 使用 message-out 协议时好时不好。分析发现 B-01 R08 虽然描述了正确用法，但没有明确要求 agent 先读取 SKILL.md 了解完整协议规范，且没有说明不遵守的后果。
3. **本地 agent 文档混杂**：CLAUDE.md 和 agents.md 被提交到仓库，与 snail shell 提示词体系混杂。

## 目标

1. 用 git pre-commit hook 事前阻止直接提交到 main 分支
2. 改进 B-01 中 mention 相关规则，明确要求先读 SKILL.md 再操作
3. CLAUDE.md 和 agents.md 从仓库移除，由用户本地自行管理

## 非目标

- 不把 SKILL.md 内容嵌入系统提示词（破坏系统提示词与 skill 的语义边界）
- 不在 stage 推进时做事后校验（agent 已经在主目录改完代码，事后校验无意义）
- 不改动 message-out 的代码解析逻辑

## 设计

### 1. pre-commit 事前拦截（#2）

**问题**：agent 可以直接在 main 分支提交代码，没有任何代码级阻止。

**修复**：创建 `.githooks/pre-commit` hook，在 `npm run check` 之前检查当前分支。如果是 main 或 master，拒绝提交并提示创建 worktree。

通过 `package.json` 的 `prepare` 脚本自动配置 `core.hooksPath`，使 hook 对所有开发者（包括 agent）生效。

**生效路径**：agent 在 main 分支执行 `git commit` → hook 检测到 main 分支 → 拒绝提交并输出错误信息

### 2. commit-msg 中文标题约束（#17）

**问题**：commit message 没有格式约束，agent 可能使用英文标题或空标题。

**修复**：创建 `.githooks/commit-msg` hook，检查首行是否包含 CJK 字符。不包含则拒绝提交。

### 3. feature 文档变更提醒（#3、#16）

**问题**：agent 修改 src/ 代码时经常忘记同步更新 feature 文档。

**修复**：在 pre-commit hook 中，当 src/ 文件有变更但 docs/features/ 无变更时输出提醒（不阻塞提交，因为存在合法不需要更新文档的场景）。

### 4. S-03 工作流程重构

**问题**：S-03 的 26 项 checklist 是扁平列表，agent 看不到"首先做什么"的信号。checklist 既是"做什么"又是"检查什么"，职责混杂。

**修复**：将 checklist 重组为四步工作流程（环境准备→需求设计→实现→验证提交），每步有明确描述。checklist 降级为自检表格，定位为每阶段完成后的确认动作。Review 工作流程按相同结构重组。

### 5. mention 提示词改进

**问题**：B-01 R08 描述了 message-out 的正确用法，但没有强调必须先读取 SKILL.md。agent 可能凭记忆或 R08 的简化描述直接操作，跳过完整协议规范。

**修复**：R08 改为明确要求"使用 message-out 前必须先读取其 SKILL.md"，并补充不遵守协议的后果（消息不会被投递）。

### 6. 移除 CLAUDE.md 和 agents.md

**问题**：CLAUDE.md 被提交到仓库，通过 `@` 引用将所有 prompts 注入，不区分角色和阶段。

**修复**：`git rm CLAUDE.md`，`.gitignore` 中添加 `CLAUDE.md`、`AGENTS.md`、`agents.md`。

## 改动范围

| 文件 | 改动 |
|---|---|
| `.githooks/pre-commit` | 新增：阻止直接提交到 main，src/ 变更时提醒更新 feature 文档 |
| `.githooks/commit-msg` | 新增：commit message 首行必须包含中文字符 |
| `package.json` | 新增 `prepare` 脚本，配置 `core.hooksPath` |
| `.meta/prompts/scenarios/.../S-03-研发者手册.md` | 重构：增加四步工作流程，checklist 降级为自检表格 |
| `.meta/prompts/base/B-01-身份与责任契约.md` | R08 改为要求先读 SKILL.md，R07 补充后果说明 |
| `CLAUDE.md` | 从仓库移除 |
| `.gitignore` | 添加 CLAUDE.md、AGENTS.md、agents.md |

## 验证

- 自动化：`npm run check`（lint + build + test）全部通过，35 个测试文件
- 人工验证：
  - 在 main 分支执行 `git commit` 应被 hook 拒绝
  - 在 worktree 分支执行 `git commit` 应正常通过
  - CLAUDE.md 和 agents.md 已从 git 跟踪中移除

## 风险与决策记录

- **hook 可被绕过**：`git commit --no-verify` 可跳过 hook。但 agent 的系统提示词明确要求不跳过 hooks，且 `--permission-mode bypassPermissions` 不影响 git hooks。这是合理的防御深度。
- **prepare 脚本需要 npm install**：新 clone 的仓库需要先 `npm install` 才能激活 hook。这是 Node.js 项目的标准行为。
- **不嵌入 SKILL.md**：保持系统提示词与 skill 的语义边界。系统提示词说"用什么"，skill 说"怎么用"。agent 必须通过读取文件获取 skill 的完整规范。
