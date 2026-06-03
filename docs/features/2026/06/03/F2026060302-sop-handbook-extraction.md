---
id: F2026060302
title: sop-handbook-extraction
from_ids: []
tags: [sop, prompts, context-optimization]
modules: [persistence, prompt-center]
doc_kind: spec
---

# F2026060302 [sop] SOP 角色手册外提与结构重构

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

SOP YAML 文件 `config/sop/code-delivery.yaml` 达到 50KB / 810 行，主要原因：
1. 角色手册（handbook）以 YAML 多行字符串内联嵌入，每个 role 的 handbook 包含完整工作流程、规则和自检清单
2. developer handbook 在 development 和 review 两个 stage 间近似重复（仅前几条工作规则不同，其余 ~200 行完全相同）
3. review 阶段的 developer handbook 携带了 development 阶段的完整工作流程（环境准备→实现→验证提交），与当前 stage 职责无关
4. PR 评论签名模板和 Stage Gate 自检机制在 4 个 role handbook 中逐字重复
5. 工作规则带有 `[全阶段]`、`[实现中]` 等范围前缀——这些前缀在规则内联到 SOP role handbook 后已冗余（规则所在位置即隐含其作用域）

## 目标

### P1 — 消除跨 stage 内容混杂

- development 阶段的 developer handbook 只保留开发阶段职责，移除 Review 工作流程、Issue 收口和 review 阶段约束
- review 阶段的 developer handbook 只保留检视回应职责，移除 Development 工作流程
- designer GATE 与 developer GATE 对齐（严禁主目录修改、已合入文档不得二次修改等）

### P2 — SOP 结构重构

- 新增 SOP 级 `shared_handbook` 字段，存放所有 role 共用的规则（PR 签名模板、Stage Gate 自检）
- 移除所有工作规则的范围前缀（`[全阶段]`、`[实现中]`、`[设计阶段]`、`[检视中]`、`[交叉审视]`、`[协作]`、`[合入中]`）
- 将 handbook 外提为独立 `.handbook.md` 文件，SOP 目录结构从单文件变为同名目录
- reviewer handbook 从 `reviewer-handbook` skill 内联到 SOP（role 职责应在 SOP 中，skill 回归原子操作定位）

## 非目标

- 不修改 `reviewer-handbook` skill 文件本身（skill 内容清理作为后续独立 issue）
- 不修改 `evolution.yaml`（不涉及 code-delivery SOP）
- 不修改平台提示词文件（B-01~S-06）

## 设计

### P1 详设

**跨 stage handbook 拆分**：
- development developer handbook：保留环境准备→设计确认→实现→验证提交完整流程，移除 Review 工作流程和 Issue 收口
- review developer handbook：仅保留请求检视→处理意见→收口流程，不含开发阶段工作流
- 自检清单按 stage 职责裁剪（development 不含 Issue 收口行，review 不含环境准备行）
- designer GATE 补齐：GATE-1 增加"严禁主目录修改"，GATE-3 增加"已合入文档不得二次修改"，GATE-4 对齐写法

**跨 role 共享内容处理**：
- 场景细则（合并/变基冲突、错误修复、字段变更）保留在 development 和 review developer handbook 中——内容恰好相同但属于各 role 的遵守规则，不提取到 shared
- Stage Gate 自检机制提取到 shared_handbook——所有 role 共用同一套流程

### P2 详设

**shared_handbook**：
- SOP 顶层字段，包含 PR 评论签名模板（用 `<角色名>` 占位）和 Stage Gate 自检流程
- builder 在注入 role handbook 之前先注入 shared_handbook
- 模板变量（`{{stage_acceptance_checklist_block}}`、`<Snail 名称>`）在渲染时替换

**handbook 外提**：
- 目录结构：`config/sop/<sop-key>/<sop-key>.yaml` + `<stage-key>#<role-key>.handbook.md`
- YAML 中 handbook 字段用 `@` 前缀引用文件：`handbook: "@design#designer.handbook.md"`
- `file-config-store.ts` 的 `loadSopDir` 新增目录扫描逻辑
- `loadSingleSopFile` 新增 `resolveHandbookFileRefs` 方法，加载时一次性读入文件内容

**范围前缀移除**：
- 所有 `[全阶段]`、`[实现中]`、`[设计阶段]`、`[检视中]`、`[交叉审视]`、`[协作]`、`[合入中]` 前缀删除
- 规则所在位置（stage-specific role handbook）已隐含其作用域

**reviewer handbook 内联**：
- 从 `reviewer-handbook` skill 提取 5 阶段工作流程、4 GATE、复检流程到 SOP reviewer handbook
- SOP 中原有的 `[检视中]` 规则与 skill 内容合并，消除重复
- skill 保留不变，后续独立 issue 处理

## 生效路径

- `config/sop/code-delivery/` 目录结构和 handbook 文件：通过 `file-config-store.ts` 加载到内存
- `shared_handbook` 字段：通过 `Sop` domain type → `builder.ts` → system-reminder 注入
- `@` 引用机制：`file-config-store.ts` 的 `resolveHandbookFileRefs` 在加载时解析

## 改动范围

- `config/sop/code-delivery.yaml` → 删除，替换为 `config/sop/code-delivery/` 目录
- `config/sop/code-delivery/code-delivery.yaml` — SOP 结构定义（120 行）
- `config/sop/code-delivery/*.handbook.md` — 5 个 role handbook 文件
- `src/shared/domain-types.ts` — `Sop` 增加 `shared_handbook`，`WorkspaceStageDefinition` 增加 `sop_id`
- `src/persistence/file-config-store.ts` — `SopYamlFile` 增加 `shared_handbook`，新增目录扫描和 `@` 引用解析
- `src/prompt-center/builder.ts` — `PromptBuildContext` 增加 `sharedHandbook`，`buildRoleContent` 先注入 shared 再注入 role
- `src/workspace-workflow/manager-collaboration.ts` — 从 store 获取 `shared_handbook` 传入 builder

<!-- [design-time] 章节结束 -->

## 验证

### P1

- [ ] development developer handbook 不包含 Review 工作流程
- [ ] review developer handbook 不包含 Development 工作流程
- [ ] designer GATE 包含"严禁主目录修改"和"已合入文档不得二次修改"
- [ ] 所有 handbook 无 `[全阶段]` 等范围前缀

### P2

- [ ] `config/sop/code-delivery/code-delivery.yaml` 存在且 YAML 合法
- [ ] 5 个 `*.handbook.md` 文件存在且可被 `@` 引用解析
- [ ] `shared_handbook` 包含 PR 签名模板和 Stage Gate 自检
- [ ] TypeScript 编译通过（`npx tsc --noEmit`）
- [ ] `file-config-store.ts` 能正确加载目录结构的 SOP

### 通用

- [ ] 系统提示词注入的 handbook 内容与原单文件版本语义一致（无内容丢失）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | handbook 外提后 builder 需要额外文件 IO | 加载时一次性读入内存，运行时无额外 IO | 2026-06-03 |
| 2 | `#` 作为文件名分隔符是否与系统保留字符冲突 | macOS/Linux 文件系统允许 `#`，Windows 不允许——当前部署环境为 macOS，后续如有 Windows 需求再调整 | 2026-06-03 |
| 3 | reviewer-handbook skill 与 SOP 内联内容重复 | 本次只做 SOP 侧内联，skill 清理作为后续独立 issue | 2026-06-03 |
