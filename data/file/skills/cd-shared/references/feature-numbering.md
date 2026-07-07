# 特性编号规则

## 编号格式

`FYYYYMMDDxxxx`

- `F`：固定前缀
- `YYYYMMDD`：编号分配当天日期（8 位数字）
- `xxxx`：4 位随机码（小写字母 + 数字，排除易混淆字符 0/o/1/l）。首位必须是字母（`a-kmnp-z`），后 3 位可以是数字或字母（字符集 `2-9a-kmnp-z`），以区分日期部分。

碰撞空间：32 × 32^3 = 1,048,576 种。随机源使用 `/dev/urandom`。

示例：`F20260623vkw2`

## 目录结构

`docs/features/YYYY/MM/DD/FYYYYMMDDxxxx-kebab-case-title.md`

## 生成编号

1. 确定日期：使用创建文档当天日期（YYYYMMDD）
2. 生成 4 位随机码：首位从字母集 `a-kmnp-z` 随机选取，后 3 位从 `2-9a-kmnp-z` 随机选取（排除 0/o/1/l）
3. 检查碰撞：扫描 `docs/features/YYYY/MM/DD/` 下已有文件，确认不与现有编号重复
4. 如碰撞则重新生成

## 顺延规则

当文档创建日期与当前日期不一致时，需要顺延到当前日期并重新生成随机码。

- **触发条件**：文档创建于昨天或更早，但 PR 今天才提交或合入
- **顺延方式**：重新生成编号（日期更新为当天，随机码重新生成）
- **文件移动**：feature 文档需要移动到当前日期目录下

示例：
- 文档昨天创建，编号 `F20260624accb`
- PR 今天提交，需要顺延到 `F20260625xxxx`（新的随机码）
- feature 文档需要移动到 `docs/features/2026/06/25/` 目录下

## 遗留格式

已有的 `FYYYYMMDDNN`（两位顺序递增编号）格式的 feature 文档保持不变，无需迁移。新旧格式可共存，代码解析兼容两种格式。

## 验证命令

```bash
# 检查指定日期目录下已有的编号
ls docs/features/YYYY/MM/DD/F*.md 2>/dev/null
```

## Commit / PR 标题模板

```
[FYYYYMMDDxxxx][module][Feature Update|BugFix|New Feature][Incompatible] 中文标题
```

- `[Incompatible]` 仅在存在不兼容更新时出现
- `module` 为小写中划线格式（如 prompt、project-management、web、sop 等）

## 合入阶段 PR 标题编号核对

合入者声明合入就绪前，必须核对 PR 标题中的特性编号与当前 Issue 关联的 Feature 文档编号一致。不一致时，合入者必须先修正 PR 标题。开发者在 Feature 文档编号变化时有主动更新 PR 标题的责任。
