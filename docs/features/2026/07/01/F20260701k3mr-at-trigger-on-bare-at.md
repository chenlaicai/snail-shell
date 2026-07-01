---
id: F20260701k3mr
title: at-trigger-on-bare-at
from_ids: [F2026061805]
tags: [ux, web, bugfix]
modules: [web]
doc_kind: spec
change_type: bugfix
---

# F20260701k3mr [web] 输入 @ 即触发补全列表

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

F2026061805 实现了 @mention 自动补全功能，但用户反馈：输入 `@` 后补全列表不弹出，必须先输入空格再输入 `@` 加至少一个汉字才能触发。这与原始 spec 的 B1 行为矛盾。

### 根因分析

`extractMentionQuery`（`src/web/hooks/useMention.ts:35`）使用正则 `^[\p{L}\p{N}_][\p{L}\p{N}_-]*` 匹配 `@` 后的文本。该正则要求**至少一个字符**存在才能匹配。当用户仅输入 `@`（`tail` 为空字符串）时，正则匹配失败，函数返回 `null`，补全列表不显示。

**与 spec 的矛盾**：F2026061805 B1 明确规定"当用户在输入框中输入 @ 时，应显示 role_instance 补全列表"。当前实现将"输入 @"解释为"需要 `@` 后至少一个字符"，偏离了 spec 意图。

### 业界实践

主流应用（Slack、Discord、GitHub、Notion）的 @mention 触发模式一致：**输入 `@` 立即显示全量列表，继续输入时过滤**。当前实现偏离了这一通用交互预期。

## 目标

修复 `extractMentionQuery`，使用户在输入 `@` 后（无需额外字符）立即触发补全列表，显示所有可用 role_instance。继续输入字符时按子串过滤列表。

## 非目标

- 不改变 MentionDropdown UI 组件
- 不改变键盘行为契约（Enter/Tab 确认、Escape 关闭、Shift+Enter 发送）
- 不改变发送时的 `extractToSpeakers` 逻辑
- 不改变后端路由逻辑

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 用户在行首或空白字符后输入 `@`，光标紧跟 `@` | 显示所有 role_instance 补全列表 | ✅ |
| B1-ext | 用户输入 `@` 后继续输入字符 | 补全列表按子串过滤（区分大小写不敏感） | ✅（已有） |
| B11 | `stage.role_instances` 为空且用户输入 `@` | 不显示补全列表，@ 作为普通文本处理 | ✅（已有，filterMentionState 返回 null） |

## 设计

### 改动范围

仅修改 `extractMentionQuery` 函数，在正则匹配前增加对 `tail` 为空的处理：

```
当前逻辑：tail 为空 → 正则匹配失败 → return null（不触发）
修改后：  tail 为空 → return { start: mentionStart, query: "" }（触发，显示全量列表）
```

**具体位置**：`src/web/hooks/useMention.ts` 第 34 行与第 35 行之间，增加 early return：

```typescript
// @ 后无字符时，显示全量列表（与 Slack/GitHub/Notion 行为一致）
if (tail.length === 0) return { start: mentionStart, query: "" };
```

### 下游影响分析

| 组件 | 影响 | 原因 |
|------|------|------|
| `filterMentionState` | 无 | `"".includes("")` 为 `true`，返回全量列表 |
| `computeTextTransform` | 无 | `end = start + 1 + 0 = start + 1`，正确替换 `@` |
| `extractToSpeakers` | 无 | 使用独立正则 `/@([\p{L}\p{N}_-]+)/gu`，只匹配已输入字符的 mention |
| `MentionDropdown` | 无 | 只依赖 `suggestions.length > 0` 判断是否渲染 |
| 键盘行为 | 无 | Enter/Tab/Escape/Shift+Enter 逻辑不变 |

### 边界场景验证

| 场景 | 输入 | 预期 |
|------|------|------|
| 行首 @ | `@\|` | 显示全量列表 |
| 空格后 @ | `hello @\|` | 显示全量列表 |
| @ 后输入汉字 | `@开发\|` | 过滤列表 |
| @ 后输入空格 | `@ \|` | 不触发（return null） |
| 已完成 mention | `@alice \|` | 不触发（return null） |
| email 场景 | `user@\|` | 不触发（prefix 非空白，return null） |
| 选择后 | `@alice \|` | 不触发（trailing space） |
| role_instances 为空 | `@\|` | filterMentionState 返回 null，不显示 |

### 测试变更

修改 `tests/extract-mention-query.test.ts`：

- **修改**：`"returns null when cursor right after @ with no query"` → 改为期望返回 `{ start: 0, query: "" }`
- **新增**：`"returns empty query when cursor right after @ with space prefix"` — 验证 ` @` 场景

## 生效路径

| 文件 | 改动 |
|---|---|
| `src/web/hooks/useMention.ts` | `extractMentionQuery` 增加 `tail.length === 0` early return |
| `tests/extract-mention-query.test.ts` | 修改 1 个测试 + 新增 1 个测试 |

## 设计约束摘要

- **边界**：仅修改 `extractMentionQuery` 函数的 1 行 early return，不涉及其他组件
- **关键决策**：
  - 空 `tail`（`@` 后无字符）视为有效触发状态，返回 `{ start, query: "" }`
  - 与业界主流应用行为对齐（Slack/GitHub/Notion/Discord）
  - 下游 `filterMentionState` 已天然支持空查询（全量返回）
- **语义不变量**：
  - 补全列表激活时 Enter 确认选择、Shift+Enter 发送
  - `@` 后跟空白字符不触发（mention 已完成语义）
  - email 场景不触发（prefix 非空白字符检查）

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 改动 |
|---|---|
| `src/web/hooks/useMention.ts` | `extractMentionQuery` 第 34-35 行间增加 early return |
| `tests/extract-mention-query.test.ts` | 修改 1 个测试断言 + 新增 1 个测试用例 |

## 验证

- [x] 输入 `@` 后立即显示全量补全列表
- [x] 输入 `@` 后继续输入字符，列表按子串过滤
- [x] `@` 后输入空格，补全列表关闭
- [x] 已完成 mention（`@name ` + 空格）后不触发补全
- [x] email 场景（`user@`）不触发补全
- [x] role_instances 为空时输入 `@` 不显示补全列表
- [x] 从全量列表中选择角色后，文本正确插入 `@name `

## 关联

- **前置**: F2026061805（@mention 自动补全原始实现）
- **类型**: bugfix（实现与 spec 不一致）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | `@` 后无字符是否触发补全 | F2026061805 B1 明确要求输入 @ 即显示列表；Slack/GitHub/Notion 均为 `@` 立即触发 | 可能导致误触发（如输入 email 时） | 立即触发 | spec 明确 + 业界惯例 + email 已有 prefix 检查防护 | 架构师-1 | 2026-07-01 |
