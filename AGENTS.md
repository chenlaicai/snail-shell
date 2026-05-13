# AGENTS.md

本文件为外部 AI agents 提供在 Snail Shell 仓库中工作的指引。系统行为规则已迁入 `.meta/prompts/` 提示词模块，外部 agent 需自行加载。

## 系统提示词

以下提示词模块构成 Snail Shell 的完整系统提示词。Claude Code 通过 CLAUDE.md 的 `@` 引用自动注入；其他 agent 需自行加载对应模块。

### Base 层（始终注入）

@.meta/prompts/base/B-01-身份与责任契约.md

@.meta/prompts/base/B-02-知识治理.md

@.meta/prompts/base/B-03-运行时边界.md

### Scenario 层 — Work Context（按场景注入）

@.meta/prompts/scenarios/project-conversation/work-context/S-01-项目上下文.md

@.meta/prompts/scenarios/project-conversation/work-context/S-02-历史能力.md

### Scenario 层 — Stage Role Playbook（按角色和阶段注入）

@.meta/prompts/scenarios/project-conversation/stage-role-playbooks/S-03-研发者手册.md

@.meta/prompts/scenarios/project-conversation/stage-role-playbooks/S-04-检视者手册.md

### Scenario 层 — Task Runtime（后台任务）

@.meta/prompts/scenarios/task-runtime/S-05-mention提取.md

@.meta/prompts/scenarios/task-runtime/S-06-会话摘要.md

### 加载策略

- **修改 Snail Shell 代码**：B-01、B-02、S-01、S-03（或 S-04，视角色而定）
- **检视 PR**：B-01、B-02、S-01、S-04
- **后台任务**：按任务类型加载对应 task runtime 模块
- 提示词结构规范见 `docs/core/prompt-system-structure.md`

## 开发工作流要求

**重要：开发和测试必须使用 Worktree 隔离**

当为 Snail Shell 项目本身开发新功能或修复 bug 时：

- **必须使用 worktree**：在进行任何代码修改前，必须创建隔离的 worktree
- **严禁修改主目录的 git 分支**：只要涉及查看某个分支代码、切换分支、修改代码、测试或提交，都必须在隔离 worktree 中完成；主目录已有本地改动时只能记录并避开，除非用户明确要求处理
- **初始化要求**：每次创建 worktree 后，必须将主目录的 `config/llm.json` 复制到对应 worktree 的 `config/llm.json`
- **配置说明**：`config/llm.json` 是本地运行所必需的文件，但它被 `.gitignore` 忽略，不允许提交；因此每个新 worktree 都要手动复制，避免因缺少该文件导致程序无法启动
- **创建方式**：
  - **Claude Code**：必须使用 `EnterWorktree` 工具创建 worktree，退出时使用 `ExitWorktree` 工具
  - **其他 agents**：使用 git 命令在 `../snail-shell-worktrees/` 目录创建（与主项目同级）
- **Worktree 位置**：
  - Claude Code 创建的 worktree 位于 `.claude/worktrees/`（已配置构建工具忽略）
  - 其他 agents 创建的 worktree 位于 `../snail-shell-worktrees/`
- **清理要求**：完成工作后，需要适当清理 worktree
- **自动收尾记录要求**：创建或确认工作分支、worktree 和 PR 后，必须使用 record-feature-repo-context skill（`.meta/skills/record-feature-repo-context/`） 把 `branch_name`、`worktree_path`、`pr_url` 记录到当前 Feature；Feature 完成并确认已合入后，通过系统完成动作触发安全清理，系统只清理已记录且位于约定 worktree 目录内的 worktree，并使用非强制方式删除已合入本地分支
- **原因**：确保并行开发不会干扰主项目目录或其他正在进行的工作

工作流程示例（Claude Code）：
1. 用户请求功能或 bug 修复
2. 使用 `EnterWorktree` 工具创建隔离环境
3. 将主目录的 `config/llm.json` 复制到 worktree 的 `config/llm.json`
4. 在 worktree 中进行修改、测试和提交
5. 使用 `ExitWorktree` 工具退出并清理（keep 保留 / remove 删除）

工作流程示例（其他 agents）：
1. 用户请求功能或 bug 修复
2. 在 `../snail-shell-worktrees/` 中创建隔离环境
3. 将主目录的 `config/llm.json` 复制到 worktree 的 `config/llm.json`
4. 在 worktree 中进行修改、测试和提交
5. 完成后清理（如果工作继续则保留，如果完成则删除）

## 项目概述

Snail Shell 是一个多智能体协作工作空间系统。

### 核心理念

- **阶段驱动**：项目通过固定的工作流阶段推进，每个阶段有明确的输入和输出
- **角色协作**：不同角色的 AI 智能体各司其职，通过提及机制相互协作
- **产物导向**：工作必须沉淀为正式产物，只有满足产物要求才能推进
- **留痕可追溯**：所有工作过程和决策必须可追溯

### 技术栈

- TypeScript + Node.js
- SQLite（数据持久化）
- Express + WebSocket（API 服务）
- better-sqlite3（数据库）

## 开发指南

### 构建和测试

```bash
npm run build    # 构建
npm run lint     # 代码检查
npm run test     # 运行测试
npm run check    # 完整检查（lint + build + test）
npm start        # 启动服务
```

### 理解项目

**具体实现细节请阅读实际代码**，建议按以下顺序：

1. 阅读 `.meta/` 目录下的配置文件，理解工作流定义
2. 查看数据库 schema，理解数据模型
3. 阅读核心编排逻辑，理解系统如何协调各个组件

---

**注意**：本文档只提供工作流指引和项目参考。具体的行为规则、角色职责和交付要求已迁入 `.meta/prompts/` 提示词模块，详见 `docs/core/prompt-system-structure.md`。
