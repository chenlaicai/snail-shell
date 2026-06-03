---
id: F2026051909
title: commit 与 PR 模板
from_ids: []
tags: [convention]
modules: [project_management]
---
# F2026051909 commit 与 PR 模板

## 背景

当前研发流程只要求 commit 标题和 PR 标题使用中文，缺少稳定的语义模板。遇到不兼容更新时，标题和正文没有强制暴露不兼容标识，检视者也缺少对应检查点，容易让破坏性变化在提交记录、PR 列表和检视阶段不可见。

## 目标

1. 为当前项目推进流程制定 commit 标题模板。
2. 为 PR 标题和正文制定对应模板。
3. 对不兼容更新建立显式标识规则。
4. 让研发者产出、检视者检查和本地 commit hook 形成同一套约束。

## 非目标

1. 不引入交互式 commit 工具或 PR 创建向导。
2. 不追溯修改历史 commit 或已合入 PR 标题。
3. 不让 hook 自动判断改动是否不兼容；不兼容语义由研发者判断并由检视者复核。

## 设计

commit 标题统一为：

```text
[FYYYYMMDDNN][Feature Update|BugFix|New Feature][Incompatible] 中文标题
```

其中 `[Incompatible]` 仅在存在不兼容更新时出现；兼容更新不得添加该段。不兼容更新包括但不限于删除旧入口、改变持久化 schema 或协议字段、移除兼容层、改变用户可见流程或要求使用者迁移数据/配置/调用方式。

PR 标题沿用同一前缀结构，正文必须说明改动摘要、验证结果，并在不兼容更新时增加 `## 不兼容更新` 段落说明影响对象、迁移或处理方式，以及为什么不保留兼容层。

本 feature 不采用用户示例中的 `Imcompatible` 拼写，而采用标准英文 `Incompatible`，避免长期模板固化拼写错误。

## 生效路径

1. `.meta/prompts/prompts/S-03-研发者手册.md`：研发者在 development 阶段提交 commit 和创建 PR 时遵守模板。
2. `.meta/prompts/prompts/S-04-检视者手册.md`：检视者复核 PR 标题、commit 标题、正文和不兼容标识一致性。
3. `.githooks/commit-msg`：本地提交时阻断不符合模板的普通 commit 标题。
4. `tests/meta/prompt-assets-test.ts`：验证提示词长期保留模板规则。

## 改动范围

1. 新增本 feature 文档。
2. 更新研发者手册的 commit/PR 交付规则。
3. 更新检视者手册的 PR/commit 模板检查点。
4. 更新 commit-msg hook 的标题校验。
5. 补充提示词资产测试。

## 验证

1. `npm run test`
2. 手工检查 `.githooks/commit-msg` 对当前提交标题模板生效。

## 风险与决策记录

1. 决策：模板使用 `[Incompatible]` 而不是用户示例中的 `[Imcompatible]`。原因是长期规则不应固化拼写错误。
2. 决策：不让 hook 强制判断是否需要 `[Incompatible]`。原因是不兼容属于语义判断，静态标题校验无法可靠从 diff 推断，只能校验标识格式，具体是否遗漏由研发者自检和检视者复核承担。
3. 风险：已有历史 commit 不符合新模板；本 feature 只约束后续普通提交，不追溯改写历史。

## 范围变更记录

1. 2026-05-19：rebase 到最新 `main` 后，`F2026051907` 已被 `system-prompt-injection-optimization` 占用，本 Feature 文档编号调整为 `F2026051909`，不改变需求和实现范围。
