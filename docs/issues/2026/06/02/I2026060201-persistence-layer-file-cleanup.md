---
id: I2026060201
title: persistence-layer-consolidation
from_ids: [I2026060112]
tags: [persistence, cleanup, config]
modules: [persistence]
doc_kind: spec
---

# I2026060201 [persistence] 持久化配置目录统一

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

I2026060112（配置表文件化）完成了持久化层的核心重构：5 张 DB 配置表移除，`config/workspaces.json` 成为 workspace 配置的唯一真值源，`.meta/sop/*.yaml` 成为 SOP 定义的唯一真值源。

但重构后遗留了三个问题：

1. **持久化配置分散在两个目录**：平台级 SOP YAML 在 `.meta/sop/`，但 `.meta/` 的职责是 agent 基础设施（提示词、skills、模板），SOP YAML 是运行时持久化配置，应归入 `config/`。
2. **旧 seed 文件未清理**：`.meta/workspace-config-seed.json` 源码无引用但仍在磁盘，`.meta/README.md` 仍在描述它且包含其他不存在文件的引用。
3. **配置文件 example 不规范**：部分配置文件缺少 example 文件，现有 example 文件命名不一致（`snail-den.example.json` vs `llm.json.example`），且部分 example 缺少字段说明。

## 目标

### P1 — 平台 SOP 归入 `config/sop/`

将 `.meta/sop/*.yaml` 移动到 `config/sop/*.yaml`，让 `config/` 成为所有平台级持久化配置的唯一目录。

### P2 — workspace SOP 归入 `.snail/config/sop/`

将 workspace 级 SOP 的存放路径从 `<workspace_root>/.snail/sop/` 改为 `<workspace_root>/.snail/config/sop/`，与平台级保持一致的 `config/sop/` 结构。

### P3 — 删除冗余 seed 文件

删除 `.meta/workspace-config-seed.json`，源码已无引用。

### P4 — 更新 `.meta/README.md`

移除 README 中对已不存在文件的描述，移除 SOP 相关描述（SOP 已不属于 `.meta/`）。

### P5 — 配置文件 example 规范化

为所有 `config/` 下的配置文件提供规范的 `.json.example` 文件，采用统一格式说明每个字段的含义。

**现状问题**：

| 文件 | 有 example | 命名规范 | 字段说明 |
|---|---|---|---|
| `llm.json` | ✓ `llm.json.example` | ✓ `.json.example` | ❌ 无说明 |
| `feishu.json` | ✓ `feishu.json.example` | ✓ `.json.example` | ✓ 详细 |
| `snail-den.json` | ✓ `snail-den.example.json` | ❌ `.example.json` | ⚠️ 部分 |
| `logging.json` | ✗ 无 | - | - |
| `guard-profile.json` | ✗ 无 | - | - |
| `workspaces.json` | ✗ 无 | - | - |

**变更内容**：

1. **统一命名规范**：所有 example 文件命名为 `<filename>.json.example`
   - `snail-den.example.json` → `snail-den.json.example`（重命名）

2. **统一格式规范**：采用 `feishu.json.example` 的模式
   - 文件顶部 `_help` 字段：说明如何使用此文件（复制为 `config/xxx.json` 后填写）
   - 每个字段前添加 `_xxx_help` 字段：说明该字段的含义、类型、可选值

3. **创建缺失的 example 文件**：
   - `config/logging.json.example`
   - `config/guard-profile.json.example`
   - `config/workspaces.json.example`

4. **补充现有 example 的字段说明**：
   - `config/llm.json.example` — 添加 `_help` 和各字段 `_xxx_help` 说明

## 非目标

- 不涉及 `.meta/prompts/`、`.meta/skills/`、`.meta/templates/`、`.meta/scripts/`、`.meta/prompt-evaluations/`（agent 基础设施，不属于持久化配置）
- 不涉及 `config/workspaces.json`、`config/guard-profile.json`、`config/llm.json`、`config/logging.json`、`config/snail-den.json`、`config/feishu.json` 的内容修改（已在 `config/` 中，位置正确；P5 只涉及 example 文件）
- 不涉及历史 Issue 文档中的 `.meta/sop` 引用（历史记录不修改）
- 不修改 example 文件中的示例值（保持现有的合理默认值，只添加字段说明）

