---
id: F20260707wqay
title: Vite 文件监听忽略 worktree 目录
from_ids: []
tags: [bugfix, frontend, vite, dev-experience]
modules: [web]
---
# F20260707wqay Vite 文件监听忽略 worktree 目录

## 状态

- [x] design
- [x] development
- [ ] review
- [ ] merge

## 问题描述

Close Issue 后页面发生完整刷新（非 React 重渲染，而是 Vite 级别的 full page reload）。此问题已通过 3 轮 PR 修复 React Query / WebSocket 层面的问题，但根因仍然存在。

### 用户提供的日志证据

```
10:11:13 [vite] changed tsconfig file detected: ../../.snail/worktrees/feature-issue-last-updated-time/tsconfig.json - Clearing cache and forcing full-reload to ensure TypeScript is compiled with updated config values.
10:11:13 [vite] changed tsconfig file detected: ../../.snail/worktrees/feature-issue-last-updated-time/src/web/tsconfig.json - Clearing cache and forcing full-reload to ensure TypeScript is compiled with updated config values.
10:11:14 [vite] (client) page reload ../../.snail/worktrees/feature-issue-last-updated-time/src/web/index.html
```

## 用户意图锚

| 编号 | 修饰语类别 | 用户原话 | 含义 |
|------|-----------|---------|------|
| UA-1 | 时序 | "close issue后" | 触发时机：issue 关闭操作之后 |
| UA-2 | 视觉属性 | "页面会自动刷新" | 现象：整页自动重新加载，非局部更新 |
| UA-3 | 数量 | "之前排查过多次" | 已有多轮修复尝试（PR #531, #551, #579），问题仍未解决 |
| UA-4 | 条件 | "是否确实会触发 页面的重新刷新" | 需要确认日志中的 Vite 事件与页面刷新的因果关系 |
| UA-5 | 空间 | "页面" | 作用范围：整个页面（Vite 级 full-reload），非局部组件重渲染 |

**来源**：消息 ID 4055（用户 kickoff 消息，stage 6aed82b8）

**架构师解读**：用户需要确认日志中的 Vite tsconfig 检测事件确实是页面刷新的直接原因（UA-4）。用户已排查多轮（UA-3），但此前修复均在 React Query / WebSocket 层面，未触及 Vite dev server 层面。页面级别的完整刷新（UA-2, UA-5）指向 Vite dev server 行为，而非 React 组件重渲染。

## 根因分析

### 因果链

```
用户点击 Close Issue
  → 后端 closeIssue() (collaboration.ts:259)
    → issuePort.closeIssue() — DB 事务
    → cleanupResourcesAsync() — 异步执行 (collaboration.ts:268)
      → cleanupResources() (resource-cleanup.ts)
        → git worktree remove <path>  ← 删除 worktree 目录
        → worktree 目录中的 tsconfig.json 文件被删除/变更
  → Vite dev server 文件监听器检测到 tsconfig.json 变更
    → [vite] changed tsconfig file detected
    → Clearing cache and forcing full-reload
    → [vite] (client) page reload
    → 页面完整刷新
```

### 根因：Vite dev server 监听 worktree 目录中的 tsconfig.json

**位置**：`src/web/vite.config.ts:52-54`

```typescript
server: {
  watch: {
    cwd: path.resolve(__dirname),
  },
}
```

当前配置仅设置了 `cwd`（chokidar 的相对路径基准），**未配置 `ignored`**。tsconfig 文件通过 `ensureWatchedFile()` 被添加到 Vite 的主 chokidar watcher 中（非独立 watcher）。Vite root 为 `src/web/`，worktree 中的 tsconfig.json 位于 root 之外，因此被 `watcher.add()` 显式监听。当 close issue 触发 `git worktree remove` 时，worktree 目录被删除，其中的 `tsconfig.json` 和 `src/web/tsconfig.json` 文件变更被 chokidar 检测到，触发 `reloadOnTsconfigChange()` → cache 清除和 full-reload。

