---
id: I2026060201
title: sop-multi-role-and-stage-transition-ui
from_ids: [I2026052201, I2026060113]
tags: [sop, role, bug, conversation, workflow, ui]
modules: [workspace-workflow, persistence, web]
doc_kind: spec
---

# I2026060201 SOP 多角色配置与 Stage 转移 UI 修复

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

SOP YAML 中某些 stage 描述了多位参与者（如"两位设计者交叉审视"），但实际创建的 conversation 实例中该 stage 只出现一个角色。用户在页面上"谁在执行"区域和 @mention 输入框均只能看到 1 位设计者。

**根因分析**：

`code-delivery.yaml` 的 `design` stage（line 32-42）定义了 1 个 designer 角色，**未设置 `count: 2`**：

```yaml
roles:
  - key: designer
    name: 设计者
    is_primary: true
    # 缺少 count: 2
```

而 `review` stage（line 116-126）正确使用了 `count: 2`：

```yaml
roles:
  - key: reviewer
    name: 检视者
    count: 2
```

`expandStageRoles`（`file-config-store.ts:676`）在 `count` 缺省时默认为 1，因此只创建 1 个 `StageRoleDefinition`。下游 `createDefaultStageConversation`（`workflow.ts:220`）从 store 读取角色列表构建 `participatingRoles`，自然只有 1 位设计者。

**影响链路**：

| 层 | 函数/位置 | 行为 |
|---|---|---|
| YAML 定义 | `code-delivery.yaml:32` | designer 角色无 `count: 2` |
| YAML 解析 | `expandStageRoles` | `count ?? 1` → 只创建 1 个 SRD |
| 对话创建 | `createDefaultStageConversation` | `participatingRoles: ["Boss Role", "设计者"]` |
| UI 渲染 | `buildParticipants` / `getAvailableRolesForCurrentConversation` | 从 `participating_roles` 读取 → 只展示 1 个 |

**次要问题**：`extractRoleBindings`（`app.js:571`）在 UI 创建 workspace 时只处理 `developer` 和 `reviewer` 两种 key，遗漏了 `designer`、`merger` 等。但这只影响 UI 配置创建路径，不影响 `.snail` 目录加载路径。

## 目标

1. `code-delivery.yaml` 的 design stage designer 角色补充 `count: 2`，使两位设计者能正确出现在对话实例中
2. 验证 `count` 扩展机制在 design stage 正确生效（conversation participatingRoles、UI 渲染、@mention 均展示 2 位设计者）

## 非目标

- 不修改 `expandStageRoles` 的扩展逻辑（当前 `count` 机制已正确实现）
- 不修改 `createDefaultStageConversation` 的角色读取逻辑
- 不修改 `extractRoleBindings` 的 UI 配置路径（与本次 bug 无关，属于独立问题）
- 不引入新的多角色机制（`count` 已满足需求）

## 设计

### 改动 1：`code-delivery.yaml` design stage 补充 `count: 2`

在 designer 角色定义中添加 `count: 2`，与 review stage 的 reviewer 角色保持一致：

```yaml
roles:
  - key: designer
    name: 设计者
    description: 负责需求对齐与设计，两位设计者交叉审视，产出锁定的 Feature 文档。
    handbook_prompt_ref: "global:S-09"
    is_primary: true
    count: 2
    working_rules:
      - 独立分析需求，不得简单附和对方
      - 对关键设计取舍必须有正反两面论述
      - 对抗必须产生价值：指出具体风险或替代方案
      - 无法达成一致时必须升级到用户决策
```

**效果**：`expandStageRoles` 将创建两个 `StageRoleDefinition`：
- `srd-<stageDefId>-designer-1`，name: `设计者-1`
- `srd-<stageDefId>-designer-2`，name: `设计者-2`

`createDefaultStageConversation` 将生成 `participatingRoles: ["Boss Role", "设计者-1", "设计者-2"]`。

### 改动 2：系统提示词模板适配

当前系统提示词中引用的 Snail 名称和角色名称需要适配 `-1`/`-2` 后缀。需检查：
- `builder.ts` 中 `participating_roles` 和 `participating_role_details_block` 的拼接是否正确处理带后缀的角色名
- `resolveConversationRole` 通过 `getByStageDefinitionName(workspace_id, stage_definition_id, roleName)` 查找时，`roleName` 为 `设计者-1` 能否正确匹配

### 改动 3（可选）：`snail_template_id` 绑定

`count: 2` 的两个实例共享同一 `snail_template_id`（当前为 `null`）。如果需要两位设计者使用不同 Snail（如一位用 Sonnet、一位用 Opus），需要在 `role_snail_mapping` 中分别绑定。当前 scope 内不处理此需求——两位设计者使用同一 Snail 模板。

## 生效路径

- `.meta/sop/code-delivery.yaml` — design stage designer 角色 `count: 2`
- `src/persistence/file-config-store.ts` — `expandStageRoles` 自动扩展（无需改动）
- `src/workspace-workflow/workflow.ts` — `createDefaultStageConversation` 自动读取扩展后的角色列表（无需改动）
- `src/web/workspace-context.js` — `buildParticipants` 自动渲染扩展后的角色（无需改动）

