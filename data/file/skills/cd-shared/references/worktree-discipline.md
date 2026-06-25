# Worktree 纪律

design 和 development 阶段的角色（architect、developer）在执行任何文件修改前必须遵守本规则。review 和 merge 阶段的角色进入已有 worktree，不创建新 worktree。

## 规则

1. **先进 worktree，再干活**：收到任务后第一步是创建并进入 worktree，不是分析需求或写文档。
2. **基于最新 `origin/main`**：worktree 必须从最新的远程 main 分支创建。
3. **验证工作目录**：创建后立即验证 cwd 在 `<workspace>/.claude/worktrees/` 或 `<workspace>/.snail/worktrees/` 内。
4. **主目录零修改**：严禁在主目录进行任何文件修改，包括 feature 文档、代码、配置文件。
5. **记录上下文**：创建 worktree 后调用 `record-issue-repo-context --set worktree_path=<path> --set branch_name=<branch>` 记录到 stage output_artifacts。

## 执行流程

```
1. git fetch origin main
2. git worktree add <path> -b <branch> origin/main
3. pwd 验证 cwd 在 worktree 内
4. record-issue-repo-context 记录路径和分支
5. 开始执行正式工作
```

## 违规判定

以下行为视为违规：
- 在主目录创建或修改 feature 文档
- 在主目录修改代码文件
- 跳过 worktree 创建直接开始工作
- worktree 创建后未验证 cwd