`.snail/worktrees/` 和 `.claude/worktrees/` 目录中的文件变更均会被 chokidar 监听到，因为当前 `ignored` 配置为空（仅有 Vite 默认忽略路径，不包含 worktree 目录）。

### 为什么之前的修复没有解决这个问题

| PR | 修复内容 | 层级 | 能否解决本根因 |
|----|---------|------|--------------|
| #531 (F20260701k5rp) | 异步清理 + 乐观更新 | React Query | 否 — React Query 层面的优化无法阻止 Vite dev server 的文件监听触发 |
| #551 (F20260702k5rp) | 移除 WebSocket onOpen 中的 invalidateQueries | React Query / WebSocket | 否 — 同上 |
| #579 (F20260706x53y) | 过滤冗余 activity_status_changed 事件 | React Query / WebSocket | 否 — 同上 |

三轮修复均在应用层（React Query cache 管理、WebSocket 事件处理），而本根因在 **Vite dev server 的文件监听层**。应用层修复无法阻止 Vite 检测到 tsconfig.json 变更后强制 full-reload。

### 触发场景

不仅 close issue 会触发此问题，任何涉及 worktree 目录创建/删除的操作都会触发：

1. **Close Issue** → `git worktree remove` 删除 worktree → tsconfig.json 删除 → full-reload
2. **Stage Transition** → Agent 创建新 worktree（`git worktree add`）→ 新 worktree 中的 tsconfig.json 出现 → full-reload
3. **Worktree 修改** → Worktree 内文件操作导致 tsconfig.json 变更 → full-reload

## [design-time] 设计方案

### 核心业务行为

1. **当 worktree 目录被创建或删除时**，Vite dev server 不应检测到这些目录中的文件变更，不触发 cache 清除和 full-reload ← UA-1, UA-2, UA-5
2. **当 `src/web/` 目录内的源代码文件变更时**，Vite 的 HMR 和文件监听行为不受影响 ← UA-2
3. **当根目录的 `tsconfig.json` 变更时**，Vite 仍应正常检测并触发 reload（这是必要的开发时行为）

### 方案：配置 Vite server.watch.ignored 排除 worktree 目录

在 `src/web/vite.config.ts` 的 `server.watch` 配置中增加 `ignored`，排除 `.snail/worktrees/` 和 `.claude/worktrees/` 目录。

**修改文件**：`src/web/vite.config.ts`

**设计要点**：

1. ~~`ignored` 配置必须同时包含 Vite 默认忽略路径（`.git/**`、`node_modules/**`）和 worktree 目录，因为显式设置 `ignored` 会覆盖默认值~~ **[已修正]** Vite 8.1.0 的 `resolveChokidarOptions` 始终包含默认忽略路径（`**/.git/**`、`**/node_modules/**`、`**/test-results/**`、cacheDir、outDirs），用户提供的 `ignored` 是**追加**到默认列表，不是覆盖。因此只需提供 worktree 目录的 glob 模式
2. 路径模式使用 `**` 前缀的 glob 模式（与 Vite 默认模式格式一致）：`**/.snail/worktrees/**` 和 `**/.claude/worktrees/**`
3. ~~需确认 Vite 8.x 的 `server.watch.ignored` 是否与 chokidar 的 `ignored` 选项语义一致~~ **[已确认]** Vite 8.1.0 的 `server.watch` 直接展开到 `resolveChokidarOptions()`，`ignored` 字段类型为 chokidar 的 `AnymatchMatcher`，语义完全一致。tsconfig 文件通过 `ensureWatchedFile()` 添加到同一个 chokidar watcher 实例，`ignored` 在 `watcher.add()` 和事件回调两个层级均生效

**约束**：
- 不得影响 `src/web/` 目录内的 HMR 行为
- 不得影响根 `tsconfig.json` 变更时的正常 reload
- 需覆盖 `.snail/worktrees/` 和 `.claude/worktrees/` 两个目录（系统使用两个 worktree 根目录）

### 不兼容更新

无。纯开发体验优化，不影响构建产物或运行时行为。

