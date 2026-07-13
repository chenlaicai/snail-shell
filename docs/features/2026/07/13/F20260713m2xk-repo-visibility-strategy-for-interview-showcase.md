---
id: F20260713m2xk
title: repo-visibility-strategy-for-interview-showcase
from_ids: []
tags: [repo, strategy, git, public-release]
modules: [repo]
doc_kind: spec
---

# F20260713m2xk 代码仓可见调整 - 面试展示策略

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

**特性类型**: config-sync（仓库可见性策略）
**创建日期**: 2026-07-13
**状态**: 已锁定

## 背景 [required]

用户准备拿本项目作为面试项目展示。当前仓库为 private，需要调整为可公开可见的形式。但用户有两个约束：

1. **版本隔离**：只展示稳定版本（约1个月前的代码），不展示最新开发中的代码
2. **选择性公开**：通过发布旧版本实现"藏一点"，而非排除大量文件导致项目无法启动

### 当前仓库状况

| 属性 | 值 |
|------|-----|
| 仓库地址 | `github.com/chenlaicai/snail-shell.git` |
| 可见性 | private |
| 提交数 | 511+ |
| 已 gitignore | `.env`、`.claude/`、`CLAUDE.md`、`config/*.json`、`config/sop/*.yaml` 等 |

### 目标快照

| 属性 | 值 |
|------|-----|
| 目标 commit | `37152fb6`（2026-06-09） |
| 快照文件数 | 556 |
| `data/file/` 内容 | 空（prompts/sops/skills/knowledge 目录当时不存在） |
| README 状态 | 自洽（引用的结构与当时代码一致） |

### 关键技术事实

- **Git 历史暴露风险**：将 private repo 直接转为 public，所有 511 个 commit 的完整历史将全部可见，包括曾提交后删除的文件
- **分支可见性**：GitHub public repo 的所有分支对所有人均可见，无法在同一 repo 中保留私有分支
- **旧快照自洽性**：1个月前的 commit `37152fb6` 的 README、代码结构、配置文件互相一致，项目可独立启动，无需额外适配

## 用户意图锚 [required]

| UA # | 用户原话 | 来源 | 关键修饰语 | 架构师解读 |
|------|---------|------|-----------|-----------|
| UA-1 | "我准备拿本项目作为面试项目，但肯定需要展示" | msg#1 | 空间：GitHub（公开平台）；目的：面试展示；条件：肯定（必须展示，非可选） | 项目必须在 GitHub 上公开可见，作为面试作品集，这不是可选项 |
| UA-2 | "github上本仓库肯定不能保持private了" | msg#1 | 空间：GitHub；状态：从 private 变 public；条件：肯定（确定性的状态变更） | 仓库可见性必须从 private 调整为 public |
| UA-3 | "我只想公开稳定版本" | msg#1 | 数量：稳定版本（非全部版本）；条件：只想（排他性，不包含非稳定版本）；条件：稳定 | 公开的内容需经过稳定性筛选，只公开稳定版本，排他性地排除开发中版本 |
| UA-4 | "我自己本地继续保持最新的版本" | msg#1 | 空间：本地（非远端）；状态：继续最新；时序：保持（持续状态，不中断） | 本地开发仓库不受影响，继续作为最新开发主线，持续不中断 |
| UA-5 | "自己藏一点所以也不想直接全部public" | msg#1 | 数量：部分（非全部）；意图：藏；条件：不想直接（偏好间接/选择性方式，非直接全部公开） | 选择性公开。用户后续澄清（msg#2）："藏一点"主要指不暴露最新代码，通过发布旧版本实现；旧版本的完全代码应可公开，排除列表应最小化 |
| UA-6 | "暴露1个月前的完全代码，这是需要的，而且如果像你这样藏了那么多、项目也根本无法启动啊" | msg#2 | 数量：完全代码（非部分）；条件：1个月前（时序锚点）；条件：可启动（功能性约束） | 公开仓库必须包含完整可启动的项目代码，排除列表不得导致项目无法启动 |
| UA-7 | "你得整理好具体的做法，到时候我可以让ai按照做法来做" | msg#2 | 条件：具体做法（可执行性）；意图：AI 可照做 | 需要产出详细的操作步骤文档，供 AI 逐步执行 |

