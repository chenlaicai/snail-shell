---
id: F2026053002
title: acs-skill-injection
from_ids: [F2026052908, F2026052302]
tags: [acs, skill, agent-runtime]
modules: [agent, skill-center]
doc_kind: spec
---

# F2026053002 [agent] ACS Skill 原生注入

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

`capability.skills` 收集了所有已注册 skill 的 `SkillCapability`（含 name、description、content），但没有任何 agent adapter 消费它。三个 agent runtime 的 skill 注入现状：

| Agent | 现状 | 原生 skill 机制 |
|---|---|---|
| Claude Code | `capability.skills` 未被 adapter 读取 | `.claude/skills/<name>/SKILL.md`，原生扫描 + Skill tool |
| Codex CLI | 同上 | `.agents/skills/<name>/SKILL.md`，原生扫描 + `$SkillName` 引用 |
| SST OpenCode | 同上 | `.claude/skills/` + `.agents/skills/` + `.opencode/skills/`，原生扫描 + `skill` tool |

`spec.ts:33` 的 TODO 明确标注了注入策略未实现。PR #310 移除了 `skill_references` 声明式字段后，`collectActiveSkills()` 变为无条件返回所有 skill，但消费端从未接通。

同时，当前 `skill-center/registry.ts` 硬编码 `process.cwd()/.meta/skills/`，不支持项目级 skill 覆盖。而 prompt 系统已支持 `projectRoot/.snail/prompts/` 项目覆盖，skill 应保持一致。

## 目标

### P1 — 通过符号链接实现三端原生 skill 注入

利用三个 agent CLI 的原生 skill 发现机制，通过符号链接将 Snail Shell 的 `.meta/skills/` 暴露为 agent 原生目录：

- `.claude/skills/` → `.meta/skills/`（Claude Code + OpenCode 共用）
- `.agents/skills/` → `.meta/skills/`（Codex + OpenCode 共用）

### P2 — 支持项目级 skill 覆盖

扩展 `skill-center/registry.ts` 支持从 `<projectRoot>/.snail/skills/` 加载项目级 skill，与 prompt 系统的 `loadProjectPrompts()` 对齐。符号链接目录同时包含全局 skill 和项目级 skill（项目级同名覆盖全局）。

## 非目标

- 不修改三个 agent CLI 的原生 skill 发现逻辑
- 不将 SKILL.md 全文嵌入 systemPrompt（保持 `F2026051409` 的语义边界约束）
- 不实现 skill 的条件激活机制（`when` 类似物）——当前所有 skill 全量返回，由 agent 按需调用
- 不处理 OpenCode 的 `.opencode/skills/` 目录（通过 `.claude/skills/` 和 `.agents/skills/` 已覆盖）

## 设计

### P1 详设

**符号链接策略**：在各 agent adapter 的 `invokeMessage()` 中调用 `ensureSkillSymlinks(projectRoot, skills)`，在 worktree 内创建符号链接目录：

```
<worktree>/.claude/skills/<skill-name>/  →  <实际skill目录>/
<worktree>/.agents/skills/<skill-name>/  →  <实际skill目录>/
```

每个 skill 子目录单独创建符号链接（而非整个目录的符号链接），以便支持项目级覆盖：全局 skill 和项目级 skill 各自创建链接，项目级同名覆盖全局。

**skill 目录来源**：
- 全局：`<snail-shell-root>/.meta/skills/`
- 项目级：`<projectRoot>/.snail/skills/`（可选，不存在则跳过）

**清理**：符号链接在 agent 进程生命周期内持续存在，不在 `invokeMessage()` 结束时清理（agent 启动时扫描目录，中途清理会导致后续调用丢失 skill）。worktree 整体删除时符号链接自然清理。`cleanupSkillSymlinks()` 作为工具函数保留，供测试和手动清理使用。

### P2 详设

**registry.ts 扩展**：`listSkills()` 接受可选 `projectRoot` 参数：
- 无参数时行为不变（只加载全局 `.meta/skills/`）
- 有参数时先加载全局，再加载项目级，项目级同名覆盖

**capability/builder.ts**：`collectActiveSkills(context)` 从 `PromptBuildContext` 中获取 `projectRoot`，传递给 `listSkills(projectRoot)`。

## 生效路径