## 验收标准

- [ ] Close Issue 后，Vite dev server 不再输出 "changed tsconfig file detected" 日志
- [ ] Close Issue 后，页面不再发生 full-reload（Vite 级别）
- [ ] 修改 `src/web/` 下的源代码文件时，HMR 正常工作
- [ ] 修改根 `tsconfig.json` 时，Vite 仍正常触发 reload
- [ ] 创建/删除 worktree 时，Vite 不触发 full-reload

## 验证计划

1. **Close Issue 验证**：启动 Vite dev server，执行 close issue 操作，确认控制台无 "changed tsconfig file detected" 和 "page reload" 日志
2. **HMR 验证**：修改 `src/web/` 下的 `.tsx` 文件，确认 HMR 正常生效（非 full-reload）
3. **Root tsconfig 验证**：修改根 `tsconfig.json`，确认 Vite 正常触发 reload
4. **Worktree 创建验证**：执行 `git worktree add` 在 `.snail/worktrees/` 下创建新 worktree，确认 Vite 不触发 full-reload

## 决策记录

| 决策 | 正面 | 反面 | 结论 |
|------|------|------|------|
| 忽略 worktree 目录 vs 忽略特定文件 | 彻底排除所有 worktree 文件变更 | 可能遗漏 worktree 内需要监听的文件 | 选择忽略整个目录 — worktree 是独立工作副本，其文件变更不应影响主 dev server |
| glob 模式格式 | `**/.snail/worktrees/**` 匹配任意深度 | 精确路径可能更安全 | 选择 `**` 前缀模式 — 与 Vite 默认忽略路径（`**/.git/**`）格式一致，anymatch 正确匹配 |

### Vite 8.1.0 源码验证

**`resolveChokidarOptions`（node_modules/vite/dist/node/chunks/node.js:12833-12849）**：

```js
function resolveChokidarOptions(options, resolvedOutDirs, emptyOutDir, cacheDir) {
    const { ignored: ignoredList, ...otherOptions } = options ?? {};
    const ignored = [
        "**/.git/**",
        "**/node_modules/**",
        "**/test-results/**",
        escapePath(cacheDir) + "/**",
        ...arraify(ignoredList || [])    // 用户提供的 ignored 追加到默认列表
    ];
    // ...
}
```

**tsconfig 监听路径（node_modules/vite/dist/node/chunks/node.js:2219-2221, 2941, 3646）**：

tsconfig 文件通过 `ensureWatchedFile(watcher, tsconfigFile, config.root)` 添加到主 chokidar watcher。`ensureWatchedFile` 仅对 Vite root 之外的文件调用 `watcher.add()`。chokidar 的 `_isIgnored` 在 `add()` 时和事件回调时均检查 `ignored` 模式。

## 历史修复参考

| Feature | PR | 修复层级 | 状态 |
|---------|-----|---------|------|
| F20260701k5rp | #531 | React Query: 异步清理 + 乐观更新 | implemented |
| F20260702k5rp | #551 | WebSocket: 移除 onOpen invalidateQueries | implemented |
| F20260706x53y | #579 | React Query: 过滤冗余 activity_status_changed | implemented |

本 Feature 修复的是上述三轮修复未覆盖的 Vite dev server 层面根因，与上述修复互补。

## 关联 PR 处置

### PR #586（F20260706w8hp — Close Issue 导航可观测性埋点）

**处置**：本 PR 合入后，关闭 PR #586，并在 PR #586 中指向本 PR。

**理由**：PR #586 是诊断工具（nav-trace.ts sessionStorage ring buffer），非修复方案。其 Feature 文档背景明确记录"Vite HMR 文件监控…均被排除或缺乏理论依据"——当时只检查了 HMR（模块级热更新），未检查 Vite tsconfig watcher（触发 full reload 的独立机制）。根因已通过用户提供的 Vite 日志直接定位，诊断工具不再需要。PR #586 的 Feature 文档作为历史排查记录保留参考价值，但代码不合入。
