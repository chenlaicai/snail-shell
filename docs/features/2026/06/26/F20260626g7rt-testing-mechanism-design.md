---
id: F20260626g7rt
title: testing-mechanism-design
from_ids:
  - F2026060701
  - F2026061703
tags:
  - testing
  - quality
  - ai-native
  - infrastructure
  - sop
modules:
  - project_management
doc_kind: spec
---

# F20260626g7rt [testing] 测试机制设计：Spec-Driven 行为契约测试

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

Snail Shell 经历了三个测试阶段：

1. **v1 早期**：AI 自由编写测试 → 测试全部绑定实现（断言 fetch 参数、内部状态、调用次数），重构时全挂但业务逻辑未变
2. **v1 后期**：删除覆盖率填充式测试（F2026052102）
3. **v2 当前**：全部清零，建立"默认不写测试 + 行为契约守护"范式（F2026060701、F2026061703）

F2026061703 解决了"什么时候写测试"的问题（AI 自行判断，锚定 feature spec），但没有解决"写出来的东西如何不退化为 v1"的问题。当前状态是零测试、零测试依赖、零测试基础设施。

**v1 失败的根因分析**：测试的规格来源是 AI 从代码实现反推的猜测，不是业务规约。AI 的天性是从代码推导测试场景，而不是从 spec 正推。单纯的"行为契约测试"范式（F2026060701）只约束了"怎么写"，没有约束"从哪来"。

**行业佐证**：Meta TestGen-LLM 研究（FSE 2024）显示，AI 生成的测试仅 25% 真正增加有效覆盖率，43% 存在 flaky 或 tautological 问题。Topos/Krv Labs（2026-06）指出"agentic spray problem"——AI 生成的代码通过了测试但不理解仓库。Aviator Runbooks 实验表明 spec-driven 开发将重构期测试维护成本降低 70%。

**人类介入的问题**：当前 SOP（code-delivery）中，每个 stage transition 都需要用户手动调用 `advanceStage()`。用户期望 AI 自行解决大部分问题，只有真正需要人时才转给人，同时 merge 必须控制在手。此问题已拆分为独立 feature 处理。

## 目标

建立测试机制：测试的规格来源是 spec 不是 code，断言外部可观测行为而非内部实现。

> **人类介入决策分层**已拆分为独立 feature（见范围变更 #8），本文档仅覆盖测试机制。

### P1 — 测试基础设施与断言约束

- 建立断言约束规则（禁止断言调用参数，允许断言副作用触发）
- 安装 Vitest + fast-check 依赖
- 配置 Vitest（复用已有 tsconfig 和 path alias）
- 清理项目中残留的过时测试引用

### P2 — SOP 对齐与规则沉淀

- 更新 testing-rules.md：增加 spec 引用规范、断言约束细则、golden-file 和 PBT 使用指南
- 更新 developer handbook：测试编写判断原则增加"规格来源"约束
- 更新 evidence-rules.md：增加测试类型验证命令
- 清理 PR 模板、README 中过时的测试命令引用

## 非目标

- 不要求每个 feature 都写测试——保持 F2026061703 的"AI 自行判断"原则
- 不引入端到端集成测试（需要真实 LLM 调用，非确定性强，成本高）
- 不引入 prompt 质量断言测试（归入 evaluation 机制，非本 feature 范围）
- 不引入 spec 一致性自动检查脚本（红蓝对抗确认此为递归问题，由 design stage 人类审核替代）
- 不建立覆盖率指标或覆盖率门槛
- 不改变 merge 硬门禁——merge 必须由用户控制
- 不包含人类介入决策分层（已拆分为独立 feature，见范围变更 #8）

## 核心业务行为

