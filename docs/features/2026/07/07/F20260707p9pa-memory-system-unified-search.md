---
id: F20260707p9pa
title: 记忆系统统一搜索架构
from_ids: []
tags: [memory, search, fts5, architecture]
modules: [memory-search, knowledge, message, feature-chain, evolution, snail-mcp-server]
created_at: 2026-07-07
---

# F20260707p9pa: 记忆系统统一搜索架构

## 用户意图锚

| UA | 用户原话 | 来源 | 关键修饰语 | 架构师解读 |
|----|---------|------|-----------|-----------|
| UA-1 | "你分析https://github.com/chenlaicai/snail-shell/issues/588，然后看看本系统的记忆系统如何搭建" | 消息 1 | 空间：本系统（Snail Shell）；时序：先分析后设计；条件：基于 issue #588 的洞察 | 用户要求先分析 issue #588 的内容，然后基于其洞察设计 Snail Shell 的记忆系统架构。分析范围 = issue #588 提出的 5 个问题。设计目标 = 可落地的记忆系统方案。 |

## 背景与问题分析

### Issue #588 的核心洞察

Issue #588 记录了 5 个关键洞察：

1. **传统搜索引擎管线与 Agent 互补**：管线负责多路召回+融合排序（零 LLM 参与），Agent 负责意图理解+策略决策
2. **Agent 场景下传统管线劣势消解**：意图理解由 Agent 完成、冷启动可多轮迭代、管线复杂度变为可编排优势
3. **多轮召回是核心**：Agent 评估→策略调整→终止判断的迭代循环
4. **Agent 用管线 > 人用管线**：查询构造更精确、迭代意愿强、结果评估更完整
5. **Snail Shell 当前是 LLM-driven retrieval**：Agent 决定搜什么、调哪个工具，但每个工具是单路检索，无融合排序

### 当前系统的 4 个搜索机制

| 域 | 搜索方式 | 文件位置 | 问题 |
|----|---------|---------|------|
| Knowledge | FTS5 (`unicode61`) | `knowledge/_internal/search-index.ts` | 中文被拆为单字，无词组匹配；无跨域搜索 |
| Message | SQL LIKE (全表扫描) | `message/_internal/repository.ts:searchContext()` | 无排名、逐 stage 搜索、性能随数据量下降 |
| Feature Doc | 内存子串匹配 | `feature-chain/_internal/repository.ts:search()` | 不支持排名、数据量大时内存占用高 |
| Evolution | 内存子串匹配 | `evolution/_internal/repository.ts:search()` | 同上 |

**核心问题**：Agent 需要知道"搜什么应该调哪个工具"，且各工具结果格式不统一、无跨域融合排序。

### Issue #588 提出的 5 个设计问题

1. Snail Shell 是否需要引入传统搜索管线（或部分引入）
2. 如何与现有 MCP 工具体系融合
3. 多路召回在 Snail Shell 数据特点下的适配
4. 是否需要引入向量检索
5. Agent 多轮编排管线的交互协议设计

## 设计方案

### 架构总览

```
Agent（意图理解 + 策略决策）
  ↓ search_memory(query, options)
统一搜索 MCP 工具（单一入口）
  ↓
搜索协调器（顺序查询 + 结果融合）
  ├── FTS5 通道
  │   ├── Knowledge 索引（trigram，升级自 unicode61）
  │   ├── Message 索引（trigram，替代 LIKE）
  │   ├── Feature Doc 索引（trigram，替代内存匹配）
  │   └── Evolution 索引（trigram，替代内存匹配）
  ├── 元数据通道（tags / scope / time_range / content_type）
  └── （未来）向量通道
  ↓
融合排序器
  - 各域 bm25 分数 max 归一化
  - 域权重加权
  - 条件多样性重排（域间最高分差异 <20% 时启用）
  ↓
统一结果格式
  { content_type, id, title, snippet, score, source, metadata }
```

### 对 Issue #588 五个问题的回答

#### Q1: 是否需要引入传统搜索管线？

**结论：部分引入。**

引入传统管线中的两个环节：**多路召回**和**融合排序**。不引入粗排/精排分层——Snail Shell 数据量（百级知识条目、千级消息、十级特性文档）不需要从百万级粗排到百级。

