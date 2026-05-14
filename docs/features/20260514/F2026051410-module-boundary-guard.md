# F2026051410 模块边界守护

## 背景

PR #172 完成了模块结构重构，划分了 8 个职责清晰的模块，并定义了单向依赖方向。但当前缺乏自动化机制来守护这些边界，开发者可能无意中违反依赖方向，导致模块耦合重新恶化。

## 目标

1. 添加 ESLint 规则，自动检查模块间导入方向是否正确
2. 更新检视者手册，增加架构边界检查项，形成流程保障

## 非目标

1. 不修复已知的 `persistence → meta` 边界违反（meta 目录后续会被移除）
2. 不添加循环依赖检测工具（后续按需引入）
3. 不修改模块内部实现

## 设计

### 依赖方向定义

根据 F2026051307 定义的依赖方向：

```
shared ← persistence
shared ← prompt-center ← skill-center
shared ← snail-den (← agent/)
shared ← message-bus (← persistence)
以上全部 ← project-workflow
以上全部 ← knowledge-center
以上全部 ← interaction-entry
```

### ESLint 规则设计

使用 `@typescript-eslint/no-restricted-imports` 规则（ESLint 9+ / typescript-eslint 推荐方式），按模块定义允许的导入源：

| 模块 | 允许导入的模块 | 备注 |
|---|---|---|
| `shared/` | 无（只能导入外部依赖） | |
| `persistence/` | `shared/` | |
| `prompt-center/` | `shared/` | |
| `skill-center/` | `shared/`, `prompt-center/` | |
| `snail-den/` | `shared/`, `agent/` | |
| `message-bus/` | `shared/`, `persistence/` | |
| `project-workflow/` | 所有内部模块 | |
| `knowledge-center/` | 所有内部模块 | |
| `interaction-entry/` | 所有内部模块 | |
| `meta/` | - | 非目标，不添加守护规则（见决策 2） |

### 检视清单更新

在 S-04 检视者手册的"检查"部分增加一条：
- 检查新代码是否遵守模块依赖方向，跨模块导入是否符合 `docs/features/20260513/F2026051307-module-refactor.md` 定义的依赖图

## 改动范围

