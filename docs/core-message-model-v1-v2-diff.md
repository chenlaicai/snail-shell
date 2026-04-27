# Snail Shell 核心消息模型 V1/V2 对比

## 文档定位

本文档只服务于后续从 V1 迁移到 V2 的代码修改与实现收敛。

它不是长期核心规范的一部分。

当系统完成 V2 落地后，这份文档应直接移除。

迁移完成后的长期核心规范应只保留：

1. `docs/core-message-model-v2.md`
2. `docs/runtime-cli-response-baselines.md`

`docs/core-message-model.md` 描述旧四段式模型，只作为迁移背景存在，不应再作为新实现规范入口。

---

## 对比目的

本对比稿只回答一个问题：

1. V2 相对于 V1 到底改了哪些消息建模前提。

它不承担迁移计划、实现步骤、排期拆解职责。

---

## V1 的核心假设

1. `delta` 是过程
2. `result` 是正式结论
3. `end` 是终态
4. assistant 消息默认应存在“过程/结论”语义分层
5. 前端、搜索、预览优先消费 `result`

## V2 的核心假设

1. 消息本体是完整顺序事件流
2. 内容事件与控制事件可共存于同一模型
3. 不再要求独立正式正文层
4. 终态由控制事件和 `message.status` 共同定义
5. 流程层统一对象是 `MessageEvent`

---

## 关键变化

### 1. 核心承载结构变化

V1：

1. `message + message_part`
2. `message_part.kind = start | delta | result | end`

V2：

1. `message + MessageEvent[]`
2. 持久化层可将 `MessageEvent` 落为 `message_event`

### 2. 正文假设变化

V1：

1. 系统存在单独的正式结论层 `result`
2. `result` 是正式展示、正式引用、正式摘要的优先来源

V2：

1. 不再要求所有 runtime 都能映射出独立 `result`
2. 消息内容主体改为整条 `MessageEvent[]`
3. 文本事件只是内容流的一部分，不自动升级为单独正文层

### 3. Claude result 的角色变化

V1 倾向：

1. Claude terminal `result` 容易被理解为天然正式正文层

V2：

1. Claude terminal `result` 先与上一条 `text` 去重
2. 相同则舍弃其文本值
3. 不同则吸纳为新的 `text` 事件
4. 它不再天然高于消息流中已有内容

### 4. OpenCode / Codex 的解释方式变化

V1 的问题：

1. 容易被迫从连续流里抽一个 `result`
2. 容易把最后文本提升为唯一正式正文来源

V2：

1. OpenCode 的最终 `text` 只是普通文本事件
2. Codex 的最后一个 `agent_message` 只是最后一个文本事件
3. 不再要求它们向 Claude 对齐成同构 `result`

### 5. 流程层统一对象变化

V1：

1. 核心语言是 `message_part`

V2：

1. 核心语言是 `MessageEvent`
2. runtime adapter 的主要工作变成“runtime 原始事件 -> MessageEvent”映射

---

## 对后续代码修改的含义

如果后续实现要对齐 V2，通常意味着要检查：

1. 现有 `message_part` 四段式是否仍被当成核心流程对象
2. 现有 adapter 是否仍在强制抽取 `result`
3. 现有前端是否仍只把 `result` 当主内容
4. 现有搜索/预览是否仍强依赖 `result`
5. 现有消息完成态是否仍与 `end` 强绑定

这些内容只是改造对照清单，不属于 V2 规范本体。

---

## 移除时机

当以下条件成立时，应删除本文档：

1. V2 已成为实际代码与数据结构的唯一实现基线
2. 代码评审不再需要通过 V1/V2 对照解释设计差异
3. 仓库内不再存在以 V1 为默认前提的核心实现