### 测试机制

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当开发者编写测试时 | 测试文件头部应当包含 spec 引用注释，格式为 `// @spec-ref: FYYYYMMDDxxxx#behavior-N`（建议而非硬约束；CI 不检查，reviewer 人工关注） | — |
| B2 | 当开发者编写断言时 | 禁止使用 `toHaveBeenCalledWith` / `toBeCalledTimes` 等断言调用参数和次数的方法 | — |
| B3 | 当开发者编写断言时 | 允许使用 `toHaveBeenCalled()` 验证副作用触发、`toEqual` / `toBe` 验证返回值和状态变更、`toBeInstanceOf` 验证错误类型 | — |
| B4 | 当测试验证复杂输出时 | 使用 golden-file 模式：生成实际输出，与 `tests/golden/` 下的快照文件 diff，不一致则失败 | — |
| B5 | 当 golden-file 需要更新时 | 必须通过 `UPDATE_GOLDEN=1` 环境变量显式触发，更新必须有独立 commit | — |
| B6 | 当测试验证核心业务逻辑时 | 优先使用 property-based testing（fast-check），定义系统不变量而非枚举输入输出 | — |
| B7 | 当 CI 运行时 | `npm run test` 执行所有测试，无测试时返回成功（不阻塞 PR） | — |
| B8 | 当审查者审查 PR 时 | 有测试则检查断言约束合规性和 spec 引用存在性；无测试时不阻塞 | — |
| B9 | 当架构师编写核心业务行为条目时 | 每条应当满足 S1-S5 质量标准：触发条件具体、预期行为可观测、值得守护、粒度适中、不绑定实现（SOP 级约束，由对抗审视保障，不进 CI 门禁） | — |
| B10 | 当架构师交叉审视时 | 审视者应当对每条行为条目执行 S1-S5 质量检查，不通过的要求修正 | — |

## 设计

### 核心概念一：Spec-Driven 行为契约测试

**规格来源约束**：测试用例的场景必须来源于 feature spec 的核心业务行为列表，不是从代码实现反推。AI 的角色是"把 spec 翻译成可执行断言"，不是"从代码中发现该测什么"。

**为什么 spec 引用是建议而非硬约束**：红蓝对抗确认，CI 门禁只能检查格式存在（`@spec-ref` 注释是否存在），不能检查语义质量（spec 条目是否有意义）。AI 可以生成 `// @spec-ref: TBD` 或 trivially true 的 spec 条目来绕过检查。真正有效的制衡是 design stage 的人类审核 spec，不是 CI 正则匹配。

### 核心概念二：行为条目质量标准（源头治理）

**问题**：测试链条的源头是架构师写的核心业务行为条目。如果条目质量差（trivially true、无法断言、绑定实现），下游的测试再好也是垃圾进垃圾出。当前只有格式要求（"当 X 时，应该 Y"）和粒度检查（不超过 20 行测试），没有质量标准。

**S1-S5 质量标准**：

| 标准 | 规则 | 坏例子 | 好例子 |
|------|------|--------|--------|
| S1 触发条件具体 | 可识别的业务触发，不能是"调用 X 函数" | 当调用 createIssue 时 | 当用户提交 issue 创建表单且必填字段完整时 |
| S2 预期行为可观测 | 返回值/状态/副作用/错误，不能是"正确处理" | 应该正确处理 | 状态应变为 closed，closed_at 应被设置 |
| S3 值得守护 | 被悄悄破坏时用户会受影响（思考框架而非机械规则——迫使架构师自问"如果这条被删掉，谁会发现？"；灰色地带由对抗审视兜底） | getMessage 应返回消息对象（trivially true） | 消息列表应按时间倒序，系统消息排在用户消息之后；AI 应给出有帮助的回复（非确定性，不适用） |
| S4 粒度适中 | 一条 = 一个可测试断言 | 状态变化时应更新状态、发通知、记日志 | 拆为三条独立行为 |
| S5 不绑定实现 | 描述"做什么"不描述"怎么做" | 调用 repository.update 应执行 UPDATE SQL | issue 标题被修改后，重新查询该 issue 时标题应为新值 |