## 设计

### 核心分类原则

**`config/`** = 源码运行时读取的持久化配置文件（系统启动和运行的唯一真值源）

**`.meta/`** = agent 基础设施（提示词、skills、模板、脚本、评测数据）

两者的边界：被 `file-config-store.ts` 或类似持久化层直接加载的配置文件 → `config/`；被 agent 框架加载的提示词和能力包 → `.meta/`。

### P1 详设 — 平台 SOP 迁移

1. 创建 `config/sop/` 目录
2. 移动 `.meta/sop/code-delivery.yaml` → `config/sop/code-delivery.yaml`
3. 移动 `.meta/sop/evolution.yaml` → `config/sop/evolution.yaml`
4. 删除空目录 `.meta/sop/`
5. 修改 `src/persistence/file-config-store.ts` 第 124 行：
   - 旧：`path.join(this.repoRoot, ".meta", "sop")`
   - 新：`path.join(this.configDir, "sop")`（`configDir` 默认为 `<repoRoot>/config`）
6. 更新 `src/persistence/schema.ts` 第 5 行注释：`.meta/sop/*.yaml` → `config/sop/*.yaml`
7. 更新 `src/workspace-workflow/snail-loader.ts` 第 62 行注释：`.meta/sop/*.yaml` → `config/sop/*.yaml`

依据：
- `loadSopDir` 是 `private` 方法，仅在 `loadAll()` 中调用，改动范围封闭
- `this.configDir` 已在构造函数中设定为 `<repoRoot>/config`，复用此字段而非硬编码路径

### P2 详设 — workspace SOP 路径调整

1. 修改 `src/persistence/file-config-store.ts` 第 129 行：
   - 旧：`path.join(resolvedRoot, ".snail", "sop")`
   - 新：`path.join(resolvedRoot, ".snail", "config", "sop")`
2. 修改 `src/workspace-workflow/snail-loader.ts`：
   - **第 41 行** `snailPaths.sopDir` helper：
     - 旧：`path.join(workspaceRoot, SNAIL_DIR_NAME, "sop")`
     - 新：`path.join(workspaceRoot, SNAIL_DIR_NAME, "config", "sop")`
   - **第 62 行** JSDoc 注释：`.snail/sop/*.yaml` → `.snail/config/sop/*.yaml`
   - **第 109 行** `loadSopYamlDefinitions()` 调用点：路径由 `snailPaths.sopDir()` 驱动，helper 改后自动生效
   - **第 187-188 行** `initializeSnailDirectory()` 中 `sopDir` 的赋值：同样由 `snailPaths.sopDir()` 驱动，helper 改后自动生效
   - **第 203 行** 默认 SOP YAML 写入路径：同上
3. 更新相关注释

核心依据：`snailPaths.sopDir` 是集中的路径构造 helper（第 41 行），`loadSopYamlDefinitions` 调用点（第 109 行）和 `initializeSnailDirectory`（第 187 行）都通过它获取路径。修改 helper 一处即可同步所有调用方。

影响范围：
- 当前 Snail Shell workspace 没有 `.snail/sop/` 目录，无存量迁移问题
- `evolution-center` workspace 同样无 `.snail/sop/` 目录
- 机制存在但无活跃用户，改动安全

### P3 详设 — 删除 seed 文件

直接删除 `.meta/workspace-config-seed.json`。

依据：
- `grep` 搜索 `src/` 和 `.meta/scripts/` 中均无 `workspace-config-seed` 引用
- `config/workspaces.json` 是 I2026060112 确立的唯一真值源

### P4 详设 — README 更新

`.meta/README.md` 需要以下更新：

