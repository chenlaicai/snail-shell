---
feature_ids: [F2026052503]
related_features: [F2026052303, F2026052502]
topics: [project-root, overlay, sop, prompt-center, skill-center]
doc_kind: spec
created: 2026-05-25
---

# F2026052503 project_root 与项目级 overlay 加载

> **Status**: spec | **Owner**: terrenceeLeung

## 背景

Snail Shell 自举系统把「平台运行时」与「被开发的项目」物理坍缩在同一个 `process.cwd()`。当前 SOP 配置散布在四层里，没有单一真相源：

| 层 | 位置 | 内容 |
|---|---|---|
| 种子 JSON | `.meta/project-config-seed.json` | stage 定义（key/title/sequence/产物契约/验收标准）+ role 定义（name/working_rules/snail_template_id） |
| DB 表 | `project_stage_definition` + `stage_role_definition` | 种子 JSON 的持久化副本，启动时 `main.ts:137` 灌入 |
| 硬编码 | `workflow.ts:39` | `["development","review"]` 线性推进，转移规则写死在代码里 |
| 提示词模板 | F-01 frame + S-03/S-04 handbooks | 按 stage/role 条件路由注入领域知识，角色-手册映射硬编码 |

具体问题：

- agent 子进程全部 `cwd: process.cwd()`（`codex.ts:153`、`stateful-cli-agent.ts:158`）；
- prompt/skill 从 `process.cwd()/.meta/` 全局加载，无 project 参数；
- `project` 表无工作目录字段；
- F-01 frame 把角色手册写死（`{{#when:roles=研发者}}{{prompt:S-03}}`），用户自定义角色的手册拼不进来。

## 目标

### P1 — 工作目录绑定（可单独成 PR）

`project` 增加 `project_root`；agent 启动 `cwd` 从 `project_root` 读取，取代写死的 `process.cwd()`。

配置策略：
- `system_self` 项目：`project_root` 默认 runtime cwd（当前行为不变）。
- 外部项目：创建时必须指定 `project_root`（通过 seed JSON 或未来 API），值为绝对路径。
- 校验：project 加载时检查路径存在且可读，否则报可诊断错误（含路径和 project id），不静默跳过。

### P2 — 三加载器项目级 overlay（可单独成 PR）

SOP / prompt / skill 三者共享同一套 overlay 模式：两级 scope `global | project`、`(scope, scope_ref, key)` 寻址、project-aware 解析、按 scope 路由。

| | core-base（平台维护） | project-overlay（`<project_root>/.snail/`） |
|---|---|---|
| SOP | 平台 SOP（如 `code-delivery`） | 项目 SOP |
| prompt | 平台 prompt（B/F/S 系列） | 领域角色手册 |
| skill | 平台 skill | 域 skill |

具体三件：

1. **SOP 独立池**：`sop(id, scope, scope_ref, key)`；唯一键 `(scope, scope_ref, key)`，global 的 `scope_ref=null`，project 的 `scope_ref=project.id`。`stage_definition` 父 → `sop_id`；`feature` + `adopted_sop_scope`/`adopted_sop_key` 整套采用（不加 `adopted_sop_scope_ref` 字段——`scope=project` 时 `scope_ref` 由 `feature.project_id` 派生，`scope=global` 时为 `null`）；`stage_role_definition` 去 `snail_template_id`（见下方 snail 绑定来源）。`sop` 表 schema 保持精简（stages + roles），不预留 gate 字段。
2. **snail 绑定来源**：`snail_template_id` 从 `stage_role_definition` 移除后，初始 role→template 映射来源为 project 级默认配置 `project.role_template_defaults`（JSON，按 `[sop_scope][sop_key][stage_key][role_name]` 四级定位到 `snail_template_id`；`sop_scope` 区分 global/project 同 key SOP，project 的 `scope_ref` 由 `project.id` 派生无需存入 key）。Feature 创建时按 adopted SOP 从 project 默认快照到 `feature.role_snail_mapping`（按 `[stage_id][role_name]` 存储），可 feature 级覆盖。校验：adopted SOP 的每个 agent role 必须在 mapping 中有对应 template，否则 feature 创建报错。
3. **prompt / skill 改 project-aware**：`buildConversationCapability(context)` 加 project-overlay 扫描根 + `(scope, scope_ref, key)` 路由解析 + 缓存。
4. **overlay 冲突规则**：每类资源（SOP / prompt / skill）的命名空间为 `(scope, scope_ref, key)`。同 scope 同 scope_ref 下 key 重复 = 加载错误。跨 scope 同 key 不冲突，不合并，不 fallback——global 和 project 是隔离命名空间。
5. **角色 → 手册解耦**：role 定义携带 `handbook_prompt_ref`（scope-qualified 引用：`global:S-03` 或 `project:my-handbook`；bare key 默认解析为所属 SOP 同 scope）；F-01 frame 去掉硬编码 `{{#when:roles=研发者}}{{prompt:S-03}}`，改为遍历当前 stage 的 role、按各自 `handbook_prompt_ref` 动态注入。