## 方案设计 [required]

### 方案选型

#### 方案 A：独立公开仓库（推荐）

创建一个新的 public 仓库接收稳定版本快照，原 private 仓库不动。

**优势**：
- 完全隔离：公开仓库和私有仓库互不影响
- 历史可控：公开仓库只有发布快照，不暴露开发历史
- 内容可控：可精确控制每次发布包含哪些文件
- 可逆性：如果发现问题可以随时删除公开仓库重新来

**劣势**：
- 公开仓库没有 commit history（只有发布快照）

#### 方案 B：当前仓库直接转 public + filter-repo 清理历史

使用 `git filter-repo` 从所有历史 commit 中删除敏感目录，然后将仓库转为 public。

**劣势**：
- filter-repo 不可逆，操作风险高
- 511 个 commit 的历史全部暴露
- 一旦公开无法收回

#### 方案 C：当前仓库转 public + squash 历史

将所有历史压缩为单个 commit，然后转为 public。

**劣势**：
- 丢失所有 commit history
- 仍然是单仓库，后续每次更新都需要公开

### 决策：方案 A（独立公开仓库）- 用户已确认

**决策依据**：
1. 技术事实：private repo 转 public 会暴露全部历史，这是不可逆的
2. 用户约束 UA-3（只想稳定版本）+ UA-4（本地继续最新）天然要求两个仓库分离
3. 用户约束 UA-5（藏一点、不想直接全部）通过发布旧版本实现
4. 用户已明确确认（msg#2）："commit不暴露是合理的，所以我认同另开一个公开仓库的做法"

### 公开仓库内容策略

#### 核心原则

公开仓库包含目标 commit `37152fb6`（2026-06-09）的**完全代码**，仅排除极少量内部状态文件。项目必须可正常启动。← UA-6

#### 排除列表

| 目录/文件 | 理由 |
|-----------|------|
| `.snail/` | 内部状态（仅 `init.json`），不属于项目代码 |
| `config.json` | OpenCode 工具链配置，不属于项目代码 |
| `docs/features/` | 历史提交记录，不属于项目代码（用户确认 msg#3） |

**本地配置排除**：`git archive` 仅导出 git tracked 文件，已 gitignore 的本地配置（`.env`、`.claude/`、`CLAUDE.md`、`config/*.json`、`config/*.yaml` 等）不会出现在快照中。公开仓库沿用主仓的 .gitignore 规则。← UA-5, msg#3

#### 保留说明

以下文件属于项目完整性的组成部分，保留有助于面试展示项目成熟度：

| 目录/文件 | 保留理由 |
|-----------|----------|
| `.githooks/` | 展示工程规范（commit-msg、pre-commit 等） |
| `.github/` | 展示 CI/CD 实践和协作流程 |
| `scripts/` | 展示工程工具链 |
| `bin/` | 服务启动脚本，项目运行必需 |
| `CONTRIBUTING.md` / `SECURITY.md` | 展示项目治理成熟度 |
| `package-lock.json` | 确保依赖可复现 |

### README 适配策略

目标 commit `37152fb6` 的 README 与当时的代码结构自洽，无需大幅修改。仅需：

1. **添加发布说明**：在 README 顶部添加"这是稳定发布版本，基于 2026-06-09 的代码快照"
2. **移除内部工具引用**：如果 .gitignore 中排除了 `config.json`，README 中不应引用该文件

无需修正工作区结构 - 旧 README 中的 `src/agent/`、`src/api/` 等路径在当时是准确的。

### 详细操作步骤 ← UA-7

