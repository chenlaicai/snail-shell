---
id: F20260713m2xk
title: repo-visibility-strategy-for-interview-showcase
from_ids: []
tags: [repo, strategy, git, public-release]
modules: [repo, scripts]
doc_kind: spec
---

# F20260713m2xk 代码仓可见调整 - 面试展示策略

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

**特性类型**: config-sync（仓库可见性策略与发布脚本）
**创建日期**: 2026-07-13
**状态**: 已锁定

## 背景 [required]

用户准备拿本项目作为面试项目展示。当前仓库为 private，需要调整为可公开可见的形式。但用户有两个约束：

1. **版本隔离**：只展示稳定版本，不展示最新开发中的代码
2. **选择性公开**：不想全部公开，想"藏一点"（如系统提示词、内部 SOP 等核心 know-how）

### 当前仓库状况

| 属性 | 值 |
|------|-----|
| 仓库地址 | `github.com/chenlaicai/snail-shell.git` |
| 可见性 | private |
| 提交数 | 511+ |
| 敏感目录 | `data/file/prompts/`（系统提示词）、`data/file/sops/`（SOP 定义）、`data/file/skills/`（技能工作流）、`data/file/knowledge/`（知识库） |
| 已 gitignore | `.env`、`.claude/`、`CLAUDE.md`、`config/*.json`、`config/sop/*.yaml` 等 |

### 关键技术事实

- **Git 历史暴露风险**：将 private repo 直接转为 public，所有 511 个 commit 的完整历史将全部可见，包括曾提交后删除的文件
- **分支可见性**：GitHub public repo 的所有分支对所有人均可见，无法在同一 repo 中保留私有分支
- **filter-repo 不可逆**：使用 `git filter-repo` 重写历史可以删除敏感文件，但操作不可逆且可能遗漏
- **README 引用断裂**：当前 README.md 引用了多个排除目录（`data/file/sops/`、`data/file/prompts/`、`data/file/skills/`）、已 gitignore 的配置（`config/llm.json`）、排除文件（`CONTRIBUTING.md`、`SECURITY.md`）和过时的工作区结构，公开仓库必须生成适配版 README

## 用户意图锚 [required]

| UA # | 用户原话 | 来源 | 关键修饰语 | 架构师解读 |
|------|---------|------|-----------|-----------|
| UA-1 | "我准备拿本项目作为面试项目，但肯定需要展示" | msg#1 | 空间：GitHub（公开平台）；目的：面试展示；条件：肯定（必须展示，非可选） | 项目必须在 GitHub 上公开可见，作为面试作品集，这不是可选项 |
| UA-2 | "github上本仓库肯定不能保持private了" | msg#1 | 空间：GitHub；状态：从 private 变 public；条件：肯定（确定性的状态变更） | 仓库可见性必须从 private 调整为 public |
| UA-3 | "我只想公开稳定版本" | msg#1 | 数量：稳定版本（非全部版本）；条件：只想（排他性，不包含非稳定版本）；条件：稳定 | 公开的内容需经过稳定性筛选，只公开稳定版本，排他性地排除开发中版本 |
| UA-4 | "我自己本地继续保持最新的版本" | msg#1 | 空间：本地（非远端）；状态：继续最新；时序：保持（持续状态，不中断） | 本地开发仓库不受影响，继续作为最新开发主线，持续不中断 |
| UA-5 | "自己藏一点所以也不想直接全部public" | msg#1 | 数量：部分（非全部）；意图：藏；条件：不想直接（偏好间接/选择性方式，非直接全部公开） | 选择性公开，部分内容需要排除，采用间接方式而非直接全部公开 |

## 方案设计 [required]

### 方案选型

#### 方案 A：独立公开仓库（推荐）

创建一个新的 public 仓库（如 `snail-shell`），原 private 仓库重命名为 `snail-shell-dev`（或保持不变）。通过脚本将稳定版本导出到公开仓库，排除敏感内容。

**优势**：
- 完全隔离：公开仓库和私有仓库互不影响
- 历史可控：公开仓库只有发布快照，不暴露开发历史
- 内容可控：可精确控制每次发布包含哪些文件
- 可逆性：如果发现问题可以随时删除公开仓库重新来

