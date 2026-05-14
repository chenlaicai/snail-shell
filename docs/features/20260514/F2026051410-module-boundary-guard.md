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

| 模块 | 允许导入的模块 |
|---|---|
| `shared/` | 无（只能导入外部依赖） |
| `persistence/` | `shared/` |
| `meta/` | `shared/` |
| `prompt-center/` | `shared/` |
| `skill-center/` | `shared/`, `prompt-center/` |
| `snail-den/` | `shared/`, `agent/` |
| `message-bus/` | `shared/`, `persistence/` |
| `project-workflow/` | 所有内部模块 |
| `knowledge-center/` | 所有内部模块 |
| `interaction-entry/` | 所有内部模块 |

### 检视清单更新

在 S-04 检视者手册的"检查"部分增加一条：
- 检查新代码是否遵守模块依赖方向，跨模块导入是否符合 `docs/features/20260513/F2026051307-module-refactor.md` 定义的依赖图

## 改动范围

1. `eslint.config.mjs`：添加模块边界导入限制规则
2. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/S-04-检视者手册.md`：增加架构检查项

## 验证

1. `npm run lint` 规则生效，发现 28 个现有边界违反
2. 现有违反主要是技术债务，可在后续重构中修复：
   - `shared/` → `meta/`（meta 目录后续会移除）
   - `message-bus/` → `agent/`、`llm/`、`snails/`
   - `prompt-center/` → `meta/`、`skill-center/`、`snails/`、`agent/`
   - `snail-den/` → `llm/`
   - `persistence/` → `meta/`
3. 新代码会自动被 ESLint 检查，防止边界违反
