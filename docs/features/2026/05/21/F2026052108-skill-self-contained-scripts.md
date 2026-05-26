---
id: F2026052108
title: Skill 脚本自包含重构：消除 src/bin 外部依赖
from_ids: []
tags: [skill]
modules: [project_management]
---
# F2026052108 Skill 脚本自包含重构：消除 src/bin 外部依赖

## 背景

Snail Shell 的 skill 目录原先不是自包含的。Skill 的 SKILL.md 定义在 `.meta/skills/<name>/`，但可执行脚本的实际逻辑在 `src/bin/<name>.ts` 中（编译到 `dist/src/bin/<name>.js`）。Skill 目录内的薄壳脚本通过跨目录引用指向编译产物：

```js
// .meta/skills/message-out/message-out.js
require(path.resolve(__dirname, "../../../dist/src/bin/message-out.js"));
```

这违反 Claude Code skill 的业界标准规范：**skill 目录应自包含，可直接拷贝到另一台机器的 `.claude/skills/` 下生效**。

## 目标

- 每个 skill 目录自包含：`SKILL.md` + `scripts/<name>.js`（esbuild 打包的独立脚本）
- 消除所有 `dist/src/bin/` 跨目录引用
- 消除 `src/bin/` 中的 skill 脚本源文件（`server-control.ts` 除外，它是项目基础设施）
- 更新 SKILL.md 中的命令路径引用
- 构建流程同步更新

## 非目标

- 不改变 skill 的功能语义或命令行接口
- 不改变 `server-control.ts`（项目服务管理工具，非 skill）

## 设计

### 变更前 vs 变更后

```
变更前:
  src/bin/message-out.ts                    ← TS 源码（依赖 ../message-bus/message-out）
  dist/src/bin/message-out.js               ← tsc 编译产物
  .meta/skills/message-out/message-out.js   ← require("../../../dist/...") 薄壳

变更后:
  .meta/skills/message-out/
  ├── SKILL.md                              ← skill 定义
  └── scripts/
      └── message-out.js                    ← esbuild 打包的独立脚本（自包含）
```

### 构建方式

使用 esbuild 将每个 skill 脚本打包为独立 Node.js 文件：

```bash
npx esbuild src/bin/<name>.ts --bundle --platform=node --target=node20 --format=cjs \
  --outfile=.meta/skills/<name>/scripts/<name>.js --external:better-sqlite3
```

- `--bundle` 将 TypeScript 依赖内联到单个 `.js` 文件
- `--external:better-sqlite3` 保留 native 模块的外部引用
- 输出文件添加 `#!/usr/bin/env node` shebang，设为可执行

### 产物提交策略

打包后的 `scripts/<name>.js` 直接提交到 git，作为 skill 目录的完整组成部分。构建流程中的 `build-dist.ts` 仅将这些脚本复制到 `dist/`。

### 任务锚

#### 本质目标
将 skill 目录重构为自包含的、符合 Claude Code 业界标准的结构，消除 `src/bin/` ↔ `.meta/skills/` 的跨目录耦合。

#### 反目标
- 不得改变任何 skill 的功能语义或命令行接口
- 不得引入新的构建依赖（esbuild 已通过 npx 可用）
- 不得删除 `server-control.ts`

#### 语义不变量
- 每个 skill 的命令行接口（参数名、子命令、输出格式）不变
- 构建流程 `npm run build` 仍正常产出 dist

#### 成功标准
- `node .meta/skills/message-out/scripts/message-out.js text --text 'hello'` 正常运行
- `src/bin/` 中仅剩 `server-control.ts`
- 所有 SKILL.md 引用路径指向 `scripts/<name>.js`
- 现有测试通过（更新引用路径后）

## 生效路径

- `.meta/skills/<name>/scripts/<name>.js`：6 个自包含 skill 脚本，作为运行时入口
- `.meta/skills/<name>/SKILL.md`：各 skill 的命令路径引用指向 `scripts/<name>.js`
- `.meta/skills/developer-handbook/SKILL.md`：研发者请求检视时的 message-out 调用路径
- `.meta/skills/reviewer-handbook/SKILL.md`：检视者通知研发者时的 message-out 调用路径
- `.meta/prompts/prompts/B-01-身份与责任契约.md`：跨角色 mention 协议中的 message-out 标准调用路径
- `scripts/build-dist.ts`：构建流程从 `scripts/<name>.js` 复制到 `dist/.meta/scripts/`
- `eslint.config.mjs`：lint 配置忽略新路径下的打包产物
- `.meta/skills/SKILL.md.template`：新 skill 模板反映 `scripts/<name>.js` 路径约定

