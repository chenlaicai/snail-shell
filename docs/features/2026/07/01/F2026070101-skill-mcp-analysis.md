---
id: F2026070101
title: Skill 与 MCP 能力梳理分析
created: 2026-07-01
status: implemented
modules: [skills, mcp-server]
tags: [analysis, cleanup, architecture]
---

# Skill 与 MCP 能力梳理分析

## 背景

对当前代码仓中的 Skill 和 MCP 进行逐个分析，识别冗余、残留无用、以及能力承载方式需要调整的问题。

## 当前资产清单

### Skills 目录结构

**两个目录的关系**：
- `.claude/skills/`：Claude Code 实际使用的目录，包含 15 个 symlinks，指向 `data/file/skills/` 下的目录
- `data/file/skills/`：实际存放 skill 内容的目录，包含 14 个普通目录（其中 4 个为空）

#### 活跃 Skills（10 个，在系统提示词中注册）

| Skill | 类型 | 依赖 | 状态 |
|-------|------|------|------|
| cd-design | 行为指南 | 无 | ✅ 正常 |
| cd-development | 行为指南 | 无 | ✅ 正常 |
| cd-merge | 行为指南 | 无 | ✅ 正常 |
| cd-review | 行为指南 | 无 | ✅ 正常 |
| cd-review-dev | 行为指南 | 无 | ✅ 正常 |
| cd-shared | 行为指南 | 无 | ✅ 正常 |
| evo-executor | 行为指南 | 无 | ✅ 正常（已改用 snail-evolution MCP） |
| ga-assistant | 行为指南 | 无 | ✅ 正常 |
| prompt-constraints | 文档索引 | 无 | ✅ 正常 |
| snail-skill-creator | 行为指南 | 无 | ✅ 正常 |

#### Broken Symlinks（4 个，位于 `.claude/skills/`，目标目录不存在）

| Symlink | 原目标 | 状态 |
|---------|--------|------|
| conversation-history | data/file/skills/conversation-history | ❌ 已被 snail-message-history MCP 替代 |
| evolution-candidate | data/file/skills/evolution-candidate | ❌ 功能已合并到 snail-evolution MCP |
| feature-chain | data/file/skills/feature-chain | ❌ 已被 snail-feature-chain MCP 替代 |
| set-task-anchor | data/file/skills/set-task-anchor | ❌ 目标不存在，用途不明 |

#### Empty Directories（4 个，位于 `data/file/skills/`，无 SKILL.md）

| 目录 | 状态 |
|------|------|
| project-analysis | ❌ 空目录 |
| project-decomposition | ❌ 空目录 |
| project-intake | ❌ 空目录 |
| project-monitor | ❌ 空目录 |

### MCP Servers（7 个）

| MCP Server | Tools | 职责 |
|------------|-------|------|
| snail-final-response | set_final_body | 消息最终答复提交 + 路由 |
| snail-evolution | complete_evolution_item, create_candidate | 演进项管理 |
| snail-knowledge | search, list, add, remove | 知识库 CRUD |
| rednote-research | research_notes, login, check_login | 小红书调研 |
| snail-issue-context | set_context, get_context | Issue 上下文读写 |
| snail-message-history | search, list, get, get_window | 跨 stage 消息查询 |
| snail-feature-chain | search, get, get_chain | Feature 文档查询 |

## 问题分析

### 问题 1：残留清理（低风险，直接执行）

**4 个 broken symlinks** 指向不存在的目录，是历史迁移的残留物：
- `conversation-history`：已被 `snail-message-history` MCP 替代（代码注释明确写了"替代旧 conversation-history skill"）
- `evolution-candidate`：功能已合并到 `snail-evolution` MCP 的 `create_candidate` tool
- `feature-chain`：已被 `snail-feature-chain` MCP 替代（代码注释明确写了"替代旧 feature-chain skill"）
- `set-task-anchor`：目标不存在，无法确定原始用途

**4 个 empty directories** 没有任何内容，是项目管理功能的残留：
- project-analysis, project-decomposition, project-intake, project-monitor

**处置**：删除所有 broken symlinks 和 empty directories。

### 问题 2：evo-executor 引用断裂（中风险，需修复）

`evo-executor/SKILL.md` 第 12 行和第 20 行引用了 `evolution-candidate` skill：
```
治理对话中如需创建新演进项，使用 `evolution-candidate` skill。
完整协议详见 `evolution-candidate` skill。
```

但该 skill 已不存在，实际创建候选应使用 `snail-evolution` MCP 的 `create_candidate` tool。

**处置**：更新 evo-executor SKILL.md，将对 evolution-candidate 的引用改为 snail-evolution MCP 的 create_candidate tool。

### 问题 3：message-payload 可被 set_final_body 替代（新发现）

**关键发现**：前端只渲染 markdown，message-payload 的结构化 block 类型从未被渲染。

**证据链**：

