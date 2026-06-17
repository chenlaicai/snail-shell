---
id: F2026061701
title: rednote-research-mcp-server
from_ids: [F2026060901]
tags: [mcp, search, xiaohongshu, research]
modules: [mcp]
doc_kind: spec
---

# F2026061701 [mcp] Rednote Research MCP Server — 小红书关键词搜索与内容调研

<!-- [design-time] 以下章节在需求收敛与设计阶段完成并锁定 -->

## 背景

用户需要一个小红书关键词搜索和内容整理工具，用于辅助调研场景（如竞品分析、产品调研、需求挖掘）。现有社区方案（xiaohongshu-mcp、xhs-research）存在以下问题：

1. **依赖外部组件**：xiaohongshu-mcp 是独立 Go 二进制 + Docker，xhs-research 依赖 xiaohongshu-mcp 运行
2. **无法融入平台**：社区工具是独立进程，无法跟随 Snail Shell 平台启动，不支持多 agent 复用
3. **Session 管理被动**：cookie 过期后需要手动重新扫码，无自动化重试机制

小红书官方未提供公开的内容搜索 API 或 AI Agent 集成，所有搜索能力必须通过浏览器自动化实现。

## 目标

在 Snail Shell 平台内实现一个自包含的小红书调研 MCP Server，满足：

- 不依赖任何第三方小红书工具（xiaohongshu-mcp 等）
- 跟随 Snail Shell 平台启动，作为平台级 MCP Server 注册
- 多 agent 可复用同一套搜索能力
- Session 过期时自动检测并引导重新登录

### P1 — 搜索引擎核心

- 实现 Playwright 浏览器自动化搜索（导航 → `__INITIAL_STATE__` 提取）
- 实现关键词扩展（查询意图分类 + 噪音词剥离 + 后缀扩展）
- 实现三维评分（相关性 40% + 时效性 25% + 互动量 35%）
- 实现两层去重（feed_id 精确 + Jaccard 标题 trigram）
- 实现笔记详情 + 评论抓取

### P2 — MCP 集成

- 暴露 3 个 MCP tools：`research_notes`、`login`、`check_login`
- 注册为平台级 MCP Server（与 `snail-final-response`、`evolution`、`knowledge` 同级）
- 通过 v2 Hono handler 自动处理 JSON-RPC 请求（`src/infra/mcp-server/handler.ts`）

### P3 — Session 管理

- Playwright persistent context 持久化浏览器 profile
- 搜索时被动检测 auth_required（登录页重定向）和 no_results（搜索为空）
- 检测到 auth_required 时返回结构化错误，LLM 自动调用 `login` 重试

## 非目标

- 不实现小红书发布、评论、点赞等写入操作——本工具仅用于搜索调研
- 不实现反爬虫对抗的高级策略（代理池、指纹轮换等）——依赖 Playwright 的基础反检测
- 不实现跨平台搜索——仅支持小红书
- 不自动下载 Chromium——使用用户本地已安装的 Chrome

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当调用 `research_notes` 且 session 有效时 | 返回包含评分和去重结果的结构化 JSON | |
| B2 | 当调用 `research_notes` 且 session 已过期时 | 返回 `{ error: "auth_required" }` 错误 | |
| B3 | 当调用 `login` 且用户在 120 秒内扫码成功时 | 返回 `{ status: "success" }` | |
| B4 | 当调用 `login` 且超时未扫码时 | 返回 `{ status: "timeout" }` | |
| B5 | 当调用 `check_login` 且 session 有效时 | 返回 `{ logged_in: true }` | |
| B6 | 当调用 `check_login` 且 session 无效时 | 返回 `{ logged_in: false }` | |
| B7 | 当多个 tool 并发调用时 | 异步锁保证同一时间只有一个浏览器实例访问 userDataDir | |

## 设计

### 数据获取层

**搜索原理**：Playwright 启动 Chrome → 导航到 `https://www.xiaohongshu.com/search_result?keyword=xxx` → 等待 React hydration → 从 `window.__INITIAL_STATE__.search.feeds.value` 提取数据。

