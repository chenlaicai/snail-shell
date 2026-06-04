---
id: F2026052103
title: main 分支 pre-push 防护
from_ids: []
tags: [workflow, security]
modules: [project_management]
---
# F2026052103 main 分支 pre-push 防护

## 背景

私有仓库 `chenlaicai/snail-shell` 不能直接使用 GitHub branch protection 强制 `main` 只能通过 PR 合入。现有本地 hook 机制已经通过 `.githooks/` 和 `core.hooksPath` 生效，但原先只阻止了在本地 `main/master` 上直接 `git commit`，还没有阻止直接 `git push` 到远端 `main/master`。

## 目标

- 阻止直接 push 到远端 `main` / `master`
- 保持现有本地 hook 体系不变
- 明确说明本地 hook 不能防住 `git push --no-verify`

## 非目标

- 不实现 GitHub 服务端分支保护
- 不尝试在本地仓库内禁用 `--no-verify`
- 不修改主目录工作区的现有未跟踪内容

## 设计

新增 `.githooks/pre-push`，逐行读取 push 映射。只要目标远端引用是 `refs/heads/main` 或 `refs/heads/master`，就拒绝本次 push，并提示先推 feature 分支再通过 PR 合入。

该实现复用仓库当前已启用的 `core.hooksPath = .githooks`，因此无需新增额外安装步骤。

## 生效路径

- `.githooks/pre-push`：本地 push 前拦截目标分支
- `.git/config` 中已有 `hooksPath = .githooks`，由现有 `prepare` 脚本和本机配置让 hook 生效
- `pre-push` 拒绝 `refs/heads/main` 和 `refs/heads/master`

## 改动范围

- 新增 `.githooks/pre-push`
- 新增本次 feature 文档
- 在 `B-01-身份与责任契约` 提示词中新增 [HARD] 规则，禁止 agent 使用 `--no-verify` 跳过 git hooks，形成防御深度

## 验证

- `sh .githooks/pre-push` 模拟 push 到 `refs/heads/main` 会失败
- `sh .githooks/pre-push` 模拟 push 到普通 feature 分支会通过
- `npm run check` 通过，只有仓库既有 lint warnings

## 风险与决策记录

- 本地 hook 不能禁止 `git push --no-verify`，这是 Git 的行为边界，不是本次实现遗漏。
- 在系统提示词 `B-01-身份与责任契约` 中新增 [HARD] 规则，禁止 agent 使用 `--no-verify`，形成两层防御：git hook 拦截普通 push → 系统提示词禁止 agent 主动跳过 hook。
- 若需要不可绕过的强制限制，仍需 GitHub branch protection 或其他服务端机制。
- 决策：在仓库内补上 pre-push 防护，作为防误操作手段；同时在文档中明确其边界，避免把它误认为仓库级强制策略。

## 范围变更记录

- 2026-05-21：补充 `pre-push` 防护，覆盖远端 `main/master` 的直接 push 场景。
- 2026-05-21：明确本地 hook 对 `--no-verify` 的限制，避免误解为可绕过 Git 本身的行为。
- 2026-05-21：在 `B-01` 提示词中新增禁止 agent 使用 `--no-verify` 的 [HARD] 规则，作为 agent 行为层面的防御深度补充。