1. **前端渲染路径**：`ChatMessage.tsx` 第 253-254 行将 `message.context.context` 传给 `RichTextRenderer`
2. **RichTextRenderer 只处理两种 block**：`markdown`（通过 marked.parse）和 `mermaid`（通过 mermaid 库）
3. **无结构化 block 渲染**：前端没有 question card、artifact card、reference card、table（结构化）、chart 的渲染组件
4. **extractBlocksFallback 只提取 fallback_text**：`collaboration.ts` 第 22-28 行从 blocks 格式中提取 `fallback_text` 用于事件摘要，不渲染结构化 block

**message-payload 生成的 block 类型 vs 前端实际渲染**：

| Block 类型 | message-payload 生成 | 前端渲染 |
|-----------|---------------------|---------|
| text (with mentions) | ✅ | ❌ 只渲染 markdown |
| rich_text | ✅ | ❌ |
| markdown | ✅ | ✅ |
| question | ✅ | ❌ 无对应组件 |
| question_response | ✅ | ❌ |
| table (structured) | ✅ | ❌ |
| chart | ✅ | ❌ |
| artifact_card | ✅ | ❌ |
| reference_card | ✅ | ❌ |
| tool_call_card | ✅ | ❌ |
| image | ✅ | ❌ |
| icon | ✅ | ❌ |

**结论**：message-payload 的结构化 block 能力是死代码。前端只渲染 markdown，而 set_final_body 的 markdown 内容被正确渲染。

**set_final_body 已具备的能力**：
- ✅ 提交 markdown 最终答复（前端正确渲染）
- ✅ to_speakers 路由声明（替代 message-payload 的 mentions）
- ✅ 自动提取 stage_transition 信号
- ✅ 幂等防护

**移除 message-payload 的收益**：
- 降低 AI 理解复杂度（只需掌握一个消息提交工具）
- 消除 message-payload 与 set_final_body 的职责模糊
- 减少一个 skill 维护成本
- 消除断裂引用（conversation-history）

**移除 message-payload 的风险**：
- 失去结构化 block 能力（但前端从未渲染，无实际影响）
- 失去 mentions 嵌入内容的能力（但 to_speakers 已在协议层实现）

**处置**：建议移除 message-payload skill，将路由能力统一到 set_final_body 的 to_speakers。

### 问题 4：prompt-constraints 的能力承载方式（优化建议）

prompt-constraints skill 只是查询 `.meta/prompts/reference/` 目录的文档，本质上是一个"文档索引"。

**分析**：
- 当前方式：Agent 使用 Glob + Read 手动查询
- 优化方式：可以迁移为 MCP，提供结构化的搜索和查询能力
- 但当前方式已经足够，迁移收益不大

**处置**：当前不阻塞，可作为未来优化方向。

## 核心业务行为

- 当 Skill 的目标目录不存在时，symlink 应被视为残留并删除
- 当 Skill 引用另一个不存在的 Skill 时，引用必须更新为当前有效的替代方案
- 当两个能力（Skill 和 MCP）的职责重叠时，必须明确边界并统一引用

## 决策记录

| 决策 | 理由 | 替代方案 |
|------|------|----------|
| 删除 4 个 broken symlinks（`.claude/skills/` 下） | 目标目录不存在，是历史迁移残留 | 无 |
| 删除 4 个 empty directories（`data/file/skills/` 下） | 无内容，是项目管理功能残留 | 无 |
| 更新 evo-executor 引用 | 引用的 skill 已不存在 | 重建 evolution-candidate skill（不推荐，功能已合并到 MCP） |
| 移除 message-payload skill | 前端只渲染 markdown，结构化 block 从未被渲染；set_final_body 已覆盖所有实际能力 | 保留 message-payload（不推荐，增加 AI 理解复杂度且结构化能力是死代码） |
| 更新引用 message-payload 的 skill（cd-review、cd-development） | skill 移除后引用断裂 | 无 |
| 暂不迁移 prompt-constraints 为 MCP | 当前方式可用，迁移收益不大 | 立即迁移（可选） |

## 不兼容更新

无。本次分析不涉及数据库或 API 变更。

## 验收标准

- [x] 4 个 broken symlinks 已删除（`.claude/skills/` 下，本地 gitignored 清理）
- [x] 4 个 empty directories 已删除（`data/file/skills/` 下，本地未跟踪清理）
- [x] evo-executor SKILL.md 中对 evolution-candidate 的引用已更新为 `snail-evolution` MCP `create_candidate` tool
- [x] message-payload skill 已移除（目录 + 脚本文件）
- [x] cd-review SKILL.md + workflow.md 中对 message-payload 的引用已更新为 `set_final_body`
- [x] cd-development workflow.md 中对 message-payload 的引用已更新为 `set_final_body`
- [x] cd-shared/pr-signature.md 和 SKILL.md.template 中的引用已同步更新
