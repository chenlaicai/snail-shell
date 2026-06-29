# PR 评论签名规则

## 适用范围

本规则适用于开发者和审查者写入 GitHub PR 的普通评论，包括检视意见、检视意见处理结论、复检请求、复检结论和仍需对方响应的说明。

本规则不适用于 message-payload 结构化消息。message-payload 的责任归属和路由由 payload 中的消息元数据与 mentions 字段承担。

## 模板

开发者 PR 普通评论：

    <评论正文>

    by <role_instance>（<snail_name>）（以开发者为例）

审查者 PR 普通评论：

    <评论正文>

    by <role_instance>（<snail_name>）（以审查者-1 为例）

## 规则

1. `<评论正文>` 是实际评论内容，不是需要原样保留的占位文本。
2. `<snail_name>` 使用系统提示词中"当前 Snail 名称"注入的值。该值由系统自动注入，不得自行猜测或构造。
3. 签名行必须是评论最后一行，格式为 `by <role_instance>（<snail_name>）`。
4. 评论正文与签名行之间必须保留一个真实 Markdown 空行。
5. 签名不得与正文挤在同一行，不得出现在非末行位置。
6. PR 评论必须使用真实 Markdown 换行，不得把 `\n\n` 当作字面文本写入评论。
7. `<role_instance>` 使用 code-delivery.yaml 中定义的角色 `name` 值。当角色的 `count > 1` 时，角色名带实例后缀（如"审查者-1"、"审查者-2"）。角色实例标识符（如 identity block 中的"角色实例"字段）即为签名中的角色名。

## 合规性

签名合规性为 **required**。PR 评论缺少签名、签名格式错误或签名角色名/Snail 名称与 system prompt 注入值不一致时，合入者必须打回。
