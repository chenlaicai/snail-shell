---
name: issue-chain
description: 查询历史 Issue 文档的索引，搜索相关特性设计记录。用于 AI 在分析新需求时主动搜索历史 Issue 文档，建立引用链（from_ids）。
---

# Issue Chain Skill

## Purpose

Issue Chain 提供对 `docs/issues/` 下所有 Issue 文档的索引搜索和引用链追溯能力。

AI 在分析新 Issue 需求时，应当使用此 skill 搜索历史 Issue 文档中是否已有相关讨论、设计决策或改动记录，避免重复讨论已决问题或做出与既有决策矛盾的选择。

## When To Use

- 分析新 Issue 需求时，搜索历史 Issue 中是否有相关模块或功能的设计记录
- 需要了解某个历史 Issue 的完整设计文档时
- 需要追溯某个历史 Issue 的前置引用和后继引用链时
- 在 issue 文档中填写 from_ids 前，确认目标 Issue 的准确 ID

## Commands

### search — 全文搜索历史 Issue

```bash
node .meta/skills/issue-chain/scripts/issue-chain.js --mode search --query <关键词> [--limit 10]
```

结果按 FTS5 相关度排序，每条包含 issue_id、title、summary、tags、modules、snippet。

### get — 获取单个 Issue 完整文档

```bash
node .meta/skills/issue-chain/scripts/issue-chain.js --mode get --id <IYYYYMMDDNN>
```

返回 frontmatter + 完整 Markdown 正文。

### chain — 追溯引用链

```bash
node .meta/skills/issue-chain/scripts/issue-chain.js --mode chain --id <IYYYYMMDDNN> [--direction backward|forward|both]
```

- backward（默认）: 该 Issue 引用的前置 Issue（from_ids 链）
- forward: 引用了该 Issue 的后继 Issue 列表
- both: 双向同时查询

## Output

所有命令输出 JSON 格式结果。

## Usage Flow

1. 用户提出新 Issue 需求
2. 使用 `--mode search --query <关键词>` 搜索历史 Issue 文档
3. 对匹配结果使用 `--mode get --id` 查看完整设计文档
4. 使用 `--mode chain --id` 追溯引用链，理解演进上下文
5. 确认关联后在当前 issue 文档 frontmatter 中写入 from_ids

## Hard Rules

- 索引仅在系统启动时全量重建；新合入的 Issue 文档需下次重启后进入索引
- 已合入的历史 Issue 文档不可修改 from_ids（单向引用）
- 仅当前开发中的 Issue 可在确认关联后写入 from_ids
