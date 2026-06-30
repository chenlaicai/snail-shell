---
id: F20260630eomi
title: vite-watch-scope
from_ids: []
tags: [vite, dev-server, performance, worktree]
modules: [web]
doc_kind: spec
change_type: bugfix
---

# F20260630eomi [web][BugFix] 限制 Vite 文件监听范围至 src/web/，修复 worktree 导致 CPU 100%

## 背景

Vite dev server（localhost:5173）在 agent 活跃期间 CPU 飙升至 100%、内存占用 2.4GB，前端完全无法响应（页面加载十几秒超时）。

**根因**：Vite 的 chokidar 文件监听器默认监听项目根目录下所有文件。`.snail/worktrees/` 下有 38 个 worktree、50,489 个源文件。当 agent 在 worktree 中修改文件时，监听器收到海量 macOS FSEvents 事件，陷入 `fse_dispatch_event` → `SetPrototypeForEach` → `StringIndexOf` 的密集字符串匹配循环，导致 CPU 饱和。

## 目标

1. Vite dev server 的文件监听范围限定为 `src/web/`（前端源码目录）
2. worktree 中的文件变更不影响 Vite 性能
3. 前端 HMR 热更新功能不受影响

## 非目标

- 不修改 worktree 目录结构
- 不修改 `.gitignore`

## 方案

在 `vite.config.ts` 的 `server` 配置中增加 `watch.cwd`：

```ts
server: {
  watch: {
    cwd: path.resolve(__dirname),  // = src/web/
  },
}
```

`server.watch` 选项透传给 chokidar，`cwd` 将监听路径的基准目录限定为 `src/web/`，与 Vite `root` 一致。

## 验证

| 检查项 | 结果 |
|--------|------|
| `tsc --noEmit` | 通过 |
| Vite build | 通过 |
| HMR 不受影响 | 源文件在 `src/web/` 内，监听正常 |
| proxy 不受影响 | 网络层独立于文件监听 |
| path aliases 不受影响 | 基于 `__dirname` 独立解析 |