1. **删除 `workspace-config-seed.json` 章节**（第 28-65 行）：该文件已不存在
2. **删除 `stages.json`、`snails.json`、`artifacts.json` 相关描述**（第 194-203 行）：这三个文件均不存在
3. **删除 `frames/` 和 `_template-frame.md` 相关描述**（第 78-103 行）：这些文件不存在
4. **删除 `sop/` 相关描述**（如有）：SOP 已迁移到 `config/sop/`，不再属于 `.meta/`
5. **更新 `当前文件` 章节**：反映实际文件清单（prompts、skills、templates、scripts、prompt-evaluations、README）
6. **更新目录含义说明**：明确 `.meta/` 只存放 agent 基础设施，持久化配置在 `config/`

### P5 详设 — 配置文件 example 规范化

#### 格式规范

采用 `feishu.json.example` 已有的模式，每个 example 文件包含：

1. **文件顶部 `_help` 字段**：说明如何使用此文件
   ```
   "  _help": "复制本文件为 config/xxx.json 后再填写。config/xxx.json 会被 git 忽略，不要提交真实密钥或敏感配置。"
   ```

2. **每个业务字段前添加 `_xxx_help` 字段**：说明该字段的含义、类型、可选值
   ```
   "  _level_help": "日志级别过滤阈值。可选值：debug, info, warn, error",
   "  level": "info"
   ```

#### 文件变更清单

**新建文件**：

1. `config/logging.json.example`
   ```json
   {
     "  _help": "复制本文件为 config/logging.json 后再填写。",
     "  _level_help": "日志级别过滤阈值。只有权重 >= 该级别的日志才会被写入文件。可选值：debug(10), info(20), warn(30), error(40)",
     "level": "info",
     "  _directory_help": "日志文件存放目录（相对于 process.cwd() 的路径）。启动时若目录不存在会自动创建",
     "directory": "logs",
     "  _filename_prefix_help": "日志文件名前缀。最终文件名格式：{filename_prefix}-{YYYY-MM-DD}.{index}.log",
     "filename_prefix": "snail-shell",
     "  _max_file_size_mb_help": "单个日志文件的最大大小（单位：MB）。超过此阈值时自动切换到下一个分片文件",
     "max_file_size_mb": 10
   }
   ```

2. `config/guard-profile.json.example`
   ```json
   {
     "  _help": "复制本文件为 config/guard-profile.json 后再填写。GuardProfile 是 Snail Shell 安全策略的唯一配置源。",
     "  _allow_help": "放行列表。匹配的工具调用直接放行，不触发审批。格式：Bash(command:*) 或裸工具名",
     "allow": [
       "Bash(npm:*)",
       "Bash(git:*)",
       "Edit",
       "Write"
     ],
     "  _deny_help": "拒绝列表。匹配的工具调用直接拒绝，优先级高于 allow。格式同 allow",
     "deny": [
       "Bash(rm -rf /:*)",
       "Bash(sqlite3:*)",
       "AskUserQuestion",
       "EnterPlanMode",
       "ExitPlanMode"
     ]
   }
   ```

3. `config/workspaces.json.example`
   ```json
   {
     "  _help": "复制本文件为 config/workspaces.json 后再填写。workspaces.json 是工作区配置的唯一真值源。",
     "workspaces": [
       {
         "  _id_help": "工作区唯一标识符，用于所有内部引用",
         "id": "my-workspace",
         "  _module_help": "工作区所属模块。可选值：workspace_management, evolution",
         "module": "workspace_management",
         "  _name_help": "工作区显示名称",
         "name": "My Workspace",
         "  _summary_help": "工作区简介/描述",
         "summary": "用于开发和测试的工作区",
         "  _workspace_root_help": "工作区根目录的绝对路径。支持模板变量 {{process.cwd()}}",
         "workspace_root": "{{process.cwd()}}",
         "  _guard_profile_help": "工作区级安全策略覆盖，结构与 config/guard-profile.json 相同。null 表示使用系统默认",
         "guard_profile": null,
         "  _sop_bindings_help": "该工作区绑定的 SOP 列表",
         "sop_bindings": [
           {
             "  _sop_id_help": "绑定的 SOP ID，引用 config/sop/*.yaml 中定义的 SOP",
             "sop_id": "sop-code-delivery",
             "  _is_default_help": "是否为该工作区的默认 SOP，每个工作区最多一个",
             "is_default": true,
             "  _role_bindings_help": "角色到模板的映射。key 是 SOP 角色 key，value 是模板 ID（字符串或字符串数组）",
             "role_bindings": {
               "designer": "claude-code-sonnet",
               "developer": "claude-code-sonnet"
             }
           }
         ]
       }
     ]
   }
   ```