## 非目标

- **SOP gate schema / 状态机外化**（O8 #256）：stage 转移边上的 gate 条件（required_artifacts / acceptance / force_override）、配置化状态机图、agent 提议 → runtime 校验。
- **SOP.md 文件格式 / .md 解析器**：SOP 定义的终态载体（.md 文件 vs DB vs 共存）尚未拍案。本 feature 沿用 seed JSON → DB 路径。
- **统一 transition API**（O8 之后）：UI/MCP/CLI 三入口的 `advanceStage(feature, target, actor, evidence, force?)` 统一 surface。
- **UI 改动**：本 feature 纯 backend。project 设置、SOP 选择、看板 stage 流转等 UI 增强作为独立 feature。
- **SOP 继承/覆盖**：近全局微定制走 clone，drift 记为已知 trade-off。
- **独立 workspace 实体、多租户**。
- **FeatureStatus 清理**：已合入 F2026052303。

## 设计

域模型见 RFC #247。核心三句话：**Global SOP 定义"我怎么干"，Project SOP 定义"我们怎么干"，Feature 接在一起：在哪干（`project_root`）/ 用哪套规范（adopted SOP）/ 用哪个模型（`role_snail_mapping`）。**

- **作用域阶梯** `global → project → feature → stage`；runtime 是控制面，不是作用域一级。
- **overlay 解析顺序** `global → project → feature/stage`，统一挂在 `buildConversationCapability`；守边界：SOP/role/overlay 是内部编排概念，不泄进 #248 ACP 协议。
- **生命周期分离**：core-base 随 Snail Shell 升级；project-overlay 随项目演进。两者按 scope 路由解析，不混。
- **根分离**（O6）：`project_root` 只是目录，不假设 git。
- 与 F2026052502（渐进式披露 / query-current-context）方向一致：overlay 也是按需、按作用域取。

## 生效路径

- 代码 `src/`：`project.project_root` + `project.role_template_defaults`；`sop` 池表（含 `scope_ref`）+ `feature.adopted_sop_*`；`stage_role_definition` 去 snail 字段 + 加 `handbook_prompt_ref`（scope-qualified）；agent cwd；`buildConversationCapability` project-aware 加载（含 overlay 冲突检测）；F-01 frame 角色手册动态注入。
- `.meta/` 拆 core-base（留平台）/ project-overlay（`<project_root>/.snail/`）。
- `docs/README.md` 更新为两层入口（runtime-core + project-overlay）。

## 改动范围

- `src/persistence/schema.ts` / `store.ts` / `project-config-model.ts`：`project.project_root` + `project.role_template_defaults`；`sop` 池（含 `scope_ref`，唯一键 `(scope, scope_ref, key)`）；`stage_definition` 父；`stage_role_definition` 去 snail + 加 `handbook_prompt_ref`（scope-qualified）；`feature.adopted_sop_*`；feature 创建时 mapping 校验。
- `src/agent/*`：spawn cwd。
- `src/prompt-center/builder.ts` / `registry.ts`、`src/skill-center/registry.ts`：project-overlay 扫描根 + `(scope, scope_ref, key)` 路由 + 缓存 + 冲突检测。
- `.meta/prompts/frames/F-01-*.md`：角色手册动态注入（扩 frame engine 或 builder 层 role 遍历）。
- `.meta/` 目录组织；`.meta/project-config-seed.json`。
- `tests/`：见验证。

