---
id: F2026061801
title: consolidate-dependency-updates
from_ids: []
tags:
  - deps
  - dependency-update
  - zod
  - breaking-change
  - incompatible
modules:
  - deps
doc_kind: spec
---

# F2026061801 [deps] 合并依赖更新

## 背景

项目中存在多个 dependabot 提交的依赖更新 PR，每个 PR 更新单个依赖包。这种方式导致：
1. PR 数量过多，管理复杂
2. 依赖更新分散，难以统一测试
3. 可能存在依赖冲突风险

### 原有 PR 列表

| PR# | 依赖 | 版本变更 |
|-----|------|----------|
| #387 | dompurify | 3.4.5 → 3.4.10 |
| #386 | form-data | 4.0.5 → 4.0.6 |
| #385 | esbuild | 0.28.0 → 0.28.1 |
| #384 | marked | 18.0.4 → 18.0.5 |
| #383 | typescript-eslint | 8.60.0 → 8.61.1 |
| #382 | @types/node | 25.9.1 → 25.9.3 |
| #381 | @types/react | 19.2.16 → 19.2.17 |
| #380 | zod | 3.25.76 → 4.4.3 |
| #379 | react-router-dom | 7.16.0 → 7.18.0 |
| #353 | tsx | 4.22.3 → 4.22.4 |
| #351 | @larksuiteoapi/node-sdk | 1.66.0 → 1.67.0 |
| #350 | eslint | 10.4.0 → 10.5.0 |

## 目标

1. 将所有 dependabot PR 合并为一个统一的依赖升级 PR
2. 确保所有依赖更新兼容并经过测试
3. 修复因依赖更新导致的 breaking change

## 非目标

1. 不引入新功能
2. 不修改业务逻辑
3. 不改变项目架构

## 设计

### 更新的依赖

#### 主要依赖更新

| 依赖 | 旧版本 | 新版本 | 变更类型 |
|------|--------|--------|----------|
| marked | ^18.0.3 | ^18.0.5 | patch |
| zod | ^3.25.76 | ^4.4.3 | **major** |
| react-router-dom | ^7.16.0 | ^7.18.0 | minor |
| @larksuiteoapi/node-sdk | ^1.62.1 | ^1.67.0 | minor |

#### 开发依赖更新

| 依赖 | 旧版本 | 新版本 | 变更类型 |
|------|--------|--------|----------|
| @types/node | ^25.6.0 | ^25.9.3 | patch |
| @types/react | ^19.2.16 | ^19.2.17 | patch |
| eslint | ^10.3.0 | ^10.5.0 | minor |
| tsx | ^4.21.0 | ^4.22.4 | patch |
| typescript-eslint | ^8.59.2 | ^8.61.1 | minor |

### Breaking Change 修复

#### Zod 4.x 迁移

Zod 4.x 引入了破坏性变更，`z.record()` API 发生变化：

**修复前（Zod 3.x）**：
```typescript
const snailAssignmentPlanSchema = z.record(z.record(z.string()));
```

**修复后（Zod 4.x）**：
```typescript
const snailAssignmentPlanSchema = z.record(z.string(), z.record(z.string(), z.string()));
```

**改动文件**：
- `src/infra/http/routes/issue.route.ts:20`

### 改动文件

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `package.json` | 修改 | 更新依赖版本号 |
| `package-lock.json` | 修改 | 更新锁定的依赖版本 |
| `src/infra/http/routes/issue.route.ts` | 修改 | 修复 zod 4.x breaking change |

## 验证

- [x] ESLint 通过（`npm run lint`）
- [x] TypeScript 编译通过（`npx tsc`）
- [x] 构建成功（`npm run build`）
- [x] Web 构建成功（`npm run build:web`）

## 关联

- **替代**: PR #387, #386, #385, #384, #383, #382, #381, #380, #379, #353, #351, #350
- **合并为**: PR #396

## 变更记录

### 2026-06-18: 初始版本

- 合并 12 个 dependabot PR 为统一的依赖升级 PR
- 更新 9 个依赖包版本
- 修复 zod 4.x 的 `z.record()` API 变更
- 创建特性文档
