---
id: I2026050902
title: reboot 依赖同步
from_ids: []
tags: [workflow]
modules: [project_management]
---
# I2026050902 reboot 依赖同步

## 背景

`bin/snail-service reboot` 目前会把命令转换为 `restart` 并启用 `--update-main` 语义，实际流程包含 `git fetch origin main`、`git pull --ff-only origin main`、`npm run build` 和服务重启，但不会执行 `npm install`。

当远端更新引入新的依赖、调整锁文件或改变原生依赖安装产物时，本地 `node_modules` 会停留在旧状态。用户刚遇到的失败路径是 `reboot` 后服务无法正常启动，手动执行 `npm install` 再启动即可恢复，说明更新型重启缺少依赖同步步骤。

## 目标

1. 让 `bin/snail-service reboot` 在拉取最新 `main` 后同步依赖，再构建和重启。
2. 保持 `restart` 默认语义不变，避免普通本地重启无条件联网或改动依赖目录。
3. 保持 `restart --update-main` 与 `reboot` 一致，因为两者当前共享更新型重启语义。

## 非目标

1. 不改变服务控制脚本的 start、stop、status 行为。
2. 不引入依赖缓存、增量安装判断或包管理器切换。
3. 不改变 `npm run build`、`npm start` 或测试命令本身。

## 设计

`reboot` 的本质是“更新 main 后重启”，不是单纯进程重启。依赖同步必须发生在 `git pull --ff-only origin main` 之后、`npm run build` 之前，这样构建和服务启动都基于最新 `package.json`、`package-lock.json` 和安装产物。

普通 `restart` 不自动安装依赖，避免本地调试时每次重启都触发网络请求、安装脚本或 `node_modules` 变更。显式传入 `--update-main` 的 `restart` 与 `reboot` 共享同一路径，也应同步依赖。

## 生效路径

1. `bin/snail-service` 在 `UPDATE_MAIN=1` 时执行 `npm install`。
2. `dist/bin/snail-service` 由构建产物生成，随 `npm run build` 更新。

## 改动范围

1. `bin/snail-service`
2. `tests/scripts/service-entrypoint-test.ts`
3. `docs/features/20260509/I2026050902-reboot-dependency-sync.md`

## 验证

1. 运行 `npm run build`，确认脚本和 TypeScript 构建通过。
2. 检查构建后的 `dist/bin/snail-service`，确认发布脚本包含同样的 `npm install` 流程。
3. 运行 `npm run test`，覆盖既有成功路径。
4. 手动检查 `bin/snail-service` 的命令分支：`reboot` 和 `restart --update-main` 触发依赖同步，普通 `restart` 不触发依赖同步。
5. `tests/scripts/service-entrypoint-test.ts` 增加 `npm install` 断言，防止更新型重启再次缺失依赖同步。

## 风险与决策记录

`npm install` 会比单纯 `git pull` 和构建更慢，并可能执行依赖安装脚本。但 `reboot` 已经是更新远端 `main` 的操作，目标是把工作区推进到可启动状态；相比让用户误以为代码损坏，更新型重启中同步依赖是更符合语义的默认行为。

## 范围变更记录

1. 实现自检时发现已有 `service-entrypoint-test` 覆盖 `--update-main` 入口，因此补充依赖同步断言，把用户遇到的缺失依赖场景纳入回归测试。
