# F2026052601 [project_management] 特性标题加个模块

## 背景

当前 commit message / PR 标题模板为 `[FYYYYMMDDNN][Feature Update|BugFix|New Feature][Incompatible] 中文标题`，缺少模块归属标识。Project 已有 `module` 字段（`project_management` | `knowledge_governance`），commit/PR 标题应体现模块信息，便于在提交历史中按模块过滤。

## 目标

- commit message / PR 标题模板增加 `[module]` 字段，插入在日期和变更类型之间
- feature 文档标题同样增加 `[module]` 标识
- git commit-msg hook 校验正则同步更新

## 非目标

- 不修改 Feature 数据模型（不新增 DB 列或 TypeScript 字段）
- 不修改 `ProjectModule` 类型定义（`project_management` | `knowledge_governance` 保持不变）
- 不修改 feature 文档文件名规则
- 不修改 Web UI 中的 feature 标题展示

## 设计

### 新模板

```
[FYYYYMMDDNN][module][Feature Update|BugFix|New Feature][Incompatible] 中文标题
```

module 取值与 `ProjectModule` 类型一致：`project_management` | `knowledge_governance`。

### 示例

```
[F2026052601][project_management][Feature Update] 特性标题增加模块字段显示
[F2026052601][knowledge_governance][BugFix] 修复知识治理入口校验
```

## 生效路径

- `.githooks/commit-msg` — commit 首行格式校验
- `.meta/skills/developer-handbook/SKILL.md` — 开发流程模板引用
- `.meta/skills/reviewer-handbook/SKILL.md` — 检视者模板检查规则
- `.meta/prompts/prompts/S-03-研发者手册.md` — 运行时提示词
- `docs/README.md` — feature 文档标题模板

## 改动范围

| 文件 | 改动类型 |
|------|----------|
| `.githooks/commit-msg` | 修改 — 正则增加 `[module]` 捕获组 |
| `.meta/skills/developer-handbook/SKILL.md` | 修改 — 模板增加 `[module]` 字段 |
| `.meta/skills/reviewer-handbook/SKILL.md` | 修改 — 检视规则同步 |
| `.meta/prompts/prompts/S-03-研发者手册.md` | 修改 — 运行时提示词同步 |
| `.meta/prompt-evaluations/prompt-behavior-samples.json` | 修改 — 评测量样本同步 |
| `tests/meta/prompt-assets-test.ts` | 修改 — 测试断言同步 |
| `docs/README.md` | 修改 — feature 文档标题模板增加 `[module]` |
| `docs/features/20260526/F2026052601-feature-title-add-module.md` | 新增 |

## 验证

- 新格式 commit 通过 commit-msg hook 校验
- TypeScript 编译通过
- 全部测试通过

## 决策记录

- **PR**: https://github.com/chenlaicai/snail-shell/pull/264
- **分支**: `f/F2026052601-feature-title-module`