| 管线环节 | 是否引入 | 理由 |
|---------|---------|------|
| 多路召回 | ✅ | FTS5 + 元数据过滤，顺序查询各域（SQLite 同步执行） |
| 粗排 | ❌ | 数据量小，FTS5 bm25 直接精排 |
| 精排 | ✅（FTS5 bm25 替代） | 内置 bm25 排名足够 |
| 重排 | ✅ | 跨域归一化 + 域权重加权 + 条件多样性重排 |
| 向量召回 | ❌（本次） | FTS5 + trigram 覆盖 90% 场景；架构预留扩展点 |

#### Q2: 如何与现有 MCP 工具体系融合？

**新增 `search_memory` MCP 工具作为统一入口，保留现有域工具用于精确查询。**

| 工具类型 | 用途 | 保留/新增 |
|---------|------|----------|
| `search_memory` | 跨域探索性搜索 | 新增 |
| `search_knowledge` | 知识库精确搜索 | 保留 |
| `search_messages` | 消息历史精确搜索 | 保留（内部升级为 FTS5） |
| `search_feature_chain` | 特性文档精确搜索 | 保留（内部升级为 FTS5） |

Agent 日常使用 `search_memory` 即可；需要域特定查询（如按 stage 查消息、按 ID 查特性文档）时使用域工具。

#### Q3: 多路召回在 Snail Shell 数据特点下的适配

Snail Shell 有 4 类可搜索数据，各有不同的数据特点和更新模式：

| 数据类型 | 数据量 | 更新频率 | 真相源 | FTS5 索引策略 |
|---------|--------|---------|--------|--------------|
| Knowledge | 百级 | 低频 | 文件（markdown） | 双写：文件 + FTS5，启动时校验重建 |
| Message | 千级 | 高频 | SQLite（message_context） | 同步写入 FTS5（事务内，B7） |
| Feature Doc | 十级 | 极低频 | 文件（markdown） | 启动时从文件重建 |
| Evolution | 十级 | 低频 | SQLite（evolution_item） | 双写：SQLite + FTS5 |

**多路召回设计**：
- **FTS5 通道**：各域独立 FTS5 索引，协调器顺序查询（SQLite/better-sqlite3 是同步执行）
- **元数据通道**：tags、scope、content_type、time_range 过滤，作为 FTS5 查询的 WHERE 条件（严格来说是过滤而非独立召回，不产生候选集，而是缩小 FTS5 候选集）
- 各域 FTS5 索引保持独立（对齐 DDD），不合并为统一表
- **召回路数**：1 路召回（FTS5 bm25）+ 1 路过滤（元数据），业界典型 3-5 路（BM25 + 向量 + 标签 + 图谱）

#### Q4: 是否需要引入向量检索？

**结论：本次不引入，架构预留扩展点。**

| 维度 | FTS5 + trigram | 向量检索 |
|------|---------------|---------|
| 中文支持 | trigram 3 字符滑窗，比 unicode61 单字更精确 | 不受语言限制 |
| 语义理解 | 无（字面匹配） | 有（不同表述相同语义可匹配） |
| 排序质量 | bm25（词频+文档频率） | 余弦相似度（语义距离） |
| 依赖 | SQLite 内置 | 需嵌入模型（外部依赖） |
| 成本 | 零额外成本 | 嵌入推理 + 向量索引存储 |
| 多轮补偿 | Agent 可多轮迭代逼近 | 减少迭代次数 |

**判断依据**：FTS5 + trigram + Agent 多轮迭代可覆盖 90% 场景。向量检索的核心价值（语义匹配）可通过 Agent 调整关键词多轮查询部分补偿。引入向量检索需要嵌入模型依赖，增加系统复杂度。

**预留扩展**：搜索协调器的通道接口设计为可扩展的，未来新增向量通道只需实现 `SearchChannel` 接口。

**向量检索引入时机**（未来参考）：
- FTS5 多轮搜索仍然找不到用户需要的内容（说明字面匹配已不够用）
- 数据量增长到万级以上（FTS5 召回率开始下降）
- 用户有明确的"搜不到但应该能搜到"的反馈
- 系统愿意接受嵌入模型的外部依赖