**嵌入点**：
- **架构师 workflow.md 锁定检查**：从"粒度标准"升级为引用完整的 S1-S5
- **架构师 cross-review.md 对抗审视**：增加"每条行为条目是否满足 S1-S5"检查点
- **开发者 testing-rules.md**：引用 behavior-item-guide.md 作为规格来源的质量保障

**设计决策：为什么 S1-S5 是架构师侧约束而非 CI 门禁**：
S1-S5 中的大部分标准（S1 触发条件具体、S2 预期行为可观测、S3 值得守护）是语义级判断，无法用 AST 或正则检查。能用 CI 检查的只有 S4（粒度——条目数量 vs 测试数量的比例）和 S5（不绑定实现——条目中是否包含函数名/表名）。但 S4/S5 的 CI 检查收益有限，不如在对抗审视中由架构师互相检查。

因此 S1-S5 全部作为架构师侧约束（workflow + cross-review），不进 CI 门禁。这与 spec 引用"建议而非硬约束"的决策一致——有效的制衡在流程（对抗审视），不在工具（CI 正则）。

### 三层守护体系

```
┌───────────────────────────────────────────────────────────┐
│ Layer 3: 流程保障                                          │
│ design stage 人类审核 spec + 人类控制 merge                 │
├───────────────────────────────────────────────────────────┤
│ Layer 2: 行为契约测试 (opt-in)                             │
│ spec 引用（建议）+ golden-file / PBT + 断言约束              │
├───────────────────────────────────────────────────────────┤
│ Layer 1: 静态守护 (每次 PR 必须通过)                        │
│ tsc + ESLint + Zod + _internal 边界                        │
└───────────────────────────────────────────────────────────┘
```

### P1 详设：断言约束与测试基础设施

**断言约束规则**：

| 类别 | 允许 | 禁止 |
|------|------|------|
| 副作用验证 | `expect(fn).toHaveBeenCalled()` | `expect(fn).toBeCalledTimes(N)` |
| 参数验证 | — | `expect(fn).toHaveBeenCalledWith(args)` |
| 返回值验证 | `expect(result).toEqual(expected)` | — |
| 状态变更验证 | `expect(db.getState()).toBe(expected)` | — |
| 错误验证 | `expect(error).toBeInstanceOf(ExpectedError)` | — |

**设计决策：为什么允许 `toHaveBeenCalled()` 但禁止参数断言**（红蓝对抗 D5 裁决）：

Snail Shell 基于 hexagonal architecture，port 的实现就是 side effect（WebSocket 推送、数据库写入、agent 进程启动）。验证"当 issue 关闭时是否触发了 WebSocket 推送"必须使用 spy。但断言具体调用参数（如 `toHaveBeenCalledWith({ event: 'issue.closed', payload: {...} })`）会绑定实现细节——当 payload 结构变化时测试会挂，但业务行为没变。

因此：允许断言"副作用是否触发"，禁止断言"副作用的具体参数"。如果需要验证副作用的输出内容，应使用 golden-file 或状态变更断言。

**ESLint 规则实现**：在 `eslint.config.mjs` 中添加 `no-restricted-syntax` 规则，禁止以下调用模式：
- `CallExpression[callee.property.name='toHaveBeenCalledWith']`
- `CallExpression[callee.property.name='toBeCalledTimes']`
- `CallExpression[callee.property.name='toHaveBeenCalledTimes']`

**Vitest 配置**：
- 复用已有 `tsconfig.json`（包含 `tests/**/*`）
- 复用已有 path alias（`@domain/`、`@infra/` 等）
- 测试文件约定：`tests/**/*.test.ts`（已有 ESLint 测试规则块覆盖）

**Golden-file 基础设施**：
- 目录：`tests/golden/<module>/`
- 格式：JSON（diff-friendly）
- 更新机制：`UPDATE_GOLDEN=1 npx vitest run` 时自动更新快照
- 实现：轻量封装 `expect(actual).toMatchGolden('path/to/golden.json')`，约 50 行代码