- 代码：`src/skill-center/registry.ts`、`src/agent/capability/builder.ts`、`src/agent/claude-code.ts`、`src/agent/claude-code-stateful.ts`、`src/agent/codex.ts`、`src/agent/opencode.ts`
- 测试：`tests/agent/capability-spec-test.ts` 扩展验证项目级 skill 合并
- 配置：无新增配置项

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `src/skill-center/registry.ts` | 修改 | `listSkills()` 支持可选 `projectRoot` 参数，合并全局 + 项目级 skill |
| `src/skill-center/index.ts` | 修改 | 导出 `listSkillsWithProject` |
| `src/agent/capability/builder.ts` | 修改 | `collectActiveSkills()` 传递 `projectRoot` |
| `src/agent/skill-symlinks.ts` | 新增 | `ensureSkillSymlinks()` + `cleanupSkillSymlinks()` 工具函数 |
| `src/agent/claude-code.ts` | 修改 | `invokeMessage()` 中调用 `ensureSkillSymlinks()` |
| `src/agent/claude-code-stateful.ts` | 修改 | 同上 |
| `src/agent/codex.ts` | 修改 | 同上 |
| `src/agent/opencode.ts` | 修改 | 同上 |
| `src/prompt-center/builder.ts` | 修改 | `collectActiveSkills()` 传递 `projectRoot` |
| `tests/agent/capability-spec-test.ts` | 修改 | 扩展测试覆盖项目级 skill 合并和符号链接 |

## 验证

### P1

- [x] 符号链接正确指向实际 skill 目录（单元测试 `testEnsureSkillSymlinks` 验证）
- [x] 符号链接不覆盖用户手动创建的真实目录（单元测试 `testEnsureSkillSymlinksDoesNotOverwriteRealDirs` 验证）
- [x] `cleanupSkillSymlinks()` 正确清理符号链接（单元测试 `testCleanupSkillSymlinks` 验证；实际场景中符号链接随 worktree 删除自然清理，不在 `invokeMessage()` 中调用）
- [ ] Claude Code agent 启动后，system-reminder 中包含 skill listing（需集成测试或实际调用验证）
- [ ] Codex agent 启动后，developer prompt 中包含 skill listing（需集成测试或实际调用验证）
- [ ] OpenCode agent 启动后，`skill` tool description 中包含 skill listing（需集成测试或实际调用验证）

### P2

- [x] 项目级 `.snail/skills/` 中的 skill 被发现并注入（单元测试 `testListSkillsWithProjectOverride` 验证）
- [x] 项目级同名 skill 覆盖全局 skill（单元测试 `testListSkillsWithProjectOverride` 验证）
- [x] 无项目级 skill 时行为不变（单元测试 `testListSkillsWithProjectNoProjectDir` 和 `testCollectActiveSkillsWithProjectRoot` 验证）

### 通用

- [x] 现有测试全部通过（capability-spec-test 9/9 通过，project-overlay-test 通过）
- [x] 新增测试覆盖项目级 skill 合并逻辑
- [x] TypeScript 编译无错误
- [x] ESLint 无错误

## 关联

- **前置**: F2026052908（提示词优化：B-03 精简与 skill_references 移除 — 本次在此基础上接通注入链路）
- **相关**: F2026052302（ACS 协议设计 — spec.ts TODO 的实现）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | 符号链接是否被 Claude Code 跟随 | Claude Code scanner 支持 symlink following，已确认 | 2026-05-30 |
| 2 | skill 内脚本路径（`node .meta/skills/...`）在符号链接下是否有效 | 符号链接不改变实际文件位置，脚本路径仍指向主仓库的 `.meta/skills/`，有效 | 2026-05-30 |
| 3 | 不嵌入 SKILL.md 全文到 systemPrompt | 保持 F2026051409 约束，利用 agent 原生 skill 机制 | 2026-05-30 |
| 4 | OpenCode adapter 的 `.opencode/skills/` 是否需要额外处理 | 不需要，OpenCode 同时扫描 `.claude/skills/` 和 `.agents/skills/`，已覆盖 | 2026-05-30 |
| 5 | 符号链接清理时机 | 不在 invokeMessage() 中清理——agent 启动时扫描目录，中途清理会导致后续调用丢失 skill。符号链接随 worktree 删除自然清理 | 2026-05-30 |

## 范围变更记录

| # | 变更内容 | 原因 | 日期 |
|---|---|---|---|
| 1 | P1 详设"清理"策略变更：从"invokeMessage() 结束后清理"改为"符号链接持续存在，随 worktree 删除自然清理" | 实现时发现 agent 启动时扫描 skill 目录，中途清理会导致后续 invokeMessage() 调用丢失 skill | 2026-05-30 |
| 2 | 改动范围表补充 `src/prompt-center/builder.ts` 和 `src/skill-center/index.ts` | 实际修改了这两个文件但初始版本遗漏 | 2026-05-30 |