1. `eslint.config.mjs`：添加模块边界导入限制规则
2. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/S-04-检视者手册.md`：增加架构检查项

## 验证

1. `npm run lint` 规则生效，发现 30 个现有边界违反
2. 现有违反主要是技术债务，可在后续重构中修复：
   - `shared/` → `meta/`（meta 目录后续会移除）
   - `message-bus/` → `agent/`、`llm/`、`snails/`
   - `prompt-center/` → `meta/`、`skill-center/`、`snails/`、`agent/`
   - `snail-den/` → `llm/`
   - `persistence/` → `meta/`
3. 新代码会自动被 ESLint 检查，提示边界违反（warn 级别，不阻断构建）

## 生效路径

- **ESLint 规则**：`eslint.config.mjs` 中的模块边界规则，通过 `npm run lint` 检查，当前为 warn 级别，提示但不阻断
- **检视清单**：S-04 检视者手册中的第 18 条检查项，人工检视时确认边界合理性
- **CI/构建**：当前为 warn 级别，不阻断构建（见风险与决策记录）

## 风险与决策记录

### 决策 1：使用 warn 级别而非 error 级别

**背景**：现有代码存在 28 个边界违反，主要是技术债务（如 `shared/` 导入 `meta/`，`message-bus/` 导入 `agent/`、`llm/` 等）。

**决策**：将模块边界规则配置为 `warn` 级别，而非 `error` 级别。

**理由**：
1. 如果使用 `error` 级别，现有 28 个边界违反会导致 `npm run lint` 失败，阻断构建
2. 这些违反是技术债务，需要逐步修复，不能一次性阻断所有构建
3. `warn` 级别可以在保持规则生效的同时，让构建通过

**风险**：
1. `warn` 级别不能阻断新增违规导入，只能提示
2. 新增代码可能无意中违反边界，但不会被 CI/构建阻断
3. 需要依赖人工检视来确保新增代码遵守边界

**后续升级条件**：
- 修复所有现有边界违反（28 个）
- 或者在 CI 中添加专门的 lint 检查步骤，将 warning 视为错误

### 决策 2：不为 meta 模块添加边界守护规则

**背景**：feature 文档中声明 `meta/` 只能导入 `shared/`，但当前 `src/meta/index.ts` 实际导入了 `prompt-center` 和 `skill-center`。

**决策**：不为 `src/meta/**/*.ts` 添加边界守护规则。

**理由**：
1. `meta/` 目录后续会被移除（见非目标第 1 条）
2. 当前 `meta/` 的导入违反是已知的技术债务
3. 为 `meta/` 添加规则会立即产生新的警告，但不会阻断构建
4. 由于 `meta/` 将被移除，为其添加规则是临时性的，不值得维护

**风险**：
1. `meta/` 模块的边界不会被自动守护
2. 如果 `meta/` 的移除被延迟，可能会产生新的边界违反
3. 文档与实现不一致（文档声明 `meta/` 只能导入 `shared/`，但实现未守护）

**后续处理**：
- 在移除 `meta/` 目录时，同步更新文档，移除对 `meta/` 的声明
- 如果 `meta/` 的移除被延迟，重新评估是否需要添加边界守护规则

### 决策 3：no-restricted-imports pattern 覆盖多层级

**背景**：当前 pattern 只覆盖一层相对路径（如 `../meta`），但嵌套目录可以用 `../../meta` 绕过。

**决策**：修改 ESLint 规则，添加多层级 pattern 来覆盖最多 5 层相对路径的跨模块导入。

**理由**：
1. 当前 pattern 只覆盖一层相对路径，存在绕过风险
2. 开发者可能在嵌套目录中使用多层级相对路径导入
3. 需要确保边界守护的完整性

**实现方式**：
- 为每个受限模块添加多层级 pattern（如 `../meta`、`../../meta`、`../../../meta` 等）
- 覆盖最多 5 层相对路径（`../`、`../../`、`../../../`、`../../../../`、`../../../../../`）

**风险**：
1. pattern 列表会变长，但可读性仍然可接受
2. 如果目录嵌套超过 5 层，仍然可能绕过（当前代码库最大嵌套为 3 层，5 层已足够覆盖）
3. 如果未来出现超过 5 层的嵌套，需要更新 pattern 列表

## 范围变更记录

### 变更 1：添加多层级 pattern

**原因**：Acceptance Snail 检视发现当前 pattern 只覆盖一层相对路径，存在绕过风险。

**变更内容**：
- 为每个受限模块添加多层级 pattern（`../`、`../../`、`../../../`、`../../../../`、`../../../../../`）
- 更新文档，说明多层级 pattern 的设计

**影响范围**：
- `eslint.config.mjs`：添加多层级 pattern
- `docs/features/20260514/F2026051410-module-boundary-guard.md`：更新文档

### 变更 2：补充文档章节

**原因**：Acceptance Snail 检视发现文档缺少生效路径、风险与决策记录、范围变更记录等章节。

**变更内容**：
- 补充"生效路径"章节
- 补充"风险与决策记录"章节
- 补充"范围变更记录"章节

**影响范围**：
- `docs/features/20260514/F2026051410-module-boundary-guard.md`：更新文档

### 变更 3：统一文档表述

**原因**：Acceptance Snail 复检发现文档表述与实现不一致。

**变更内容**：
- 将"防止边界违反"改为"提示边界违反（warn 级别，不阻断构建）"
- 将"任意相对层级"改为"最多 5 层相对路径"
- 从规则设计表中移除 `meta/`，标注为非目标
- 更新决策 3 的风险说明，明确 5 层限制

**影响范围**：
- `docs/features/20260514/F2026051410-module-boundary-guard.md`：更新文档