**Property-based testing**：
- 依赖：`fast-check`
- 使用场景：状态机不变量、数据转换一致性、排序/过滤属性
- 不要求覆盖所有模块，仅用于核心业务逻辑

### P1 详设：清理过时测试引用

| 文件 | 过时内容 | 处理 |
|------|----------|------|
| `tsconfig.json` L26 | `include` 包含 `tests/**/*` | 保留（tests 目录将重新创建） |
| `eslint.config.mjs` L45-52 | `tests/**/*.ts` 规则块 | 保留（复用） |
| `package.json` | 无 `test` script | 新增 `"test": "vitest run"` |
| `package.json` | `prompt:evaluate` 引用不存在的脚本 | 删除或注释 |
| `.github/pull_request_template.md` L32 | `npm run test` checkbox | 保留（将恢复功能） |
| `README.md` L108-113 | `npm run test` 文档 | 更新为实际命令 |

### P2 详设：SOP 对齐

**testing-rules.md 更新**：在已有"行为契约测试范式"基础上增加：

1. **规格来源规则**：测试场景必须来源于 feature spec 核心业务行为，不是从代码反推。建议在测试文件头部添加 `// @spec-ref: FYYYYMMDDxxxx#behavior-N` 注释。
2. **断言约束细则**：完整允许/禁止列表
3. **Golden-file 使用指南**：何时使用、目录约定、更新机制
4. **PBT 使用指南**：何时使用、属性定义示例
5. **测试文件结构**：`tests/<module>/<feature>.test.ts`

**developer handbook 更新**：在"测试编写判断原则"章节增加：
- "测试的规格来源必须是 spec 中的核心业务行为，不是代码实现"
- "断言只允许验证外部可观测行为（返回值、状态变更、副作用触发、错误），禁止断言调用参数和次数"

### 设计决策

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 |
|---|-------|---------|---------|---------|---------|
| D1 | Spec 引用硬约束 vs 建议 | CI 门禁可机械检查，和 `_internal` 规则同类 | AI 可以写 `// Spec: TBD` 绕过，语义质量无法自动检查 | 建议而非硬约束；制衡靠 design stage 人类审核 | 红蓝对抗：语法级检查 ≠ 语义级检查；有效的制衡在流程而非工具 |
| D2 | 测试框架选择 | Vitest 与项目 Vite 生态一致，ESLint 已有测试规则块 | Jest 更成熟 | Vitest | 生态一致性 + 已有配置基础 |
| D3 | 断言约束范围 | 全禁 toBeCalled* 最安全 | side effect 验证需要 | 禁参数/次数，允许触发 | hexagonal architecture port 实现是 side effect |
| D4 | Golden-file 用于确定性还是非确定性输出 | 统一验证方式 | AI 输出非确定性，维护成本高 | 仅用于确定性逻辑（状态转移、数据转换） | 红蓝对抗：`UPDATE_GOLDEN` 机制不适用于非确定性输出 |
| D5 | PBT 是否必须 | 属性是稳定契约，天然抗重构 | 学习曲线、属性定义困难 | 推荐但不强制 | Hypothesis/Claude Code 实验：AI 写 PBT 属性比 example-based 更可靠 |
| D6 | Spec 一致性自动检查 | 理想自动化 | 递归问题 | 不做，人类审核替代 | 红蓝对抗 #6：验证实现 = 测试本身 |
| D7 | 覆盖率指标 | 量化质量 | 激励填充式测试 | 不引入 | Meta 研究 + v1 教训 |
| D8 | 人类介入机制拆分 | P3 与 P1/P2 在设计上相关 | 实现层面完全独立（不同文件、不同风险、不同验证标准）；捆绑会互相阻塞 | P3 拆分为独立 feature | 第二轮红蓝对抗 #11：P3 修改核心协作引擎，风险不匹配 |
| D9 | 行为条目质量标准嵌入点 | CI 门禁可机械检查 | S1-S5 多为语义判断，无法 AST 检查 | SOP 级约束（"应当"），由对抗审视保障，不进 CI 门禁 | 与 spec 引用"建议非硬约束"一致：制衡在流程不在工具 |