**劣势**：
- 需要维护一个发布脚本（如果定期发布）
- 公开仓库没有 commit history（只有发布快照）

#### 方案 B：当前仓库直接转 public + filter-repo 清理历史

使用 `git filter-repo` 从所有历史 commit 中删除敏感目录，然后将仓库转为 public。

**优势**：
- 单仓库，无需维护两套
- 保留开发历史（对面试展示有加分）

**劣势**：
- filter-repo 不可逆，操作风险高
- 511 个 commit 的历史全部暴露（包括内部讨论、调试代码、错误修复过程等）
- 一旦公开无法收回，敏感信息可能已被缓存
- 需要强制 push 重写所有历史

#### 方案 C：当前仓库转 public + squash 历史

将所有历史压缩为单个 commit，然后转为 public。

**优势**：
- 操作相对简单
- 不暴露详细历史

**劣势**：
- 丢失所有 commit history（面试中无法展示开发过程）
- 仍然是单仓库，后续每次更新都需要公开

### 决策：方案 A（独立公开仓库）

**决策依据**：
1. 技术事实：private repo 转 public 会暴露全部历史，这是不可逆的
2. 用户约束 UA-3（只想稳定版本）+ UA-4（本地继续最新）天然要求两个仓库分离
3. 用户约束 UA-5（藏一点、不想直接全部）要求精细控制公开内容，方案 A 的选择性最强
4. 面试场景下，一个干净的公开仓库 + 清晰的 README 比一堆 commit history 更有展示力

### 公开仓库内容策略

#### 包含（展示项目能力）

| 目录/文件 | 理由 |
|-----------|------|
| `src/` | 核心源码，展示架构能力 |
| `tests/` | 测试代码，展示工程质量 |
| `README.md` / `README.en.md` | 项目说明（需适配，见 B-4） |
| `package.json` / `tsconfig.json` / `vitest.config.ts` / `vitest.web.config.ts` | 技术栈配置 |
| `eslint.config.mjs` | 代码规范 |
| `LICENSE` | 开源许可 |
| `config/*.yaml.example` | 配置示例（展示飞书/企微等集成能力） |

#### 排除（"藏一点"的部分）

| 目录/文件 | 理由 |
|-----------|------|
| `data/file/prompts/` | 系统提示词 - 核心 know-how |
| `data/file/sops/` | SOP 定义 - 内部工作流 |
| `data/file/skills/` | 技能定义 - 内部协作流程 |
| `data/file/knowledge/` | 知识库 - 内部数据 |
| `data/file/*.example` | 内部数据模型示例（snails/mcp/workspaces/lite-ai/guard-profile），暴露内部架构 |
| `docs/features/` | Feature 文档 - 内部开发过程（含设计讨论、架构取舍、用户意图锚） |
| `docs/README.md` | 文档索引，引用内部目录 |
| `.githooks/` | 内部 git hooks |
| `.github/` | CI/CD 配置、Issue/PR 模板 |
| `.snail/` | worktree 和内部状态（含 `init.json`、worktree 目录） |
| `CONTRIBUTING.md` | 内部贡献指南 |
| `SECURITY.md` | 安全策略（内部） |
| `scripts/` | 内部脚本（`check-issue-doc-numbering.ts`） |
| `bin/` | 内部服务启动脚本 |
| `config.json` | 根目录 OpenCode 配置，暴露内部工具链 |

> **待用户确认**：以上排除列表是否匹配"藏一点"的意图？是否有其他需要排除的内容？

### README 适配策略

公开仓库的 README 必须进行以下适配：

1. **移除引用断裂**：删除对 `data/file/sops/`、`data/file/prompts/`、`data/file/skills/` 的引用
2. **移除不可用配置引用**：删除 `config/llm.json` 相关配置说明
3. **修正工作区结构**：将过时的 `src/agent/`、`src/api/`、`src/llm/`、`src/persistence/`、`src/workspace/` 更新为实际的 `src/adapter/`、`src/domain/`、`src/infra/`、`src/app/`、`src/web/`、`src/api-contracts/`
4. **移除内部协作引用**：删除 GitHub Actions、PR 模板、CONTRIBUTING.md、SECURITY.md 相关段落
5. **添加发布说明**：在 README 顶部添加"这是稳定发布版本"说明