## 改动范围

### 新增（7 个文件）
| 文件 | 说明 |
|---|---|
| `.meta/skills/conversation-history/scripts/conversation-history.js` | esbuild 打包的自包含脚本 |
| `.meta/skills/design-decision/scripts/design-decision.js` | esbuild 打包的自包含脚本 |
| `.meta/skills/knowledge-candidate/scripts/knowledge-candidate.js` | esbuild 打包的自包含脚本 |
| `.meta/skills/message-out/scripts/message-out.js` | esbuild 打包的自包含脚本 |
| `.meta/skills/record-feature-repo-context/scripts/record-feature-repo-context.js` | esbuild 打包的自包含脚本 |
| `.meta/skills/set-task-anchor/scripts/set-task-anchor.js` | esbuild 打包的自包含脚本 |
| `docs/features/20260521/F2026052108-skill-self-contained-scripts.md` | 本 feature 文档 |

### 删除（12 个文件）
| 文件 | 说明 |
|---|---|
| `src/bin/conversation-history.ts` | 旧 TS 源码，逻辑已迁移到打包脚本 |
| `src/bin/design-decision.ts` | 旧 TS 源码，逻辑已迁移到打包脚本 |
| `src/bin/knowledge-candidate.ts` | 旧 TS 源码，逻辑已迁移到打包脚本 |
| `src/bin/message-out.ts` | 旧 TS 源码，逻辑已迁移到打包脚本 |
| `src/bin/record-feature-repo-context.ts` | 旧 TS 源码，逻辑已迁移到打包脚本 |
| `src/bin/set-task-anchor.ts` | 旧 TS 源码，逻辑已迁移到打包脚本 |
| `.meta/skills/conversation-history/conversation-history` | 旧薄壳脚本 |
| `.meta/skills/design-decision/design-decision` | 旧薄壳脚本 |
| `.meta/skills/knowledge-candidate/knowledge-candidate` | 旧薄壳脚本 |
| `.meta/skills/message-out/message-out.js` | 旧薄壳脚本 |
| `.meta/skills/record-feature-repo-context/record-feature-repo-context` | 旧薄壳脚本 |
| `.meta/skills/set-task-anchor/set-task-anchor` | 旧薄壳脚本 |

### 修改（8 个文件）
| 文件 | 改动 |
|---|---|
| `.meta/skills/conversation-history/SKILL.md` | 命令路径引用更新为 `scripts/conversation-history.js` |
| `.meta/skills/design-decision/SKILL.md` | 命令路径引用更新为 `scripts/design-decision.js` |
| `.meta/skills/knowledge-candidate/SKILL.md` | 命令路径引用更新为 `scripts/knowledge-candidate.js` |
| `.meta/skills/message-out/SKILL.md` | 命令路径引用更新为 `scripts/message-out.js` |
| `.meta/skills/record-feature-repo-context/SKILL.md` | 命令路径引用更新为 `scripts/record-feature-repo-context.js` |
| `.meta/skills/set-task-anchor/SKILL.md` | 命令路径引用更新为 `scripts/set-task-anchor.js` |
| `.meta/skills/SKILL.md.template` | 模板中的脚本路径约定更新 |
| `scripts/build-dist.ts` | 脚本复制源路径更新为 `.meta/skills/<name>/scripts/<name>.js` |
| `eslint.config.mjs` | 忽略路径从 `dist/src/bin` 更新为 `.meta/skills/*/scripts` |
| `.meta/skills/developer-handbook/SKILL.md` | message-out 调用路径更新（检视修复） |
| `.meta/skills/reviewer-handbook/SKILL.md` | message-out 调用路径更新（检视修复） |
| `.meta/prompts/prompts/B-01-身份与责任契约.md` | message-out 标准调用路径更新（检视修复） |
| `tests/meta/prompt-assets-test.ts` | 测试断言中的路径引用更新 |
| `tests/project/repo-cleanup-test.ts` | 测试断言中的路径引用更新 |