<!-- [design-time] 章节结束 -->

## 生效路径

| 入口 | 内容 |
|------|------|
| `data/file/skills/cd-development/references/testing-rules.md` | 测试规则（断言约束、spec 引用、golden-file、PBT 指南） |
| `data/file/skills/cd-development/SKILL.md` | developer handbook 测试编写判断原则更新 |
| `data/file/skills/cd-design/references/behavior-item-guide.md` | 核心业务行为条目质量标准（S1-S5 + 好坏示例） |
| `data/file/skills/cd-design/references/workflow.md` | 锁定检查引用行为条目质量标准 |
| `data/file/skills/cd-design/references/cross-review.md` | 对抗性审视增加行为条目质量检查 |
| `data/file/skills/cd-review/references/adversarial-check.md` | reviewer 测试质量检查更新 |
| `data/file/skills/cd-shared/references/evidence-rules.md` | 测试类型验证命令 |
| `package.json` | `test` script、vitest + fast-check 依赖 |
| `vitest.config.ts` | 测试运行器配置 |
| `eslint.config.mjs` | 断言约束 ESLint 规则 |

## 设计约束摘要

- **边界**：测试只验证外部可观测行为（port 接口的输入/输出/状态变化/副作用/错误），不验证 `_internal` 实现细节
- **关键决策**：断言约束（禁止参数/次数断言，允许触发断言）；spec 引用是建议非硬约束；不引入覆盖率指标；人类介入机制拆分为独立 feature
- **非目标约束**：不写端到端测试；不写 prompt 断言测试；不做 spec 一致性自动检查；不改变 merge 硬门禁
- **语义不变量**：测试的变更触发器必须是"业务规约变了"，不是"实现细节变了"

## 改动范围

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `docs/features/2026/06/26/F20260626g7rt-testing-mechanism-design.md` | 新增 | 本文档 |
| `package.json` | 修改 | 新增 vitest + fast-check 依赖、test script；清理 prompt:evaluate |
| `vitest.config.ts` | 新增 | Vitest 配置（复用 tsconfig path alias） |
| `eslint.config.mjs` | 修改 | 新增断言约束 `no-restricted-syntax` 规则 |
| `data/file/skills/cd-development/references/testing-rules.md` | 修改 | 增加 spec 引用、断言约束、golden-file、PBT 规则 |
| `data/file/skills/cd-development/SKILL.md` | 修改 | 测试编写判断原则增加规格来源约束 |
| `data/file/skills/cd-design/references/behavior-item-guide.md` | 新增 | 核心业务行为条目质量标准（S1-S5 + 好坏示例） |
| `data/file/skills/cd-design/references/workflow.md` | 修改 | 锁定检查引用行为条目质量标准 |
| `data/file/skills/cd-design/references/cross-review.md` | 修改 | 对抗性审视增加行为条目质量检查 |
| `data/file/skills/cd-review/references/adversarial-check.md` | 修改 | 测试质量检查更新 |
| `data/file/skills/cd-shared/references/evidence-rules.md` | 修改 | 增加测试类型验证命令 |
| `README.md` | 修改 | 更新测试命令文档 |
| `.github/pull_request_template.md` | 修改 | 保留 test checkbox（恢复功能） |
| `tests/` | 新增 | 测试目录（初始为空，随 feature 按需添加） |

## 验证

### P1