### 发布机制

**前置判断 - 发布频率**：

用户场景是面试展示，通常只需一次性发布或低频更新（每次面试前更新到最新稳定版本）。因此：

- **一次性发布**：直接使用 `git archive` + 手动清理 + push，无需脚本
- **定期发布**（如果用户需要）：编写 `scripts/publish-public.sh` 脚本自动化

**一次性发布流程**（推荐）：

```bash
# 1. 从私有仓库导出指定 commit 的文件树
git archive --format=tar HEAD | tar -x -C /tmp/public-snapshot
cd /tmp/public-snapshot

# 2. 删除敏感内容
rm -rf data/file/prompts/ data/file/sops/ data/file/skills/ data/file/knowledge/
rm -f data/file/*.example
rm -rf docs/features/ docs/README.md
rm -rf .githooks/ .github/ .snail/ scripts/ bin/
rm -f CONTRIBUTING.md SECURITY.md config.json

# 3. 适配 README（手动编辑）

# 4. 精简 .gitignore（移除内部工具链引用）

# 5. 初始化公开仓库
git init && git add . && git commit -m "v1.0.0 stable release"
git remote add public <public-repo-url>
git push public main
```

**定期发布脚本**（可选，用户确认后实现）：基于上述流程封装为 `scripts/publish-public.sh`，参数为版本号和源 commit。

### 公开仓库 .gitignore

公开仓库需要独立的精简版 `.gitignore`，移除内部工具链引用：

```gitignore
# Dependencies
node_modules/

# Build output
dist/

# Environment variables
.env
.env.local

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*

# Database
data/database/

# Local config
config/*.json
config/*.yaml
!config/*.example
!config/*.yaml.example
```

移除的条目：`.claude/`、`CLAUDE.md`、`AGENTS.md`、`.snail/`、`config/sop/*.yaml`、`docs/SOP.md`、`BACKLOG.md`、`review-notes/`、`docs/decisions/`、`docs/discussions/` 等内部工具链引用。

### 仓库命名与操作

**命名方案**：

| 仓库 | 名称 | 可见性 | 说明 |
|------|------|--------|------|
| 私有仓库 | `snail-shell`（保持不变） | private | 当前仓库，继续作为开发主线 |
| 公开仓库 | `snail-shell-public`（或用户偏好名称） | public | 接收稳定版本快照 |

**操作风险说明**：
- 如果选择将现有仓库重命名为 `snail-shell-dev`，GitHub 会自动重定向旧 URL，但本地 remote 需要更新（`git remote set-url`）
- 推荐保持私有仓库不变，公开仓库使用新名称，避免 remote 更新操作

> **待用户确认**：公开仓库的名称偏好？

## 核心业务行为 [required]

### B-1: 发布流程执行 ← UA-3, UA-5

**当** 用户执行发布流程并指定源 commit 时
**应该** 生成一个不含敏感文件的代码快照，推送到公开仓库
**约束**：排除列表中的文件/目录不得出现在公开仓库中；公开仓库的 README 不得引用已排除的文件/目录

### B-2: 私有仓库不受影响 ← UA-4

**当** 发布流程执行后
**应该** 私有仓库的代码、历史、分支均不受任何影响
**约束**：发布流程对私有仓库只读，不写入

### B-3: 公开仓库历史隔离 ← UA-3

**当** 多次执行发布流程时
**应该** 每次发布创建新的 commit，但公开仓库只有发布快照，不含开发历史
**约束**：公开仓库的 commit history 只包含发布记录

### B-4: README 适配 ← UA-5

**当** 生成公开仓库快照时
**应该** 对 README 进行适配：移除对已排除目录的引用、修正过时的工作区结构、移除内部协作引用、添加发布版本说明
**约束**：README 中不得出现指向公开仓库中不存在的文件/目录的引用

### B-5: 公开仓库 .gitignore 精简 ← UA-5

