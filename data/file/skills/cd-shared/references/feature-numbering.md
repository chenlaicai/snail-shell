# 特性编号规则

## 编号格式

`FYYYYMMDDNN`
- `F`：固定前缀
- `YYYYMMDD`：编号分配当天日期（8 位数字）
- `NN`：当天从 `01` 开始的两位自然数递增编号

## 目录结构

`docs/features/YYYY/MM/DD/FYYYYMMDDNN-kebab-case-title.md`

## 获取最新编号

1. 确定日期：使用创建文档当天日期（YYYYMMDD）
2. 扫描目录：`docs/features/YYYY/MM/DD/`
3. 查找已有编号：找出所有 `FYYYYMMDDNN-*.md` 文件中的最大 NN
4. 计算新编号：最大 NN + 1（如无已有文件则为 01）

## 顺延规则

当 PR 创建日期较早，但合入时已有更新的编号被使用，需要顺延到当前最新的未使用编号。

- **日期归属**：顺延后的编号使用合入当天的日期，文档目录也放在合入当天的目录下
- **串行合入假设**：此规则假设 PR 串行合入。多 PR 同时待合入时可能存在竞态条件，需要人工协调

示例：
- PR1 昨天创建，编号 F2026062101
- PR2 今天创建，编号 F2026062201，已合入
- PR1 要合入时，需要顺延到 F2026062202（今天最新的未使用编号）
- PR1 的 feature 文档需要移动到 `docs/features/2026/06/22/F2026062202-*.md`

## 验证命令

```bash
# 检查指定日期目录下的最新编号
ls docs/features/YYYY/MM/DD/F*.md 2>/dev/null | sort -t'F' -k2 -n | tail -1
```
