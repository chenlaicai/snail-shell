# 知识文档

`docs/knowledge` 存放已经通过 PR 合入的长期知识。这里的文档是知识本体和 prompt 策略的权威源；SQLite 只保存运行时投影、候选知识、变更请求、搜索索引和使用记录。

## 生效规则

1. 候选知识不直接写入本目录。
2. 新增、更新、停用、替换和归档知识都必须通过 PR 修改本目录文档。
3. PR 合入只表示知识进入仓库主分支，不表示当前运行时已经生效。
4. 系统更新并重启后，启动同步器读取本目录文档并更新 SQLite 投影，知识才进入运行时生效状态。
5. 没有本目录文档来源的数据库 active 知识视为未生效，不得进入 prompt 注入。
6. `docs/knowledge/pending/**` 是批准候选时生成的待 PR review 草稿区，不属于运行时权威源，启动同步必须跳过。
7. 带 `change_request_id` 的正式文档被当前运行代码仓扫描到时，视为对应 PR 已合入且已部署到当前版本，启动同步会自动回写 `pr_state = merged` 并写入运行时 active 投影。

## 从候选到 PR

批准候选后，系统会创建 `knowledge_change_request`，并把待 review 的 Markdown 草稿写入 `docs/knowledge/pending/<knowledge-id>.md`。草稿本身不会生效；同一次审批流程会自动调用 `knowledge-doc-pr` 能力，把 pending 草稿复制到隔离 worktree 的正式 `docs/knowledge/<knowledge-id>.md`，提交并通过 `gh pr create --head <knowledge-branch> --base main` 创建 PR，同时回写 request 的 `branch_name`、`worktree_path`、`pr_url`、`latest_commit_sha` 和 `expected_document_hash`。

PR review、PR 合入、系统更新和服务重启仍由人卡点。系统启动时会自动通过 GitHub PR 状态刷新 request；只有 PR 已确认 merged，且当前运行代码仓扫描到正式 `docs/knowledge/<knowledge-id>.md`，启动同步才会以最终文档 hash 更新 request，并把知识同步为 runtime active。PR review 修改文档是正常生命周期，不需要额外手工回写 hash。

## 文档格式

每条知识一个 Markdown 文件，使用 frontmatter 保存机器可读字段：

```markdown
---
id: knowledge-id
status: active
kind: rule
governance_level: L1
scope_type: project
scope_ref: snail-shell
project_id: project-id-or-null
title: 示例知识
created_by: Implementation Snail
approved_by: Boss Snail
approved_at: "2026-05-08T00:00:00.000Z"
source_candidate_id: candidate-id
change_request_id: request-id
introduced_by_pr: "https://github.com/chenlaicai/snail-shell/pull/1"
prompt:
  allow_prompt_injection: true
  mode: reference_only
  stage_types: []
  snail_names: []
  priority: 10
  token_budget: null
sources:
  - type: message
    id: "123"
    quote: "原始来源摘录"
---

## 内容

知识正文。

## 理由

为什么这条知识应该长期保留。
```

## 状态语义

1. `active`：当前有效，可按 prompt 策略进入运行时注入。
2. `deprecated`：已过时，保留历史但不进入 prompt 注入。
3. `superseded`：已被其他知识替代，保留演进链路但不进入 prompt 注入。
4. `archived`：归档保留，不作为有效知识使用。

## 停用方式

停用必须表达真实语义：

1. 仅停止 prompt 注入：保持 `status: active`，将 `prompt.allow_prompt_injection` 改为 `false` 或 `prompt.mode` 改为 `none`。
2. 标记过时：改为 `status: deprecated` 并在正文或 metadata 中说明原因。
3. 被新知识替代：旧知识改为 `status: superseded`，新知识记录替代关系。
4. 归档：改为 `status: archived`。
