---
id: F2026062301
title: fix-snail-form-tdz
from_ids: [F2026062207]
tags: [bugfix, web]
modules: [web]
doc_kind: spec
---

# F2026062301 [web] 修复 SnailFormDialog 空白页 bug

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

PR #418 (F2026062207) 实现了 Snail Den CRUD 功能，但用户发现点击 "Create Snail" 或 "Edit" 按钮时页面变成空白。

根因：`SnailFormDialog.tsx` 第 50 行引用了 `isCreate` 变量，但该变量直到第 67 行才通过 `const` 声明。JavaScript 的 `const` 声明存在 Temporal Dead Zone (TDZ)，在声明行之前访问会抛出 `ReferenceError`，被 React ErrorBoundary 捕获后渲染为空白页。

## 目标

修复 `SnailFormDialog` 组件中 `isCreate` 变量的 TDZ 错误，使 Create/Edit 对话框正常渲染。

## 非目标

- 不涉及 Snail Den CRUD 功能的其他改动
- 不涉及后端 API 变更
- 不涉及路由或数据流变更

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当用户点击 "Create Snail" 按钮时 | 系统应弹出 Create Snail 表单对话框，不出现空白页 | |
| B2 | 当用户点击某个 Snail 的 "Edit" 按钮时 | 系统应弹出 Edit Snail 表单对话框，预填当前数据，不出现空白页 | |

## 设计

### 修复方案

将 `const isCreate = mode === "create";` 从第 67 行移动到第 49 行（`if (!open) return null;` 之后），确保 `isCreate` 在第 50 行 `keyInvalid` 计算之前已声明并初始化。

变更前后对比：

```typescript
// 修复前（有 bug）
if (!open) return null;
const keyInvalid = isCreate && ...;  // line 50: TDZ error!
// ... handleSubmit ...
const isCreate = mode === "create";  // line 67: 太晚了

// 修复后
if (!open) return null;
const isCreate = mode === "create";  // 移到这里
const keyInvalid = isCreate && ...;  // 安全访问
// ... handleSubmit ...
```

### 设计取舍

这是纯 bugfix，无设计取舍。修复方式唯一且直接。

## 生效路径

代码修复，通过 `src/web/components/SnailFormDialog.tsx` 生效。

## 设计约束摘要

- **边界**：仅修改变量声明顺序，不改变任何业务逻辑
- **语义不变量**：`isCreate` 的语义不变，仍为 `mode === "create"` 的布尔值

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/web/components/SnailFormDialog.tsx` | 修改 | 将 `isCreate` 声明移到 `keyInvalid` 之前 |

## 验证

### 通用

- [ ] 点击 "Create Snail" 按钮，对话框正常弹出，不出现空白页
- [ ] 点击 "Edit" 按钮，对话框正常弹出并预填数据，不出现空白页
- [ ] `npm run build` 无报错
- [ ] `npm run lint` 无新增报错

## 关联

- **前置**: F2026062207（Snail Den CRUD 支持，本次 bugfix 修复其引入的 bug）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | 修复方式 | 只需移动变量声明顺序，改动最小，风险最低 | 无 | 移动 `isCreate` 声明到使用之前 | 纯 bugfix，修复方式唯一 | 架构师-1 | 2026-06-23 |
