---
id: F2026052703
title: remove-governance-artifacts
from_ids: []
tags: [governance, cleanup]
modules: [project_management]
doc_kind: spec
---

# F2026052703 [project_management] 移除治理产物 BACKLOG.md 和 review-notes

## 背景

Snail Shell 接入 clowder-ai governance 后，BACKLOG.md 和 review-notes/ 被自动生成并 commit 到仓库。这两个产物与 snail-shell 原有理念冲突：snail-shell 用 `docs/issues/` 目录树作为 feature 索引，不需要独立的 BACKLOG；review-notes 是 review 请求信的本地工作产物，不应入库。

## 目标

从仓库移除 BACKLOG.md、review-notes/、docs/decisions/、docs/discussions/，并通过 .gitignore 防止重新提交。

## 非目标

- 不修改 clowder-ai governance-pack 源码
- 不改变 cat-cafe-skills 的 skill 逻辑

## 设计

通过 `git rm` 从版本控制移除文件，在 .gitignore 添加 `BACKLOG.md` 和 `review-notes/` 防止 governance skills 重新生成后误提交。CLAUDE.md/AGENTS.md 的 Project Adaptations 已声明 override 规则。

## 生效路径

- `.gitignore`：添加 `BACKLOG.md`、`review-notes/`、`docs/decisions/`、`docs/discussions/`
- `CLAUDE.md` / `AGENTS.md`（gitignored）：Feature Index override 指导 agent 跳过 BACKLOG 相关操作

## 改动范围

- `.gitignore`
- `BACKLOG.md`（删除）
- `review-notes/`（删除）
- `docs/decisions/`（删除）
- `docs/discussions/`（删除）

## 验证

- [x] BACKLOG.md 不在 git tracked files 中
- [x] review-notes/ 不在 git tracked files 中
- [x] docs/decisions/ 不在 git tracked files 中
- [x] docs/discussions/ 不在 git tracked files 中
- [x] .gitignore 包含新规则
- [x] tsc / lint / 测试全过

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|-----------|------|------|
| 1 | governance skills 仍会本地生成 BACKLOG.md | 可接受——本地生成不影响仓库，CLAUDE.md override 指导 agent 跳过 | 2026-05-27 |