#### Q5: Agent 多轮编排管线的交互协议设计

**结论：无需特殊协议，Agent 通过多次调用 `search_memory` 自然迭代。**

Issue #588 描述的多轮召回循环：
```
轮次1: 宽泛查询 → 召回 N 条 → Agent 评估"缺什么"
轮次2: 调整关键词/换通道 → 召回 M 条 → Agent 判断"是否接近"
轮次3: 精确定向查询 → 召回 K 条 → Agent 确认"命中目标"
```

在 Snail Shell 中，这个循环通过 Agent 调用 `search_memory` 自然实现：
- 轮次1：`search_memory("记忆系统")` → 评估结果
- 轮次2：`search_memory("FTS5 搜索索引", {content_types: ["knowledge"]})` → 缩小范围
- 轮次3：`search_memory("trigram tokenizer 中文", {tags: ["search"]})` → 精确定向

**为什么不需要 session 状态**：
- 每轮搜索是独立的 FTS5 查询，不依赖前序结果
- Agent 自行维护上下文（记住搜过什么、结果如何）
- 无状态协调器更简单、更可靠
- 如果未来需要"基于前序结果优化查询"（如相关度反馈），可再引入 session

### 关键设计决策

#### 决策 1: FTS5 分词器 — `unicode61` → `trigram`

| 维度 | `unicode61`（当前） | `trigram`（方案） |
|------|---------------------|-------------------|
| 中文处理 | 每个汉字作为独立 token | 3 字符滑窗（"记忆系"、"忆系统"） |
| 查询精度 | 低（"记忆系列" 匹配 "记忆系统"） | 高（trigram "忆系统" 不匹配 "忆系列"） |
| 短查询（<3 字符） | 正常工作（单字 token） | MATCH 无 token；回退 LIKE |
| 排序 | bm25（MATCH） | bm25（MATCH，≥3 字符）；无排序（LIKE，<3 字符） |
| SQLite 版本 | 内置 | 3.34+（当前 3.53.1 ✅） |
| 外部依赖 | 无 | 无 |

**决策**：采用 `trigram`。对 ≥3 Unicode 字符的查询使用 `MATCH`（有 bm25 排序），对 <3 字符的查询回退到原始表 `LIKE`（非 FTS5 虚拟表，避免 FTS5 层额外开销）。

**正反论点**：
- ✅ 支持：中文查询精度显著提升；≥3 字符 LIKE 在 FTS5 表上有 trigram 加速
- ❌ 反对：短查询无排序；英文 trigram 冗余（"hello" → "hel","ell","llo"）
- 反驳：短查询在实际使用中罕见（<5%）；英文 trigram 冗余可接受（不影响正确性，仅索引稍大）

**trigram 与 LIKE 的关键技术事实**（基于 SQLite 3.51.0 源码验证）：
- trigram tokenizer **可以加速** ≥3 Unicode 字符的 LIKE 查询（通过将 LIKE 模式转换为 trigram MATCH 表达式）
- trigram tokenizer **无法加速** <3 Unicode 字符的 LIKE 查询——回退到 FTS5 虚拟表全表扫描，且比原始表 LIKE **更慢**（FTS5 虚拟表层有额外开销）
- 因此 <3 字符查询应使用原始表 LIKE，而非 FTS5 虚拟表 LIKE

#### 决策 2: 各域独立 FTS5 索引 — 不合并为统一表

**正反论点**：
- ✅ 支持：对齐 DDD 架构；各域独立管理索引生命周期；schema 变更不跨域影响
- ❌ 反对：协调器需顺序查询多表；跨域结果需要额外融合逻辑
- 反驳：SQLite 同步执行多表查询性能可接受（数据量百/千/十级）；跨域融合通过 max 归一化 + 域权重解决

#### 决策 3: 统一搜索入口 — 新增 `search_memory` MCP 工具

**正反论点**：
- ✅ 支持：Agent 无需知道"搜什么调哪个工具"；一次查询获得跨域融合结果
- ❌ 反对：域工具已有各自参数（如 feature chain 的 chain 查询），统一入口无法覆盖
- 反驳：统一入口面向探索性搜索（90% 场景）；域工具保留用于精确查询（10% 场景）