与 xiaohongshu-mcp 的区别：不依赖其 Go 二进制，用 TypeScript + Playwright-core 自行实现相同的搜索逻辑。

**浏览器生命周期**：每次请求启动/销毁（方案 B）。理由：简单，无状态泄漏，避免长驻进程的内存占用。每次搜索的延迟主要来自页面导航和 React hydration（3-6 秒），浏览器启动开销（1-2 秒）占比不大。

**Session 持久化**：Playwright persistent context，userDataDir 为 `~/.rednote-research/browser-profile/`。首次需要扫码登录，之后 session 自动保持。

### 搜索引擎

**关键词扩展**：分类查询意图（推荐/测评/攻略/避雷/调研/通用）→ 噪音词剥离 → 后缀扩展。生成 5-8 个搜索关键词。

**三维评分**：
- 相关性 40%：中文 bigram 切分，`0.60 * coverage^1.35 + 0.25 * precision + 0.15 * title_bonus`
- 时效性 25%：线性衰减，365 天窗口
- 互动量 35%：`0.40*log1p(favorites) + 0.30*log1p(likes) + 0.30*log1p(comments)`，min-max 归一化

**去重**：
1. feed_id 精确去重
2. Jaccard 标题 trigram 去重（阈值 0.60），保留互动量更高的版本

**详情抓取**：Top N 笔记获取全文（截断 800 字）+ 最多 8 条评论（每条评论最多 2 条子回复），500ms 间隔避免风控。

### MCP Tools

| Tool | 输入 | 输出 | 说明 |
|------|------|------|------|
| `research_notes` | `topic` (string), `options?` ({depth, days, top_n}) | 结构化 JSON（关键词、去重结果、评分、详情） | 一站式调研 |
| `login` | 无 | `{ status: "success"/"timeout" }` | headed 模式打开登录页 |
| `check_login` | 无 | `{ logged_in: boolean }` | headless 检查登录状态 |

### 并发安全

Chromium 同一时间只允许一个进程访问同一 userDataDir。通过互斥锁（`mutex`）保证同一时间只有一个 context 存活，锁在 `context.on("close")` 时释放。

### Auth 检测

两层检测：
1. 搜索前：检查页面 URL 是否包含 `login` 或 `passport` → 返回 `auth_required`
2. 搜索后：结果为空时返回 `no_results`（区分于认证错误）

