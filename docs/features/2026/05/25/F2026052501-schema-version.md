---
id: F2026052501
title: 数据库版本
from_ids: []
tags: [schema, refactor]
modules: [project_management]
---
# F2026052501 数据库版本

## 背景

当前系统启动时通过 `initSchema()` 执行幂等建表，但没有输出版本信息。当发生表结构变更（人工执行）后，无法从日志直接判断当前连接的数据库实例是否适配当前代码。需要在启动日志中打印 schema 的版本标识。

## 目标

- 系统启动时在日志中打印当前 schema（`src/persistence/schema.ts`）的版本号
- 版本号自动追踪，不需要人工维护
- 启动脚本（`bin/snail-service start`）运行时，启动日志对终端直接可见，不需要用户手动查看日志文件

## 非目标

- 不实现数据库自动迁移或版本比对
- 不在数据库中写版本表
- 不改变现有 initSchema 行为
- 不改变 Logger 的写入边界（保持仅文件写入）

## 设计

版本号来源：`src/persistence/schema.ts` 文件在 git 仓库中最近一次 commit 的 hash 和日期。

具体方案：在 `src/persistence/schema.ts` 中新增 `getSchemaVersion()` 函数，通过 `git log -1 --format="%h %ad" --date=short -- src/persistence/schema.ts` 获取版本信息。格式为 `<short-hash> <YYYY-MM-DD>`（如 `3824365 2026-05-24`）。

如果运行时 git 不可用（如生产部署不含 `.git`），fallback 返回 `"UNKNOWN"`。

在 `main.ts` 的 `ConversationStore` 实例化后调用 `getSchemaVersion()` 并写入启动日志。

选择运行时 git 而非编译时注入的理由：
1. Snail Shell 自身开发环境始终有 git
2. 改动最小，不需要修改构建流程
3. try-catch fallback 保证生产部署不会崩溃

## 生效路径

- 代码：`src/persistence/schema.ts`（新增函数）、`src/main.ts`（调用并打印）、`src/bin/server-control.ts`（启动日志 tail）、`src/logger/index.ts`（无变更）

## 启动日志可见性设计

### 问题

`bin/snail-service start` 将 main 进程以 detached 模式 spawn，原有 stdio 全部重定向到日志文件。用户运行启动脚本后终端只看到 "started in background" 和 "log file: ..."，启动阶段的关键信息（schema 版本、agent 注册状态、seed 结果等）必须手动查看日志文件，增加操作负担。

### 方案选择

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| Logger 全局 stdout 双写 | 实现简单，一行改动 | 污染所有 Logger 调用场景（`npm run test`、后台运行等）；后台服务 stdio inherit 会在 start 返回后继续写终端 | 拒绝 |
| server-control 启动窗口 tail | 边界清晰——仅在启动等待窗口内向终端输出；不影响 Logger 语义和测试输出 | 需要额外的文件读取和位置追踪逻辑 | **采用** |

### 实现

`server-control.ts` 新增 `flushLogTail()` 函数，从日志文件读取增量内容并通过 `process.stdout.write` 输出到终端。在 `startServer()` 中：

1. spawn 后记录日志文件当前大小作为 `lastPos`（跳过控制日志自身）
2. `waitForStart()` 每轮轮询间隔调用 `flushLogTail()` 刷新新增日志行到终端
3. 成功或失败（`try/finally`）都执行最终 `flushLogTail()`，保证用户看到完整启动日志
4. `startServer()` 返回后 tail 自然停止——后台服务的后续日志不再输出到终端

`server-control.ts` 添加入口守卫 `process.argv[1]?.includes("/src/bin/server-control")`，避免被测试 import 时触发 `main()`。

## 改动范围

| 文件 | 改动 |
|------|------|
| `src/persistence/schema.ts` | 新增 `getSchemaVersion()` 导出函数 |
| `src/main.ts` | 启动日志中增加 `schemaVersion` 字段 |
| `src/bin/server-control.ts` | 新增 `flushLogTail()` 导出函数；`waitForStart` 接受 `onTick` 回调；`startServer` 启动窗口内 tail 日志到 stdout；入口守卫 |
| `tests/persistence/schema-version-test.ts` | `getSchemaVersion()` 行为级测试：正常格式、无 git fallback、不抛错 |
| `tests/bin/server-control-test.ts` | `flushLogTail()` 行为级测试：增量输出、无重复、文件不存在不抛错、lastPos 边界、失败路径 finally 保证 flush |

## 验证

- 启动服务，检查日志中包含 `schemaVersion: "<hash> <date>"` 格式的版本信息
- 在有 git 环境下确认版本号与实际 `git log` 结果一致
- 模拟无 git 环境，确认 fallback 为 `"UNKNOWN"` 且不崩溃
- `bin/snail-service start` 运行时终端可见完整启动日志（schema 版本、agent 状态、seed 结果等）
- 启动完成后终端不再有后台日志输出（tail 边界正确）
- 子进程提前退出或超时时，错误前的日志仍对终端可见（失败路径 flush）
- `npm run test` 38 个测试全部通过，测试输出不受 Logger 污染

## 风险与决策记录

- 版本号依赖 git，非 git 部署环境显示 UNKNOWN。对于 Snail Shell 自身迭代场景可接受。
- 如果未来需要更精确的版本追踪，可升级为编译时注入方案。

## 范围变更记录

- **Review #1**：补 `getSchemaVersion()` 行为级测试（`tests/persistence/schema-version-test.ts`），覆盖正常格式、无 git fallback、不抛错、GIT_DIR 环境变量干扰
- **Review #2**：`server-control` 启动窗口日志 tail（`flushLogTail`），替代 Logger 全局 stdout 方案。仅 `waitForStart` 窗口内向终端输出，成功/失败路径都保证最终 flush
- **Review #3**：补 `flushLogTail` 行为级测试（`tests/bin/server-control-test.ts`），覆盖失败路径 finally 保证 flush
