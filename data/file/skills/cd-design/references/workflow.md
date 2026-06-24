# 架构师工作流程详细流程

## 阶段一：环境准备

### GATE-1: 进入隔离 worktree
- 使用 `git worktree add` 基于最新 `origin/main` 创建 worktree
- 验证：当前工作目录必须在 worktree 内（`<workspace>/.claude/worktrees/` 或 `<workspace>/.snail/worktrees/`）
- 严禁在主目录进行任何文件修改（包括 feature 文档）
- 创建 worktree 和分支后，调用 `record-issue-repo-context --set worktree_path=<path> --set branch_name=<branch>` 记录到 stage output_artifacts

### GATE-2: 拉取并确认 `origin/main` 最新
- 在 worktree 内执行 `git fetch origin main` 并 rebase

### GATE-3: Feature 文档已检查/创建
- 扫描 `docs/features/YYYY/MM/DD/`
- 无对应文档 → 按 `docs/README.md` 模板创建
- 有文档 → 确认属于当前 issue，加载上下文
- 已合入的 feature 文档是历史交付记录，不得二次修改；新变化必须创建新的 feature 文档
- feature 文档不应残留未确认的问题；风险、疑问或待决策事项必须向用户或相关参与者提出并收敛

### GATE-4: 背景已追溯
- 基于用户需求描述、上一 Stage 产物、Feature 文档、已记录 PR 和必要的 conversation history
- 搜索相关的历史 Feature 文档（feature-chain skill）
- 查阅知识库中的相关约束和决策（knowledge-library skill）

所有 GATE 通过后方可进入阶段二。

## 阶段二：需求分析

1. 独立分析需求，理解用户要解决的真实问题
2. 搜索历史 Feature 文档和知识库，建立上下文
3. 识别需求中的模糊点、冲突点和边界条件
4. 向用户提问时，说明已查证的线索和仍缺失的决策点

## 阶段三：交叉审视与设计收敛

详见 `cross-review.md`。

## 阶段四：产出锁定

### 强制输出给用户确认

1. 设计文档锁定前，必须将完整文档内容通过消息输出给用户审阅
2. 用户确认后才能锁定；有疑问必须向用户确认，禁止自行猜测
3. 用户对部分内容有异议时，针对异议点局部回退重新分析，不需要整体回退
4. 用户长时间未确认时，系统提醒一次（不设超时，用户是最终决策者）

### 锁定检查

1. 确认 Feature 文档的 `[design-time]` 章节完整
2. 修改系统功能语义的 PR：确认"核心业务行为"章节已填写且列表非空；每条行为满足粒度标准（能否写一个不超过 20 行的测试）
3. 确认「设计约束摘要」已从设计章节中提取关键边界、决策和语义不变量
4. 确认无未解决的设计争议
5. 两位架构师均明确表示设计方案可接受
6. 将 Feature 文档的 `[design-time]` 章节视为锁定——进入实现阶段后不得单方面修改

### 变更影响面分析（产出锁定前必须完成）

- **变更类型标签**：确定主变更类型，写入 task_anchor 的 `change_type`
- **受影响范围清单**：列出涉及的文件、模块、配置文件、提示词和文档
- **验证命令预定义**（建议）：根据变更类型，在 task_anchor 的 `verification_commands` 字段中定义验证命令
