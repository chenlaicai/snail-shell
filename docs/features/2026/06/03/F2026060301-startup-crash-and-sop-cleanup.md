---
id: F2026060301
title: startup-crash-and-sop-cleanup
tags: [bug, startup, closure, sop, role-expansion]
modules: [web, persistence, workspace-workflow]
doc_kind: spec
---

# F2026060301 [web/persistence] 启动崩溃修复 + SOP ID 格式清理 + 角色展开 is_primary 修复

## 背景

启动程序进入界面报三个连续错误，均无法进入正常工作状态：

1. `stageTitle is not a function` — `workspace-context.js` 闭包捕获了 `null` 参数
2. `composer.clearReplyTarget` — `conversation-controller.js` 同样的闭包捕获问题
3. `Role not found: 设计者-1` — SOP ID 格式不匹配导致角色注册表缺失

### 根因分析

**闭包捕获问题**（影响 `workspace-context.js` 和 `conversation-controller.js`）：

构造函数接收延迟注入的依赖（如 `stageTitle`、`composer`），参数初始值为 `null`。闭包捕获的是参数局部变量，后续 `obj.prop = value` 只修改返回对象的属性，不影响闭包内已捕获的变量。

```
createWorkspaceContext({ stageTitle: null })
  → 闭包内 stageTitle 永远是 null
  → app.js: workspaceContext.stageTitle = ... 只改对象属性
  → 渲染时调用 stageTitle() → null is not a function
```

**SOP ID 格式问题**：

`loadSopDir` 给 platform SOP 加了 `sop-` 前缀（如 `sop-code-delivery`），但 `workspaces.json` 中 `sop_id` 用裸 key（如 `code-delivery`）。缓存查找不匹配，`listAllRoleDefinitions` 找不到 SOP，角色注册表缺失 "设计者-1"。

**is_primary 展开问题**：

SOP YAML 中 `is_primary: true` 定义在 role 级别，`count: 2` 展开时所有实例都继承了 `is_primary: 1`，导致 "设计者-1" 和 "设计者-2" 都是主响应，默认路由无法确定。

## 目标

1. 修复启动崩溃，程序能正常进入工作状态
2. SOP ID 格式统一，去掉多余前缀
3. 角色展开时只有首个实例标记为 primary
4. config 非 example 文件加入 gitignore

## 非目标

- 不重构延迟注入的架构模式（后续可考虑）
- 不修改其他控制器的 `showNotice` 闭包问题（非初始化时触发）

## 设计

### 修复 1：闭包捕获 → 读取 ctx 属性

将闭包内捕获的局部变量改为读取返回对象（`ctx`）上的可变属性。外部通过 `obj.prop = value` 赋值时，闭包能读到最新值。

**workspace-context.js**：
- 参数 `stageTitle` → 解构别名 `stageTitle: initialStageTitle`
- 定义 `ctx = { stageTitle: initialStageTitle, ... }`
- 闭包内 `stageTitle(...)` → `ctx.stageTitle(...)`
- 返回 `ctx`

**conversation-controller.js**：
- 同样模式处理 `composer`、`messageList`、`realtime`、`messageSync`
- 所有闭包读取 `ctx.composer` 等
- 返回 `ctx`（包含所有导出方法）

### 修复 2：SOP ID 去前缀 + workspace 隔离

- Platform SOP ID = 裸 key（如 `code-delivery`）
- Workspace SOP ID = `${workspaceId}#${key}`（如 `snail-shell#code-delivery`）
- `#` 分隔避免与 key 中的 `-` 混淆
- `workspaces.json` 中 Evolution 绑定从 `sop-evolution-stage-cycle` 改为 `evolution`

### 修复 3：is_primary 只赋予首个实例

```typescript
// 修复前
is_primary: rd.is_primary ? 1 : 0

// 修复后
is_primary: (rd.is_primary && i === 1) ? 1 : 0
```

当 `count === 1` 时 `i === 1` 恒为 true，行为不变。

### 修复 4：gitignore

`config/*.json` 和 `config/sop/*.yaml` 加入 `.gitignore`，已跟踪的 `*.example` 文件不受影响。

## 改动范围

| 文件 | 改动 |
|---|---|
| `src/web/workspace-context.js` | 闭包修复：stageTitle 读取 ctx 属性 |
| `src/web/conversation-controller.js` | 闭包修复：composer/messageList/realtime/messageSync 读取 ctx 属性 |
| `src/persistence/file-config-store.ts` | SOP ID 去前缀；is_primary 只赋予首个实例 |
| `src/workspace-workflow/manager.ts` | workspace SOP ID 用 `#` 分隔 |
| `config/workspaces.json` | Evolution 绑定改为 `evolution` |
| `.gitignore` | 添加 config 非 example 文件 |
| `config/sop/evolution.yaml` | 移除多余的 Boss Role 定义（系统自动注入） |
| `config/*.json`, `config/sop/*.yaml` | 从 git 跟踪移除，仅保留 example 文件在 GitHub |
| `tests/workspace/collaboration-test.ts` | 测试数据对齐新 SOP ID 格式 |

