---
id: I2026050901
title: 上下文阈值调整
from_ids: []
tags: [configuration, diagnostics]
modules: [project_management]
---
# I2026050901 上下文阈值调整

## 背景

实际执行发现 `gpt-5.5` 的上下文窗口与输出上限需要分别配置：上下文窗口约为 270k token，最大输出上限为 128k token。仓库内置的模型上下文窗口仍按 400k 统计，导致 Snail Shell 展示和诊断的上下文用量偏低。

同时 OpenCode 对自定义 provider/model 缺少 `limit.context` 与 `limit.output` 模型元数据时，无法基于真实窗口判断何时触发自动压缩，也无法记录该模型的输出上限。

## 目标

1. 将 Snail Shell 内置 `gpt-5.5` 与 `my-geek/gpt-5.5` 上下文窗口调整为 270000。
2. 为本机 OpenCode 配置中的 `gpt-5.5` 自定义模型补充 `limit.context = 270000` 与 `limit.output = 128000`，使 OpenCode 自动压缩和输出上限元数据具备正确依据。
3. 更新相关测试，确保 runtime usage 诊断使用新的内置窗口。

## 非目标

1. 不调整 `gpt-5.4`、`gpt-5.1-codex-max`、`big-pickle` 等其他模型窗口。
2. 不改变 Snail Shell 自己的消息裁剪、摘要生成或 stage 流程。
3. 不提交本机 `config/llm.json` 或包含密钥的 OpenCode 用户配置。

## 设计

Snail Shell 对 runtime usage 的上下文窗口来源分两层：runtime 事件显式提供窗口时优先使用 runtime 值；自定义模型没有 runtime 窗口时，从 `config/model-context-windows.json` 读取内置兜底。此次只调整 `gpt-5.5` 的内置兜底，不改变来源优先级。

OpenCode 1.4.0 的自定义模型配置 schema 使用 `provider.<id>.models.<model>.limit.context` 表示上下文窗口，使用 `provider.<id>.models.<model>.limit.output` 表示输出上限。为避免仓库提交用户私有 provider、baseURL 或密钥信息，本次直接更新本机 `~/.config/opencode/opencode.jsonc` 中已有的 `my-xcode/gpt-5.5` 与 `my-geek/gpt-5.5` 模型元数据，不纳入 PR diff。

## 生效路径

1. `config/model-context-windows.json` 为 Snail Shell runtime usage 诊断和 UI 上下文用量显示提供内置窗口。
2. `~/.config/opencode/opencode.jsonc` 的 `provider.<id>.models.gpt-5.5.limit.context` 为本机 OpenCode 自动压缩提供模型窗口元数据，`limit.output` 记录 128000 输出上限。
3. `tests/agent/opencode-parser-test.ts` 覆盖 OpenCode usage 事件缺少 runtime 窗口时的内置兜底值。

## 改动范围

1. `config/model-context-windows.json`
2. `tests/agent/opencode-parser-test.ts`
3. `docs/issues/20260509/I2026050901-context-threshold-adjustment.md`
4. 本机非仓库文件：`~/.config/opencode/opencode.jsonc`

## 验证

1. 运行 OpenCode 配置解析或调试命令，确认本机 OpenCode 配置中 `gpt-5.5` 的 `limit.context` 为 270000，`limit.output` 为 128000。
2. 运行 `npm run test -- tests/agent/opencode-parser-test.ts` 或仓库现有可用测试命令，确认 OpenCode usage 兜底窗口更新后测试通过。
3. 运行必要的构建/检查命令，确认配置和测试变更未破坏 TypeScript 或整体测试。

## 风险与决策记录

用户已明确指出 `gpt-5.5` 的 output 阈值是 128000；本机 OpenCode 配置必须把它写入 `limit.output`，不能与 270000 的 `limit.context` 混淆。仓库中的 `config/model-context-windows.json` 只表达 Snail Shell runtime usage 使用的上下文窗口兜底，因此这里保留 270000，不写成 output 阈值。

用户已明确给出实测结论：`gpt-5.5` 上下文上限为 270k，因此本 feature 直接采用 270000 作为上下文窗口配置值，不再保留 400000 的乐观估计。

OpenCode 用户配置位于仓库外且可能包含私有 provider 信息，本次不提交该文件；PR 仅记录已完成本机配置调整和验证结果。

## 范围变更记录

1. Review 阶段收到用户反馈：output 阈值应为 128000，当前文档只强调 270000，容易让人误解为 output 阈值仍是 270000。已将 feature 文档补充为 `limit.context = 270000` 与 `limit.output = 128000` 两条不同配置；仓库内置 `model-context-windows` 只承载上下文窗口，因此不改为 128000。