**当** 生成公开仓库快照时
**应该** 使用精简版 .gitignore，移除内部工具链引用（`.claude/`、`CLAUDE.md`、`.snail/` 等）
**约束**：公开仓库的 .gitignore 不得暴露内部工具链信息

## 设计约束摘要

1. **隔离原则**：公开仓库与私有仓库完全分离，不共享 git 历史
2. **只读导出**：发布流程对私有仓库只读，不修改任何内容
3. **排除完整性**：排除列表覆盖所有含内部 know-how 的目录和文件
4. **README 一致性**：公开仓库的 README 不得引用已排除的文件/目录
5. **.gitignore 精简**：公开仓库的 .gitignore 不暴露内部工具链
6. **发布频率前置判断**：一次性发布无需脚本；定期发布才需封装脚本

## 关键决策记录

### D-1: 选择独立公开仓库而非直接转 public
- **决策**：方案 A（独立公开仓库）
- **依据**：private repo 转 public 暴露全部历史且不可逆；用户要求版本隔离和选择性公开，方案 A 是唯一同时满足两个约束的方案
- **纠正通道**：用户可标记 `[纠正]` 并说明原因

### D-2: 公开仓库 commit 策略

**正方论据（单 commit 快照）**：
- 完全不暴露开发历史中的敏感信息
- 操作最简单
- 面试展示中，README 和代码质量是主要评估对象

**反方论据（单 commit 快照）**：
- 面试官看到单个 commit 的仓库，可能认为是"搬运"而非自主开发，降低可信度
- 无法展示开发迭代过程和工程实践能力

**中间方案（语义化多 commit）**：
- 创建若干语义化 commit（如 "init project structure"、"add domain layer"、"add web UI"、"add test suite"），展示开发思路但不暴露真实历史
- 操作复杂度适中

- **决策**：默认采用单 commit 快照（最安全），但此决策需用户确认
- **依据**：单 commit 最安全，但面试可信度影响取决于面试官偏好，属于业务偏好而非技术事实
- **纠正通道**：用户可标记 `[纠正]` 并说明原因

### D-3: docs/features/、scripts/、.github/ 全部排除
- **决策**：全部排除，不保留
- **依据**：
  - `docs/features/`：含内部设计讨论、架构取舍、用户意图锚，属于核心开发过程
  - `scripts/`：仅含 `check-issue-doc-numbering.ts`，纯内部工具
  - `.github/`：CI/CD 配置、Issue/PR 模板，属于内部协作流程
- **纠正通道**：用户可标记 `[纠正]` 并说明原因

### D-4: data/file/*.example 全部排除，config/*.yaml.example 保留
- **决策**：`data/file/` 下所有 `.example` 文件排除（snails/mcp/workspaces/lite-ai/guard-profile），`config/` 下 `.yaml.example` 保留
- **依据**：
  - `data/file/*.example` 暴露内部数据模型（snail 定义结构、MCP 集成方式、workspace 模型、AI 配置）
  - `config/*.yaml.example` 展示飞书/企微等集成能力，对面试展示有加分，不含敏感数据
- **纠正通道**：用户可标记 `[纠正]` 并说明原因

### D-5: 私有仓库保持不变，公开仓库使用新名称
- **决策**：私有仓库保持 `snail-shell` 不变，公开仓库使用新名称（如 `snail-shell-public`）
- **依据**：避免重命名导致的 remote 更新操作和潜在的配置断裂
- **纠正通道**：用户可标记 `[纠正]` 并说明原因

## 不兼容更新

无。本方案不影响现有系统的任何功能，仅涉及仓库管理策略。

## 待确认事项

1. **排除列表确认**：以上排除列表是否匹配"藏一点"的意图？是否有其他需要排除的内容？
2. **仓库命名**：公开仓库的名称偏好？（默认推荐 `snail-shell-public`）
3. **Commit 策略**：单 commit 快照（最安全）vs 语义化多 commit（展示开发思路）？（默认推荐单 commit）
4. **发布频率**：一次性发布（无需脚本）vs 定期发布（需封装脚本）？（默认推荐一次性发布）
