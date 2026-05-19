# PR 评论签名模板

## 适用范围

本模板适用于研发者和检视者写入 GitHub PR 的普通评论，包括检视意见、检视意见处理结论、复检请求、复检结论和仍需对方响应的说明。

本模板不适用于 message-out 结构化消息。message-out 的责任归属和路由由 payload 中的消息元数据与 mentions 字段承担。

## 模板

研发者 PR 普通评论：

```markdown
<评论正文>

by 研发者（<Snail 名称>）
```

检视者 PR 普通评论：

```markdown
<评论正文>

by 检视者（<Snail 名称>）
```

## 规则

1. `<评论正文>` 是实际评论内容，不是需要原样保留的占位文本。
2. `<Snail 名称>` 使用当前响应 Snail 的可展示名称，例如 `Claude Code Stateful + Sonnet`。
3. 签名行必须是评论最后一行，格式为 `by <角色>（<Snail 名称>）`。
4. 评论正文与签名行之间必须保留一个真实 Markdown 空行。
5. 签名不得与正文挤在同一行，不得出现在非末行位置。
6. PR 评论必须使用真实 Markdown 换行，不得把 `\n\n` 当作字面文本写入评论。

## 示例

```markdown
已处理全部检视意见，重新运行 `npm run test` 通过，申请复检。

by 研发者（Claude Code Stateful + Sonnet）
```

```markdown
复检通过，当前没有待处理问题，可以等待用户合入。

by 检视者（OpenCode Stateful + GPT-5.5）
```
