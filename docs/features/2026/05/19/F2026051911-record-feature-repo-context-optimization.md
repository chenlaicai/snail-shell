---
id: F2026051911
title: record-feature-repo-context 优化
from_ids: []
tags: [context]
modules: [project_management]
---
# F2026051911 record-feature-repo-context 优化

## 背景

`record-feature-repo-context` 用于研发者提交 PR 后，把当前 Feature 的分支、worktree 和 PR URL 写回 Snail Shell 数据库，供后续追踪与完成/归档时清理资源使用。

实际使用中经常出现 `Feature not found: F2026051906`，说明脚本拿到的 Feature 编号在目标数据库中不存在。该错误阻断了 repo context 记录，也降低了后续工作流清理与追溯的可靠性。

## 目标

1. 分析 `record-feature-repo-context` 的失败原因和涉及的工作流边界。
2. 优化脚本或 skill 文档，使 Feature 不存在、数据库路径不匹配、Feature 文档编号与数据库 Feature 编号混淆等场景给出可执行诊断。
3. 保持 repo context 记录的真实语义：只更新已由系统工作流创建且存在于数据库中的 Feature。
4. 覆盖相关自动化验证，确保既有成功路径不回归。
5. 去掉 stage 输入产物的独立持久化字段语义，改为由同一 Feature 前一 stage 的输出产物派生，避免阶段推进后输入/输出产物不同步。

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

阶段产物模型同步收敛为单向链条：当前 stage 的输出产物是本阶段正式交付；后一 stage 的输入产物不是独立可写状态，而是由同一 Feature 内 `sequence - 1` 的 stage 输出产物派生。这样避免在 stage 表中维护两份本应一致的产物列表。派生后的输入产物必须作为 manager 对外的统一 stage detail 边界，供 UI 展示、阶段推进/重开 API 响应和 prompt 注入共同使用；不能只在单个读取接口或前端局部计算。为避免对既有数据库做破坏性重建，旧库中可能存在的 `input_artifacts` 列不再进入运行时模型，新建 schema 也不再声明该列。

## 生效路径

1. `.meta/skills/record-feature-repo-context/SKILL.md`
2. `src/bin/record-feature-repo-context.ts`
3. `src/project-workflow/manager.ts`
4. `src/persistence/store.ts`
5. `src/shared/domain-types.ts`
6. 相关测试与构建产物

## 改动范围

1. `src/bin/record-feature-repo-context.ts`：默认数据库路径改为从 git 主工作区解析；增强 Feature 不存在时的诊断信息。
2. `.meta/skills/record-feature-repo-context/SKILL.md`：补充 skill 职责、Feature ID 边界、worktree 默认数据库路径和排障步骤。
3. `tests/project/repo-cleanup-test.ts`：增加 worktree 默认数据库路径和 Feature 不存在诊断的回归测试。
4. `Stage` 运行时模型和 stage 创建/更新路径移除 `input_artifacts` 写入语义；`StageDetail.input_artifacts` 改为后端按前一 stage 输出派生。
5. `ProjectManager.advanceFeature()`、`ProjectManager.restartFeatureDevelopment()` 和 conversation prompt 构建统一使用派生后的 `StageDetail`，避免 API 响应、UI 刚切换阶段和 agent 上下文出现不同输入产物。
6. `tests/project/stage-cycle-test.ts`：覆盖 development -> review、review -> restart development、第二轮 development -> review 的输入产物派生，并验证 review prompt 包含上一阶段输出产物。
7. `tests/interaction-entry/project-api-test.ts`：覆盖阶段推进 API 返回的 `next_stage.input_artifacts` 已派生。

## 验证

1. `npm run build` 通过。
2. `npm run test` 通过，38 个编译后测试文件全部通过。
3. 验证过程中 lint 输出 22 条既有架构边界 warning，均位于本次未修改模块，未阻塞构建或测试。

## 风险与决策记录

1. 用户确认该 skill 的职责是研发者提交 PR 后记录当前 Feature 的分支、worktree、PR 信息到 Feature 上下文中；实现应强化该职责，而不是扩展为 Feature 创建入口。
2. 保持 Feature 不存在时失败是刻意设计：自动创建 Feature 会绕过系统工作流，导致缺失 Stage、Conversation 和参与者归属。
3. 用户确认 stage 之间已有同 Feature sequence 前后关系，当前 stage 输入产物应直接展示前一 stage 的输出产物，不应保留独立 input 字段制造重复状态。

## 范围变更记录

1. 2026-05-19：同步最新 `origin/main` 后，`F2026051907` 已被 `system-prompt-injection-optimization` 占用；按用户明确指定，本 Feature 文档编号调整为 `F2026051911`，不改变需求和实现范围。
2. 2026-05-19：排查发现“输出产物添加后下一阶段输入产物仍显示 0”的根因是 `input_artifacts` 持久化字段未随阶段推进同步；按用户确认，改为移除 input 字段语义并由前一 stage 输出派生。
3. 2026-05-19：复检发现首次实现只在 `StageDetail` 局部派生，prompt 构建和阶段推进/重开 API 仍可能使用 raw stage；已统一 manager 对外结果和 prompt 构建边界，确保 UI/API/prompt 使用同一派生输入产物。
