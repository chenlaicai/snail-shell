---
id: I2026060308
title: prompt-optimization
from_ids: [I2026052908]
tags: [prompt, system-prompt]
modules: [prompt-center, agent]
doc_kind: spec
---

# I2026060308 [prompt] 系统提示词优化：分类重组、场景规则归位、任务协议内联

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

三个问题：

1. **B-01 规则散乱**：15 条规则无分类，硬约束、行为原则、协作协议混在一起；存在语义重复（"不是执行助手"与"高影响动作不自动执行"；"事实不足先查证"与"新输入先判断衔接"）。
2. **S-02 场景规则混入平台层**：2 条 `[设计阶段]` 知识库规则是场景专属工作流细节，不该占平台层 prompt 位；2 条 `[设计阶段]` 参考约束规则实际适用于所有阶段。
3. **S-05/S-06 作为独立 prompt 文件不合理**：这两个文件是系统内部 OpenAI 调用的 system message（LLM 提取 mention 和生成摘要），不是 agent 面向的系统提示词。20+ 行的任务协议不应作为独立 prompt 文档维护。
4. **S-01 存在死代码和语义错误**：`active_role_working_rules_block` 模板变量在 builder.ts 中硬编码为空串；输入产物警告原文错误地将上一 Stage 产物描述为"非可信引用数据"。

## 目标

1. B-01 按语义分类为 5 个分区（硬约束/行为原则/输入处理/协作协议/上下文发现），合并重复规则
2. S-02 的设计阶段专属规则移入 design handbook，参考约束规则改为 `[全阶段]`
3. S-05/S-06 删除，prompt 内联到对应代码文件（mention-extractor.ts / summary.ts）
4. S-01 移除死代码 `active_role_working_rules_block`，修正输入产物警告语义

## 非目标

- 不改变任何规则的实际语义（仅重组分类、修正标签）
- 不改变 S-05/S-06 内联后的 OpenAI 调用行为
- 不修改 B-02/B-03/S-01 以外的 prompt 文件

## 设计

### B-01 分类重组

原 15 条扁平规则 → 5 个语义分区：

| 分区 | 规则数 | 内容 |
|---|---|---|
| 硬约束 | 3 | worktree 隔离、git hooks、资源记录 |
| 行为原则 | 4 | 非执行助手、行动前识别、多方案决策、高影响动作 |
| 输入处理 | 4 | 工作语言、事实查证、新输入判断、无指向输入 |
| 协作协议 | 3 | message-payload、提问、说明方案 |
| 上下文发现 | 2 | SOP 验证、运行时标识获取 |

合并的重复规则：
- "不是执行助手" + "高影响动作不自动执行" → 保留为独立的两条行为原则（语义互补但不重复）
- "事实不足先查证" + "新输入先判断衔接" → 保留为独立的两条输入处理规则（前者是事实判断，后者是边界判断）

### S-02 规则归位

| 规则 | 原位置 | 新位置 | 理由 |
|---|---|---|---|
| 实现前对照知识库概览 | S-02 `[设计阶段]` | design handbook | 场景专属 |
| 发现知识库矛盾时暴露冲突 | S-02 `[设计阶段]` | design handbook | 场景专属 |
| 角色手册只包含核心行为规则 | S-02 `[设计阶段]` | S-02 `[全阶段]` | 所有阶段都需要知道 |
| 使用 prompt-constraints skill | S-02 `[设计阶段]` | S-02 `[全阶段]` | 所有阶段都使用 |

### S-05/S-06 内联

S-05 prompt 内容 → `mention-extractor.ts` 的 `buildSystemPrompt()` 方法
S-06 prompt 内容 → `summary.ts` 的 `generateConversationSummary()` 方法
删除 `builder.ts` 中的 S-05/S-06 排除过滤器
删除测试中的 S-05/S-06 排除过滤器

### S-01 清理

- 移除 `{{active_role_working_rules_block}}` 模板变量（builder.ts 硬编码空串）
- 移除 `builder.ts` 中 `active_role_working_rules_block: ""` 赋值
- 输入产物警告从 3 行压缩为 1 行，保留完整语义

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `.meta/prompts/prompts/B-01-*.md` | 修改 | 分类重组为 5 个分区，合并重复规则 |
| `.meta/prompts/prompts/S-01-*.md` | 修改 | 移除死代码，压缩输入产物警告 |
| `.meta/prompts/prompts/S-02-*.md` | 修改 | 移除 2 条设计阶段规则，修正 2 条作用域标签 |
| `.meta/prompts/prompts/S-05-*.md` | 删除 | 内联到 mention-extractor.ts |
| `.meta/prompts/prompts/S-06-*.md` | 删除 | 内联到 summary.ts |
| `config/sop/code-delivery/design#designer.handbook.md` | 修改 | 补充知识库查询规则 |
| `src/llm/mention-extractor.ts` | 修改 | 内联 S-05 prompt，移除 prompt-center 依赖 |
| `src/llm/summary.ts` | 修改 | 内联 S-06 prompt，移除 prompt-center 依赖 |
| `src/prompt-center/builder.ts` | 修改 | 移除排除过滤器和死代码 |
| `tests/meta/prompt-assets-test.ts` | 修改 | 移除排除过滤器 |
| `tests/prompt-center/workspace-overlay-test.ts` | 修改 | 移除排除过滤器 |

## 验证

### 通用

- [ ] TypeScript 编译通过（`tsc --noEmit`）
- [ ] ESLint 通过
- [ ] 全部 45 个测试文件通过（`npm test`）
- [ ] prompts 目录从 7 个文件减少到 5 个
- [ ] 代码中无 S-05/S-06 残留引用

## 关联

- 前置：I2026052908（prompt-optimization：B-03 精简与 skill_references 移除）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | B-01 重组是否改变规则语义 | 逐条对比确认语义不变，仅分类和标签调整 | 2026-06-03 |
| 2 | S-05/S-06 内联后可维护性 | 这是系统内部 OpenAI prompt，放在代码中合理 | 2026-06-03 |
| 3 | S-01 输入产物"非可信"定性 | 用户确认上一 Stage 产物是可信交付物，已移除"非可信" | 2026-06-03 |

## 范围变更记录

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-06-03 | S-01 输入产物警告补回"同一 Issue"边界限定 | 检视发现丢失了关键的 Issue 边界约束 |
| 2026-06-03 | S-01 移除"非可信引用数据"表述 | 用户确认上一 Stage 产物是可信的 |