#### 决策 4: 向量检索 — 本次不引入

**正反论点**：
- ✅ 支持（不引入）：无外部依赖；FTS5 + trigram + Agent 多轮覆盖 90%；降低复杂度
- ❌ 反对（应引入）：语义匹配是 FTS5 的根本短板；Agent 多轮迭代消耗 token
- 反驳：token 消耗是 Agent 决策成本，不是管线成本；用 LLM 做策略决策比用 LLM 做逐条打分更合理（issue #588 成本注记）

### 行为规格

| ID | 行为 | 预期行为 | 追溯 |
|----|------|---------|------|
| B1 | 跨域搜索 | 当 Agent 调用 `search_memory(query)` 时，系统查询所有已启用域的 FTS5 索引，返回融合排序后的 top N 结果 | ← UA-1 |
| B2 | 域过滤 | 当 Agent 调用 `search_memory(query, {content_types: ["knowledge"]})` 时，仅搜索指定域 | ← UA-1 |
| B3 | 标签过滤 | 当 Agent 调用 `search_memory(query, {tags: ["search"]})` 时，仅返回匹配至少一个标签的结果 | ← UA-1 |
| B4 | 时间范围过滤 | 当 Agent 调用 `search_memory(query, {time_range: {after: "2026-01-01"}})` 时，仅返回时间范围内的结果 | ← UA-1 |
| B5 | 短查询回退 | 当查询长度 < 3 Unicode 字符时，系统使用 `LIKE` 搜索原始表（非 FTS5 虚拟表），因为 trigram tokenizer 无法加速 <3 字符的 LIKE 查询 | ← UA-1 |
| B6 | 知识索引同步 | 当新增/修改/删除知识条目时，FTS5 索引同步更新（双写，保持当前行为） | ← UA-1 |
| B7 | 消息索引同步 | 当消息 context 创建时，FTS5 索引同步更新（事务内，保证一致性） | ← UA-1 |
| B8 | 特性文档索引重建 | 当特性文档文件变更时，下次启动时从文件重建 FTS5 索引 | ← UA-1 |
| B9 | 启动校验 | 系统启动时，所有 FTS5 索引与真相源校验，不一致时重建 | ← UA-1 |
| B10 | 结果格式统一 | 每条结果包含：content_type、id、title、snippet、score、source、metadata | ← UA-1 |
| B11 | 融合排序 | 跨域结果按 max 归一化 bm25 分数 × 域权重排序；当域间最高分差异 <20% 时启用多样性重排（每域上限 ⌈top_n / num_active_domains × 1.5⌉），否则直接按分数取 top N | ← UA-1 |
| B12 | 域工具兼容 | 现有 `search_knowledge`、`search_messages`、`search_feature_chain` 继续可用，内部升级为 FTS5 | ← UA-1 |
| B13 | 部分降级 | 当某域搜索失败时，协调器跳过该域，返回其他域的结果，不整体失败 | ← UA-1 |

### 搜索协调器接口设计

```
SearchChannel（各域实现）
  - search(query: string, options: SearchOptions): ChannelResult[]
  - rebuild(): void
  - validate(): boolean

SearchCoordinator（协调器）
  - search(query: string, options: SearchOptions): UnifiedSearchResult[]
    1. 调用各 Channel.search()（某域失败时跳过，不整体失败）
    2. 归一化各域分数（max 归一化）
    3. 域权重加权
    4. 多样性重排（仅当域间最高分差异 <20% 时启用）
    5. 返回 top N
```

### `search_memory` MCP 工具参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| query | string | ✅ | 搜索查询 |
| content_types | string[] | ❌ | 限定搜索域：knowledge / message / feature_doc / evolution |
| tags | string[] | ❌ | 标签过滤 |
| scope | string | ❌ | 范围过滤：platform / workspace |
| workspace_path | string | ❌ | 工作区路径（scope=workspace 时） |
| time_range | { after?: string; before?: string } | ❌ | 时间范围 |
| top_n | number | ❌ | 返回结果数（默认 20） |

### 返回结果格式