- [ ] `npm run test` 存在且可执行（无测试时返回成功）
- [ ] `npm run check` 编译通过（含 vitest 类型）
- [ ] ESLint 断言约束规则生效：`toHaveBeenCalledWith` / `toBeCalledTimes` 在测试文件中触发 lint error
- [ ] `toHaveBeenCalled()` 在测试文件中不触发 lint error
- [ ] Vitest 配置正确加载 tsconfig path alias
- [ ] golden-file 基础设施可用：`expect(actual).toMatchGolden('path')` 正常工作
- [ ] `UPDATE_GOLDEN=1` 环境变量触发快照更新

### P2

- [ ] testing-rules.md 包含 spec 引用规范、断言约束细则、golden-file 和 PBT 指南
- [ ] developer handbook 测试编写判断原则包含规格来源约束
- [ ] reviewer handbook 测试质量检查更新为新规则
- [ ] evidence-rules.md 包含测试类型验证命令
- [ ] README.md 测试命令文档更新
- [ ] `package.json` 中 `prompt:evaluate` 过时引用已清理
- [ ] `cd-design/references/behavior-item-guide.md` 包含 S1-S5 标准和好坏示例
- [ ] `cd-design/references/workflow.md` 锁定检查引用 S1-S5
- [ ] `cd-design/references/cross-review.md` 对抗审视增加行为条目质量检查
- [ ] `cd-development/references/testing-rules.md` 引用 behavior-item-guide.md

### 通用

- [ ] 第一轮红蓝对抗 13 个攻击点均有回应或修正
- [ ] 第二轮红蓝对抗 12 个攻击点均有回应或修正（P3 相关已拆分）
- [ ] 与 F2026060701（行为契约测试范式）兼容
- [ ] 与 F2026061703（默认不写测试 + 行为契约守护）兼容
- [ ] 与 F20260626v7s5（stage gate 强制执行）兼容

## 关联

- **前置**: F2026060701（AI 时代测试范式转变：从覆盖率填充到业务行为契约守护）— 本次在此基础上增加 spec 来源约束和断言约束
- **前置**: F2026061703（测试范式 SOP 对齐：默认不写测试 + 行为契约守护）— 本次在此基础上增加测试基础设施和结构性约束
- **相关**: F20260626v7s5（Stage Gate 强制执行）— 人类介入机制拆分为独立 feature 后与此相关
- **前置**: F2026060901（v2 初始化）— 本次在 v2 清零基础上重建测试基础设施

## 分析推理过程记录

### 第一轮红蓝对抗（测试机制）

红队攻击 13 个点，蓝队辩护 6 个维度。关键裁决：

**红队有效打击（产生修正）**：
1. Spec 引用是纸老虎（#1）→ 降级为建议
2. 禁止 toBeCalled* 过于粗暴（#5）→ 改为禁参数/次数、允许触发
3. Spec 一致性自动检查是递归问题（#6）→ 移除，由人类审核替代
4. Golden-file 用于 AI 输出不稳定（#2）→ 限定为仅确定性逻辑

**红队无效攻击（维持原方案）**：
5. PBT 需要人识别属性（#3）→ 项目中状态机/数据转换的属性可枚举
6. 三层验证过度工程（#7）→ Layer 1 基本是已有设施，增量成本低
7. 没解决"AI 改主代码适配测试"（#10）→ 已有测试失败决策树覆盖（F2026061703）

**核心分歧裁决**：
8. "同一个 AI 写 spec 和测试"（#9）→ 蓝队辩护有效：spec 由人类审核（design lock），测试是 spec 的机器可读副本。审核和执行的分离保证了制衡

### 人类介入设计推理（已拆分为独立 feature）

**起点**：用户提出"AI 自行解决大部分问题，真正需要人时才转给人"的期望，同时明确"merge 必须控制在手"。