以下步骤供 AI 逐步执行，完成一次性发布。

#### 前置条件

- 私有仓库位于 `/Users/orca/ai/snail-shell`
- 已在 GitHub 创建空的 public 仓库 `snail-shell-public`（不要初始化 README）
- 操作在私有仓库目录中执行

#### 步骤 1：导出旧版本快照

```bash
# 在私有仓库目录中执行
cd /Users/orca/ai/snail-shell

# 导出目标 commit 的文件树到临时目录
mkdir -p /tmp/public-snapshot
git archive --format=tar 37152fb6 | tar -x -C /tmp/public-snapshot

cd /tmp/public-snapshot
```

#### 步骤 2：删除内部文件

```bash
# 删除内部状态文件
rm -rf .snail/
rm -f config.json
# 删除历史提交记录
rm -rf docs/features/
```

#### 步骤 3：适配 README

在 README.md 顶部（标题下方）添加发布说明：

```markdown
> **这是稳定发布版本，基于 2026-06-09 的代码快照（commit 37152fb6）。**
```

检查 README 中是否有对 `config.json` 或 `docs/features/` 的引用，如有则移除。

#### 步骤 4：.gitignore

沿用 `git archive` 导出的 .gitignore（即主仓的 .gitignore）。该文件已经排除了本地配置文件（`.env`、`.claude/`、`CLAUDE.md` 等），无需额外修改。

#### 步骤 5：处理两条 branch 的差异

此步骤处理私有仓库分支和公开仓库分支之间的差异：

1. **文件差异**：步骤 2-4 已处理（删除内部文件、适配 README 和 .gitignore）
2. **历史差异**：公开仓库只有 1 个 commit，私有仓库有 511+ commits - 这是设计预期，无需处理
3. **remote 差异**：公开仓库使用独立的 remote，与私有仓库完全分离

```bash
# 验证快照中不包含内部文件
ls .snail/ 2>/dev/null && echo "ERROR: .snail/ still exists" || echo "OK: .snail/ removed"
ls config.json 2>/dev/null && echo "ERROR: config.json still exists" || echo "OK: config.json removed"
ls docs/features/ 2>/dev/null && echo "ERROR: docs/features/ still exists" || echo "OK: docs/features/ removed"

# 验证项目结构完整性
ls src/ tests/ package.json tsconfig.json README.md LICENSE
```

#### 步骤 6：初始化并推送到公开仓库

```bash
# 初始化新的 git 仓库
git init
git add .
# commit 信息包含源 commit 编号，便于下次更新时明确本次公开使用的版本
git commit -m "v1.0.0 stable release (snapshot from commit 37152fb6f479b30dbbb036100a840f17ddb2266c, 2026-06-09)"

# 添加公开仓库 remote 并推送
git remote add origin https://github.com/chenlaicai/snail-shell-public.git
git branch -M main
git push -u origin main
```

#### 步骤 7：验证

```bash
# 在公开仓库目录中验证项目可启动
npm install
npm run build
npm start
```

### 后续更新流程

初始发布后，如需更新公开仓库到更新的稳定版本，按以下步骤操作。

**核心思路**：两个仓库不共享 git 历史，无法 merge/rebase。每次更新是在公开仓库中创建一个新 commit，内容为私有仓库某个 commit 的清理后快照。

#### 更新步骤

