# Snail Shell 公开发布手册

本手册供 AI 逐步执行，完成公开仓库 `snail-shell-public` 的初始发布和后续更新。

## 仓库概览

| 仓库 | 地址 | 可见性 | 用途 |
|------|------|--------|------|
| 私有仓库 | `github.com/chenlaicai/snail-shell.git` | private | 开发主线，不对外公开 |
| 公开仓库 | `github.com/chenlaicai/snail-shell-public.git` | public | 面试展示用的稳定版本快照 |

**核心原则**：两个仓库不共享 git 历史，不做 merge/rebase。每次发布/更新是在公开仓库中创建一个新 commit，内容为私有仓库某个 commit 的清理后快照。

**分支保护**：公开仓库 `main` 分支已启用保护规则，不允许直接 push 或 force push。所有变更必须通过 PR squash merge 合入。

## 排除列表

以下文件/目录在导出快照后必须删除：

| 目录/文件 | 理由 |
|-----------|------|
| `.snail/` | 内部状态，不属于项目代码 |
| `config.json` | OpenCode 工具链配置，不属于项目代码 |
| `docs/features/` | 历史提交记录，不属于项目代码 |

本地配置文件（`.env`、`.claude/`、`CLAUDE.md`、`config/*.json`、`config/*.yaml` 等）已由主仓 `.gitignore` 排除，`git archive` 不会导出这些文件，无需额外处理。

## 初始发布

### 前置条件

- 私有仓库位于 `/Users/orca/ai/snail-shell`
- 已在 GitHub 创建空的 public 仓库 `snail-shell-public`（不要初始化 README）
- 操作在私有仓库目录中执行

### 步骤 1：导出旧版本快照

```bash
cd /Users/orca/ai/snail-shell

# 导出目标 commit 的文件树到临时目录
mkdir -p /tmp/public-snapshot
git archive --format=tar <COMMIT_HASH> | tar -x -C /tmp/public-snapshot

cd /tmp/public-snapshot
```

> 将 `<COMMIT_HASH>` 替换为要发布的稳定 commit 的完整 hash。

### 步骤 2：删除内部文件

```bash
rm -rf .snail/
rm -f config.json
rm -rf docs/features/
```

### 步骤 3：适配 README

在 README.md 顶部（标题下方）添加发布说明：

```markdown
> **这是稳定发布版本（snapshot from commit <COMMIT_HASH>）。**
```

检查 README 中是否有对 `config.json` 或 `docs/features/` 的引用，如有则移除。

### 步骤 4：验证快照完整性

```bash
# 验证内部文件已删除
ls .snail/ 2>/dev/null && echo "ERROR: .snail/ still exists" || echo "OK: .snail/ removed"
ls config.json 2>/dev/null && echo "ERROR: config.json still exists" || echo "OK: config.json removed"
ls docs/features/ 2>/dev/null && echo "ERROR: docs/features/ still exists" || echo "OK: docs/features/ removed"

# 验证项目结构完整性
ls src/ tests/ package.json tsconfig.json README.md LICENSE
```

### 步骤 5：初始化公开仓库（空 commit）

```bash
cd /tmp/public-snapshot

# 初始化新仓库，先推送一个空 commit 到 main
git init
git commit --allow-empty -m "initial empty commit"
git remote add origin https://github.com/chenlaicai/snail-shell-public.git
git branch -M main
git push -u origin main
```

### 步骤 6：配置分支保护

```bash
# 仅允许 squash merge
gh api repos/chenlaicai/snail-shell-public -X PATCH \
  -f allow_squash_merge=true -f allow_merge_commit=false -f allow_rebase_merge=false

# 保护 main 分支
gh api repos/chenlaicai/snail-shell-public/branches/main/protection -X PUT \
  -H "Accept: application/vnd.github+json" \
  --input - <<'EOF'
{
  "required_status_checks": null,
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

### 步骤 7：创建 release 分支并提交快照

```bash
# 回到快照目录，创建 release 分支
cd /tmp/public-snapshot
git checkout -b release/v1.0.0

# 将快照内容（步骤 1-4 已处理的）添加并提交
# 注意：此时需要把快照文件复制到 git 仓库目录中
# 如果快照目录就是 git 仓库目录，直接 add 即可
git add .
git commit -m "v1.0.0 stable release (snapshot from commit <COMMIT_HASH>)"
git push -u origin release/v1.0.0
```

> commit message 必须包含源 commit 的完整 hash（不含日期），便于下次更新时明确本次公开使用的版本。

### 步骤 8：通过 PR squash merge 合入 main

```bash
gh pr create --repo chenlaicai/snail-shell-public \
  --head release/v1.0.0 --base main \
  --title "v1.0.0 stable release" \
  --body "snapshot from commit <COMMIT_HASH>"
gh pr merge --repo chenlaicai/snail-shell-public --squash --admin
```

### 步骤 9：验证项目可启动

```bash
npm install
npm run build
npm start
```

## 后续更新

每次更新是在公开仓库中创建一个新 commit，内容为私有仓库某个新 commit 的清理后快照。不做 merge/rebase。

### 步骤 1：Clone 公开仓库

```bash
git clone https://github.com/chenlaicai/snail-shell-public.git /tmp/public-update
cd /tmp/public-update
```

### 步骤 2：从私有仓库导出目标 commit 的文件树

```bash
# 替换 <COMMIT_HASH> 为想发布的稳定 commit
mkdir -p /tmp/public-snapshot-new
git --git-dir=/Users/orca/ai/snail-shell/.git archive --format=tar <COMMIT_HASH> | tar -x -C /tmp/public-snapshot-new
```

### 步骤 3：清理内部文件

```bash
cd /tmp/public-snapshot-new
rm -rf .snail/
rm -f config.json
rm -rf docs/features/
# 适配 README（同初始发布步骤 3）
```

### 步骤 4：覆盖到公开仓库目录

```bash
# 保留公开仓库的 .git/ 目录
rsync -av --delete --exclude='.git' /tmp/public-snapshot-new/ /tmp/public-update/
```

> `rsync --delete` 确保旧版本中存在但新版本中已删除的文件被清理。

### 步骤 5：创建分支并提交

```bash
cd /tmp/public-update
git checkout -b release/v1.X.0
git add -A
git commit -m "v1.X.0 stable release (snapshot from commit <COMMIT_HASH>)"
git push -u origin release/v1.X.0
```

### 步骤 6：通过 PR 合入

```bash
gh pr create --repo chenlaicai/snail-shell-public \
  --head release/v1.X.0 --base main \
  --title "v1.X.0 stable release" \
  --body "snapshot from commit <COMMIT_HASH>"
gh pr merge --repo chenlaicai/snail-shell-public --squash --admin
```

### 步骤 7：验证项目可启动

```bash
npm install
npm run build
npm start
```

## 验证清单

每次发布/更新后逐项检查：

- [ ] `.snail/` 已删除
- [ ] `config.json` 已删除
- [ ] `docs/features/` 已删除
- [ ] `src/`、`tests/`、`package.json`、`tsconfig.json`、`README.md`、`LICENSE` 存在
- [ ] `npm install` 成功
- [ ] `npm run build` 成功
- [ ] `npm start` 成功
- [ ] commit message 包含源 commit 完整 hash（不含日期）
- [ ] README 发布说明不含日期
- [ ] 公开仓库只有发布快照 commit，不含开发历史
- [ ] 后续更新通过 PR squash merge 合入（不直接 push main）
