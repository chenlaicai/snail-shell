---
id: F2026062201
title: fix-merger-sop-unified-numbering
from_ids: []
tags:
  - process
  - sop
  - bugfix
modules:
  - process
doc_kind: spec
---

# F2026062201 [process] 修复合入者SOP：统一特性编号规则并强制使用squash merge

## 背景

合入者SOP存在两个问题：
1. 合入者多次直接使用merge合入，应该使用squash merge保持main分支历史整洁
2. 合入者未审查出来特性编号不对的问题
3. 特性编号规则不统一，开发/检视/合入各阶段规则不一致

## 目标

1. 统一特性编号规则，贯穿开发、检视、合入全流程
2. 强制使用 Squash Merge 合入 PR
3. 确保特性编号的唯一性和连续性

## 非目标

1. 修改 GitHub branch protection 或 CI check 来强制执行规则（后续单独处理）
2. 处理多 PR 同时待合入时的竞态条件（需要更复杂的机制）

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当合入者检查 PR 时 | 系统应该验证特性编号是当前最新的未使用编号 | - |
| B2 | 当合入者检查 PR 时 | 系统应该强制使用 Squash Merge 合入 PR | - |
| B3 | 当 PR 创建日期较早时 | 系统应该顺延到当前最新的未使用编号 | - |

## 设计

### 1. 统一特性编号规则（`shared.handbook.md`）

**编号格式**：`FYYYYMMDDNN`
- `F`：固定前缀
- `YYYYMMDD`：创建文档当天日期
- `NN`：当天从 `01` 开始的两位自然数递增

**目录结构**：`docs/features/YYYY/MM/DD/FYYYYMMDDNN-kebab-case-title.md`

**获取最新编号方法**：
1. 确定日期：使用创建文档当天日期（YYYYMMDD）
2. 扫描目录：`docs/features/YYYY/MM/DD/`
3. 查找已有编号：找出所有 `FYYYYMMDDNN-*.md` 文件中的最大 NN
4. 计算新编号：最大 NN + 1（如无已有文件则为 01）

**顺延规则**：
- 当 PR 创建日期较早，但合入时已有更新的编号被使用，需要顺延到当前最新的未使用编号
- **日期归属**：顺延后的编号使用合入当天的日期，文档目录也放在合入当天的目录下
- 示例：
  - PR1 昨天创建，编号 F2026062101
  - PR2 今天创建，编号 F2026062201，已合入
  - PR1 要合入时，需要顺延到 F2026062202（今天最新的未使用编号）
  - PR1 的 feature 文档需要移动到 `docs/features/2026/06/22/F2026062202-*.md`

### 2. 更新各阶段手册引用统一规则

**开发阶段**（`development#developer.handbook.md`）：
- GATE-3：严格按照「特性编号规则」获取最新未使用编号

**检视阶段**（`review#reviewer.handbook.md`）：
- GATE-4：严格按照「特性编号规则」验证编号是否为当前最新的未使用编号

**合入阶段**（`merge#merger.handbook.md`）：
- 强制使用 Squash Merge 合入 PR
- 严格按照「特性编号规则」验证编号是否为当前最新的未使用编号

### 3. 更新 YAML 配置（`code-delivery.yaml`）

- output_description：明确要求使用 Squash Merge 合入 PR
- acceptance_focus：添加严格按照「特性编号规则」验证
- acceptance_checklist：
  - 更新 merge-03 描述：严格按照「特性编号规则」验证
  - 新增 merge-05 检查项：明确要求使用 Squash Merge 合入（禁止普通 merge）

## 生效路径

- `data/file/sops/code-delivery/shared.handbook.md`：统一特性编号规则
- `data/file/sops/code-delivery/development#developer.handbook.md`：开发阶段引用
- `data/file/sops/code-delivery/review#reviewer.handbook.md`：检视阶段引用
- `data/file/sops/code-delivery/merge#merger.handbook.md`：合入阶段引用
- `data/file/sops/code-delivery/code-delivery.yaml`：YAML 配置

## 设计约束摘要

- **边界**：特性编号必须唯一，不能重复
- **关键决策**：顺延规则使用合入当天的日期，文档目录也放在合入当天的目录下
- **非目标约束**：不处理多 PR 同时待合入时的竞态条件
- **语义不变量**：特性编号格式必须为 `FYYYYMMDDNN`

## 改动范围

- `data/file/sops/code-delivery/shared.handbook.md`
- `data/file/sops/code-delivery/development#developer.handbook.md`
- `data/file/sops/code-delivery/review#reviewer.handbook.md`
- `data/file/sops/code-delivery/merge#merger.handbook.md`
- `data/file/sops/code-delivery/code-delivery.yaml`
- `docs/features/2026/06/22/F2026062201-fix-merger-sop-unified-numbering.md`

## 验证

- YAML 语法验证通过
- 本地构建和测试通过
