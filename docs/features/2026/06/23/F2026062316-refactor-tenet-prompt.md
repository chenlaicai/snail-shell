---
id: F2026062316
title: refactor-tenet-prompt
from_ids: []
tags: [prompt, refactor]
modules: [prompt]
doc_kind: spec
---

# F2026062316 [prompt] 重构 Tenet Prompt：基于实证的系统提示词重建

## 背景

`data/file/prompts/` 下的 tenet prompt（B-01、B-03）存在以下问题：

1. **分层混乱** — 实现细节（`record-issue-repo-context` 具体调用、`message-payload` 格式、`conversation` 表查询）混入准则层
2. **格式问题** — Markdown 标题 + `[HARD]` 标签混合，未使用 XML 结构化标签（Claude 对 XML 标签遵从度更高）
3. **冗余元数据** — YAML frontmatter 和 markdown 标题浪费 token，每一行应是规则本身
4. **规则质量参差** — 部分规则不可验证（认知框架）、模糊（描述性语句）、或冗余（被其他规则覆盖）
5. **编号断裂** — B-01、B-03，无 B-02，命名体系不清晰

## 目标

重建 tenet prompt，使其成为：
- 纯行为准则，不含实现细节
- 每条规则可验证、可执行
- 每条规则来自真实踩坑经验（特性文档 + feedback memory）
- 格式精简：纯 XML section + "做X/不做Y" 指令格式

## 非目标

- 不改变 tenet prompt 的加载/过滤机制（仅新增规则级 tag 过滤）
- 不迁移被移除的实现细节到 SOP/Skill（由后续工作完成）
- 不修改 SOP、Skill 或其他 prompt 文件

## 核心业务行为

### 原 B-01/B-03 → 新 T-01

| 变更类型 | 内容 |
|----------|------|
| 合并 | B-01（身份与责任契约）+ B-03（运行时边界）→ T-01（行为准则） |
| 移除 frontmatter | 文件名即 id/title，不浪费行在元数据 |
| 移除 markdown 标题 | XML section 标签本身就是分节 |
| 新增规则级 tag 过滤 | `filterContentByTags()` 支持行首 `[tag]` 标记，无 tag 规则始终保留 |
| 移除实现细节 | `record-issue-repo-context` 调用、`message-payload` 格式、`conversation` 表查询方法 |

### 11 条实证原则

每条原则均从特性文档中的真实 incident 提取，附有具体 failure mode：

**<identity>**
1. 对判断、行动和输出负责，不当执行器

**<judgment>**
2. 对输入做判断，不把输入当结论
3. 不以表面信号替代语义正确性
4. 用户权威不构成免判断理由

**<execution>**
5. 先识别问题本质，再选择行动方式
6. 完整分析、完整实现
7. 一步到位优先，拆分必须语义闭合
8. 边界变化时更新判断，不执行过期计划

**<scope>**
9. 用户举例只是问题线索，不是范围上限
10. 说明计划后继续执行，不等用户说"继续"

**<rule_discipline>**
11. 修改规则前先判断语义层级归属
12. 不写向后兼容代码

### 数据来源

- 5 个 agent 并行扫描 200+ 篇特性文档（2026/05/06 - 2026/06/23）
- 11 条 feedback memory（`/memory/feedback_*.md`）
- 提取 ~80 条原始原则 → 去重合并 → 最终 12 条

### 移除的规则及理由

| 移除规则 | 理由 |
|----------|------|
| worktree 隔离约束 | 平台运行时约束，非通用行为准则 |
| `--no-verify` 禁令 | 非关键，可由 hook 机制保障 |
| Stage 产物可信 | 由 SOP 层保障，非通用行为准则 |
| 硬约束删除需人类确认 | 不可验证的元规则，防线在代码层（版本控制 + review） |
| 行动前识别五要素 | 认知框架，无法验证是否执行 |
| 新输入判断能否衔接 | 无法验证，"任务边界"是模糊概念 |
| 提问指向待决策项 | 被"不替用户做决定"覆盖 |
| 说明方案时直接表达 | 和"先确认执行还是分析"重复 |
| 工作语言简体中文 | 平台特定约束，非通用行为准则 |
| 输入不是自动成立的事实 | 被"对输入做判断"覆盖 |
| 归属不明时暴露疑惑 | 被"上下文错位先查证"覆盖 |

### 代码变更

| 文件 | 变更 |
|------|------|
| `data/file/prompts/B-01-身份与责任契约.md` | 删除 |
| `data/file/prompts/B-03-运行时边界.md` | 删除 |
| `data/file/prompts/T-01-行为准则.md` | 新建，12 条规则，纯 XML 格式 |
| `src/domain/tenet-prompt/_internal/repository.ts` | 新增 `filterContentByTags()`；移除 frontmatter 解析（5 个方法）；从文件名提取 id/title |

## 验收标准

- [x] `npx tsc --noEmit` 通过
- [x] `npm run build` 通过（lint + tsc + vite）
- [ ] `findByWorkspace` 无 tags 时返回完整内容
- [ ] `findByWorkspace` 带 tags 时正确过滤规则级 tag
- [ ] 无 frontmatter 的 prompt 文件可正常解析
