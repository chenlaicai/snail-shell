# F2026052601 [project-management] 特性标题加个模块

## 背景

当前 commit message / PR 标题模板为 `[FYYYYMMDDNN][Feature Update|BugFix|New Feature][Incompatible] 中文标题`，缺少模块归属标识。Project 已有 `module` 字段（`project-management` | `knowledge-governance`），commit/PR 标题应体现模块信息，便于在提交历史中按模块过滤。

## 目标

- commit message / PR 标题模板增加 `[module]` 字段，插入在日期和变更类型之间
- feature 文档标题同样增加 `[module]` 标识
- git commit-msg hook 校验正则同步更新
- `ProjectModule` 类型值从下划线改为中划线

## 非目标

- 不修改 Feature 数据模型（不新增 DB 列或 TypeScript 字段）
- 不修改 feature 文档文件名规则
- 不修改 Web UI 中的 feature 标题展示
- 不修改 `knowledge_governance` 表名 / `ConversationOwnerType` 等非 module 用途的标识符

## 设计

### 新模板

```
[FYYYYMMDDNN][module][Feature Update|BugFix|New Feature][Incompatible] 中文标题
```

module 取值与 `ProjectModule` 类型一致：`project-management` | `knowledge-governance`。

### 示例

```
[F2026052601][project-management][Feature Update] 特性标题增加模块字段显示
[F2026052601][knowledge-governance][BugFix] 修复知识治理入口校验
```

## 生效路径

- `src/shared/domain-types.ts` — `ProjectModule` 类型定义
- `src/persistence/schema.ts` — 项目表 `module` 列默认值
- `src/persistence/store.ts` — `listProjects` 默认 module 参数
- `src/project-workflow/self-project-seed.ts` — 内置项目 seed module
- `src/project-workflow/workflow.ts` — `createInitialWorkflow` 默认 module
- `.githooks/commit-msg` — commit 首行格式校验
- `.meta/skills/developer-handbook/SKILL.md` — 开发流程模板引用
- `.meta/project-config-seed.json` — 项目配置 seed 数据
- `docs/README.md` — feature 文档标题模板

## 改动范围

| 文件 | 改动类型 |
|------|----------|
| `src/shared/domain-types.ts` | 修改 — `ProjectModule` 类型值改中划线 |
| `src/persistence/schema.ts` | 修改 — 默认值改中划线 |
| `src/persistence/store.ts` | 修改 — 默认参数改中划线 |
| `src/project-workflow/self-project-seed.ts` | 修改 — 常量改中划线 |
| `src/project-workflow/workflow.ts` | 修改 — 默认值改中划线 |
| `.githooks/commit-msg` | 修改 — 正则和错误提示改中划线 |
| `.meta/skills/developer-handbook/SKILL.md` | 修改 — 模板说明改中划线 |
| `.meta/project-config-seed.json` | 修改 — seed module 值改中划线 |
| `docs/README.md` | 修改 — feature 文档标题模板增加 `[module]` |
| `tests/**/*.ts` (4 文件) | 修改 — module 字符串改为中划线 |
| `docs/features/20260526/F2026052601-feature-title-add-module.md` | 新增 |

## 验证

- 新格式 commit 通过 commit-msg hook 校验
- TypeScript 编译通过
- 全部测试通过

## 风险与决策记录

- 已有数据库 `project` 表 module 值为下划线格式，需手工执行：
  ```sql
  UPDATE project SET module = 'project-management' WHERE module = 'project_management';
  UPDATE project SET module = 'knowledge-governance' WHERE module = 'knowledge_governance';
  ```
- `knowledge_governance` 作为表名和 `ConversationOwnerType` 值保持不变，仅 `ProjectModule` 类型值改为中划线
- **PR**: https://github.com/chenlaicai/snail-shell/pull/264
- **分支**: `f/F2026052601-feature-title-module`
