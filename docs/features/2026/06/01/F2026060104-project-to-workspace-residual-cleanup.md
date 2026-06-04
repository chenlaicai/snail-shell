---
id: F2026060104
title: project-to-workspace-residual-cleanup
from_ids: []
tags: [refactor, naming, cleanup]
modules: [workspace-management]
doc_kind: spec
---

# F2026060104 项目改为 Workspace 残留清理

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

之前进行了模块职责澄清和清理，将 "project" 改为 "workspace"。但代码仓库中仍存在残留的 "project" 和 "项目" 引用，可能导致 AI 产生混淆。需要进行全仓清理，确保术语一致性。

## 目标

1. 扫描并清理代码仓库中所有残留的 "project" 和 "项目" 引用
2. 将相关命名、注释、文档统一为 "workspace" 术语
3. 确保不引入功能变更，仅做术语重命名

## 非目标

- 不改变现有功能逻辑
- 不处理第三方依赖或外部库中的 project 引用（如 `@typescript-eslint/project-service`）

## 设计

### P1 详设：扫描策略

使用 grep 扫描以下模式：
- `project`（英文，大小写敏感）
- `项目`（中文）
- `Project`（首字母大写）
- `PROJECT`（全大写）

排除范围：
- `node_modules/`
- `.git/`
- `dist/`
- `*.d.ts`（类型声明文件）
- 第三方依赖相关文件

### P2 详设：清理策略

按文件类型分类处理：
1. **源代码**（`.ts`, `.js`）：变量名、函数名、类名、注释
2. **文档**（`.md`）：标题、正文、代码块
3. **配置**（`.json`, `.yaml`）：键名、值
4. **测试**：测试描述、断言消息

对于每个匹配项：
- 判断是否为功能相关的 project（如 npm project、git project）
- 判断是否为项目管理相关的 project（需改为 workspace）
- 保留合理的 project 引用（如 "project structure" 在某些上下文中仍适用）

### P3 详设：验证策略

- TypeScript 编译通过
- 现有测试通过
- 无新增 lint 错误

## 生效路径

- 代码注释和命名
- 文档和提示词
- 配置文件

<!-- [design-time] 章节结束 -->

## 改动范围

### 扫描结果

全仓扫描统计：
- 英文 "project" 引用：942 处
- 中文 "项目" 引用：447 处
- 源代码 `src/` 中的 project 引用：21 处

### 需要清理的文件

**源代码（src/）**：
1. `src/skill-center/registry.ts` — 函数名 `listSkillsWithProject`、变量名 `projectSkillsRoot`、`projectSkills`、参数名 `projectRoot`、注释中的 "项目级"
2. `src/agent/capability/builder.ts` — 参数名 `projectRoot`、注释中的 "项目根目录"、"项目级 skill"
3. `src/agent/skill-symlinks.ts` — 参数名 `projectRoot`、注释中的 "项目级覆盖"
4. `src/agent/guard-config.ts` — 注释中的 "per-project"、"projectRoot"

**提示词（.meta/prompts/）**：
1. `.meta/prompts/prompts/S-02-历史能力.md` — "知识库按项目隔离" → "知识库按工作区隔离"
2. `.meta/prompts/prompts/S-08-演进执行者手册.md` — "项目研发者"、"项目 PR"、"项目规则"
3. `.meta/prompts/prompts/B-02-演进治理.md` — "项目规则"
4. `.meta/prompts/reference/提示词治理.md` — "依赖项目/阶段/角色上下文"、"项目特定规则"
5. `.meta/prompts/reference/演进治理.md` — "项目推进对话"

**Skills（.meta/skills/）**：
1. `.meta/skills/snail-skill-creator/SKILL.md` — "项目根目录" → "工作区根目录"
2. `.meta/skills/evolution-candidate/SKILL.md` — "项目规则" → "工作区规则"
3. `.meta/skills/conversation-history/SKILL.md` — "项目推进会话" → "工作区推进会话"
4. `.meta/skills/query-current-context/SKILL.md` — "项目上下文块"、"项目名"

**配置文件（.meta/）**：
1. `.meta/README.md` — 多处 "项目" 引用
2. `.meta/workspace-config-seed.json` — "默认项目" → "默认工作区"

**测试文件（tests/）**：
1. `tests/agent/capability-spec-test.ts` — 函数名、变量名、断言消息中的 project
2. `tests/agent/mcp-config-test.ts` — "test-project"
3. `tests/workspace/message-payload-test.ts` — "project_charter"、"项目章程摘要"
4. `tests/scripts/db-bridge-evolution-test.ts` — SQL 中的 project 表名改为 workspace

**文档（docs/）**：
- 历史 feature 文档中的 project 引用保留（已合入的历史记录不修改）

### 不清理的引用

1. **第三方依赖** — `package-lock.json` 中的 `@typescript-eslint/project-service`（TypeScript ESLint 内部模块）
2. **历史 feature 文档** — 已合入的历史记录不修改
3. **GitHub 成熟项目** — "GitHub 成熟项目" 中的 "项目" 保留（指 GitHub 上的项目）

## 验证

### P1
- [x] 全仓扫描完成，列出所有匹配项
- [x] 分类判断完成，确定哪些需要清理

### P2
- [x] 所有需清理项已处理
- [x] TypeScript 编译通过
- [x] 现有测试通过（45 个测试文件全部通过）

### P3
- [x] 无新增 lint 错误
- [x] 术语一致性验证

## 关联

- **前置**: F2026053104（SOP 模块隔离）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | 测试文件中的 project 表名 | 修改为 workspace，与实际 schema 保持一致 | 2026-06-01 |
| 2 | 第三方依赖中的 project 引用 | `@typescript-eslint/project-service` 是 TypeScript ESLint 内部模块，不需要修改 | 2026-06-01 |

## 范围变更记录

| 日期 | 变化 | 原因 |
|---|---|---|
