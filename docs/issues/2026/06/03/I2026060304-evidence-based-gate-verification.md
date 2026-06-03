---
id: I2026060304
title: evidence-based-gate-verification
from_ids: []
tags: [process, prompts, governance]
modules: [workflow]
doc_kind: spec
---

# I2026060304 [workflow] 基于证据的阶段门控验证

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

0601-0602 合入了 17 个 commit（10 个 Incompatible），但后续三天持续出现 bug：MCP 改名残留、配置路径不一致、术语重命名遗漏、启动崩溃。每个 PR 都经过了检视流程，但 bug 仍然漏出。

根因分析：AI 存在系统性的完成偏误——"我以为我都改完了"。当前 SOP 的每个阶段都依赖主观判断（"我觉得完成了""我觉得没问题"），缺少客观验证证据的要求。检视流程聚焦代码质量（结构、注释、测试模式），但缺少变更完整性验证（旧引用是否清零、关联配置是否同步、启动是否正常）。

## 目标

### P1 — 证据规则嵌入 SOP 门控

在所有阶段的 gate 机制中嵌入一条核心原则：**用命令输出替代主观判断**。任何 checklist 项标记为 passed 时，必须附带可复查的客观证据（验证命令输出、影响面清单、配置一致性对比），不允许以 "I checked" / "I verified" / "I confirmed" 作为唯一 evidence。

### P2 — 按变更类型定义验证模板

在 task_anchor 中引入变更类型标签（rename / migration / config-sync / refactor / feature / bugfix），每种类型对应一组必须执行的验证命令。开发者和检视者使用同一组命令，结果可比对。

## 非目标

- 不改变现有检视流程的五阶段结构
- 不改变双人交叉审视机制
- 不增加新的阶段或角色
- 不引入自动化 CI 验证（本次只改 SOP 提示词和手册，不改代码）

## 设计

### P1 详设

在 shared handbook 的 Stage Gate 自检章节增加证据规则：
- 每个 passed 的 checklist 项必须附带验证命令+实际输出，或影响面清单+逐条确认，或配置对一致性对比
- 不允许以主观判断作为唯一 evidence

在 development 阶段 acceptance_checklist 增加 dev-06（变更完整性验证），要求开发者根据变更类型执行对应验证命令并将输出写入 gate_evidence。

在 review 阶段 acceptance_checklist 更新 rev-02 描述，要求检视者独立执行同一组验证命令，输出作为检视证据。

### P2 详设

在 task_anchor 结构中增加两个字段：
- `change_type`：变更类型标签（rename / migration / config-sync / refactor / feature / bugfix）
- `verification_commands`：该变更类型对应的验证命令列表

在 designer handbook 的产出锁定阶段增加要求：
- 变更影响面清单（受影响文件/模块/配置）
- 变更类型标签
- 验证命令预定义

在 developer handbook 的验证阶段增加自验 checklist，按变更类型执行对应验证命令。

在 reviewer handbook 的对抗性检查阶段增加证据验证，按变更类型独立执行验证命令。

## 生效路径

本 issue 通过以下长期入口生效：
1. `config/sop/code-delivery/shared.handbook.md` — 证据规则 + 完成标准
2. `config/sop/code-delivery/code-delivery.yaml` — acceptance_checklist 更新
3. `config/sop/code-delivery/design#designer.handbook.md` — 设计产出增加变更影响面
4. `config/sop/code-delivery/development#developer.handbook.md` — 自验 checklist
5. `config/sop/code-delivery/review#reviewer.handbook.md` — 证据验证 + 非阻塞改进步骤
6. `config/sop/code-delivery/review#developer.handbook.md` — 开发者 review 阶段更新
7. `config/sop/code-delivery/merge#merger.handbook.md` — gate 证据完整性硬性检查
8. `.meta/skills/set-task-anchor/SKILL.md` — task_anchor 结构扩展
9. `.meta/prompts/reference/提交.md` — 提交前证据要求
9. `.meta/prompts/reference/检视.md` — 检视证据要求

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 变更类型 |
|---|---|
| `config/sop/code-delivery/shared.handbook.md` | 新增证据规则段落 + 完成标准 |
| `config/sop/code-delivery/code-delivery.yaml` | 更新 acceptance_checklist |
| `config/sop/code-delivery/design#designer.handbook.md` | 产出锁定增加变更影响面 |
| `config/sop/code-delivery/development#developer.handbook.md` | 新增自验 checklist |
| `config/sop/code-delivery/review#reviewer.handbook.md` | 新增证据验证段落 + 非阻塞改进步骤 |
| `config/sop/code-delivery/review#developer.handbook.md` | 更新验证要求 |
| `config/sop/code-delivery/merge#merger.handbook.md` | 新增 gate 证据完整性硬性检查 |
| `.meta/skills/set-task-anchor/SKILL.md` | 扩展 task_anchor 结构 |
| `.meta/prompts/reference/提交.md` | 增加证据要求 |
| `.meta/prompts/reference/检视.md` | 增加证据验证段落 |

## 验证

### P1
- [ ] shared handbook 包含证据规则且禁止 "I checked" 作为唯一 evidence
- [ ] development acceptance_checklist 包含 dev-06
- [ ] review acceptance_checklist rev-02 描述已更新

### P2
- [ ] task_anchor 结构包含 change_type 和 verification_commands
- [ ] designer handbook 产出要求包含变更影响面清单
- [ ] developer handbook 包含按变更类型的自验 checklist
- [ ] reviewer handbook 包含按变更类型的证据验证

### 通用
- [ ] 所有 SOP 文件格式正确、引用路径正确
- [ ] 验证命令模板覆盖 6 种变更类型

## 关联

- **相关**: I2026060108（MCP 改名残留）、I2026060112（配置路径不一致）、I2026060104（术语重命名遗漏）、I2026060301（启动崩溃）— 均为变更完整性问题

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | 证据规则是否会让流程过重 | 证据要求嵌入已有 checklist，不新增阶段；验证命令在 design 阶段预定义，dev/review 只需执行 | 2026-06-03 |
| 2 | 完成标准："没有阻塞"还是"做到最好" | 追求完美，不堵塞是最底线。发现的非阻塞改进必须在当前 PR 修复，不得推到后续 issue。自检清单可选项不是可忽略项，必须评估 | 2026-06-03 |
