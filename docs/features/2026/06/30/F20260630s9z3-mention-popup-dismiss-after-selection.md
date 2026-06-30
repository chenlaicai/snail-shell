---
id: F20260630s9z3
title: mention-popup-dismiss-after-selection
from_ids: []
tags: [web, bugfix, mention, ui]
modules: [web]
doc_kind: spec
change_type: bugfix
---

# F20260630s9z3 — @mention 选中后候选框不消失

## 变更类型

BugFix

## 问题描述

在 ChatInput 中选中 @mention 候选后，候选框（MentionDropdown）短暂消失后立即重新出现。

## 根因分析

`useMention.ts` 中的 `extractMentionQuery` 函数无法区分"正在输入的 mention"和"已完成的 mention"。

选中后文本变为 `@alice `（cursor=7），但 `extractMentionQuery` 仍将其识别为活跃查询，因为：
1. `tail.match(/^(\S*)/)` 不检查 cursor 位置，贪婪匹配整个单词
2. `handleSelect` 事件（由 `setSelectionRange` 触发）重新调用 `updateMention`，导致候选框再次出现

## 修复方案

修改 `extractMentionQuery` 的匹配逻辑：

1. 将 `tail` 改为 `value.slice(mentionStart + 1, caret)`——只取 cursor 之前的文本
2. 使用 `[\p{L}\p{N}_][\p{L}\p{N}_-]*` 要求至少一个字母/数字/_ 开头
3. 检查 query 之后的字符：
   - 单词字符（字母/数字/_）→ 光标在单词中间，不匹配
   - 空白 → mention 已完成（如 `@alice `），不匹配
   - 标点/行尾 → 用户仍在输入，匹配

## 修改文件

- `src/web/hooks/useMention.ts` — `extractMentionQuery` 函数
- `tests/extract-mention-query.test.ts` — 新增单元测试（16 个用例）

## 验证

- `npm run check` 通过（lint + tsc + build）
- `npx vitest run tests/extract-mention-query.test.ts` 16/16 通过