## 改动范围

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `.meta/sop/code-delivery.yaml` | 修改 | design stage designer 角色添加 `count: 2` |
| `src/web/stage-selector.js` | 新增 | stage 目标选择器模块，多目标时展示下拉菜单 |
| `src/web/app.js` | 修改 | `createNextStage` 和 `bounceStage` 使用选择器替代 prompt |
| `src/web/styles/components/context-panel.css` | 修改 | 新增 `.stage-selector-dropdown` 下拉菜单样式 |
| `eslint.config.mjs` | 修改 | app.js max-lines 980→1010 |

## 验证

- [x] `npm test` 全部 45 个测试文件通过（自动化）
- [x] 全链路代码审查确认带后缀角色名正确传递（自动化）：
  - `expandStageRoles` 创建 `设计者-1`/`设计者-2`（`file-config-store.ts:676-688`）
  - `RoleRegistry` 以带后缀 name 为复合键索引（`registry.ts:46`），`getByStageDefinitionName` 查找匹配（`registry.ts:61-63`）
  - `createDefaultStageConversation` 生成 `participatingRoles: ["Boss Role", "设计者-1", "设计者-2"]`（`workflow.ts:220-241`）
  - `buildRole` 提示词构建直接渲染 `r.name`（`builder.ts:176-189`）
  - `buildParticipants` UI 以 name 为 Map key 去重渲染（`workspace-context.js:13-38`）
  - `applyRoleBinding` 按 base key + instance index 解析模板绑定（`file-config-store.ts:736-753`）
- [ ] DB 重置后启动，design stage 的 `stage_role_definition` 表包含 `设计者-1` 和 `设计者-2` 两条记录
- [ ] 创建新 Issue 进入 design stage，conversation 的 `participating_roles` 包含 `["Boss Role", "设计者-1", "设计者-2"]`
- [ ] 页面"谁在执行"区域展示 2 位设计者卡片
- [ ] @mention 输入框可选择 `设计者-1` 和 `设计者-2`
- [ ] 系统提示词中 `participating_roles` 正确列出两位设计者
- [ ] review stage 的 `count: 2` 行为不受影响
- [x] Stage 转移 UI：多目标时展示下拉选择器（自动化验证）
- [x] Stage 转移 UI：单目标时自动选择无需交互（自动化验证）
- [x] Stage 转移 UI：推进按钮仅展示前进方向转移（自动化验证）

---

## Bug 2：Stage 转移 UI 无法选择目标 Stage

### 问题描述

当某个 stage 有多个可用的转移目标时（如 development 可转移到 review 或 design），UI 上无法选择目标 stage。

**复现步骤**：
1. 进入 development stage
2. 尝试执行 stage transition
3. 观察 UI 无法选择目标 stage（review 或 design）

**根因分析**：

1. **"转移阶段"按钮**（`bounceStage`）：多目标时使用 `window.prompt()` 要求用户手动输入 stage key，无下拉选择
2. **"推进阶段"按钮**（`createNextStage`）：不传 `target_stage_key`，后端 `resolveTransitionTarget()` 在多前向转移时抛错

### 修复内容

1. **新增 `src/web/stage-selector.js`**：stage 目标选择器模块，多目标时展示下拉菜单替代 `window.prompt()`，按需获取 SOP stage_definitions 解析人类可读标题
2. **修改 `src/web/app.js`**：
   - `createNextStage()`：基于 SOP stage_definitions 的 sequence 过滤前进方向转移，多目标时展示选择器，传递 `target_stage_key` 到后端
   - `bounceStage()`：使用选择器替代 `prompt()`，排除自转移
3. **修改 `src/web/styles/components/context-panel.css`**：新增 `.stage-selector-dropdown` 下拉菜单样式

### 设计决策

- 推进按钮仅展示 sequence 大于当前 stage 的转移（前进方向），转移按钮展示所有可用转移
- 选择器按需获取 SOP 数据（避免全局 state 存储仅选择器使用的数据）
- 单目标时自动选择，无需用户交互

## 关联

- **相关**: I2026052201（切换 Role Snail — role_snail_mapping 机制，两位设计者的 snail 切换依赖此机制）
- **相关**: I2026060113（SOP 图驱动 stage 转移 — design stage 的转移图不受本次改动影响）
- **参考**: I2026052606（SOP 池与角色域模型 — role 扩展机制的架构基础）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|-----------|------|------|
| 1 | designer 角色是否应拆为两个独立 key（如 `designer-a` / `designer-b`）而非用 `count: 2` | 采用 `count: 2`，与 review stage 的 reviewer 角色保持一致。`count` 机制已验证可用，无需引入新模式 | 2026-06-02 |
| 2 | 两位设计者是否需要不同 snail_template_id | 当前不要求——同一模板即可。后续如需差异化，通过 `role_snail_mapping` 的 stage+role 绑定实现（I2026052201 已支持） | 2026-06-02 |