**分析路径**：
1. 盘点当前 SOP 中所有人类介入点 → 发现每个 stage transition 都是硬门禁
2. 分类所有需要判断力的决策 → 四层模型（价值判断/方向选择/质量守护/合规检查）
3. 识别对抗机制的信号价值 → 对抗共识是最强的质量信号，但当前没有被利用
4. 确认可逆性边界 → design/development/review 可逆（回退 stage），merge 不可逆（代码进 main）
5. 用户确认：merge 必须控制在手 → 确立 merge 为唯一硬门禁

**关键洞察**：
- 当前的门禁是按"阶段"切的，不是按"决策风险"切的
- 对抗共识可以作为人类代理（对抗结构本身提供信息增益）
- Merge 的不可逆性是唯一无法用对抗替代的风险点

**第二轮红蓝对抗后决定拆分**：P3（人类介入机制）修改 `collaboration.ts` 核心引擎，与 P1/P2（测试机制）的实现层面完全独立。捆绑会互相阻塞——P3 的 bug 会阻塞测试基础设施合入。因此 P3 拆分为独立 feature。

### 第二轮红蓝对抗（完整文档）

红队攻击 12 个新点（不重复第一轮），蓝队辩护 7 个维度。

**红队有效打击（产生修正）**：
1. B1 "必须" vs D1 "建议" 矛盾（#1）→ B1 改为"应当"
2. "merge 唯一硬门禁"与 L1 硬门禁矛盾（#2）→ 澄清措辞；P3 拆分后此矛盾在本文档中消除
3. auto-advance vs "永远不要自动推进 Stage"（#3）→ P3 拆分为独立 feature 后另行处理
4. [Incompatible] 时间悖论（#4）→ P3 拆分后不在本文档范围
5. 风险分层缺乏可执行机制（#5）→ P3 拆分后不在本文档范围
6. B13 "2 轮"依据缺失（#7）→ P3 拆分后不在本文档范围
7. P3 应拆分为独立 feature（#11）→ 采纳

**红队攻击但 P3 拆分后不在本文档范围**：
8. 对抗共识关联失败（#6）→ P3 独立 feature 需要处理
9. Golden-file 与状态断言区别模糊（#8）→ 实现阶段给出具体示例
10. 修改核心引擎风险（#9）→ P3 独立 feature 需要风险评估
11. 缺少审计/回滚（#10）→ P3 独立 feature 需要覆盖
12. PBT 缺具体示例（#12）→ 实现阶段给出具体属性定义

**蓝队诚实承认的弱点**：
1. AI 自动推进的可观测性未定义（通知形式、醒目标记）
2. `collaboration.ts` 改动复杂度（与 dispatch lock、abort 机制的交互）
3. L1 决策的边界模糊（风险评估本身可能是 L2 决策——递归问题）

### 第三轮红蓝对抗（S1-S5 行为条目质量标准）

红队攻击 6 个点，蓝队辩护 6 个维度。

**红队有效打击（产生修正）**：
1. B9 "必须" vs D9 "不进 CI" 执行真空（#1）→ B9 改为"应当"，标注 SOP 级约束
2. S5 好例子违反自身规则（#3）→ 修正为"重新查询时标题应为新值"
3. B11 与 S4 功能重叠（#4）→ 删除 B11
4. S3 主观性 + 非确定性反例缺失（#2, #6）→ S3 标注为思考框架，补充反例