## 验证

- [ ] `project_root` 指向非 cwd 目录的 project，agent 在该目录内运行。
- [ ] `project_root` 路径不存在时，project 加载报可诊断错误（含路径和 project id）。
- [ ] `system_self` project 未设 `project_root` 时默认 runtime cwd，行为不变。
- [ ] project 的 `<project_root>/.snail/` 下放专属 SOP/skill/角色手册，被加载生效，不污染其他 project。
- [ ] 两个 project 分别有同 key 的 project-scope SOP，`scope_ref` 隔离正确，不串台。
- [ ] 同 scope 同 scope_ref 下 key 重复的 prompt/skill 触发加载错误。
- [ ] 自定义角色声明 scope-qualified `handbook_prompt_ref` 后，手册能拼进 system prompt。
- [ ] Feature 创建时，adopted SOP 的每个 agent role 在 `role_snail_mapping` 中有对应 template；缺失时报错。
- [ ] SOP 池：feature 能各采用 global / project SOP 一套，`(scope, scope_ref, key)` 解析正确。
- [ ] 同一 project 同时可见 `global:code-delivery` 和 `project:code-delivery` 时，feature 采用不同 SOP 快照到各自的 role template defaults，不串。
- [ ] 自研 project（`kind=system_self`）不回归。
- [ ] tsc / lint / 测试全过。

## 关联

- **前置**: #247（RFC runtime-workspace 域模型，已拍案）
- **前置**: #248（ACP，唯一组装入口 `buildConversationCapability`）
- **前置**: F2026052303（FeatureStatus 死代码清理，已合入 #252）
- **相关**: F2026052502（渐进式披露 / query-current-context，#260）
- **阻塞**: #256（O8 SOP 执行引擎，依赖本 feature 的 SOP 池可加载）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|-----------|------|------|
| 1 | 跨 project 数据串台（单库） | 数据访问边界用 project-scoped 句柄强制 `project_id` 过滤（`ConversationStore` God-node），不散在 call site | 2026-05-23 |
| 2 | frame 引擎无 role 遍历构造 | 当前只有 `{{#when}}`/`{{#if}}`/`{{variable}}`/`{{prompt:ID}}`，实现必须扩 frame engine 或在 builder 层完成 role 遍历注入 | 2026-05-25 |
| 3 | 抽象锁定 | 只把高置信结构做实（`project_root`、SOP 池、`adopted_sop_*`、`handbook_prompt_ref`），machinery 增量补 | 2026-05-23 |
| 4 | SOP 机制保持现状是否阻塞 P1+P2 | 不阻塞（CVO 确认）。SOP gate / 状态机外化 / SOP.md 格式独立推进。`sop` 表 schema 保持精简，gate 字段待 O8 定义后再加 | 2026-05-25 |
| 5 | SOP.md vs DB 作为 SOP 真相源 | 未拍案。两者可共存（.md = 源码，DB = 运行时缓存）。本 feature 沿用 seed JSON → DB，不引入 .md 解析 | 2026-05-25 |
| 6 | UI 是否需要改动 | 本 feature 纯 backend，不改 UI。UI 增强（project 设置、SOP 选择、看板流转）作为独立 feature | 2026-05-25 |
| 7 | SOP project scope 缺 `scope_ref` 会串 project（review 退回） | 补 `scope_ref` 字段，唯一键改为 `(scope, scope_ref, key)`；global `scope_ref=null`，project `scope_ref=project.id` | 2026-05-25 |
| 8 | `snail_template_id` 移除后初始绑定来源不明（review 退回） | 新增 `project.role_template_defaults`；feature 创建时快照到 `role_snail_mapping`；校验每个 agent role 有 template | 2026-05-25 |
| 9 | `project_root` 缺可执行配置入口（review 退回） | `system_self` 默认 cwd；外部 project 创建时必须指定绝对路径；路径不存在报可诊断错误 | 2026-05-25 |
| 10 | overlay 冲突规则缺失（review 退回） | 同 scope+scope_ref 下 key 重复 = 加载错误；跨 scope 同 key 不冲突不 fallback；`handbook_prompt_ref` 改为 scope-qualified | 2026-05-25 |
| 11 | `role_template_defaults` 用 role name 做 key 会压扁多 SOP/多 stage 场景（review R2 退回） | 改为 `[sop_key][stage_key][role_name]` 三级定位；feature 快照按 `[stage_id][role_name]` 存储 | 2026-05-25 |
| 12 | `adopted_sop_*` 缺 `scope_ref` 解析规则（review R2） | 不加冗余字段：`scope=project` 时 `scope_ref` 由 `feature.project_id` 派生，`scope=global` 时为 `null` | 2026-05-25 |
| 13 | `role_template_defaults` 用 `sop_key` 定位不区分 global/project 同 key SOP（review R3） | 改为四级 `[sop_scope][sop_key][stage_key][role_name]`，`sop_scope` 区分 global/project | 2026-05-25 |

