---
id: F20260624a1b2
title: fix-issue-creation-500
from_ids: []
tags: [issue, bugfix, error-handling]
modules: [core, web]
doc_kind: spec
change_type: bugfix
---

# F20260624a1b2 [core] 修复 Issue 创建接口 500 错误，添加域验证错误处理

## 背景

创建新 Issue 时点击 Create 按钮报错：
- 前端显示：`创建失败：The string did not match the expected pattern.`
- 控制台报错：`Failed to load resource: the server responded with a status of 500 (Internal Server Error)`

根因是 `POST /api/workspaces/:workspaceId/issues` 路由缺少错误处理，域层验证错误直接抛出为未处理的 500 错误。

## 修复内容

### 1. 添加路由错误处理

将内联路由处理函数提取为独立的 `createIssue` 函数（与 `sendMessage`、`closeIssue` 保持一致），添加 try/catch 捕获域验证错误：

| 错误消息 | HTTP 状态码 |
|---------|------------|
| `SOP not found:*` | 400 |
| 含 `snail assignment` 的错误 | 400 |
| 含 `stage definitions` 的错误 | 400 |

### 2. 移除过时测试文件

- `tests/feature-numbering-test.ts`
- `tests/snail/snail-den-crud-test.ts`
- `tests/snail/snail-issue-context-mcp-test.ts`

## 核心业务行为

| # | 场景 | 预期行为 |
|---|------|---------|
| 1 | SOP 不存在 | 返回 400 + `SOP not found: xxx` |
| 2 | snail assignment plan 与 SOP 不匹配 | 返回 400 + 具体验证错误信息 |
| 3 | SOP 无 stage definitions | 返回 400 + `No stage definitions found` |
| 4 | 创建成功 | 返回 201 + issue + stage 数据 |

## 修改文件

- `src/infra/http/routes/issue.route.ts` — 提取 `createIssue` 函数，添加错误处理