**修改文件**：

4. `config/llm.json.example` — 添加字段说明
   ```json
   {
     "  _help": "复制本文件为 config/llm.json 后再填写。config/llm.json 会被 git 忽略，不要提交真实 API Key。",
     "  _provider_help": "LLM 提供商。当前支持：openai",
     "provider": "openai",
     "openai": {
       "  _api_key_help": "OpenAI API Key。不要提交真实密钥",
       "api_key": "your-openai-api-key",
       "  _model_help": "使用的模型 ID",
       "model": "gpt-4.1-mini",
       "  _base_url_help": "API 基础 URL",
       "base_url": "https://api.openai.com/v1",
       "  _timeout_ms_help": "请求超时时间（毫秒）",
       "timeout_ms": 60000
     }
   }
   ```

**重命名文件**：

5. `config/snail-den.example.json` → `config/snail-den.json.example`
   - 保持内容不变，只修正命名规范

## 生效路径

- 文件移动：`.meta/sop/*.yaml` → `config/sop/*.yaml`
- 文件删除：`.meta/workspace-config-seed.json`
- 源码修改：`file-config-store.ts`、`schema.ts`、`snail-loader.ts`（路径引用 + 注释）
- 文档更新：`.meta/README.md`
- 文件新建：`config/logging.json.example`、`config/guard-profile.json.example`、`config/workspaces.json.example`
- 文件修改：`config/llm.json.example`（添加字段说明）
- 文件重命名：`config/snail-den.example.json` → `config/snail-den.json.example`

## 设计取舍记录

| # | 取舍 | 选择 | 理由 | 备选 |
|---|---|---|---|---|
| 1 | 平台 SOP 存放位置 | `config/sop/` | 与 `config/workspaces.json` 同级，统一持久化配置入口；`configDir` 已有现成字段可复用 | `.meta/sop/`（现状，但与 agent 基础设施混杂） |
| 2 | workspace SOP 存放位置 | `.snail/config/sop/` | 与平台级 `config/sop/` 结构对称；`.snail/config/` 成为 workspace 级持久化配置统一目录 | `.snail/sop/`（现状，但命名不表明"持久化配置"属性） |
| 3 | 路径变更方式 | 硬编码改为 `this.configDir` | 复用已有构造参数，路径不再硬编码 | 继续硬编码新路径（可行但不优雅） |
| 4 | example 文件命名规范 | `.json.example` | 与已有 `llm.json.example`、`feishu.json.example` 保持一致 | `.example.json`（snail-den 现状，但不符合惯例） |
| 5 | 字段说明方式 | `_xxx_help` 字段 | 与 `feishu.json.example` 已有模式一致；JSON 不支持注释，这是最直观的方式 | 在 example 文件顶部用 `_comment` 字段集中说明（可读性差） |

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `.meta/sop/code-delivery.yaml` | 移动 | → `config/sop/code-delivery.yaml` |
| `.meta/sop/evolution.yaml` | 移动 | → `config/sop/evolution.yaml` |
| `.meta/sop/` | 删除目录 | 目录已清空 |
| `.meta/workspace-config-seed.json` | 删除 | 旧 seed 文件，已被 config/workspaces.json 替代 |
| `src/persistence/file-config-store.ts` | 修改 | 平台 SOP 路径从 `.meta/sop` 改为 `configDir/sop`；workspace SOP 路径从 `.snail/sop` 改为 `.snail/config/sop` |
| `src/persistence/schema.ts` | 修改 | 注释更新 |
| `src/workspace-workflow/snail-loader.ts` | 修改 | `snailPaths.sopDir` helper 路径改为 `.snail/config/sop`；`initializeSnailDirectory` 创建路径同步更新；JSDoc 注释更新 |
| `.meta/README.md` | 修改 | 移除过时文件引用和 SOP 描述，更新为当前实际文件清单 |
| `config/logging.json.example` | 新建 | logging 配置示例，含字段说明 |
| `config/guard-profile.json.example` | 新建 | guard-profile 配置示例，含字段说明 |
| `config/workspaces.json.example` | 新建 | workspaces 配置示例，含字段说明 |
| `config/llm.json.example` | 修改 | 添加 `_help` 和各字段 `_xxx_help` 说明 |
| `config/snail-den.example.json` | 重命名 | → `config/snail-den.json.example`，统一命名规范 |