## 验证

- [x] 启动程序无报错，正常进入界面
- [x] 进入对话后消息正常发送
- [x] `npx tsc --noEmit` 类型检查通过
- [ ] 角色展开后只有 -1 实例是 primary
- [ ] 需删除 `data/snail-shell.db` 重建（不兼容变更）

## 讨论记录

### 闭包捕获的根因

最初排查时关注了初始化时序（`stageTitle` 在 `init()` 之前还是之后赋值），后来确认根因不在时序——赋值在 `init()` 之前已完成。问题在于 JavaScript 闭包语义：函数参数是局部变量，闭包捕获的是变量绑定而非引用。`workspaceContext.stageTitle = ...` 修改的是返回对象的属性，闭包内的局部变量永远是构造时的 `null`。

修复思路：不改架构（不用 getter/setter 或依赖注入框架），只把闭包内的局部变量读取改为读取返回对象（`ctx`）上的属性。`ctx` 是 `const` 引用的同一个对象，外部赋值 `ctx.stageTitle = ...` 对闭包立即可见。

### SOP ID 为什么要去前缀

原来 `loadSopDir` 给 platform SOP 自动加了 `sop-` 前缀（如 `sop-code-delivery`），但 `workspaces.json` 中绑定用裸 key（如 `code-delivery`）。讨论后认为前缀是多余的——key 本身来自文件名，已经足够唯一。前缀增加了理解复杂度，且导致绑定和缓存之间的格式不一致。去掉前缀后，SOP ID 就等于 key，简单直接。

### workspace SOP 用 `#` 分隔符

workspace SOP ID 格式为 `${workspaceId}#${key}`。最初用了 `-` 分隔，但 workspaceId 和 key 本身都会包含中划线，导致歧义。改用 `#` 分隔，语义更清晰。

### SOP 中的 role 与 instance 的关系

SOP YAML 中 `is_primary: true` 定义在 role 级别，`count: 2` 让一个 role 展开为多个实例（`设计者-1`、`设计者-2`）。讨论确认：role 级别的 primary 标记应只赋予首个实例（`-1`），其余实例不是主响应。这样默认路由（无 mention 时）指向 `-1`，不会出现两个实例都是主响应的问题。

`count === 1` 时没有后缀，`i === 1` 恒为 true，行为与修复前完全一致。

### Boss Role 不应在 SOP YAML 中定义

`evolution.yaml` 原来定义了 Boss Role 作为 SOP 角色，这是不对的。Boss Role 是系统级参与者，由 `workflow.ts` 自动注入到 `participating_roles`（`["Boss Role", ...roles.map(...)]`），不需要在 SOP 角色列表中声明。`code-delivery` SOP 也没有定义 Boss Role。移除后保持一致。

### config 目录命名

讨论了 `config` vs `configs`，结论沿用 `config`（单数），这是更普遍的惯例（Rails、Django、Node 生态都用 `config`）。

### 配置文件从 git 移除

`.gitignore` 只影响未跟踪文件，已在 git 中的文件不会自动排除。需要 `git rm --cached` 从索引中移除非 example 文件（磁盘上保留），GitHub 上只保留 `*.example` 文件。

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | SOP ID 去前缀是不兼容变更 | 需删除数据库重建，已在 commit 中标注 Incompatible | 2026-06-03 |
| 2 | workspace SOP 用 `#` 分隔 | 避免与 key 中 `-` 混淆 | 2026-06-03 |
| 3 | 闭包修复不改架构 | 只改读取方式，不引入 getter/setter 或依赖注入框架 | 2026-06-03 |
| 4 | showNotice 闭包问题未修 | 只在用户操作时触发，非启动崩溃，后续统一处理 | 2026-06-03 |
| 5 | Boss Role 从 evolution SOP 移除 | 系统自动注入，不需要在 SOP 中定义 | 2026-06-03 |
| 6 | is_primary 只赋予首个实例 | role 级别的 primary 语义由 -1 实例承担 | 2026-06-03 |
| 7 | config 沿用单数命名 | 更普遍的惯例 | 2026-06-03 |
| 8 | git rm --cached 移除已跟踪文件 | .gitignore 不影响已跟踪文件，需手动移除索引 | 2026-06-03 |
