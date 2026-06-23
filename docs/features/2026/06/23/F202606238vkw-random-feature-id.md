---
id: F202606238vkw
title: random-feature-id
from_ids: []
tags: [sop, numbering]
modules: [sop]
doc_kind: spec
---

# F202606238vkw [sop] 特性编号改为随机码格式

## 背景

特性编号 `FYYYYMMDDNN` 使用同日顺序递增编号（01, 02, ...），但 PR 并行开发时编号冲突频繁，顺延规则导致大量重编号工作（移动文件、更新 frontmatter、更新 commit message），且 AI 执行顺延的出错率很高。顺序号在代码中无逻辑依赖，唯一作用是保证同日唯一性。

## 目标

将特性编号格式从 `FYYYYMMDDNN` 改为 `FYYYYMMDDxxxx`（4 位随机码），消除顺延机制，编号创建后终身不变。

## 非目标

- 不迁移已有的 `FYYYYMMDDNN` 格式文档
- 不修改 `repository.ts` 的日期解析逻辑（已有兼容性）

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当创建新 feature 文档时 | 系统应分配 `FYYYYMMDDxxxx` 格式编号（4 位小写字母+数字随机码），并检查同日碰撞 | - |
| B2 | 当 PR 在不同日期合入时 | 编号和所属日期目录保持原样，不进行顺延或重新编号 | - |
| B3 | 当校验脚本遇到旧格式 `FYYYYMMDDNN` 文件时 | 应正常识别并通过校验 | - |
| B4 | 当校验脚本遇到新格式 `FYYYYMMDDxxxx` 文件时 | 应正常识别并按日期级别检测碰撞 | - |

## 设计

### 编号格式

`FYYYYMMDDxxxx`：F + 8 位日期 + 4 位随机码（a-z0-9）

### 关键决策

- 随机码空间 1,679,616 种（36^4），同日碰撞概率极低（日均 15 个 feature 时碰撞概率约 0.007%）
- 删除顺延规则，编号终身不变
- 校验脚本 `check-issue-doc-numbering.ts` 兼容新旧两种格式
- `repository.ts` 的 `^F(\d{4})(\d{2})(\d{2})` 正则天然兼容，无需修改

## 生效路径

- SOP/Skill 文件：cd-shared, cd-design, cd-development, cd-review, cd-merge
- 文档：docs/README.md
- 脚本：scripts/check-issue-doc-numbering.ts
