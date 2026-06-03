---
id: I2026051912
title: PR 评论签名模板
from_ids: []
tags: [convention]
modules: [project_management]
---
# I2026051912 PR 评论签名模板

## 背景

研发者和检视者在 PR 普通评论中已有签名要求，但当前规则只要求末行以角色名结尾，缺少统一模板。评论正文较长或包含 Markdown 列表时，单独角色名容易被看作正文内容，也不利于后续检索和人工识别评论责任人。

## 目标

1. 为研发者 PR 普通评论制定包含角色与 Snail 名称的统一签名模板。
2. 为检视者 PR 普通评论制定包含角色与 Snail 名称的统一签名模板。
3. 明确签名必须使用独立末行，并由模板直接提供真实 Markdown 换行结构。
4. 补充提示词资产测试和行为评估样本，防止规则在后续提示词调整中丢失。

## 非目标

1. 不改变 message-out mention 协议；跨角色路由仍使用结构化 payload。
2. 不改变 commit 标题、PR 标题或 PR 正文模板。
3. 不新增自动发布 PR 评论的脚本或评论格式化工具。
4. 不追溯修改历史 PR 评论。

## 设计

PR 普通评论签名统一沉淀在 `.meta/templates/pr-comment-signature.md`，格式为：

```markdown
<评论正文>

by 研发者（<Snail 名称>）
```

或：

```markdown
<评论正文>

by 检视者（<Snail 名称>）
```

其中 `<评论正文>` 是实际评论内容，`<Snail 名称>` 使用当前响应 Snail 的可展示名称，例如 `Claude Code Stateful + Sonnet`。评论正文与签名行之间必须保留一个真实 Markdown 空行，签名行必须是评论最后一行，不能与正文挤在同一行，也不能放在非末行位置。这样既保留评论主体的 Markdown 结构，又让最后一行稳定表达评论责任人与具体响应 Snail。

研发者覆盖处理检视意见、回复检视结论、请求复检等写入 PR 的普通评论。检视者覆盖提交检视意见、复检通过或仍需研发者响应等写入 PR 的普通评论。对话内的 message-out 结构化消息不使用该签名模板，因为其责任归属由消息元数据和 mentions 字段承担。

## 生效路径

1. `.meta/prompts/prompts/S-03-研发者手册.md`：研发者 review 收口阶段的 PR 普通评论签名模板。
2. `.meta/prompts/prompts/S-04-检视者手册.md`：检视者问题报告、复检结论和 PR 普通评论签名模板。
3. `.meta/templates/pr-comment-signature.md`：提供可发现、可复用的 PR 评论签名模板文件。
4. `.meta/README.md`：说明 `.meta/templates/` 的目录职责。
5. `.meta/prompt-evaluations/prompt-behavior-samples.json`：增加覆盖三类 runtime 的签名行为样本。
6. `tests/meta/prompt-assets-test.ts`：验证研发者和检视者手册持续包含 `by <角色>（<Snail 名称>）` 独立末行签名模板，并验证模板文件存在。

## 改动范围

1. 新增本 feature 文档。
2. 更新研发者手册中的 PR 评论签名规则。
3. 更新检视者手册中的 PR 评论签名规则。
4. 新增 `.meta/templates/pr-comment-signature.md`。
5. 更新 `.meta/README.md` 的模板目录说明。
6. 补充提示词行为评估样本。
7. 补充提示词资产测试。

## 验证

1. `npm run test`
2. 人工检查 `.meta/templates/pr-comment-signature.md`、研发者手册和检视者手册中签名规则均使用独立末行 `by <角色>（<Snail 名称>）`，且模板直接提供真实 Markdown 换行结构。

## 风险与决策记录

1. 决策：签名模板只约束 PR 普通评论，不约束 message-out 消息。原因是 message-out 的路由和责任归属由结构化 payload 表达，额外签名会混淆协议边界。
2. 决策：新增 `.meta/templates/pr-comment-signature.md` 作为独立模板文件。原因是用户明确期望能看到“模板在哪”，仅写入角色手册会降低可发现性。
3. 决策：不新增自动格式化工具。原因是当前需求是提示词流程模板，PR 评论由角色在 review 流程中手动发布，提示词资产测试足以防止长期规则丢失。

## 范围变更记录

1. 2026-05-19：根据用户反馈“模板在哪”，补充 `.meta/templates/pr-comment-signature.md` 独立模板文件，并让角色手册引用该文件。
2. 2026-05-19：根据用户反馈“签名再调整一下：增加snail name”，将 PR 普通评论签名从仅包含角色升级为 `by <角色>（<Snail 名称>）`。
3. 2026-05-19：同步最新 `origin/main` 时发现 `I2026051911` 已被 `record-feature-repo-context-optimization` 占用，将本 Feature 文档编号调整为 `I2026051912`，不改变需求和实现范围。
4. 2026-05-19：根据用户反馈“实际评论效果也没有换行”，将模板从文字描述末行行尾调整为直接提供“正文 + 空行 + 独立签名末行”的 Markdown 格式。
5. 2026-05-19：根据复检意见，同步更新 `.meta/README.md` 对 `templates/pr-comment-signature.md` 的描述，避免仍称为“末行行尾签名模板”。
