---
id: F20260624c3d4
title: fix-log-filename-format
from_ids: []
tags: [logging, bugfix, pino-roll]
modules: [infra]
doc_kind: spec
change_type: bugfix
---

# F20260624c3d4 [infra] 修复日志文件名格式，更新 pino-roll 选项为 v4 版

## 背景

日志文件名格式不正确：
- 当前活跃文件：`snail-shell.1.log`（无日期）
- 轮转文件：`snail-shell-2026-06-22.1.log`

原因是 `src/infra/logger.ts` 使用了 pino-roll v3 的旧选项名（`interval`/`maxFiles`），而 v4 版本的正确选项是 `frequency`/`limit`。

## 修复内容

更新 pino-roll 配置选项：

| 旧选项 (v3) | 新选项 (v4) | 值 |
|------------|------------|-----|
| `interval` | `frequency` | `"daily"` |
| `maxFiles` | `limit.count` | `config.max_days` |

## 文件命名规则

pino-roll v4 的文件命名格式：`filename.date.count.extension`

| 场景 | 文件名 |
|------|--------|
| 当前活跃文件 | `snail-shell.2026-06-24.log` |
| 超 10MB 轮转后 | 旧 → `snail-shell.2026-06-24.1.log`，新 → `snail-shell.2026-06-24.log` |
| 跨天轮转 | 旧 → `snail-shell.2026-06-24.N.log`，新 → `snail-shell.2026-06-25.log` |

## 配置项

```yaml
# config/logging.yaml
level: info
directory: logs
max_file_size_mb: 10
```

代码默认值：`max_days: 30`

## 修改文件

- `src/infra/logger.ts` — 更新 pino-roll 选项为 v4 版
