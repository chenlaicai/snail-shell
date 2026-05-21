# F2026052104 移除多余的 committer 配置

## 背景

`.git/config` 中存在仓库级别的 `[user]` 配置（`Test User <test@example.com>`），覆盖了全局 git 配置（`chensg <chenshaoguo0@qq.com>`），导致本仓库中所有 commit 的 committer 信息都带上多余的 `Test User <test@example.com>`。

## 目标

- 移除 `.git/config` 中的 `[user]` section，让仓库回退到使用全局 git 配置
- 确认没有 Snail Shell 代码会重新写入这些配置

## 非目标

- 不修改测试文件中的 fixture 配置（测试使用隔离仓库，不受影响）
- 不添加 git config 写入防护（无代码会写入，不需要防护）

## 设计

直接删除 `.git/config` 第 18-20 行的 `[user]` section。无需代码改动。

Git 配置优先级：`.git/config` > `~/.gitconfig` > `/etc/gitconfig`。删除仓库级别配置后，全局配置 `chensg <chenshaoguo0@qq.com>` 将生效。

## 生效路径

- 直接修改 `.git/config` 文件

## 改动范围

- `.git/config`：删除 `[user]` section

## 验证

- 执行 `git config --local user.name` 和 `git config --local user.email` 确认不再返回 `Test User` / `test@example.com`
- 确认 `git config user.name` 返回全局配置值 `chensg`

## 风险与决策记录

无风险。删除的是手动配置的测试值，不影响任何 Snail Shell 功能。

## 范围变更记录

无范围变更。
