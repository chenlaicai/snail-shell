# F2026051911 record-feature-repo-context 优化

## 背景

`record-feature-repo-context` 用于研发者提交 PR 后，把当前 Feature 的分支、worktree 和 PR URL 写回 Snail Shell 数据库，供后续追踪与完成/归档时清理资源使用。

实际使用中经常出现 `Feature not found: F2026051906`，说明脚本拿到的 Feature 编号在目标数据库中不存在。该错误阻断了 repo context 记录，也降低了后续工作流清理与追溯的可靠性。

## 目标

1. 分析 `record-feature-repo-context` 的失败原因和涉及的工作流边界。
2. 优化脚本或 skill 文档，使 Feature 不存在、数据库路径不匹配、Feature 文档编号与数据库 Feature 编号混淆等场景给出可执行诊断。
3. 保持 repo context 记录的真实语义：只更新已由系统工作流创建且存在于数据库中的 Feature。
4. 覆盖相关自动化验证，确保既有成功路径不回归。

## 非目标

1. 不在脚本中自动创建 Feature；Feature 生命周期仍由系统工作流负责。
2. 不改变完成/归档 Feature 的状态流转规则。
3. 不直接修改主目录数据库或工作流状态数据。

## 设计

`record-feature-repo-context` 的正确模型是“更新当前系统数据库中已存在 Feature 的 repo context”，不是“根据文档编号创建或补齐 Feature”。因此脚本继续保持 Feature 不存在时失败，避免制造没有 Stage、Conversation 和系统工作流归属的伪 Feature。

本次优化处理两个容易混淆的失败来源：

1. 默认数据库路径从脚本所属 Snail Shell git 主工作区解析为 `data/snail-shell.db`。研发者在隔离 worktree 内调用 skill 时，脚本不应因为 `process.cwd()` 位于 worktree 而创建或读取 worktree 下的空数据库，也不应被其他临时调用目录的 git 仓库误导。
2. Feature 不存在时，错误信息必须同时输出已检查数据库路径和生命周期边界，明确区分“Feature 文档编号存在”和“数据库 Feature 记录存在”。

脚本仍支持 `--db-path` 和 `DB_PATH` 覆盖默认数据库，用于测试或显式操作其他 Snail Shell 实例。

## 生效路径

1. `.meta/skills/record-feature-repo-context/SKILL.md`
2. `src/bin/record-feature-repo-context.ts`
3. 相关测试与构建产物

## 改动范围

1. `src/bin/record-feature-repo-context.ts`：默认数据库路径改为从 git 主工作区解析；增强 Feature 不存在时的诊断信息。
2. `.meta/skills/record-feature-repo-context/SKILL.md`：补充 skill 职责、Feature ID 边界、worktree 默认数据库路径和排障步骤。
3. `tests/project/repo-cleanup-test.ts`：增加 worktree 默认数据库路径和 Feature 不存在诊断的回归测试。

## 验证

1. `npm run build` 通过。
2. `npm run test` 通过，38 个编译后测试文件全部通过。
3. 验证过程中 lint 输出 22 条既有架构边界 warning，均位于本次未修改模块，未阻塞构建或测试。

## 风险与决策记录

1. 用户确认该 skill 的职责是研发者提交 PR 后记录当前 Feature 的分支、worktree、PR 信息到 Feature 上下文中；实现应强化该职责，而不是扩展为 Feature 创建入口。
2. 保持 Feature 不存在时失败是刻意设计：自动创建 Feature 会绕过系统工作流，导致缺失 Stage、Conversation 和参与者归属。

## 范围变更记录

1. 2026-05-19：同步最新 `origin/main` 后，`F2026051907` 已被 `system-prompt-injection-optimization` 占用；按用户明确指定，本 Feature 文档编号调整为 `F2026051911`，不改变需求和实现范围。
