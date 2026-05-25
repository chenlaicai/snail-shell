# F2026052501 数据库版本

## 背景

当前系统启动时通过 `initSchema()` 执行幂等建表，但没有输出版本信息。当发生表结构变更（人工执行）后，无法从日志直接判断当前连接的数据库实例是否适配当前代码。需要在启动日志中打印 schema 的版本标识。

## 目标

- 系统启动时在日志中打印当前 schema（`src/persistence/schema.ts`）的版本号
- 版本号自动追踪，不需要人工维护

## 非目标

- 不实现数据库自动迁移或版本比对
- 不在数据库中写版本表
- 不改变现有 initSchema 行为

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

- 代码：`src/persistence/schema.ts`（新增函数）、`src/main.ts`（调用并打印）

## 改动范围

| 文件 | 改动 |
|------|------|
| `src/persistence/schema.ts` | 新增 `getSchemaVersion()` 导出函数 |
| `src/main.ts` | 启动日志中增加 `schemaVersion` 字段 |

## 验证

- 启动服务，检查日志中包含 `schemaVersion: "<hash> <date>"` 格式的版本信息
- 在有 git 环境下确认版本号与实际 `git log` 结果一致
- 模拟无 git 环境，确认 fallback 为 `"UNKNOWN"` 且不崩溃

## 风险与决策记录

- 版本号依赖 git，非 git 部署环境显示 UNKNOWN。对于 Snail Shell 自身迭代场景可接受。
- 如果未来需要更精确的版本追踪，可升级为编译时注入方案。

## 范围变更记录

（暂无）