**红队攻击但承认为结构性限制**：
5. 同一 LLM 对抗审视的关联失败（#5）→ 文档已在多处承认此风险；S1-S5 的好坏示例作为 few-shot 锚点部分缓解；design lock 人类审核是最终兜底

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|-------|---------|---------|---------|---------|--------|------|
| D1 | Spec 引用硬约束 vs 建议 | CI 可机械检查 | AI 可绕过语义质量 | 建议；制衡靠人类审核 | 红蓝对抗 #1 | 红队+蓝队 agent | 2026-06-26 |
| D2 | 测试框架 | Vitest 生态一致 | Jest 更成熟 | Vitest | 已有 Vite 生态 | 红蓝共识 | 2026-06-26 |
| D3 | 断言约束范围 | 全禁最安全 | side effect 验证需要 | 禁参数/次数，允许触发 | hexagonal arch port=side effect | 红队 #5 | 2026-06-26 |
| D4 | Spec 一致性自动检查 | 理想自动化 | 递归问题 | 不做 | 验证实现=测试本身 | 红队 #6 | 2026-06-26 |
| D5 | 覆盖率指标 | 量化质量 | 激励错误行为 | 不引入 | Meta+ v1 教训 | 用户 | 2026-06-26 |
| D6 | 人类介入机制拆分 | P3 与 P1/P2 设计上相关 | 实现独立、风险不匹配、捆绑阻塞 | 拆分为独立 feature | 第二轮红蓝对抗 #11 | 红队+裁判 | 2026-06-26 |

## 范围变更记录

| # | 变更类型 | 变更内容 | 原因 | 日期 |
|---|----------|----------|------|------|
| 1 | 修正 | Spec 引用从硬约束降级为建议 | 红蓝对抗 #1：CI 门禁只能检查格式，不能检查语义 | 2026-06-26 |
| 2 | 修正 | 断言约束从"禁止 toBeCalled*"改为"禁止参数/次数，允许触发" | 红蓝对抗 #5：hexagonal architecture 中 side effect 验证是合理需求 | 2026-06-26 |
| 3 | 移除 | 删除 spec 一致性自动检查 | 红蓝对抗 #6：递归问题 | 2026-06-26 |
| 4 | 限定 | Golden-file 仅用于确定性逻辑 | 红蓝对抗 #2：AI 输出非确定性 | 2026-06-26 |
| 5 | 新增 | 增加人类介入决策分层（P3） | 用户提出"度如何把握"问题 → 分析推导出四层模型 | 2026-06-26 |
| 6 | 新增 | 增加分析推理过程记录章节 | 用户要求记录设计推理过程 | 2026-06-26 |
| 7 | 约束 | 明确 merge 为唯一硬门禁 | 用户明确要求：merge 必须控制在手 | 2026-06-26 |
| 8 | 拆分 | P3（人类介入决策分层）拆分为独立 feature | 第二轮红蓝对抗 #11：实现层面与 P1/P2 完全独立，捆绑会互相阻塞；P3 修改核心协作引擎 `collaboration.ts`，风险不匹配 | 2026-06-26 |
| 9 | 修正 | B1 "必须"改为"应当" | 第二轮红蓝对抗 #1：B1 "必须"与 D1 "建议"直接矛盾 | 2026-06-26 |
| 10 | 修正 | 三层守护体系图移除人类介入相关内容 | 第二轮红蓝对抗 #2：P3 拆分后，本文档不再包含人类介入机制 | 2026-06-26 |
| 11 | 新增 | 增加核心概念二：行为条目质量标准（S1-S5） | 用户指出测试链条的源头——架构师写的行为条目——缺乏质量标准；坏条目导致坏测试 | 2026-06-26 |
| 12 | 修正 | B9 "必须"改为"应当"，标注为 SOP 级约束 | 第三轮红蓝对抗 #1：与 B1 同构的"必须"vs"不进 CI"执行真空 | 2026-06-26 |
| 13 | 修正 | S5 好例子从"数据库中 title 字段"改为"重新查询时标题应为新值" | 第三轮红蓝对抗 #3：原好例子违反 S5 自身规则（绑定持久层实现） | 2026-06-26 |
| 14 | 删除 | 删除 B11（开发者能翻译为不超过 20 行测试） | 第三轮红蓝对抗 #4：与 S4 功能重叠，缺乏增量价值 | 2026-06-26 |
| 15 | 修正 | S3 标注为"思考框架而非机械规则"，补充非确定性反例 | 第三轮红蓝对抗 #2：S3 主观性问题无法消除，明确标注其定位 | 2026-06-26 |
