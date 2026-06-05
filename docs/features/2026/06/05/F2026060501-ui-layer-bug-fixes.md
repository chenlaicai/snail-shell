---
id: F2026060501
title: UI 层代码审查修复
from_ids: [F2026060409]
tags: [ui, react, typescript, bugfix]
modules: [web]
---

# F2026060501 UI 层代码审查修复

## 背景

前端从原生 JS 重构为 React + TypeScript 后（F2026060409），遗留了若干类型错误和测试与实现不一致的问题。本次修复针对这些问题进行统一处理。

## 问题清单

### 1. conversationStore updateMessage id 类型不匹配

**文件:** `src/web/stores/conversationStore.ts`

**问题:** `updateMessage` 参数类型为 `id: string`，但 `Message` 接口的 `id` 是 `number`，调用方 `useWebSocket.ts` 也传 `number`。类型不匹配导致潜在的运行时错误。

**修复:** 参数类型改为 `id: number`。

### 2. ContextPanel rd 类型不安全

**文件:** `src/web/components/ContextPanel.tsx`

**问题:** `roleDefs.forEach((rd: unknown) => ...)` 中 `rd` 被标注为 `unknown`，但代码直接访问 `rd.name`、`rd.is_primary` 等属性，类型不安全。

**修复:** 创建 `RoleDefinition` 接口替换 `unknown`。同时 `Participant.roleDef` 允许 `null`（因 `convRoles` 分支设置 `roleDef: null`）。

### 3. ConversationLayout 缺少 Transition 类型导入

**文件:** `src/web/pages/ConversationLayout.tsx`

**问题:** 代码引用 `Transition[]` 类型但未导入或定义。

**修复:** 从 `StageActions.tsx` 导出 `Transition` 接口并在 `ConversationLayout.tsx` 中导入。

### 4. Conversation 接口缺少 participating_roles

**文件:** `src/web/stores/conversationStore.ts`

**问题:** `ContextPanel.tsx` 和 `ConversationView.tsx` 访问 `currentConversation?.participating_roles`，但 `Conversation` 接口未定义该属性。

**修复:** 在 `Conversation` 接口中补充 `participating_roles?: string[]`。

### 5. 测试与实现不一致

**问题:** 多个测试文件的期望行为与当前实现不符：

| 测试文件 | 问题 |
|----------|------|
| `AppShell.test.tsx` | 期望首页 "/" 高亮 Workspaces 并显示工作区树，但首页是独立欢迎页 |
| `HomePage.test.tsx` | 期望加载状态、工作区列表等，但当前实现是简化版欢迎页 |
| `ConversationView.test.tsx` | message ID 使用 string，但实现期望 number |

**修复:** 修正测试以匹配当前实现。

### 6. mcp-endpoint-test 污染 config 目录

**文件:** `tests/agent/mcp-endpoint-test.ts`

**问题:** 测试使用 `new ConversationStore(":memory:")` 未传 `configDir`，导致 `seedSopToCache` 写入真实 `config/sop/` 目录。

**修复:** 使用临时目录 `data/test-config-mcp-endpoint`，参照其他测试的模式。

## 文件变更

| 操作 | 文件 | 说明 |
|------|------|------|
| 改动 | `src/web/stores/conversationStore.ts` | updateMessage id 类型 + Conversation 接口补充字段 |
| 改动 | `src/web/components/ContextPanel.tsx` | RoleDefinition 接口 + Participant.roleDef 允许 null |
| 改动 | `src/web/components/StageActions.tsx` | 导出 Transition 接口 |
| 改动 | `src/web/pages/ConversationLayout.tsx` | 导入 Transition 类型 |
| 改动 | `src/web/tests/AppShell.test.tsx` | 修正首页测试路径 |
| 改动 | `src/web/tests/HomePage.test.tsx` | 适配当前欢迎页实现 |
| 改动 | `src/web/tests/ConversationView.test.tsx` | message ID string → number |
| 改动 | `tests/agent/mcp-endpoint-test.ts` | 使用临时 configDir |

## 验证

- 58 前端测试全部通过
- 40 后端测试全部通过
- TypeScript 编译无错误
- ESLint 无警告
