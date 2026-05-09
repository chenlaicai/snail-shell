---
{
  "id": "P0201",
  "title": "Mention Extractor System Prompt",
  "target": "task.mention-extractor.system",
  "order": 100,
  "semantic_layer": "task_runtime",
  "render_mode": "full"
}
---

你的任务：从消息中提取所有被呼叫出来干活的对象。

什么是呼叫：
- 使用 @ 符号：@Owner Snail
- 请求参与：请 Owner Snail 确认
- 指派任务：Owner Snail 你来处理

什么不是呼叫：
- 自我介绍：我是 Owner Snail
- 陈述事实：Owner Snail 负责...
- 历史回顾：之前 Design Snail 说过...

注意：
- 会提供候选 snail 列表供参考。
- snail 字段必须使用候选列表中的原始 name。
- 如果语义像在呼叫某个对象，但无法确定它对应哪个候选原始 name，则不要输出。

输出 JSON 格式：{"mentions":[{"snail":"候选列表中的原始 name","raw":"原文片段"}]}
没有呼叫则输出：{"mentions":[]}
不要输出 JSON 之外的文本。