### 设计决策

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | MCP vs Skill | MCP tool call 不需要上下文切换，Snail Shell 多 agent 可复用 | Skill 更适合流程编排场景 | MCP Server | 搜索是工具调用，且 Snail Shell 是多 agent 系统 | 用户 | 2026-06-09 |
| D2 | 浏览器生命周期 | 方案 A（长驻）响应快；方案 B（每次请求）简单无状态 | 方案 A 内存占用高、需要崩溃恢复 | 方案 B（每次请求启动/销毁） | 页面导航延迟（3-6s）是主要开销，浏览器启动（1-2s）占比不大 | 用户 | 2026-06-09 |
| D3 | 评分/去重放在哪 | 粗粒度 tool 一次调用搞定；细粒度 tool LLM 灵活编排 | 粗粒度执行时间长；细粒度编排复杂 | 粗粒度（MCP server 内部完成） | 核心价值是自动化，不应让 LLM 编排 10+ 次 tool call | 用户 | 2026-06-09 |
| D4 | 技术栈 | TypeScript 全栈一致；Python 已有现成引擎 | 重写评分算法有工作量 | TypeScript 全栈重写 | 不引入额外 Python 运行时依赖 | 用户 | 2026-06-09 |
| D5 | 浏览器依赖 | playwright-core 轻量不自动下载；playwright 自动下载 Chromium | 用户需自行安装 Chrome | playwright-core + 本地 Chrome | 减少依赖体积，用户环境已有 Chrome | 用户 | 2026-06-09 |
| D6 | MCP Server 位置 | 内嵌在 Snail Shell 代码中（与 snail-final-response 同级）；独立项目 | 内嵌跟着平台启动，后续可加观测/安全机制 | 内嵌在 `src/domain/snail-mcp-server/_internal/servers/rednote-research/` | 需要跟随平台启动，遵循 v2 domain-driven 架构 | 用户 | 2026-06-09 |

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/domain/snail-mcp-server/_internal/servers/rednote-research.ts` | 新增 | MCP Server 定义 + handler，支持 RednoteResearchConfig 配置 |
| `src/domain/snail-mcp-server/_internal/servers/rednote-research/types.ts` | 新增 | Feed、SearchResult、DetailResult 等类型定义 |
| `src/domain/snail-mcp-server/_internal/servers/rednote-research/browser.ts` | 新增 | Playwright 浏览器生命周期管理、登录检测、异步锁、临时目录清理 |
| `src/domain/snail-mcp-server/_internal/servers/rednote-research/engine/keywords.ts` | 新增 | 关键词扩展（意图分类 + 噪音词剥离 + 后缀扩展） |
| `src/domain/snail-mcp-server/_internal/servers/rednote-research/engine/scoring.ts` | 新增 | 三维评分算法（相关性 + 时效性 + 互动量） |
| `src/domain/snail-mcp-server/_internal/servers/rednote-research/engine/dedup.ts` | 新增 | 两层去重（feed_id + Jaccard 标题） |
| `src/domain/snail-mcp-server/_internal/servers/rednote-research/engine/search.ts` | 新增 | Playwright 搜索逻辑（导航 + __INITIAL_STATE__ 提取） |
| `src/domain/snail-mcp-server/_internal/servers/rednote-research/engine/detail.ts` | 新增 | 笔记详情 + 评论抓取 |
| `src/domain/snail-mcp-server/_internal/initor.ts` | 修改 | 注册 rednote-research 为平台级 MCP Server |
| `package.json` | 修改 | 新增 `playwright-core` 依赖 |
| `docs/features/2026/06/17/F2026061701-*.md` | 新增 | 本文档 |

## 验证

### P1

- [ ] TypeScript 编译通过（`npx tsc --noEmit`）
- [ ] ESLint 通过（`npx eslint src/domain/snail-mcp-server/_internal/servers/rednote-research/`）
- [ ] 关键词扩展：输入"咖啡机推荐"生成 ≥5 个相关关键词
- [ ] 评分算法：相同结果集多次评分结果一致
- [ ] 去重：重复 feed_id 和相似标题均被正确去除

### P2

- [ ] Snail Shell 启动后 rednote-research endpoint 可访问
- [ ] `research_notes` 返回结构化 JSON（含 keywords_used、results、stats）
- [ ] `login` 打开 headed Chrome 显示登录页
- [ ] `check_login` 正确返回登录状态

### P3

- [ ] session 有效时 `research_notes` 正常返回搜索结果
- [ ] session 过期时返回 `{ error: "auth_required" }`
- [ ] 登录页重定向时返回 auth_required 错误
- [ ] 并发调用不导致 userDataDir 冲突

### 通用

- [ ] 无 TypeScript 编译错误
- [ ] 无 ESLint 错误
- [ ] `playwright-core` 正确安装且不自动下载 Chromium

## 关联

- **参考**: [xpzouying/xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp) — 搜索原理参考（`__INITIAL_STATE__` 提取方式）
- **参考**: [kunhai1994/xhs-research](https://github.com/kunhai1994/xhs-research) — 评分/去重/关键词扩展算法参考

## 范围变更记录

| # | 变更类型 | 变更内容 | 原因 | 日期 |
|---|----------|----------|------|------|
| 1 | 架构迁移 | 从 v1 `src/mcp/` 迁移到 v2 `src/domain/snail-mcp-server/`，文档编号更新为 F2026061701 | 适配 v2 domain-driven 架构，避免编号冲突 | 2026-06-17 |
| 2 | Review 修复 | 添加 RednoteResearchConfig 配置接口；修复 mutex 并发 bug；统一错误处理为抛异常模式；使用临时目录 + 自动清理 | 对抗性检视反馈 | 2026-06-17 |
