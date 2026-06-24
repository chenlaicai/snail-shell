---
id: F20260624ss39
title: fix-issue-creation-log-format-skill-symlink
from_ids: []
tags: [issue, logging, skill, feature-id, bugfix, error-handling]
modules: [core, infra, agent-config]
doc_kind: spec
change_type: bugfix
---

# F20260624ss39 [core][infra] 修复 Issue 创建 500 错误 + 日志文件名格式 + Skill 符号链接 + 特性编号格式

## 修复 1：Issue 创建接口 500 错误

### 背景

创建新 Issue 时点击 Create 按钮报错：
- 前端显示：`创建失败：The string did not match the expected pattern.`
- 控制台报错：`Failed to load resource: the server responded with a status of 500 (Internal Server Error)`

根因是 `POST /api/workspaces/:workspaceId/issues` 路由缺少错误处理，域层验证错误直接抛出为未处理的 500 错误。

### 修复

将内联路由处理函数提取为独立的 `createIssue` 函数（与 `sendMessage`、`closeIssue` 保持一致），添加 try/catch 捕获域验证错误：

| 错误消息 | HTTP 状态码 |
|---------|------------|
| `SOP not found:*` | 400 |
| 含 `snail assignment` 的错误 | 400 |
| 含 `stage definitions` 的错误 | 400 |

同时移除过时测试文件：
- `tests/feature-numbering-test.ts`
- `tests/snail/snail-den-crud-test.ts`
- `tests/snail/snail-issue-context-mcp-test.ts`

### 核心业务行为

| # | 场景 | 预期行为 |
|---|------|---------|
| 1 | SOP 不存在 | 返回 400 + `SOP not found: xxx` |
| 2 | snail assignment plan 与 SOP 不匹配 | 返回 400 + 具体验证错误信息 |
| 3 | SOP 无 stage definitions | 返回 400 + `No stage definitions found` |
| 4 | 创建成功 | 返回 201 + issue + stage 数据 |

### 修改文件

- `src/infra/http/routes/issue.route.ts` — 提取 `createIssue` 函数，添加错误处理

---

## 修复 2：日志文件名格式

### 背景

日志文件名格式不正确：
- 当前活跃文件：`snail-shell.1.log`（无日期）
- 轮转文件：`snail-shell-2026-06-22.1.log`

原因是 `src/infra/logger.ts` 使用了 pino-roll v3 的旧选项名（`interval`/`maxFiles`），而 v4 版本的正确选项是 `frequency`/`limit`。

### 修复

更新 pino-roll 配置选项：

| 旧选项 (v3) | 新选项 (v4) | 值 |
|------------|------------|-----|
| `interval` | `frequency` | `"daily"` |
| `maxFiles` | `limit.count` | `config.max_days` |

### 文件命名规则

pino-roll v4 的文件命名格式：`filename.date.count.extension`

| 场景 | 文件名 |
|------|--------|
| 当前活跃文件 | `snail-shell.2026-06-24.log` |
| 超 10MB 轮转后 | 旧 → `snail-shell.2026-06-24.1.log`，新 → `snail-shell.2026-06-24.log` |
| 跨天轮转 | 旧 → `snail-shell.2026-06-24.N.log`，新 → `snail-shell.2026-06-25.log` |

### 配置项

```yaml
# config/logging.yaml
level: info
directory: logs
max_file_size_mb: 10
```

代码默认值：`max_days: 30`

### 修改文件

- `src/infra/logger.ts` — 更新 pino-roll 选项为 v4 版

---

## 修复 3：Skill 符号链接断开

### 背景

`.claude/skills/cd-review` 等符号链接指向 `skills/cd-review`（相对路径），实际解析为 `.claude/skills/skills/cd-review`，目标不存在。

根因是 `FileSkillRepository` 存储的 `dir_path` 是相对路径（如 `skills/cd-review`），而符号链接需要绝对路径才能正确指向 `data/file/skills/cd-review`。

### 修复

1. `FileDataStore.fromRepoRoot()` 和 `workspace()` 方法改用 `path.resolve()` 确保 `baseDir` 是绝对路径
2. `FileSkillRepository.loadSkillDir()` 使用 `store.getBaseDir()` 构建绝对路径

### 符号链接路径映射

| 类型 | 文件位置 | 符号链接 |
|------|---------|---------|
| 平台级 | `<repoRoot>/data/file/skills/cd-review/` | `<workspace>/.claude/skills/cd-review` → 绝对路径 |
| Workspace 级 | `<workspace>/.snail/skills/xxx/` | `<workspace>/.claude/skills/xxx` → 绝对路径 |

### 修改文件

- `src/infra/file-data-store.ts` — `fromRepoRoot` 和 `workspace` 改用 `path.resolve`
- `src/domain/skill/_internal/repository.ts` — `loadSkillDir` 使用 `store.getBaseDir()` 构建绝对路径

---

## 修复 4：特性编号格式调整

### 背景

特性编号 `FYYYYMMDDxxxx` 中 xxxx 首位是数字时，与日期部分 `YYYYMMDD` 视觉上不好区分。

### 修复

修改 `.githooks/commit-msg` 正则表达式，要求 xxxx 首位必须是字母：

| 项目 | 旧格式 | 新格式 |
|------|--------|--------|
| 正则表达式 | `\d{8}[2-9a-kmnp-z]{4}` | `\d{8}[a-kmnp-z][2-9a-kmnp-z]{3}` |
| 示例 | `F202606243vgu` | `F20260624ss39` |

字符集说明：
- 首位：`[a-kmnp-z]`（字母，排除 l 和 o 以避免混淆）
- 后 3 位：`[2-9a-kmnp-z]`（数字 2-9 或字母）

### 修改文件

- `.githooks/commit-msg` — 更新正则表达式和错误提示