```typescript
interface UnifiedSearchResult {
  content_type: "knowledge" | "message" | "feature_doc" | "evolution";
  id: string;
  title: string;
  snippet: string;       // 高亮摘要
  score: number;         // 归一化分数 0-1
  source: {
    domain: string;      // 域标识
    file_path?: string;  // 文件路径（如适用）
    stage_id?: string;   // 消息所属 stage（如适用）
    url?: string;        // 外部链接（如适用）
  };
  metadata: {
    tags?: string[];
    scope?: string;
    created_at?: string;
    [key: string]: unknown;
  };
}
```

## 不兼容更新

| 变更 | 影响范围 | 处理方式 |
|------|---------|---------|
| Knowledge FTS5 分词器 `unicode61` → `trigram` | 现有知识库搜索索引 | 启动时自动 DROP + CREATE + 重建（文件为真相源，无数据丢失） |
| Message 搜索 `LIKE` → FTS5 | `search_messages` 工具内部实现 | 行为变化：搜索结果可能略有不同（trigram 更精确） |
| Feature Doc 搜索 内存匹配 → FTS5 | `search_feature_chain` 工具内部实现 | 行为变化：搜索结果可能略有不同 |
| Evolution 搜索 内存匹配 → FTS5 | evolution search 内部实现 | 行为变化：搜索结果可能略有不同 |

**无需人工干预**：所有索引变更在启动时自动完成。FTS5 索引是派生数据，真相源（文件/SQLite 表）不受影响。

## 实现指引

### 新增 memory-search 域

创建 `src/domain/memory-search/` 目录，包含：
- `port.ts` — `SearchChannel` 接口、`SearchCoordinator` 接口
- `_internal/coordinator.ts` — 搜索协调器实现（顺序查询 + 融合排序）
- `_internal/fusion-ranker.ts` — 分数归一化 + 域权重 + 条件多样性重排

### 各域 FTS5 索引改造

**Knowledge（已有 FTS5，升级分词器）**：
- 问题：`CREATE VIRTUAL TABLE IF NOT EXISTS` 不会修改已有表的分词器
- 方案：启动时检测分词器版本（查询 `sqlite_master` 获取 CREATE 语句，解析 tokenize 参数），不一致时 DROP + CREATE + 从文件重建
- 约束：不使用 ALTER TABLE（系统禁止），使用 DROP + CREATE

**Message（新增 FTS5）**：
- 新建 `message_search` FTS5 表（trigram），索引 `message_context.context`
- 写入时机：`message_context` 创建时同步写入 FTS5（事务内，保证一致性）
- 重建：从 `message_context` 表全量重建

**Feature Doc（新增 FTS5）**：
- 新建 `feature_doc_search` FTS5 表（trigram），索引 title + summary + body
- 写入时机：启动时从文件重建（与当前内存匹配一致）
- 验证：文件修改时间 vs 索引时间

**Evolution（新增 FTS5）**：
- 新建 `evolution_search` FTS5 表（trigram），索引 title + content
- 写入时机：`evolution_item` 创建/更新时同步写入 FTS5
- 注意：当前 evolution search 实现是全量加载 SQLite 数据到内存后 JS 过滤，需改为 SQL-level FTS5 MATCH 查询，不再全量加载

### MCP 工具注册

在 `snail-mcp-server/_internal/initor.ts` 注册新的 `snail-memory-search` MCP server，包含 `search_memory` 工具。

### 融合排序实现要点

- **分数归一化**：各域 bm25 分数范围不同，使用 max 归一化（score / max_score）到 [0, 1]，避免 min-max 在单结果时的除零问题
- **域权重**：默认 knowledge=1.0, feature_doc=1.0, evolution=0.9, message=0.8（消息量大但相关性通常较低）
- **多样性**：每域最多返回 `top_n / num_active_domains * 1.5` 条（向上取整）；仅当域间最高分差异 <20% 时启用，避免强制多样性排除高分结果

## 与业界搜索引擎实践的取舍

### 设计哲学：轻量管线 + Agent 编排

本方案的核心设计哲学是 **"轻量管线 + Agent 编排"**——管线只做基础召回和排序，复杂度交给 Agent 的多轮迭代能力来补偿。

