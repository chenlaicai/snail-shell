---
id: F20260702xkt3
title: close-issue-custom-dialog
from_ids: [F20260624g4rw]
tags: [issue, close, ui, dialog]
modules: [web]
doc_kind: spec
change_type: feature
---

# F20260702xkt3 [web] Close Issue 自定义确认弹窗

## 背景

F20260624g4rw 实现了 Close Issue 按钮和确认流程，但使用了浏览器原生 `window.confirm()` 弹窗。该弹窗样式由操作系统决定，与应用整体 UI 风格不一致，用户反馈"很难看"。

系统已有 `Dialog` 组件（`src/web/components/ui/dialog.tsx`），基于 HTML `<dialog>` 元素构建，支持 modal 模式、点击遮罩关闭、键盘 Escape 关闭、`data-autofocus` 初始焦点控制。该组件当前零引用（现有对话框如 `NewIssueDialog`、`SopFormDialog` 均使用 `div`-based modal 自建），但质量合格、语义正确。Close Issue 是最简单的确认场景，适合作为 `Dialog` 组件的首个采用者。

## 目标

将 Close Issue 的确认交互从 `window.confirm()` 替换为基于 `Dialog` 组件的自定义弹窗。`Dialog` 组件当前零引用，本次作为首个采用者验证其在实际场景中的适用性。

## 非目标

- 不修改 Close Issue 的后端链路（`useCloseIssue` mutation 保持不变）
- 不修改 StageActionBar 的按钮布局或可见性逻辑
- 不修改 Close 成功后的状态切换逻辑（`closed_at` → 只读模式）
- 不在弹窗中增加额外功能（如关闭原因输入）

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | When 用户点击 "Close Issue" 按钮 | 弹出自定义确认弹窗，标题为 "Close Issue"，内容为 "确认关闭此 Issue？关闭后对话保留为只读"，包含 "Cancel" 和 "Close Issue" 两个按钮 | 手动测试 |
| B2 | When 用户点击弹窗的 "Close Issue" 确认按钮 | 按钮进入 loading 状态（文本变为 "Closing..."），调用 `useCloseIssue`；`onSuccess` 回调中显式调用 `onClose()` 关闭弹窗，界面切换为只读 | 手动测试 |
| B3 | When 用户点击弹窗的 "Cancel" 按钮 | 弹窗关闭，不执行任何操作 | 手动测试 |
| B4 | When 用户点击弹窗外的遮罩区域 | 弹窗关闭，不执行任何操作 | 手动测试 |
| B5 | When 用户按 Escape 键 | 弹窗关闭，不执行任何操作 | 手动测试 |
| B6 | When 关闭操作失败 | 弹窗保持打开，按钮恢复可点击状态，通过 toast 显示错误信息 | 手动测试 |

## 设计

### 1. 新建 `CloseIssueDialog` 组件

创建 `src/web/components/CloseIssueDialog.tsx`，复用现有 `Dialog` 组件：

```
CloseIssueDialog
├── Dialog（ui/dialog.tsx 提供的容器）
│   ├── 标题: "Close Issue"
│   └── 内容区:
│       ├── 提示文本: "确认关闭此 Issue？关闭后对话保留为只读"
│       └── 操作栏:
│           ├── Cancel 按钮（text-text-secondary）
│           └── Close Issue 按钮（bg-status-red，表示破坏性操作）
```

- 确认按钮使用红色（`bg-status-red`）而非默认蓝色，明确表示破坏性操作
- 确认按钮在 loading 状态下禁用，文本变为 "Closing..."
- Dialog 的 `onClose` 绑定到取消逻辑（点击遮罩 / Escape 均触发取消）
- 初始焦点在 Cancel 按钮（安全默认），通过 `data-autofocus` 属性控制

### 2. 修改 `StageActionBar.tsx`

- 移除 `handleClose` 中的 `window.confirm()` 调用
- 新增 `showCloseDialog` state 控制弹窗显隐
- 点击 "Close Issue" 按钮 → 设置 `showCloseDialog = true`
- 渲染 `<CloseIssueDialog>` 组件，传入 `open`、`onClose`、`onConfirm` 回调
- `onConfirm` 内部执行现有的 `closeIssue.mutate` 逻辑，成功后关闭弹窗

### 3. 样式规范

| 元素 | 样式 | 参考来源 |
|------|------|----------|
| 弹窗容器 | 复用 `Dialog` 组件默认样式 | `ui/dialog.tsx` |
| 确认按钮 | `bg-status-red hover:bg-status-red/80 text-white` | 破坏性操作惯例 |
| 取消按钮 | `text-text-secondary hover:text-text-primary` | `NewIssueDialog` Cancel 按钮 |
| 提示文本 | `text-sm text-text-secondary` | 对话框正文惯例 |

### 4. 决策记录

| 决策 | 选择 | 正面理由 | 反面理由/风险 |
|------|------|----------|---------------|
| 确认按钮颜色 | 红色（`bg-status-red`） | Close 是破坏性操作，应与主操作（蓝色 Advance）视觉区分；`bg-status-red` 已在 9 个文件中使用 | 无显著风险 |
| 是否增加关闭原因输入 | 否 | 用户未要求；后端 `updateCloseSummary` 是异步资源清理后的回调，非用户输入 | 若未来需要关闭原因，需再次修改 |
| 复用 Dialog vs 自建 div-modal | 复用 `Dialog` | `Dialog` 组件质量合格、语义正确（基于 `<dialog>` 元素），支持无障碍、焦点管理、Escape 关闭；Close Issue 是最简单的确认场景，适合作为首个采用者 | `Dialog` 当前零引用，首次采用需验证兼容性；现有对话框均使用 div-modal 模式，存在风格不一致风险 |

## 生效路径

- `src/web/components/CloseIssueDialog.tsx` — 新建，基于 `Dialog` 组件的确认弹窗
- `src/web/components/StageActionBar.tsx` — 移除 `window.confirm`，引入 `CloseIssueDialog`

## 改动范围

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/web/components/CloseIssueDialog.tsx` | 新增 | Close Issue 自定义确认弹窗组件 |
| `src/web/components/StageActionBar.tsx` | 修改 | 移除 `window.confirm`，改用 `CloseIssueDialog` |

## 验证

- [ ] 点击 "Close Issue" 按钮弹出自定义弹窗（非系统原生 confirm）
- [ ] 弹窗标题为 "Close Issue"，内容包含确认提示
- [ ] 点击 "Close Issue" 确认按钮后，Issue 关闭，弹窗消失，界面切换为只读
- [ ] 点击 "Cancel" 或遮罩区域或按 Escape，弹窗关闭，无操作
- [ ] 关闭操作失败时弹窗保持打开，显示错误 toast
- [ ] 确认按钮在 loading 状态下禁用并显示 "Closing..."
- [ ] TypeScript 编译通过
- [ ] ESLint 通过
- [ ] Vite 构建通过
