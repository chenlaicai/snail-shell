---
id: I2026060304
title: skill-audit-and-fixes
from_ids: []
tags: [skill, 文档, 脚本]
modules: [skill]
doc_kind: spec
---

# I2026060304 [skill] Skill 全量审视与修复

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

用户反馈 conversation-history skill 在实际使用中"极其难用"，AI 很难查到本 issue 的历史对话。经代码级审视发现根本原因不是 AI 找不到 conversation_id（系统提示词明确注入了），而是脚本不支持 issue-id 维度的查询，导致跨 stage/conversation 的历史查询不可能。

进一步对所有 12 个 skill 进行代码级审视，发现多个 skill 的 SKILL.md 描述与实际脚本实现存在不匹配。

## 目标

修复所有 skill 的 SKILL.md 与脚本实现之间的不匹配问题，优先级从高到低：

### P1 — conversation-history 增加 issue-id 查询模式

为 conversation-history 脚本增加 `--issue-id` 查询模式，支持查询同一 issue 下所有 conversation 的历史消息。

### P2 — SKILL.md 文档修正

修正以下 skill 的 SKILL.md 描述，使其与实际脚本实现匹配：

1. **query-current-context**：补充遗漏的输出字段（Stage ID、Issue ID、输入产物、输出产物、来源对话 ID、Conversation ID）
2. **evolution-candidate**：补充自动创建的 issue/stage/conversation 副作用说明、evolution-center 工作区说明
3. **record-issue-repo-context**：修正自发现机制描述（fs.realpathSync 解析后的路径前缀）、补充 merge 是浅合并的说明
4. **message-payload**：补充遗漏的 blocks 子命令、question-response 的 --selection-mode 参数、reference-card 的 --ref-type 合法值枚举

## 非目标

- 不修改 developer-handbook、reviewer-handbook、prompt-constraints、snail-skill-creator 这四个纯文档 skill
- 不修改 issue-chain 和 knowledge-library（SKILL.md 描述与实现基本匹配）
- 不修改 set-task-anchor（SKILL.md 与代码基本匹配）
- 不修改系统提示词（S-01、S-02 等）

## 设计

### P1 详设：conversation-history 增加 issue-id 查询

**数据层**：
- `conversation` 表有 `issue_id` 字段
- `store.ts:394` 已有 `listConversationsByIssue(issueId)` 方法
- `message` 表通过 `conversation_id` 关联

**新增模式**：`search-by-issue`
- 参数：`--issue-id`（必填）、`--query`（可选）、`--limit`（可选，默认 50）
- 逻辑：先查 `SELECT id FROM conversation WHERE issue_id = ?`，再跨 conversation 搜索消息
- 无 `--query` 时返回该 issue 下所有 conversation 的最近消息
- 有 `--query` 时在该 issue 的所有 conversation 中做全文搜索

**SKILL.md 更新**：
- 新增 `search-by-issue` 模式说明
- 补充 conversation 和 issue 的关系说明
- 增加选择指南：何时用哪种模式

### P2 详设：SKILL.md 文档修正

逐个 skill 修正 SKILL.md，使其与脚本实际实现匹配。详见"改动范围"章节。

## 生效路径

- `.meta/skills/conversation-history/scripts/conversation-history.js` — 新增 search-by-issue 模式
- `.meta/scripts/db-bridge.js` — 新增 history-search-by-issue 模式
- 各 skill 的 SKILL.md — 文档修正

## 设计约束摘要

- **边界**：只修改 skill 脚本和 SKILL.md，不修改系统提示词、不修改数据库 schema
- **关键决策**：conversation-history 新增 search-by-issue 模式，而非修改现有模式
- **非目标约束**：不修改纯文档 skill（developer-handbook 等）
- **语义不变量**：现有模式的行为不变，只新增能力

<!-- [design-time] 章节结束 -->

## 改动范围

### P1 — conversation-history 脚本修改

| 文件 | 改动 |
|---|---|
| `.meta/skills/conversation-history/scripts/conversation-history.js` | 新增 search-by-issue 模式 |
| `.meta/scripts/db-bridge.js` | 新增 history-search-by-issue 查询逻辑 |
| `.meta/skills/conversation-history/SKILL.md` | 新增模式说明、选择指南、issue 关系说明 |

### P2 — SKILL.md 文档修正

| 文件 | 改动 |
|---|---|
| `.meta/skills/query-current-context/SKILL.md` | 补充遗漏的输出字段 |
| `.meta/skills/evolution-candidate/SKILL.md` | 补充副作用说明 |
| `.meta/skills/record-issue-repo-context/SKILL.md` | 修正自发现描述、补充 merge 语义 |
| `.meta/skills/message-payload/SKILL.md` | 补充遗漏的子命令和参数 |

## 验证

### P1

- [x] `--issue-id` 参数正确解析
- [x] 跨 conversation 搜索返回正确结果
- [x] 无 `--query` 时返回最近消息
- [x] 有 `--query` 时做全文搜索
- [x] 现有模式不受影响（45 个测试全部通过）

### P2

- [x] 各 SKILL.md 的描述与脚本实现一致
- [x] 无遗漏的输出字段、子命令或参数

## 关联

无前置 issue。

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | conversation-history 新增模式 vs 修改现有模式 | 删除独立的 search-by-issue 模式，改为让 search/recent/page 三个核心模式直接支持 --issue-id。这样即使 AI 用错了模式，只要传了 --issue-id（系统提示词明确注入了），也能得到正确结果。 | 2026-06-03 |