业界搜索引擎服务的是**人**——人搜两三次就累了，所以管线要做得很重，一次给出最优结果。本方案服务的是 **Agent**——Agent 不知疲倦，可以多轮迭代逼近。这意味着管线不需要一次完美，只需每轮返回足够好的候选，Agent 来做策略决策。

这是 Issue #588 的核心洞察：**把 LLM 用在策略决策（高价值）而非逐条打分（低价值）**。

### 本方案 vs 业界典型架构

**业界典型架构**（如 Elasticsearch / Lucene）：
```
查询 → 多路召回（BM25 + 向量 + 标签 + 图谱）→ 粗排 → 精排（GBDT/深度模型）→ 重排（多样性/新鲜度/业务规则）→ 结果
```

**本方案架构**：
```
查询 → FTS5 bm25 召回（4 域）+ 元数据过滤 → max 归一化 + 域权重加权 → 条件多样性重排 → 结果
```

### 逐环节取舍

| 环节 | 业界做法 | 本方案 | 取舍原因 |
|------|---------|--------|---------|
| **召回-字面** | BM25 倒排索引 | FTS5 bm25 | ✅ 一致。SQLite FTS5 内置 bm25，无需自建索引 |
| **召回-语义** | 向量检索（ANN） | ❌ 不做 | Agent 多轮换关键词可补偿；数据量小（百/千/十级）向量优势不显著；避免嵌入模型外部依赖 |
| **召回-标签** | 标签/元数据过滤 | ✅ 元数据通道 | WHERE 条件过滤，不独立召回（缩小 FTS5 候选集而非产生独立候选） |
| **召回-图谱** | 知识图谱关联 | ❌ 不做 | Snail Shell 无图谱数据；Feature Chain 的引用链是简单 DAG，不需要图谱检索 |
| **粗排** | 轻量模型快速筛到百级 | ❌ 跳过 | 数据量本身就是百/千级，FTS5 bm25 直接精排 |
| **精排** | GBDT / 深度学习模型 | ❌ 跳过 | 单排序信号（bm25），无多信号可融合；无训练数据（无点击率/反馈）；数据量不支撑模型训练 |
| **精排-贝叶斯融合** | 贝叶斯模型融合（BMF） | ❌ 不做 | 贝叶斯融合的前提是多排序信号（bm25 + 向量 + 点击率）。本方案单信号无需融合；无点击率/反馈数据；数据量不支撑模型训练 |
| **重排-归一化** | 多种归一化方法 | ✅ max 归一化 | 简单有效，避免 min-max 除零 |
| **重排-融合** | 贝叶斯融合 / RRF | ❌ 线性加权 | 单信号不需要融合；多域间用域权重线性加权即可 |
| **重排-多样性** | MMR / DPP 等算法 | ✅ 条件多样性 | 简单的每域配额限制；仅当域间最高分差异 <20% 时启用，避免排除高分结果 |
| **重排-新鲜度** | 时间衰减因子 | ❌ 不做 | Feature Doc / Evolution 更新频率极低；Message 有 time_range 过滤已够 |
| **重排-业务规则** | 人工规则干预 | ❌ 不做 | Snail Shell 无商业搜索的业务规则需求 |

### 数据量定义管线深度

| 数据量级 | 适用管线 | 本方案对应 |
|---------|---------|-----------|
| 百万级 | 全管线（多路召回 + 粗排 + 精排 + 重排） | — |
| 万级 | 多路召回 + 精排 + 重排 | 未来扩展（引入向量时） |
| 千级 | 单路召回 + 排序 + 重排 | **本方案** |
| 百级 | 全表扫描 + 排序 | 当前 Feature Doc / Evolution |

### 简单方案替代复杂方案的条件

| 复杂方案 | 简单替代 | 替代条件 |
|---------|---------|---------|
| 向量检索 | Agent 多轮换关键词 | 数据量小 + Agent 有迭代能力 |
| 贝叶斯融合 | 线性加权 | 单排序信号，无多信号可融合 |
| MMR 多样性 | 每域配额 + 条件触发 | 域数少（4 个），简单配额够用 |
| 时间衰减 | time_range 过滤 | 更新频率低，不需要动态衰减 |
| 粗排 + 精排 | FTS5 bm25 直接排序 | 数据量本身就是百/千级 |

