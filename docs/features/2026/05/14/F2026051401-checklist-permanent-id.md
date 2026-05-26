---
id: F2026051401
title: Checklist 永久编号机制与单向前进思维规则
from_ids: []
tags: [checklist]
modules: [project_management]
---
# F2026051401 Checklist 永久编号机制与单向前进思维规则

## 背景

S-03/S-04 的 checklist 使用全局连续编号（1-25），插入一个条目需要重排后续所有编号，维护成本高且脆弱。同时，用户在实际使用中反复遇到 AI 在代码重构时保留兼容代码、引入临时过渡状态的问题，需要在提示词中明确约束。

## 目标

1. Checklist 编号改为永久编号机制，新增/删除条目不影响已有编号
2. 明确编号只作为唯一标识，执行顺序由 section header + 箭头表达
3. 在 B-01 新增"单向前进"思维方式规则和"禁止残留兼容层"禁止项
4. 在 S-03 设计分析和实现环节落地该约束
5. 在 prompt-system-structure.md 补充 checklist 编号规范

## 非目标

- 不改变 checklist 的执行顺序或内容语义
- 不重构 checklist 的 section 结构
- 不修改 R 编号体系（与 checklist 编号是独立的两套系统）

## 设计

### 永久编号机制

- 编号 = 唯一标识，不表达执行顺序
- 执行顺序由 section header 从上到下的排列和 `→` 箭头表达
- 新增条目使用该 checklist 内下一个可用编号，永不重排已有编号
- 删除条目后编号留空，不复用
- 引用格式：`模块ID-checklist #编号`，如 `S-03-checklist #3`

### 单向前进思维规则

在 B-01 计划与拆分规则中新增 R35.5，将"单向前进、不引入残留状态"确立为思维方式层面的要求，覆盖分析、设计、实现全链路。在禁止项中新增 R49，提供具体判断语料。

## 生效路径

- `.meta/prompts/base/B-01-身份与责任契约.md`：R35.5、R49
- `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/S-03-研发者手册.md`：checklist 编号规范说明、设计分析 #25、实现 #10
- `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/S-04-检视者手册.md`：checklist 编号规范说明
- `docs/core/prompt-system-structure.md`：Checklist 编号规范章节

## 改动范围

| 文件 | 改动 |
|------|------|
| `.meta/prompts/base/B-01-身份与责任契约.md` | +R35.5（思维方式）、+R49（禁止残留兼容层）、R49→R50 |
| `.meta/prompts/.../S-03-研发者手册.md` | Development/Review checklist 编号规范、section header 加 `→`、+设计分析 #25、#10 补充兼容层禁令 |
| `.meta/prompts/.../S-04-检视者手册.md` | 主/复检 checklist 编号规范、section header 加 `→` |
| `docs/core/prompt-system-structure.md` | +Checklist 编号规范章节 |

## 验证

- `npm run check` 全部 35 个测试通过
- prompt-assets-test 验证 S-03/S-04 可正常加载和解析

## 风险与决策记录

### 现有引用影响分析

经全仓库搜索确认：**无外部文件引用 S-03/S-04 的 checklist 具体编号**。checklist 编号目前是纯粹的内部标识，没有被任何外部文件、测试或文档引用。本次改为永久编号机制不破坏任何现有引用。

### 编号规范说明格式

编号规范说明使用 `- ` 格式（非 blockquote），确保在 `render_mode: outline` 模式下可被注入运行时提示词。执行顺序在说明文本中明确写出 section 名称序列，不依赖 section header 的 `→` 箭头（outline 模式下 header 不会被注入）。

## 范围变更记录

无范围变更。