```bash
# 1. Clone 公开仓库（或使用已有本地副本）
git clone https://github.com/chenlaicai/snail-shell-public.git /tmp/public-update
cd /tmp/public-update

# 2. 从私有仓库导出目标 commit 的文件树
# 替换 <COMMIT_HASH> 为想发布的稳定 commit
mkdir -p /tmp/public-snapshot-new
git --git-dir=/Users/orca/ai/snail-shell/.git archive --format=tar <COMMIT_HASH> | tar -x -C /tmp/public-snapshot-new

# 3. 清理内部文件（同初始发布）
cd /tmp/public-snapshot-new
rm -rf .snail/
rm -f config.json
rm -rf docs/features/
# 适配 README（同初始发布步骤 3）

# 4. 将清理后的文件覆盖到公开仓库目录
# 保留公开仓库的 .git/ 目录
rsync -av --delete --exclude='.git' /tmp/public-snapshot-new/ /tmp/public-update/

# 5. 提交并推送
# commit 信息包含源 commit 编号，便于下次更新时明确本次公开使用的版本
cd /tmp/public-update
git add -A
git commit -m "v1.1.0 stable release (snapshot from commit <COMMIT_HASH>, YYYY-MM-DD)"
git push origin main
```

#### 两条 branch 差异处理

| 差异类型 | 初始发布 | 后续更新 |
|----------|----------|----------|
| 文件差异 | 步骤 2-4 处理 | 同样步骤处理，再 rsync 覆盖 |
| 历史差异 | 公开仓库 1 个 commit | 公开仓库累积多个 release commit，每个对应一个快照 |
| remote 差异 | 独立 remote | 不变，仍推送到同一 public remote |

**关键约束**：
- 公开仓库的 commit history 只包含发布快照（如 "v1.0.0 release"、"v1.1.0 release"），不含开发历史
- 每次更新是一个新 commit，不做 merge/rebase（两仓库无共同祖先）
- 使用 `rsync --delete` 确保旧版本中存在但新版本中已删除的文件被清理

### 公开仓库 .gitignore

沿用 `git archive` 导出的主仓 .gitignore，不额外修改。主仓 .gitignore 已排除本地配置文件（`.env`、`.claude/`、`CLAUDE.md`、`config/*.json` 等），公开仓库继承相同规则。

### 仓库命名与操作

| 仓库 | 名称 | 可见性 | 说明 |
|------|------|--------|------|
| 私有仓库 | `snail-shell`（保持不变） | private | 当前仓库，继续作为开发主线 |
| 公开仓库 | `snail-shell-public` | public | 接收稳定版本快照 |

用户已确认名称（msg#2："2.可"）。

## 核心业务行为 [required]

### B-1: 发布流程执行 ← UA-3, UA-5, UA-6

**当** 用户执行发布流程时
**应该** 从私有仓库的指定 commit 导出完全代码快照，仅删除内部状态文件（`.snail/`、`config.json`、`docs/features/`），推送到公开仓库
**约束**：排除列表仅含 `.snail/`、`config.json` 和 `docs/features/`；项目必须可正常启动

### B-2: 私有仓库不受影响 ← UA-4

**当** 发布流程执行后
**应该** 私有仓库的代码、历史、分支均不受任何影响
**约束**：发布流程对私有仓库只读，不写入

### B-3: 公开仓库历史隔离 ← UA-3

**当** 执行发布或后续更新流程时
**应该** 公开仓库只有发布快照 commit，不含开发历史
**约束**：公开仓库的 commit history 只包含发布记录（如 "v1.0.0 release"、"v1.1.0 release"）；两仓库不共享 git 历史，不做 merge/rebase

### B-4: 操作步骤可执行 ← UA-7

**当** AI 按照操作步骤执行时
**应该** 能够完成初始发布和后续更新的全流程
**约束**：步骤必须包含具体命令和验证点；后续更新步骤需处理两条 branch 的文件差异（rsync 覆盖）和历史差异（新 commit，不 merge）

### B-5: .gitignore 沿用主仓规则 ← UA-5

**当** 生成公开仓库快照时
**应该** 沿用主仓的 .gitignore（由 git archive 导出），不额外修改
**约束**：本地配置文件（`.env`、`.claude/`、`CLAUDE.md` 等）已由主仓 .gitignore 排除，不会出现在快照中

## 设计约束摘要

