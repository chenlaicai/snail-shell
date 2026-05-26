---
id: F2026052603
title: Feature Chain 历史追踪机制
from_ids: []
tags: [knowledge, search, workflow]
modules: [project_management]
---
# F2026052603 Feature Chain 历史追踪机制

## 背景

当前 Feature 之间完全扁平，AI 在新建 Feature 时无法感知历史 Feature 中相关模块、相关功能的讨论和决策，导致同一个问题反复改、同一个坑反复踩。需要在系统中引入 Feature 之间的引用链机制，让 AI 在分析新需求时可以主动搜索历史 Feature 文档，建立 from_ids 关联链。

## 目标

1. `docs/features/` 下所有 Feature 文档增加 YAML frontmatter（id, title, from_ids, tags, modules），作为唯一真相源
2. 系统启动时解析所有 Feature 文档 frontmatter + 正文，写入独立索引表 `feature_chain_index`，建 FTS5 全文搜索
3. 新增 `feature-chain` skill，支持 search/get/chain 三种查询模式
4. AI 在建新 Feature 分析需求时，可主动搜索历史库，确定关联后在 feature 文档 frontmatter 中写入 from_ids
5. 系统提示词 S-02 注入 skill 引用

## 非目标

- 不在系统启动时自动注入 from_ids 链摘要（新 Feature 启动时 from_ids 为空）
- 不做增量更新机制，索引仅在系统启动时全量重建
- 不修改已有 Feature 文档（迁移后置，先搭机制）
- 不提供 feature_index 表的增量同步 API

## 设计

### 数据模型

- 独立索引表 `feature_chain_index`：存放 feature_id、title、summary、from_ids、tags、modules、doc_path、created_at
- FTS5 虚拟表 `feature_chain_search`：对 title、summary、tags、modules、body（正文全文）建索引
- 反向索引 `feature_chain_backlink`：(feature_id, from_feature_id) 对，从 from_ids 自动推导

### 索引初始化

- 触发时机：系统启动时，ConversationStore 初始化后调用 `store.rebuildFeatureChainIndex()`
- 流程：扫描 `docs/features/**/F*.md` → 手动分割 `---` 解析 YAML frontmatter + 正文 → 清空 `feature_chain_index` → 全量重建（DELETE + INSERT） → 重建 `feature_chain_search`（FTS5 外部内容表，DELETE + INSERT 直接操作） → 重建 `feature_chain_backlink`
- 不依赖 gray-matter 等第三方库，使用内置 `yaml` 包解析 frontmatter
- 不做增量更新，`docs/features/` 是唯一真相源

### feature-chain skill

- `--mode search --query <keywords> [--limit 10]`：FTS5 全文搜索
- `--mode get --id <FYYYYMMDDNN>`：返回完整 Feature 文档（frontmatter + 正文）
- `--mode chain --id <FYYYYMMDDNN> [--direction backward|forward|both]`：追溯引用链

### AI 补充 from_ids

- AI 在 development 过程中使用 `feature-chain --mode search` 发现关联后，可通过 `updateFeatureChainLink()` 同时更新 Feature 文档 frontmatter 和 DB 索引

### 使用流程

1. 新建 Feature 文档（from_ids 为空）
2. AI 分析需求时调用 feature-chain --mode search 搜索历史
3. AI 确定关联后，在 feature 文档中写入 from_ids（及 tags、modules）
4. 已合入的 Feature 文档不可修改 from_ids（单向引用）

## 生效路径

- DB schema：`src/persistence/schema.ts` 新增三张表
- 代码模块：`src/feature-chain/`（indexer, search, service, cli）
- Skill：`.meta/skills/feature-chain/SKILL.md` + `scripts/feature-chain.js`
- 提示词：S-02 历史能力增加 skill 引用
- Feature 文档模板：`docs/README.md` 更新模板，加入 frontmatter 示例
- 启动入口：应用启动流程挂载索引重建

## 改动范围

- `src/persistence/schema.ts`：新增 feature_chain_index / feature_chain_search / feature_chain_backlink 三张表 + 索引
- `src/persistence/store.ts`：新增 `rebuildFeatureChainIndex()` 公开方法
- `src/feature-chain/`：新模块（indexer.ts）
- `src/main.ts`：启动入口增加索引重建调用
- `.meta/skills/feature-chain/`：新 skill（SKILL.md + scripts/feature-chain.js）
- `.meta/scripts/db-bridge.js`：新增 featureChain module（search / get / chain）+ CLI mode
- `.meta/prompts/prompts/S-02-历史能力.md`：新增 skill 引用
- `docs/README.md`：feature 文档模板增加 frontmatter 示例

## 验证

- 索引重建：启动后 DB 中存在所有 Feature 文档的索引记录
- FTS 搜索：`feature-chain --mode search --query <关键词>` 返回匹配结果
- 链路追溯：`feature-chain --mode chain --id <id>` 返回正确的前向/后向引用链
- 新 Feature 文档模板包含 frontmatter

## 风险与决策记录

- 索引体积：当前 ~60 个 Feature 文档，全文索引体积可控；未来 Feature 数量大幅增长后可考虑分段索引
- 启动耗时：每次启动全量解析 ~60 个 markdown 文件，应当 <1s；后续 Feature 增多时再评估

## 范围变更记录

（待实现过程中补充）
