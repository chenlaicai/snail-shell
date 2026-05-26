# Review Request: F2026052607 项目级 prompt overlay loader + 脚本路径适配

Review-Target-ID: F2026052607
Branch: feat/F2026052607-project-overlay-loader
PR: https://github.com/chenlaicai/snail-shell/pull/285

## What

P1: 实现 `.snail/prompts/` 项目级 prompt overlay loader。`loadProjectPrompts(projectRoot)` 从项目目录加载 prompt，`mergePrompts()` 同 ID 时项目覆盖全局。`resolveHandbookRef` 支持 `project:` scope。`buildConversationCapability` 集成 overlay，角色手册可引用项目 prompt。

P2: 新增 `PLATFORM_META` 常量（启动时捕获 `process.cwd()`），builder.ts 中脚本路径从 `process.cwd()` 改为 `PLATFORM_META`，不随 project cwd 变化。

## Why

F2026052606 将 agent cwd 从 `process.cwd()` 分离为 `project.project_root`，但两个关键能力未实现：
1. 项目自建角色的手册无法通过 `handbook_prompt_ref = "project:xxx"` 引用
2. builder.ts 中脚本路径硬编码 `process.cwd()`，project 切换后路径指错

## Original Requirements（必填）

> "Feature 1: 项目级 prompt/skill overlay 落地 — 实现 `projectRoot/.snail/` loader；`handbook_prompt_ref` 支持 `project:` scope 解析；builder.ts 脚本路径从 `process.cwd()` 改为 `SNAIL_HOME`"
> "没有 overlay，用户自建项目的角色手册 / skill 全部失效，#277 讨论的前提也不成立"

- 来源：thread_mpmrimj37xa7t2lj（F2026052606 What's Next kickoff 讨论）
- 关联 issue: #276, #279
- **请对照上面的摘录判断交付物是否解决了原始问题**

## Tradeoff

- Skill overlay 从 scope 中拆出（#284）——当前有文本注入 vs agent 原生两条通道，需先收敛架构方向
- 项目 prompt 不能覆盖 frame（frame 定义 prompt 架构，覆盖风险过高）
- 不做热加载（.snail/ 变更后需重新创建 feature / 重启对话）
- `PLATFORM_ROOT` 用启动时 `process.cwd()` 而非 `__dirname`（`__dirname` 指向 `dist/`，`.meta/` 在仓库根）

## Architecture Ownership（必填）

Architecture cell: prompt-center
Map delta: none
Why: 在现有 prompt-center 模块内新增 overlay 加载和合并逻辑，不改变模块边界

请 reviewer 检查：
- diff 是否与 `Map delta` 一致
- 是否新建了并行 Store / Queue / Router / Adapter / Dispatcher / Binding

## Open Questions

### 技术 OQ（给 reviewer）

1. `loadProjectPrompts` 每次 `buildConversationCapability` 调用都扫磁盘——prompt 文件量小（十几个），当前可接受。是否需要在 builder 层加缓存？
2. `mergePrompts` 返回新数组（不修改全局 registry 的 prompts 数组）——请确认 `collectActiveSkills(activePromptIds, allPrompts)` 使用合并后列表时行为正确

### 价值 OQ（给 CVO，如有）

无

## Next Action

请 review PR #285 代码变更，特别关注：
- `registry.ts` 新增的 `loadProjectPrompts` / `mergePrompts` 实现
- `builder.ts` 中 overlay 集成和 `resolveHandbookRef` 改动
- `platform-paths.ts` 的初始化时机

## Review Sandbox（必填）

- Path: `/tmp/snail-shell-review/F2026052607/{reviewer-handle}`
- Start Command: `npm run check`（纯后端，无需启动服务）
- Ports: N/A（无前端 / 无运行时服务改动）

## 自检证据

### Spec 合规

Quality Gate 通过。Spec 7 项 P1 AC + 3 项 P2 AC + 2 项通用 AC 全部满足。
Follow-up tail scan: 代码文件 0 命中。
Artifact hygiene: 无根目录媒体工件。

### 测试结果

npm run check → 42/42 pass, exit 0
  - ESLint: 0 errors
  - tsc: 0 errors
  - 新增 14 项 project-overlay 测试

### 相关文档

- Spec: `docs/features/2026/05/26/F2026052607-project-overlay-loader.md`
- BACKLOG: F2026052607 in-progress
- 关联: F2026052606（前置），#276, #279, #284
