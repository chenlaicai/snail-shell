---
id: I2026052202
title: 知识治理功能：对话修复 + UI 重构 + module 字段 + seed 化
from_ids: []
tags: [knowledge, governance]
modules: [knowledge_governance]
---
# I2026052202 知识治理功能：对话修复 + UI 重构 + module 字段 + seed 化

## 背景

PR #237 围绕知识中心治理对话功能的全链路修复与架构升级：

1. **原始缺陷**：知识治理对话无法正常使用——事件绑定顺序错误、F-02 frame 缺少角色手册、working_rules 为空
2. **架构升级**：知识治理从 synthetic project/feature/stage 升级为统一库表模型的内置 project，通过 `module` 字段隔离
3. **UI 合并**：治理对话消息渲染从自建实现改为复用项目管理共享 `renderMessages`，删除重复的消息内容提取逻辑

## 改动摘要

### BugFix：修复三项阻塞性缺陷

1. **事件绑定顺序**：`renderGovernanceChat()` 在 `bindDetailEvents()` 之后调用，导致治理对话的发送按钮缺少事件监听器
2. **F-02 frame 缺少角色手册**：新增 `.meta/prompts/prompts/S-08-知识执行者手册.md`
3. **working_rules 为空**：补全知识执行者的 `description` 和 5 条 `working_rules`

### Feature Update：module 字段 + Knowledge Center seed 化

- `project` 表新增 `module` 字段（`project_management` | `knowledge_governance`），`kind` 保持 `system_self` 语义不污染
- Knowledge Center 作为第二个 `system_self` 内置项目走 `seedProjectConfigs` 统一 seed 机制初始化到 DB
- `governance-prompt.ts` 删除 synthetic 对象，改为从 DB 加载 project/feature/stage/role
- `createGovernanceShell` 创建真实 Feature/Stage 并关联 conversation
- `listProjects` 默认按 `module = 'project_management'` 过滤，隔离知识治理
- `resolveConversationRole` 删除知识治理硬编码分支，走 DB seed 统一查找
- `knowledge-candidate` skill 自包含脚本同步更新

### UI 重构：消息渲染合并

- 治理对话消息渲染改为复用项目管理共享 `renderMessages`
- 删除自建 `extractMessageContent` 和 `renderGovernanceMessages`
- `text`、`content_block`、`question`、`message-out` 等所有事件类型由统一 message-renderer 处理
- 可展开治理详情面板（来源与追溯 / 治理进度与裁决去向）

## 改动范围

| 文件 | 类型 |
|------|------|
| `.meta/prompts/prompts/S-08-知识执行者手册.md` | 新增 |
| `.meta/prompts/frames/F-02-knowledge-governance.md` | 修改 |
| `.meta/project-config-seed.json` | 修改 |
| `.meta/skills/knowledge-candidate/scripts/knowledge-candidate.js` | 修改 |
| `docs/features/20260522/I2026052202-knowledge-governance.md` | 新增 |
| `src/shared/domain-types.ts` | 修改 |
| `src/persistence/schema.ts` | 修改 |
| `src/persistence/store.ts` | 修改 |
| `src/persistence/project-config-model.ts` | 修改 |
| `src/persistence/knowledge-model.ts` | 修改 |
| `src/knowledge-center/governance-prompt.ts` | 修改 |
| `src/project-workflow/workflow.ts` | 修改 |
| `src/project-workflow/self-project-seed.ts` | 修改 |
| `src/project-workflow/manager.ts` | 修改 |
| `src/main.ts` | 修改 |
| `src/web/knowledge-center.js` | 修改 |
| `src/web/ui-shell.js` | 修改 |
| `src/web/styles/components/knowledge.css` | 修改 |
| `tests/**/` | 修改（4 个测试适配，3 条新增断言） |

## 验证结果

- tsc 编译通过
- eslint 通过
- 35 项测试全部通过
