---
id: F2026051910
title: 清理 docs/core
from_ids: []
tags: [refactor, docs]
modules: [project_management]
---
# F2026051910 清理 docs/core

## 背景

用户已明确当前演进方向：AI 时代不再长期保留普通设计文档；源码注释负责沉淀必要的 why，核心原则及时进入系统提示词、skill、代码、脚本或评估资产等可运行入口。`docs/core` 当前仍保留多份核心设计文档，需要梳理其内容并迁移到 Snail Shell 运转飞轮中，最后移除不应继续存在的设计文档。

## 目标

1. 梳理 `docs/core` 下文档内容，区分设计规范、运行时事实基线、提示词治理规则、知识治理规则和消息模型约束。
2. 将仍需长期生效的规则迁移到合适入口，例如 `.meta/prompts/`、`.meta/skills/`、代码注释、测试或 README。
3. 移除不再作为权威入口长期维护的设计文档。
4. 保持提示词调整遵守现有 frame 与 prompt 归属边界。
5. 通过必要验证确认提示词资产、测试和构建未回归。

## 非目标

1. 不重新设计 Snail Shell 消息模型、知识治理流程或提示词系统。
2. 不引入新的兼容层或临时文档入口。
3. 不修改已合入的历史 feature 文档。
4. 不把 runtime 采样事实伪装成系统提示词规则。

## 设计

本次清理按“内容去向”处理 `docs/core`：

1. 可执行行为规则进入 `.meta/prompts/` 对应 Base 或 Scenario 模块。
2. skill 的命令、协议和完整操作流程进入对应 `.meta/skills/<skill>/SKILL.md`。
3. 代码模型和协议不变量进入 TypeScript 类型、消息协议代码、测试和必要 why 注释。
4. runtime 原始观测事实若仍需保留，应转为测试 fixture 或 runtime adapter 注释，而不是继续放在 `docs/core` 设计文档中。
5. 提示词效果评估规则应进入研发者提示词治理规则、评估样本资产和测试说明。

## 生效路径

1. `.meta/prompts/`：让 AI 在运行时直接获得规则。
2. `.meta/skills/`：让结构化能力的完整协议随 skill 生效。
3. `src/` 与 `tests/`：让消息模型、runtime 映射和评估资产通过类型、实现和验证约束生效。
4. `docs/README.md`：更新文档目录边界，避免后续重新把设计文档放回 `docs/core`。
5. 设计决策库：承载经过知识治理确认的架构取舍和系统不变量。

## 改动范围

预计涉及：

1. `docs/core/`
2. `docs/README.md`
3. `.meta/prompts/`
4. `.meta/skills/`
5. `src/shared/`、`src/agent/`、`src/web/` 中与消息模型、runtime 映射和知识治理枚举相关的长期入口
6. `tests/meta/`、`tests/persistence/` 或其他相关测试资产

## 验证

1. 运行提示词资产相关测试。
2. 运行消息模型或全量测试中与改动相关的测试。
3. 如涉及构建产物或 skill CLI，运行必要构建后验证脚本入口可用。

验证结果：

1. 初次 `npm run build` 因新 worktree 未安装依赖失败，缺少 `@eslint/js`；已在 worktree 内执行 `npm install` 补齐依赖。
2. 重新执行 `npm run build` 通过；ESLint 保留既有 22 条模块边界 warning，无 error。
3. 执行 `npm run test -- --run tests/meta/prompt-assets-test.ts`，该命令触发构建并运行 38 个编译测试文件，全部通过。
4. 构建后执行 `design-decision` list 查询成功，当前没有 active 设计决策记录与本次方向冲突。
5. 合并最新 `origin/main` 后，因 main 新增 Mermaid 依赖，先执行 `npm install` 同步依赖，再通过提交 hook 执行 `npm run test`；最终 40 个编译测试文件全部通过。

## 风险与决策记录

1. `design-decision` skill 当前依赖 `dist`，新 worktree 尚未构建时无法查询；后续验证阶段通过构建恢复入口后再复查。
2. 本次目标是移除设计文档，但不能丢失仍需长期生效的系统约束；迁移完成前不得删除对应内容。
3. 历史 feature 文档中仍会保留对旧 `docs/core` 路径的引用；这些是已合入交付记录，不在本次改写范围内。
4. `core_doc_pr` 作为知识治理历史枚举值保留，以兼容已有持久化记录；新治理通过 prompt、skill、用户手册、代码/测试或设计决策记录承载长期内容。

## 范围变更记录

1. 实现中发现知识治理 `core_doc_pr` 已作为持久化枚举值存在；本次不删除枚举，只将其标记为历史记录值，并把新治理入口引导到提示词、skill、用户手册、代码/测试或设计决策记录。
2. 实现中补充 `src/agent/` 和 `src/web/` 改动，用代码级 why 注释与界面标签承载原 `docs/core` 中仍需长期存在的 runtime 映射和知识治理语义。
3. 合并最新 `origin/main` 后发现同日 feature 文档编号冲突；本轮文档从 `F2026051907` 顺延为 `F2026051909`。
4. 再次同步最新 `origin/main` 后，同日新增 `F2026051909`；本轮文档继续顺延为 `F2026051910`。
