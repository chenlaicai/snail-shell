# 特性编号规则

## 编号格式

`FYYYYMMDDxxxx`

- `F`：固定前缀
- `YYYYMMDD`：编号分配当天日期（8 位数字）
- `xxxx`：4 位随机码（小写字母 + 数字，排除易混淆字符 0/o/1/l，字符集为 `2-9a-kmnp-z`）

碰撞空间：32^4 = 1,048,576 种。随机源使用 `/dev/urandom`。

示例：`F202606238vkw`

## 目录结构

`docs/features/YYYY/MM/DD/FYYYYMMDDxxxx-kebab-case-title.md`

## 生成编号

1. 确定日期：使用创建文档当天日期（YYYYMMDD）
2. 生成 4 位随机码：字符集 `2-9a-kmnp-z`（排除 0/o/1/l）
3. 检查碰撞：扫描 `docs/features/YYYY/MM/DD/` 下已有文件，确认不与现有编号重复
4. 如碰撞则重新生成

## 编号终身不变

编号在创建时一次性分配，**永不变更**。无论 PR 何时合入，编号和所属日期目录均保持原样。不存在顺延或重新编号机制。

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