## 验证

### P1 — 平台 SOP 迁移

- [ ] `config/sop/code-delivery.yaml` 和 `config/sop/evolution.yaml` 存在
- [ ] `.meta/sop/` 目录已删除
- [ ] `grep -r "\.meta.*sop" src/` 无结果（源码中无旧路径引用）
- [ ] `file-config-store.ts` 的 `loadAll()` 正确加载 `config/sop/*.yaml`

### P2 — workspace SOP 路径调整

- [ ] `file-config-store.ts` 的 `loadAll()` 从 `.snail/config/sop/` 加载 workspace SOP
- [ ] `snail-loader.ts` 的 `snailPaths.sopDir` helper 返回 `.snail/config/sop` 路径
- [ ] `snail-loader.ts` 的 `loadSopYamlDefinitions()` 从 `.snail/config/sop/` 加载
- [ ] `snail-loader.ts` 的 `initializeSnailDirectory()` 在 `.snail/config/sop/` 创建目录和默认 YAML
- [ ] `grep -r "\.snail.*sop" src/` 中无残留的 `.snail/sop`（不含 `.snail/config/sop`）引用

### P3 — seed 文件清理

- [ ] `.meta/workspace-config-seed.json` 已删除
- [ ] `grep -r "workspace-config-seed" src/ .meta/scripts/` 无结果

### P4 — README 更新

- [ ] `.meta/README.md` 中无对不存在文件的引用
- [ ] README 描述的文件清单与实际磁盘文件一致
- [ ] README 中无 SOP 相关描述（SOP 已不属于 `.meta/`）

### P5 — 配置文件 example 规范化

- [ ] 所有 example 文件命名统一为 `.json.example`（无 `.example.json`）
- [ ] `config/logging.json.example` 存在且包含 `_help` 和各字段 `_xxx_help` 说明
- [ ] `config/guard-profile.json.example` 存在且包含 `_help` 和各字段 `_xxx_help` 说明
- [ ] `config/workspaces.json.example` 存在且包含 `_help` 和各字段 `_xxx_help` 说明
- [ ] `config/llm.json.example` 包含 `_help` 和各字段 `_xxx_help` 说明
- [ ] `config/snail-den.json.example` 存在（重命名自 `snail-den.example.json`）

### 通用

- [ ] TypeScript 编译无错误
- [ ] 现有测试通过

## 关联

- **前置**: I2026060112（配置表文件化——文件为唯一真值源）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| 1 | 旧 seed 文件是否需要保留作为参考 | 不需要。config/workspaces.json 已是唯一真值源，旧文件结构已过时 | 2026-06-02 |
| 2 | SOP 路径变更是否有存量影响 | 无。当前两个 workspace 均无 `.snail/sop/` 目录，机制存在但无活跃用户 | 2026-06-02 |
| 3 | 平台 SOP 路径用 `configDir` 还是硬编码 | 用 `configDir`。复用已有构造参数，避免路径硬编码 | 2026-06-02 |
| 4 | example 文件命名规范 | 统一为 `.json.example`。与已有 `llm.json.example`、`feishu.json.example` 保持一致 | 2026-06-02 |
| 5 | 字段说明格式 | 用 `_xxx_help` 字段。JSON 不支持注释，这是与 `feishu.json.example` 已有模式一致的最直观方式 | 2026-06-02 |
