---
id: I2026050604
title: 流式过程标题行宽度稳定
from_ids: []
tags: [ui]
modules: [project_management]
---
# I2026050604 流式过程标题行宽度稳定

## 背景

完成态 assistant 消息会把流式过程收敛到可折叠的过程流中。折叠态只展示很短的“流式过程”摘要，浏览器会按折叠摘要计算 flex item 的 auto 宽度；用户展开过程流后，内部事件标题行仍被限制在这个偏窄宽度内，导致命令、路径或生成标签比实时态更早截断，显示宽度随标题内容变化而异常收缩。

该问题影响的是完成态过程流的可读性，不是消息模型、流式协议或事件内容持久化问题。

## 目标

1. 含有 `event_stream` 的完成态 assistant 消息应复用常规 assistant 消息的宽度预算，不因折叠摘要过短而收缩。
2. 事件标题行必须保持单行稳定预览，过长内容使用省略号截断，完整信息继续通过展开后的详情区域承载。
3. 事件标题行的类型标签、摘要文本和展开箭头在同一视觉行内稳定对齐。
4. 只收敛当前桌面 Web 工作台中的完成态过程流显示问题，不引入未定义的移动端支持承诺。

## 非目标

1. 不调整流式事件的数据结构、持久化格式或 `message-out` payload 协议。
2. 不改变过程流默认展开/折叠策略。
3. 不为所有消息类型强制统一宽度，只限定含过程流的完成态 assistant 消息。
4. 不解决正文详情区域内部的长文本换行策略。

## 设计

渲染层在消息 shell 上暴露 `has-event-stream` 状态类。CSS 通过 `.msg.assistant.message-shell.has-event-stream` 将包含过程流的完成态 assistant 消息固定到当前桌面 Web 工作台既有 assistant 消息宽度预算 `78%`。这样折叠态的短摘要不再决定整条完成态消息的实际宽度，展开后的事件列表可以使用与实时态一致的横向空间。

事件块的 `summary` 改为三列 grid：事件类型标签、可收缩标题摘要、展开箭头。中间列使用 `minmax(0, 1fr)`，确保标题文本可以在剩余空间内收缩，而不是撑开或挤压其他列。

新增共享样式工具 `.ui-truncate-one-line`，把稳定标题行的不变量集中为 `min-width: 0`、`overflow: hidden`、`text-overflow: ellipsis` 和 `white-space: nowrap`。事件摘要节点使用该工具类，避免后续新增标题行时重复分散同一套截断规则。

## 生效路径

1. `src/web/message-renderer.js` 在渲染含 `event_stream` 的消息 shell 时添加 `has-event-stream` 类，并让事件摘要文本使用 `.ui-truncate-one-line`。
2. `src/web/styles.css` 定义过程流完成态消息的桌面 Web 工作台宽度预算、事件标题行 grid 布局，以及单行截断工具类。
3. `tests/web/workspace-layout-test.ts` 通过静态布局断言覆盖消息宽度类、事件标题行布局和截断工具类，防止后续样式回归。

## 改动范围

1. 更新 `src/web/message-renderer.js`。
2. 更新 `src/web/styles.css`。
3. 更新 `tests/web/workspace-layout-test.ts`。
4. 新增 `docs/features/I2026050604-stream-title-width.md` 记录本 feature 设计、边界、验证和范围变更。

## 验证

1. 运行 `npm run check`，覆盖 lint、build 和测试。
2. 确认 `tests/web/workspace-layout-test.ts` 断言包含过程流消息宽度、事件标题行 grid 布局和单行截断规则。
3. 通过代码检查确认完整事件内容仍在展开后的详情区域渲染，标题行只承担稳定预览职责。

## 风险与决策记录

当前没有未经确认的问题。

决策记录：本次不调整事件数据模型，也不把长标题完整展示在标题行中。标题行定位为扫描预览，完整内容应由详情区域承载；因此稳定单行截断比随内容拉伸或换行更符合当前消息列表的阅读模型。

## 范围变更记录

1. PR 初始实现只包含前端渲染、样式和布局测试；进入检视阶段后，用户要求基于最新 `main` rebase 并补充当前 feature 设计文档，因此新增本文档作为长期设计记录。
2. 2026-05-06 已执行 `git fetch origin && git rebase origin/main`，确认 `origin/main` 为 `da93bacaa6532123d5f525ed952531f5208160ee`，当前分支无需冲突处理且已基于最新 main。
3. 用户指出 Snail Shell 当前没有“移动端”产品范围；本 feature 移除新增的过程流窄视口宽度规则和测试断言，并将文档收敛为当前桌面 Web 工作台显示问题，不再把既有窄视口 CSS 规则解释为移动端支持承诺。