### 迁移的 skill 脚本（6 个）
| Skill | 旧脚本位置 | 新脚本位置 |
|-------|-----------|-----------|
| conversation-history | `src/bin/conversation-history.ts` | `.meta/skills/conversation-history/scripts/conversation-history.js` |
| design-decision | `src/bin/design-decision.ts` | `.meta/skills/design-decision/scripts/design-decision.js` |
| knowledge-candidate | `src/bin/knowledge-candidate.ts` | `.meta/skills/knowledge-candidate/scripts/knowledge-candidate.js` |
| message-out | `src/bin/message-out.ts` | `.meta/skills/message-out/scripts/message-out.js` |
| record-feature-repo-context | `src/bin/record-feature-repo-context.ts` | `.meta/skills/record-feature-repo-context/scripts/record-feature-repo-context.js` |
| set-task-anchor | `src/bin/set-task-anchor.ts` | `.meta/skills/set-task-anchor/scripts/set-task-anchor.js` |

### 未涉及的 skill（3 个）
- developer-handbook、reviewer-handbook、snail-skill-creator — 纯 SKILL.md 规则型 skill，无脚本

### 保留在 src/bin/
- `server-control.ts` — Snail Shell 服务管理工具，非 skill 脚本

## 验证

- [x] `message-out` 脚本独立可运行（stdin 和 `--text` 模式）
- [x] 5 个其余 skill 脚本可解析执行（无重复 shebang SyntaxError）
- [x] `git grep` 确认 runtime 入口（reviewer-handbook、developer-handbook、B-01）全部指向新路径
- [x] `npm run build` 构建通过（CI 确认）
- [x] `npm run test` 测试通过（CI 确认，含 message-out-test、repo-cleanup-test、knowledge-candidate-test 路径修复）
- [ ] `git grep` 确认无残留的 `dist/src/bin/<skill-name>` 引用

## 风险与决策记录

- **esbuild 打包产物维护负担**：`scripts/<name>.js` 是构建产物但直接提交到 git。好处是 skill 目录真正的自包含（不需要构建步骤即可直接使用），代价是修改逻辑时需要重新打包并提交产物。决策：鉴于 skill 脚本逻辑变更频率低，自包含的价值高于产物维护成本。

- **重复 shebang 构建缺陷**：esbuild 的 `banner` 选项添加 shebang 时，如果源文件已包含 shebang，会导致重复。首轮打包时未检查输出文件，5 个脚本的第二行 shebang 被 Node.js 当作 JS 代码解析导致 SyntaxError。修复：移除重复的 shebang 行。后续重新打包时需要先删除源文件中的 shebang 或改用 `--banner:js=` 控制。

- **message-out 路径迁移的连锁影响**：message-out 是跨角色 mention 协议的核心工具，路径从 `.meta/skills/message-out/message-out.js` 变为 `.meta/skills/message-out/scripts/message-out.js` 会影响 reviewer-handbook、developer-handbook 和 B-01 提示词中的标准调用。修复：同步更新三处 runtime 引用。

- **测试文件中的旧路径引用**：`message-out-test.ts`、`repo-cleanup-test.ts`、`knowledge-candidate-test.ts` 等多个测试文件中硬编码了旧 skill 脚本路径（如 `.meta/skills/message-out/message-out.js`），在删除旧薄壳后导致 `MODULE_NOT_FOUND` 和 `ENOENT`。修复：全部同步到 `scripts/<name>.js` 新入口。

- **不兼容标记**：本 PR 删除旧入口、改变用户/agent 可见调用方式，按提交/PR 模板规则标记为 `[Incompatible]`。不保留兼容层的理由：旧路径为薄壳包装，迁移后不再必要，保留多条可调用入口增加维护负担。

## 范围变更记录

- **检视修复（初轮）**：移除 5 个 skill 脚本的重复 shebang（`conversation-history`、`design-decision`、`knowledge-candidate`、`record-feature-repo-context`、`set-task-anchor`），修复 runtime 入口的 message-out 路径引用（`reviewer-handbook/SKILL.md`、`developer-handbook/SKILL.md`、`B-01-身份与责任契约.md`）。
- **检视修复（PR 元数据更新）**：PR 标题添加 `[Incompatible]` 标记，PR 正文新增 `## 不兼容更新` 段落，说明影响对象、迁移方式和理由。
- **检视修复（分支同步）**：同步 `origin/main`（包含 F2026052107），解决 B-01 文件合并冲突。
- **检视修复（复检测试路径）**：修复 `message-out-test.ts:69`、`repo-cleanup-test.ts`（4 处）、`knowledge-candidate-test.ts:30` 中的旧 skill 脚本路径，全部更新为 `scripts/<name>.js` 新入口。CI 全部通过。
