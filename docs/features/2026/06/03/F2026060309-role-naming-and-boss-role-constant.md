---
id: F2026060309
title: role-naming-and-boss-role-constant
from_ids: [F2026060302]
tags: [sop, prompts, workflow, web, persistence]
modules: [workflow, prompt-center, web, persistence]
doc_kind: spec
---

# F2026060309 [workflow] 角色名称专业化 + Boss Role 提取为系统常量

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->

## 背景

1. SOP 角色名称采用"动词+者"模式（设计者、研发者、检视者、合入者），更像功能描述而非软件研发团队角色，专业感不足
2. "Boss Role" 是硬编码英文字符串字面量，散布在 15+ 源码文件中，从未正式定义
3. UI 参与者列表直接显示 "Boss Role"（虽有 `=== "Boss Role" ? "用户"` 映射），混在中文角色列表中突兀
4. 系统提示词中 "Boss Role" 参与者无 description，agent 不知道它是谁、有什么权限
5. 无任何地方告诉 agent "当前系统是 Snail Shell，一个 AI 工作室"

## 目标

### P1 — 角色名称专业化

| 旧名称 | 新名称 | 英文 key (不变) |
|--------|--------|----------------|
| 设计者 | 架构师 | `designer` |
| 研发者 | 开发者 | `developer` |
| 检视者 | 审查者 | `reviewer` |
| 合入者 | 维护者 | `merger` |

### P2 — Boss Role 提取为系统常量

- 在 `src/shared/domain-types.ts` 定义 `HUMAN_ROLE_NAME = "项目负责人"`
- 所有 TS 源码统一 `import { HUMAN_ROLE_NAME }`，JS 文件使用字符串字面量 `"项目负责人"`
- SQL 查询中的 `'Boss Role'` 同步更新

### P3 — 环境认知注入

- 新增 `B-04-环境认知.md` 提示词，让所有 snail 知道：
  - 自己运行在 Snail Shell AI 工作室中
  - 人类操作者是「项目负责人」，拥有最终决策权
  - 需要确认时通过 @项目负责人 提问

## 非目标

- 不改动 YAML `key` 字段（`designer`/`developer`/`reviewer`/`merger` 为内部标识符）
- 不改动 handbook 文件名（仍使用英文 key 命名）
- 不改动 `docs/features/` 历史文档
- 不改动 `boss_pending_count` 等内部字段名（非用户可见）

## 设计

### 常量提取

```typescript
// src/shared/domain-types.ts
export const HUMAN_ROLE_NAME = "项目负责人";
```

TS 文件通过 import 引用常量，JS 文件直接使用字符串字面量（保持现有 JS/TS 混合架构的兼容性）。

### 提示词注册

`B-04-环境认知.md` 使用标准 frontmatter，prompt-center 自动发现，无需手动注册。

## 生效路径

- SOP YAML `name` 字段变更 → FileConfigStore 加载时生效
- `HUMAN_ROLE_NAME` 常量 → 编译时生效
- B-04 提示词 → 下次系统提示词组装时生效
- DB 中已有数据需手工迁移（不兼容更新）

## 不兼容更新

- `Boss Role` 标识符变更为「项目负责人」，已有 DB 数据需手工迁移：

```sql
UPDATE conversation SET participating_roles = REPLACE(participating_roles, 'Boss Role', '项目负责人');
UPDATE message SET from_role = '项目负责人' WHERE from_role = 'Boss Role';
UPDATE message SET to_roles = REPLACE(to_roles, 'Boss Role', '项目负责人');
UPDATE message_dispatch SET to_role = '项目负责人' WHERE to_role = 'Boss Role';
```

- 角色显示名称变更，运行时从 SOP YAML 重新加载，已有快照不受影响