## 范围变更记录

- 2026-05-25：编号从 F2026052303 更正为 F2026052503（F2026052303 已被 #252 占用）；并入架构师 2026-05-24 回复的三加载器同构 + `handbook_prompt_ref` + scope 路由 + 生命周期分离。
- 2026-05-25（CVO 讨论，重写整合）：
  - 补充 SOP 四层现状分析（seed JSON / DB / workflow.ts / prompts）作为背景。
  - 明确非目标：SOP gate schema、SOP.md 解析、统一 transition API、UI 改动均不在范围。
  - SOP gate 方向记录：gate 是 stage 转移边上的条件原语；终态支持 UI 或 .md 配置 gate，agent 提议 + human force override，三入口统一 API。属于 O8+。
  - SOP.md vs DB 未拍案但不阻塞：两者可共存（.md = 源码，DB = 运行时缓存），本 feature 沿用 seed JSON → DB。
  - 本 feature 纯 backend，不改 UI。
  - 格式对齐新模板：添加 Status/Owner 行、关联 section、风险与决策改表格。
- 2026-05-25（GPT-5.5 design review 退回 4 点，修复）：
  - 补 SOP `scope_ref` 字段 + 唯一键 `(scope, scope_ref, key)`，解决多 project 同名 SOP 串台。
  - 新增 `project.role_template_defaults` 作为 `snail_template_id` 移除后的初始绑定来源，feature 创建时快照 + 校验。
  - P1 补充 `project_root` 配置策略：`system_self` 默认 cwd，外部 project 必须指定绝对路径，路径不存在报可诊断错误。
  - 新增 overlay 冲突规则：同 namespace key 重复 = 加载错误，跨 scope 不冲突不 fallback；`handbook_prompt_ref` 改为 scope-qualified 引用。
- 2026-05-25（GPT-5.5 design review R2，修复）：
  - `role_template_defaults` key 从 role name 改为 `[sop_key][stage_key][role_name]` 三级定位，避免多 SOP/多 stage 同名 role 压扁。
  - `adopted_sop_scope_ref` 不加冗余字段，明确派生规则：`scope=project` → `feature.project_id`，`scope=global` → `null`。
  - 文本一致性：改动范围 `(scope,key)` → `(scope, scope_ref, key)`；`研発者` → `研发者`；风险 #2 "待确认" → 确定性结论。
- 2026-05-25（GPT-5.5 design review R3，修复）：
  - `role_template_defaults` 第一层从 `sop_key` 改为 `[sop_scope][sop_key]` 四级定位，覆盖 global/project 同 key SOP 场景。
  - 验证项补：同一 project 可见 global 和 project 同 key SOP 时，feature 快照不串。
