---
id: F20260701tj92
title: 审查者 GATE-4 引擎强制执行
created: 2026-07-01
status: review
pr_url: https://github.com/chenlaicai/snail-shell/pull/529
issue_id: c9aa88eb-6736-4463-b72f-6fbf1432e739
---

# 审查者 GATE-4 引擎强制执行

## 背景

PR #522 中审查者在 3 轮检视中均未执行 GATE-4（特性编号合规检查），导致遗留格式 `F2026070101` 未被发现。根因分析发现：

- GATE-1~4 定义在 `cd-review/references/workflow.md` 中，是**纯 prompt 指令**
- 引擎 `auto-advance.ts` 的 `getFailedReviewGates()` 只检查 `rev-01`、`rev-02`、`rev-03`（出口门禁）
- GATE-4 没有对应的结构化字段，引擎完全不感知审查者是否执行了编号检查
- 对抗性检查维度（adversarial-check.md）也不覆盖特性编号合规

## [design-time]

### 核心业务行为

1. 当审查者提交 `adversarial_consensus` 信号时，`gate_evidence` 必须包含 `rev-04` 字段，值为特性编号合规验证的证据文本
2. 当引擎校验 review 阶段门禁时，`rev-04` 必须通过格式校验——值必须匹配 `FYYYYMMDDxxxx` 格式（F + 8位日期 + 4位随机码）
3. 当 `rev-04` 缺失或格式不合法时，引擎阻断阶段推进，返回 `GATE_FAILED` 错误
4. 当 `rev-04` 格式合法时，引擎放行；碰撞检查和目录结构验证仍由审查者在 prompt 层执行

### 方案设计

#### 问题链路

```
SOP 定义 GATE-4（prompt 层）
    ↓ 缺失：无结构化字段
引擎无法校验（代码层）
    ↓ 缺失：对抗性检查不覆盖此维度
审查者可跳过（执行层）
```

#### 修复：补全闭环

```
SOP 定义 GATE-4（prompt 层）
    ↓ 审查者将特性编号写入 gate_evidence.rev-04
引擎校验 rev-04 格式（代码层）
    ↓ 格式不合法 → 阻断
审查者无法跳过（执行层）
```

#### 变更范围

| 组件 | 变更内容 |
|------|---------|
| `auto-advance.ts` | `getFailedReviewGates()` 数组增加 `"rev-04"`，并在循环内对 `rev-04` 做额外正则校验（不新建独立方法） |
| `cd-review/references/workflow.md` | GATE-4 描述增加"将特性编号写入 `gate_evidence.rev-04`"的要求 |
| `cd-review/SKILL.md` | exit gate 清单增加 `rev-04` 说明 |

#### 引擎校验逻辑

`rev-04` 的校验在 `getFailedReviewGates()` 内部完成，不新建独立方法：

1. **存在性校验**（与 rev-01~03 一致）：`gate_evidence.rev-04` 必须是非空字符串
2. **格式校验**（新增，仅针对 `rev-04`）：值必须匹配正则 `/^F\d{8}[a-kmnp-z][2-9a-kmnp-z]{3}$/`

格式校验的意义：捕获最常见的违规——使用了错误的编号格式（如遗留的 `FYYYYMMDDNN`）。这是纯结构校验，不需要语义理解。

#### 校验分层边界

| 校验项 | 执行层 | 说明 |
|--------|-------|------|
| 编号格式合法 | 引擎（正则） | `rev-04` 值必须匹配 `FYYYYMMDDxxxx` |
| 编号无碰撞 | 审查者（prompt） | 扫描同日期目录，引擎不覆盖 |
| 文档在正确目录 | 审查者（prompt） | 检查文件路径，引擎不覆盖 |

引擎的 `rev-04` 校验**只保证格式合法**。碰撞检查的正确性依赖审查者 prompt 层执行——审查者写入 `rev-04` 的值即为审查者声称的合法编号，引擎不验证其唯一性。

#### 审查者执行流程（变更后）

阶段一准备阶段，审查者在执行 GATE-4 时：
1. 读取 PR 标题和 Feature 文档，提取特性编号
2. 按 `feature-numbering.md` 规则验证格式合法
3. 扫描同日期目录确认无碰撞
4. 将特性编号写入 `gate_evidence.rev-04`

阶段五提交信号时，引擎自动校验 `rev-04` 格式。

### 设计约束摘要

- 引擎只做结构校验（格式正则），不做语义校验（碰撞、目录）
- `rev-04` 的值是特性编号本身（如 `F20260701tj92`），不是验证结论文本
- 格式校验正则与 `feature-numbering.md` 中的编号规则一致
- 不改变现有 rev-01~03 的校验逻辑

### 已知缺口：GATE-1/2/3 同类结构性断裂

GATE-1（进入 worktree）、GATE-2（基于最新 main）、GATE-3（分支属于当前 issue）同样只有 prompt 约束，没有引擎强制。本次只修 GATE-4，因为 PR #522 暴露的是 GATE-4 漏检。

GATE-1/2/3 的同类修复（增加 `rev-*` 引擎强制）应作为后续改进。根因相同：入口门禁定义在 prompt 层，没有对应的结构化字段供引擎校验。

### 关键决策记录

| 决策 | 依据 | 替代方案 |
|------|------|---------|
| 引擎做格式校验而非仅检查字段存在 | 约束更强，能捕获格式违规；正则校验成本低 | 仅检查非空（与 rev-01~03 一致） |
| `rev-04` 值为特性编号而非验证结论文本 | 引擎可直接用正则校验编号格式；结论文本无法结构化校验 | 写入验证结论文本（引擎只能检查非空） |
| 碰撞检查留在 prompt 层 | 扫描文件系统不适合硬编码在引擎中；碰撞是低概率事件 | 引擎也做碰撞检查（需要文件系统访问，增加复杂度） |

### 变更影响面分析

- **变更类型标签**：feature
- **受影响范围**：
  - `src/app/issue-collaboration/auto-advance.ts` — 引擎门禁校验逻辑
  - `.claude/skills/cd-review/references/workflow.md` — 审查者工作流程描述
  - `.claude/skills/cd-review/SKILL.md` — 审查者 exit gate 清单
- **验证命令预定义**：
  - `npm run check` — TypeScript 编译检查
  - `npm test` — 单元测试（含 auto-advance 相关测试）
