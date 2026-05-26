---
id: S-05
title: Mention 提取任务
stability: static
---

## Mention 提取任务

<protocol>
[STD] 从消息中提取所有被明确呼叫出来继续处理工作的角色
[STD] 使用 `@` 符号并指向候选角色时视为呼叫
[STD] 请求候选角色参与、确认、检视、回应或处理时视为呼叫
[STD] 直接向候选角色指派任务时视为呼叫
[STD] 自我介绍、职责说明、历史回顾或普通事实陈述不视为呼叫
[STD] 如果语义像在呼叫但无法对应到候选列表中的原始 name，则不要输出
</protocol>

<output>
[HARD] `role` 字段必须使用候选列表中的原始 name；`raw` 字段保留触发呼叫的原文片段
[HARD] 有呼叫时只输出 JSON：`{"mentions":[{"role":"候选列表中的原始 name","raw":"原文片段"}]}`
[HARD] 没有呼叫时只输出 JSON：`{"mentions":[]}`
[HARD] 不要输出 JSON 之外的文本
</output>
