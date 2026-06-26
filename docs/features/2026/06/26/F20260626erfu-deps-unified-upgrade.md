---
id: F20260626erfu
title: deps-unified-upgrade
from_ids: []
tags: [deps, dependabot, upgrade]
modules: [deps]
doc_kind: spec
---

# F20260626erfu Dependabot 依赖统一升级

## 概述

将 dependabot 提出的 30+ 个依赖升级 PR 合并为一个统一升级 PR，覆盖直接依赖、间接依赖和 CI action 升级。

## 背景

当前仓库有 31 个 dependabot 分支（对应 11 个 open PR），其中多个包存在重复升级分支（旧版本已被新版本覆盖）。逐一合入会产生大量 PR 噪音和重复 CI 开销。

## [design-time]

### 变更类型

`dependency-upgrade` / `config-sync`

### 升级清单

#### 直接依赖（package.json）

| 包名 | 当前版本 | 目标版本 | 类型 |
|------|---------|---------|------|
| `@hono/node-server` | ^2.0.4 | ^2.0.6 | patch |
| `hono` | ^4.12.25 | ^4.12.27 | patch |
| `lucide-react` | ^1.17.0 | ^1.21.0 | minor |
| `@tanstack/react-query` | ^5.101.0 | ^5.101.1 | patch |
| `@tanstack/react-query-devtools` | ^5.101.0 | ^5.101.1 | patch（随 react-query 联动） |
| `tailwindcss` | ^4.3.0 | ^4.3.1 | patch |
| `@tailwindcss/postcss` | ^4.3.0 | ^4.3.1 | patch |
| `vite` | ^8.0.16 | ^8.1.0 | minor |
| `@vitejs/plugin-react` | ^6.0.2 | ^6.0.3 | patch |
| `@types/pino` | ^7.0.4 | ^7.0.5 | patch |

#### 间接依赖（package-lock.json）

| 包名 | 当前版本 | 目标版本 | 说明 |
|------|---------|---------|------|
| `esbuild` | 0.28.0 | 0.28.1 | vite 的构建依赖 |
| `dompurify` | 3.4.5 | 3.4.11 | mermaid 的依赖 |
| `form-data` | 4.0.5 | 4.0.6 | 间接依赖 |

#### CI Action

| 文件 | 当前版本 | 目标版本 |
|------|---------|---------|
| `.github/workflows/ci.yml` actions/checkout | v6 | v7 |

### 已在 main 更新的包（跳过）

以下 dependabot 分支已被 main 覆盖，无需处理：

- `zod` 3→4（已在 main 完成）
- `marked` → 18.0.5（已在 main）
- `react-router-dom` → 7.18.0（已在 main）
- `eslint` → 10.5.0（已在 main）
- `tsx` → 4.22.4（已在 main）
- `typescript-eslint` → 8.61.1（已在 main）
- `@types/node` → 25.9.3（已在 main）
- `@types/react` → 19.2.17（已在 main）
- `@larksuiteoapi/node-sdk` → 1.67.0（已在 main）
- `qs` → 6.15.2（非直接依赖，lockfile 已达目标版本）

### 实现方案

**策略：直接在 main 最新版本上手动修改 package.json + 重新生成 lockfile**

不 cherry-pick dependabot 分支（它们都落后于 main，冲突概率高），而是：

1. 基于最新 `origin/main` 创建分支
2. 修改 `package.json` 中 10 个直接依赖的版本号
3. 修改 `.github/workflows/ci.yml` 中 actions/checkout 版本
4. 运行 `npm install` 重新生成 lockfile（同时更新间接依赖）
5. 验证构建和测试通过

### 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| lucide-react minor 升级引入 breaking icon 命名变更 | 低 | lucide-react 遵循 semver，minor 不应有 breaking change；构建验证可捕获 |
| vite minor 升级（8.0→8.1）可能影响构建配置 | 低 | patch 级别的 minor，构建验证可捕获 |
| lockfile 重新生成可能拉入未预期的间接依赖变更 | 中 | diff review lockfile 变更范围，确保仅预期包被更新 |

### 核心业务行为

- 当执行 `npm install` 时，lockfile 应反映所有指定的目标版本
- 当 CI 运行时，actions/checkout 应使用 v7
- 当构建项目时，所有升级后的依赖应正常工作，无编译或运行时错误

### 依赖升级后的验证

- `npm run build` 通过
- `npm run lint` 通过（如适用）
- `npm run typecheck` 通过（如适用）
- CI workflow 语法正确

### 完成后处理

统一 PR 合入后，关闭所有对应的 dependabot open PR（11 个），并删除已合入的 dependabot 远程分支（31 个）。
