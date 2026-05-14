# F2026051408 — 修复 required skill 提示词注入与 worktree 硬约束

## 背景

1. **Mention 不稳定**：agent 使用 message-out 协议时好时不好。端到端分析发现根因是 `buildSkillReferenceSection` 只引用 skill 的 description（一句话），不内嵌 SKILL.md 完整正文。agent 必须额外读取文件才能获得完整协议规范，增加了不确定步骤。
2. **流程不生效**：研发检视流程的 26 项 checklist 全部是软约束（纯提示词文本），唯一的硬门禁 `assertStageCanAdvance` 只检查 formal artifact 类型，不检查 worktree 使用情况。
3. **本地 agent 文档混杂**：CLAUDE.md 被提交到仓库，与 snail shell 提示词体系混杂。

## 目标

1. required skill 的完整协议规范直接内嵌在系统提示词中，消除 agent 额外读取文件的不确定步骤
2. stage 推进增加 worktree_path 硬约束，确保 record-feature-repo-context 被执行
3. CLAUDE.md 从仓库移除，由用户本地自行管理

## 非目标

- 不改动 message-out 的代码解析逻辑（parseMessageOutTextIfPresent 等）
- 不改动 mention 提取的 LLM fallback 机制
- 不改动 agent 运行时的 mentions 硬编码空数组

## 设计

### 1. required skill 内嵌完整正文

**问题**：`buildSkillReferenceSection`（`builder.ts:177`）对所有 skill 统一只引用 description、路径和规则。B-01 R09 写"系统提示词只引用 skill 能力边界，不复制 skill 正文"。但 required skill 的 agent 使用正确率依赖完整协议规范（命令语法、Working Rule、完整示例、Hard Rules），只引用 description 不够。

**修复**：
- `buildSkillReferenceSection` 区分 `required` 和 `conditional` 模式：required skill 内嵌 `skill.content`（SKILL.md 去掉 frontmatter 后的正文），conditional skill 保持引用方式
- 更新 B-01 R09 措辞，明确 required skill 已内嵌、按需 skill 只引用

**生效路径**：`buildConversationSystemPrompt` → `buildSkillReferenceSection` → agent 收到完整 SKILL.md 正文

### 2. worktree_path 硬约束

**问题**：`assertStageCanAdvance`（`manager.ts:484`）只检查 formal artifact 类型，不检查 worktree 使用。agent 可以跳过 checklist #2（创建 worktree）和 #20（record-feature-repo-context），直接在主目录提交 PR。

**修复**：在 `assertStageCanAdvance` 中增加检查：如果 feature 存在但 `worktree_path` 为空，拒绝推进。这要求 agent 在提交 PR 后必须执行 `record-feature-repo-context` skill（checklist #20），间接确保 worktree 被创建和使用。

**生效路径**：`advanceFeature` → `assertStageCanAdvance` → 检查 `feature.worktree_path`

### 3. 移除 CLAUDE.md

**问题**：CLAUDE.md 被提交到仓库，将所有 `.meta/prompts/` 文件通过 `@` 引用注入，不区分角色和阶段。用户本地使用 agent 修改 snail shell 时，应自行管理该文件。

**修复**：`git rm CLAUDE.md`，并在 `.gitignore` 中添加 `CLAUDE.md`、`AGENTS.md`、`agents.md`。

## 改动范围

| 文件 | 改动 |
|---|---|
| `src/prompt-center/builder.ts` | `buildSkillReferenceSection` 区分 required/conditional |
| `.meta/prompts/base/B-01-身份与责任契约.md` | R09、R10 措辞更新 |
| `src/project-workflow/manager.ts` | `assertStageCanAdvance` 增加 worktree_path 检查 |
| `CLAUDE.md` | 从仓库移除 |
| `.gitignore` | 添加 CLAUDE.md、AGENTS.md、agents.md |
| `tests/project/stage-cycle-test.ts` | 测试中 advanceFeature 前设置 worktree_path |

## 验证

- 自动化：`npm run check`（lint + build + test）全部通过，35 个测试文件
- 人工验证：
  - 检查 agent 收到的系统提示词中 Skill References 部分是否包含 message-out SKILL.md 完整正文
  - 检查 stage 推进时未设置 worktree_path 是否被拒绝
  - 检查 CLAUDE.md 是否已从 git 跟踪中移除

## 风险与决策记录

- **内嵌 SKILL.md 增加系统提示词长度**：message-out SKILL.md 约 200 行，增量可控。required skill 数量有限（当前仅 message-out），不会无限膨胀。
- **worktree_path 检查可能阻塞特殊情况**：如 feature 未通过 record-feature-repo-context 设置路径就尝试推进，会报错。这是预期行为——强制执行 checklist #20。
- **移除 CLAUDE.md 后本地 agent 需自行管理**：用户已明确表示会自行管理，不是阻塞问题。
