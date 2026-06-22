# 开发者工作流程详细流程

## 阶段一：环境准备

### GATE-1: 进入隔离 worktree
- 使用 `git worktree add` 基于最新 `origin/main` 创建 worktree
- 验证：当前工作目录必须在 worktree 内
- 严禁在主目录进行任何文件修改
- 创建 worktree 和分支后，调用 `record-issue-repo-context --set worktree_path=<path> --set branch_name=<branch>` 记录到 stage output_artifacts

### GATE-2: 拉取并确认 `origin/main` 最新
- 在 worktree 内执行 `git fetch origin main` 并 rebase

### GATE-3: Feature 文档已加载
- 确认 Feature 文档属于当前 issue
- 确认 [design-time] 章节已锁定

### GATE-4: Task Anchor 已设置
- 使用 `set-task-anchor` skill 写入：本质目标、反目标、语义不变量、成功标准、change_type、verification_commands

所有 GATE 通过后方可进入阶段二。

## 阶段二：设计确认

1. 对照 Feature 文档的 [design-time] 章节，确认理解无歧义
2. 如有歧义，通过 message-payload skill 向架构师提问
3. 确认设计约束摘要中的边界和语义不变量

## 阶段三：实现

1. 按设计方案编码
2. 遵守代码仓库完美状态原则（无兼容性桥接、无 ALTER TABLE）
3. 测试必须对应核心业务行为，断言外部可观测行为
4. 非显而易见的逻辑必须有 `/** ... */` 注释说明设计意图

## 阶段四：验证与 PR 提交

1. 执行 task_anchor 中的 `verification_commands`（或按 change_type 的默认模板）
2. 记录验证输出作为 dev-02 evidence
3. 通过 stage-gate API 写入 gate_evidence
4. 创建 PR，标题格式：`[FYYYYMMDDNN][module][Feature Update|BugFix|New Feature][Incompatible] 中文标题`
5. PR 描述中包含回归检查的范围和结果