1. **隔离原则**：公开仓库与私有仓库完全分离，不共享 git 历史
2. **只读导出**：发布流程对私有仓库只读，不修改任何内容
3. **完全代码**：公开仓库包含目标 commit 的完整代码，排除列表最小化（仅 `.snail/`、`config.json` 和 `docs/features/`）
4. **可启动性**：公开仓库的代码必须能 `npm install && npm run build && npm start` 正常运行
5. **操作可执行性**：操作步骤必须详细到 AI 可逐步执行

## 关键决策记录

### D-1: 选择独立公开仓库而非直接转 public
- **决策**：方案 A（独立公开仓库）
- **依据**：private repo 转 public 暴露全部历史且不可逆；用户要求版本隔离和选择性公开，方案 A 是唯一同时满足两个约束的方案
- **用户确认**：msg#2 "commit不暴露是合理的，所以我认同另开一个公开仓库的做法"

### D-2: 公开仓库 commit 策略 - 单 commit
- **决策**：单 commit 快照
- **依据**：不暴露开发历史；操作最简单；用户已确认
- **用户确认**：msg#2 "3.单commit"

### D-3: 排除列表（最终）
- **决策**：排除 `.snail/`（内部状态）、`config.json`（OpenCode 工具配置）、`docs/features/`（历史提交记录）
- **依据**：
  - 用户澄清（msg#2）："藏一点"主要指不暴露最新代码，通过发布旧版本实现
  - 用户约束（msg#2）："暴露1个月前的完全代码" + "项目也根本无法启动啊"
  - 用户确认（msg#3）："忽略掉docs/features，因为这是历史提交记录"
  - 用户确认（msg#3）："按照现在主仓的git规则来提交代码，不能包括我本地的一些配置" - 本地配置已由 .gitignore 排除
  - 目标 commit `37152fb6` 的 `data/file/` 目录为空，不存在 prompts/sops/skills/knowledge 排除问题
  - 旧 README 与旧代码结构自洽，无需排除文档
- **纠正通道**：用户可标记 `[纠正]` 并说明原因

### D-4: 发布频率 - 一次性发布，无需脚本
- **决策**：一次性发布，产出详细操作步骤供 AI 执行
- **依据**：用户已确认
- **用户确认**：msg#2 "4.一次性发布，无需脚本，但你得整理好具体的做法"

### D-5: 私有仓库保持不变，公开仓库使用新名称
- **决策**：私有仓库保持 `snail-shell` 不变，公开仓库使用 `snail-shell-public`
- **依据**：避免重命名导致的 remote 更新操作和潜在的配置断裂
- **用户确认**：msg#2 "2.可"

### D-6: 目标 commit 选择
- **决策**：使用 commit `37152fb6`（2026-06-09）作为公开快照源
- **依据**：用户说"1个月前"，该 commit 是 2026-06-09 的最新 commit，距今约 34 天
- **纠正通道**：用户可指定其他 commit

### D-7: Commit 信息包含源 commit 编号
- **决策**：公开仓库的 commit message 必须包含源 commit 的完整 hash
- **依据**：用户确认（msg#3）"commit信息要包含最新具体的commit编号（便于下一次明确本次的公开是用的哪个commit）"
- **格式**：`v1.0.0 stable release (snapshot from commit 37152fb6f479b30dbbb036100a840f17ddb2266c, 2026-06-09)`

## 不兼容更新

无。本方案不影响现有系统的任何功能，仅涉及仓库管理策略。

## 待确认事项

全部已确认：
1. **排除列表** ✅：`.snail/`、`config.json`、`docs/features/`（用户确认 msg#3）
2. **目标 commit** ✅：`37152fb6`（2026-06-09）（用户确认 msg#3）
3. **仓库命名** ✅：`snail-shell-public`（用户确认 msg#2）
4. **Commit 策略** ✅：单 commit，信息包含源 commit hash（用户确认 msg#3）
5. **发布频率** ✅：一次性发布 + 后续手动更新（用户确认 msg#2）
6. **.gitignore** ✅：沿用主仓规则（用户确认 msg#3）