## [design-time]

### 设计状态
- **已锁定** — 架构师-1 与架构师-2 达成共识

### 架构师-2 审视修改清单

#### P0 — 事实性错误和内部矛盾（已修改）

1. **B5 技术断言修正**：原"LIKE 搜索 FTS5 表（trigram 加速）"错误。经 SQLite 3.51.0 源码验证，trigram tokenizer 无法加速 <3 Unicode 字符的 LIKE 查询，回退到 FTS5 虚拟表全表扫描且比原始表更慢。修改为：<3 字符查询使用原始表 LIKE。

2. **B7 内部矛盾修正**：原 B7 说"异步更新"，实现指引说"同步写入（事务内）"。改为同步写入——FTS5 单行插入是微秒级，一致性保证更重要。

#### P1 — 设计缺陷（已修改）

3. **归一化除零**：min-max 归一化在单结果时 min=max 导致除零。改为 max 归一化（score / max_score）。

4. **内容哈希去重移除**：跨域内容完全相同（知识条目 vs 消息 vs 特性文档 vs 演进项）的概率极低，SHA-256 哈希去重是过度设计。移除。

5. **多样性重排条件化**：原方案无条件强制多样性，会排除高分结果。改为仅当域间最高分差异 <20% 时启用。

6. **新增 B13 部分降级**：某域搜索失败时，协调器跳过该域返回其他域结果，不整体失败。

#### P2 — 实现指引补充（已修改）

7. **Evolution 实现差距标注**：当前 evolution search 全量加载到内存后 JS 过滤，需改为 SQL-level FTS5 查询。

8. **Tokenizer 检测方法**：补充查询 `sqlite_master` 解析 tokenize 参数的方法。

9. **SQLite 并行性说明**：移除"并行查询"表述，SQLite（better-sqlite3）是同步执行，多域查询是顺序的。

### 开放问题决议（架构师-1 确认）

1. **min_score 参数语义**：max 归一化后分数是 per-query 相对的，固定阈值跨查询语义不一致。**决议：移除 min_score。** Agent 可自行过滤结果，不需要系统层阈值。

2. **域权重可配置性**：默认权重 knowledge=1.0, feature_doc=1.0, evolution=0.9, message=0.8。**决议：硬编码。** 数据量小，权重差异不大，后续按需调整代码即可。

### 关键决策记录
| 决策 | 选择 | 替代方案 | 选择理由 |
|------|------|---------|---------|
| 分词器 | trigram | unicode61 / jieba | 内置支持、中文精度提升、无外部依赖 |
| 索引结构 | 各域独立 | 统一表 | 对齐 DDD、独立管理生命周期 |
| 向量检索 | 不引入 | 引入 | FTS5+多轮迭代覆盖 90%，避免外部依赖 |
| 多轮协议 | 无（Agent 自然迭代） | session 状态 | 无状态更简单可靠 |
| 管线深度 | 多路召回+融合排序 | 完整管线（粗排+精排） | 数据量小，不需要分层排序 |
| 贝叶斯融合 | 不引入 | 引入（多信号融合） | 单排序信号（bm25）无需融合；无点击率/反馈数据；数据量不支撑模型训练 |
| 管线哲学 | 轻量管线 + Agent 编排 | 重管线一次最优 | Agent 可多轮迭代补偿管线简单度；把 LLM 用在策略决策（高价值）而非逐条打分（低价值） |
| 消息索引写入 | 同步（事务内） | 异步 | FTS5 单行插入微秒级，一致性优先 |
| 归一化方法 | max 归一化 | min-max | 避免 single-result 除零 |
| 跨域去重 | 不去重 | SHA-256 哈希 | 跨域内容相同概率极低 |
| min_score 参数 | 移除 | 保留 / 改原始 bm25 阈值 | 归一化后分数 per-query 相对，固定阈值跨查询语义不一致 |
| 域权重 | 硬编码 | 运行时可配置 | 数据量小，权重差异不大，后续按需调整代码 |
