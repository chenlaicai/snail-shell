---
id: F2026060408
title: general-assistant-sop
from_ids: [F2026060113, F2026060205, F2026060302]
tags: [sop, assistant, knowledge]
modules: [sop, web, workflow]
doc_kind: spec
---

# F2026060408 [sop] 知识问答助理 SOP

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

当前系统只有一个内置 SOP `code-delivery`（4 阶段软件研发交付流程）。用户期望新增一个面向通用知识问答场景的内置 SOP，定位为"AI 万能助理"，核心能力是意图理解、网络搜索、信息梳理归纳。

现有 SOP 架构已支持单阶段 SOP（F2026060113 设计中以 `evolution.yaml` 为示例），workflow 引擎对无转移边的终态语义已有处理：创建即进入唯一 stage，无出边 = 流程结束。因此新增 SOP 不需要改动引擎层，只需添加配置文件。

## 目标

新增内置 SOP `general-assistant`，提供知识问答型 AI 助理对话能力。

### P1 — SOP 定义

- 新增 `config/sop/general-assistant/general-assistant.yaml`
- 单阶段 `chat`，无转移图
- 单角色 `assistant`（AI 助理）
- 极简验收清单

### P2 — 助理角色手册

- 新增 `config/sop/general-assistant/chat#assistant.handbook.md`
- 覆盖：意图理解、网络搜索、梳理归纳、追问策略、行为边界

### P3 — 前端与 snail-loader 适配

- 前端：移除 `REQUIRED_WORKFLOW_STAGE_KEYS` 硬编码校验，新增 SOP 选择器，stage 编辑器按 SOP 动态更新
- snail-loader：`initializeSnailDirectory()` 新增 `sopKey` 参数，按所选 SOP 写入对应 YAML
- 合入前必须完成

## 非目标

- 不改变现有 SOP 架构、workflow 引擎、数据模型
- 不改变 `code-delivery` SOP
- 不引入多阶段流程（单阶段足够）
- 不处理 `MAX_COLLABORATION_ROUNDS`（该限制仅影响多角色 AI 协作循环，万能助理单角色不受影响）

## 设计

### 1. SOP YAML

```yaml
name: 知识问答助理
description: 通用知识问答场景，AI 助理负责意图理解、信息检索、梳理归纳和结构化回答。
first_stage: chat

stage_definitions:
  - key: chat
    title: 对话
    sequence: 1
    input_description: 用户提出的问题或需求。
    output_description: >
      AI 助理理解用户意图，通过模型知识或网络搜索获取信息，
      梳理归纳后给出结构化回答。产物要求：用户问题已得到回答；
      使用外部信息时来源已标注；有存疑的点已向用户追问而非猜测。
    acceptance_focus:
      - 用户问题是否已得到回答
      - 使用外部信息时来源是否已标注
      - 有存疑的点是否已向用户追问
    acceptance_checklist:
      - id: chat-01
        description: 用户问题已得到回答
        required: true
      - id: chat-02
        description: 使用外部信息时来源已标注
        required: false
    roles:
      - key: assistant
        name: 助理
        description: 负责理解用户意图，检索和梳理信息，给出结构化回答。
        is_primary: true
        count: 1
        handbook: "@chat#assistant.handbook.md"

# 无 transitions — 单阶段即终态
```

**设计决策：**

| # | 决策 | 理由 |
|---|---|---|
| D1 | `transitions` 字段省略而非空数组 | 与 code-delivery 保持一致的 YAML 风格；引擎层 `getForwardTransitions` 返回空数组即表示终态 |
| D2 | `chat-02`（来源标注）设为 `required: false` | 纯知识性回答不需要外部搜索，强制标注会增加无意义的自检负担 |
| D3 | 不设 `shared_handbook` | 通用规则（PR 签名、证据规则等）是软件研发专属，对知识问答无意义 |
| D4 | `acceptance_checklist` 仅作 AI 自检引导 | 单阶段 SOP 无推进动作，`checkGateEvidence` 不会触发，checklist 不产生 gate 阻断效果。这是设计意图：知识问答不需要硬性质量门禁 |

### 2. 助理手册设计

手册核心内容分为 5 个部分：

#### 2.1 意图理解

分析用户问题的真实意图，按类型选择回答策略：

| 意图类型 | 特征 | 策略 |
|----------|------|------|
| 事实查询 | "什么是 X"、"X 的 Y 是多少" | 直接回答，附来源 |
| 概念解释 | "X 是什么意思"、"X 和 Y 的区别" | 分层解释，由浅入深 |
| 对比分析 | "X 和 Y 哪个好"、"对比 A 和 B" | 结构化对比表 |
| 方案建议 | "怎么做 X"、"推荐一个 Y" | 分步方案，说明取舍 |
| 开放讨论 | "你怎么看 X"、"分析一下 Y" | 多角度分析，结论先行 |

**跨轮意图判断规则：**

- 当前问题与历史话题**无关联**时，视为全新问题，直接回答，不强行关联历史上下文
- 当前问题与历史话题**有关联**时，必须与历史保持连贯，引用或延续之前的讨论
- 判断标准：是否存在语义依赖（代词指代、省略的上下文、明确引用之前的内容）

#### 2.2 追问策略

- 先尽力理解用户意图，在已有信息基础上组织回答
- 存疑的点必须主动追问，不允许自行猜测
- 追问应具体指出哪个点不明确，而非笼统地要求"请补充信息"
- 追问后等待用户回复，不自行假设答案继续回答

#### 2.3 网络搜索

需要使用网络搜索的场景：
- 用户明确要求搜索或查找最新信息
- 问题涉及时效性内容（新闻、价格、版本号等）
- 超出模型知识范围的事实性问题

搜索行为规范：
- 搜索前先向用户说明搜索意图（"我来搜索一下最新的 X 信息"）
- 搜索后标注信息来源
- 多个来源信息不一致时，列出差异并说明判断依据

搜索降级策略：
- 网络搜索不可用时（API 限流、网络异常），使用模型知识回答并声明"以下信息基于模型知识，可能不是最新"
- 不因搜索失败而拒绝回答，但需明确标注信息时效性边界

#### 2.4 梳理归纳

- 结论先行：先给出核心回答，再展开细节
- 结构化呈现：使用分层列表、对比表、步骤说明等格式
- 长回答加小节标题，便于用户定位
- 信息量大时做摘要，提供"详细展开"的入口

#### 2.5 行为边界

- 不编造事实，不确定时明确声明
- 涉及专业领域（医疗、法律、金融）时，声明非专业建议
- 不对用户未问的问题主动展开（回答完毕后等待下一步指令）

### 3. 前端与 snail-loader 适配

#### 3.1 前端问题分析

`workspace-config-view.js` 存在两层硬编码：

1. **校验层**：`REQUIRED_WORKFLOW_STAGE_KEYS = ["design", "development", "review", "merge"]` 强制要求 4 个 stage key
2. **渲染层**：`DEFAULT_WORKSPACE_STAGE_DEFINITIONS` 硬编码了 4 阶段的 stage 定义和角色，作为 stage 编辑器的默认值

当 `has_snail: true` 时，stage 编辑器被隐藏（line 58），两层都不生效。但非 `.snail` 路径下，用户无法选择其他 SOP，也无法编辑出 `general-assistant` 的 stage 结构。

#### 3.2 前端方案

**方案：移除硬编码校验 + 新增 SOP 选择器**

1. 删除 `REQUIRED_WORKFLOW_STAGE_KEYS` 常量及其校验逻辑（line 165-167）
2. 新增 SOP 选择下拉框（从 `GET /sops` API 获取可用 SOP 列表），仅在 `has_snail: false` 时显示
3. 选择 SOP 后，从 `GET /sops/:sopId` 获取 stage_definitions，更新 stage 编辑器默认值
4. 未选择 SOP 时保留当前 `DEFAULT_WORKSPACE_STAGE_DEFINITIONS` 作为 fallback（向后兼容）
5. `has_snail: true` 时，SOP 选择器和 stage 编辑器均隐藏（SOP 从 `.snail` 目录加载，不受前端选择影响）

**API 依赖：** `GET /sops`（列出所有 SOP）和 `GET /sops/:sopId`（获取 SOP 详情含 stage_definitions）已存在于 `server.ts:227-237`，前端可直接调用。

**前端 → snail-loader 调用链：** `manager.ts:82` 的 `createWorkspace()` 已有 `input.sopId` 参数，但 line 90 调用 `initializeSnailDirectory()` 时未传递。修复方式：将 `input.sopId` 作为 `sopKey` 传入 `initializeSnailDirectory(resolvedRoot, { name, summary: input.summary, sopKey: input.sopId })`。前端 SOP 选择器的值通过已有的 `sopId` 字段传递，无需新增字段。

**影响范围：** `src/web/workspace-config-view.js` + `src/workspace-workflow/manager.ts`（line 90 透传 `sopId`）。

#### 3.3 snail-loader 问题分析

`snail-loader.ts` 的 `initializeSnailDirectory()` 硬编码了：
- `default_sop_key: "code-delivery"`（line 206）
- 写入 `code-delivery.yaml`（line 214-216）

当用户为新工作区选择 `general-assistant` SOP 时，`.snail` 初始化仍会写入 `code-delivery`。

#### 3.4 snail-loader 方案

`initializeSnailDirectory()` 新增 `sopKey` 参数：

```typescript
export function initializeSnailDirectory(
  workspaceRoot: string,
  options?: { name?: string; summary?: string; sopKey?: string },
): WorkspaceContext
```

- `sopKey` 默认为 `"code-delivery"`（向后兼容）
- `default_sop_key` 写入 `sopKey` 值
- SOP YAML 文件名改为 `${sopKey}.yaml`
- SOP 内容从平台级 `config/sop/${sopKey}/` **整体复制**（YAML + 同目录的 `*.handbook.md` 文件），因为 `@file` 引用是相对 YAML 文件路径解析的，只复制 YAML 会导致手册引用断裂
- 平台 SOP 目录不存在时 fallback 到 `DEFAULT_SOP_YAML`（此时无 handbook 引用，不涉及文件复制）

**注记：** `SopYamlDefinition` 接口（snail-loader.ts line 65-72）当前不含 `first_stage` 和 `transitions` 字段。本次不修改该接口——`initializeSnailDirectory` 写入的 YAML 文件内容包含 `first_stage: chat` 即可，运行时加载由 `file-config-store.ts` 独立解析。若后续 `SopYamlDefinition` 被用作 SOP 结构的权威来源，需扩展该接口。

## 改动范围

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `config/sop/general-assistant/general-assistant.yaml` | 新增 | SOP 定义：单阶段 chat，单角色 assistant |
| `config/sop/general-assistant/chat#assistant.handbook.md` | 新增 | 助理角色手册：意图理解、搜索、归纳、追问、边界 |
| `config/workspaces.json.example` | 修改 | 新增 `general-assistant` 的 sop_bindings 示例 |
| `src/web/workspace-config-view.js` | 修改 | 删除 `REQUIRED_WORKFLOW_STAGE_KEYS` 硬编码校验；新增 SOP 选择器（从 API 获取列表，选择后更新 stage 编辑器默认值） |
| `src/workspace-workflow/snail-loader.ts` | 修改 | `initializeSnailDirectory()` 新增 `sopKey` 参数，按所选 SOP 整体复制目录 |
| `src/workspace-workflow/manager.ts` | 修改 | `createWorkspace()` 透传 `sopId` 到 `initializeSnailDirectory`；新增 `resolveHandbookRefs` 方法解析 `.snail` 路径下 `@file` 引用；`loadWorkspaceFromSnail` 调用该方法后再传给 `replaceWorkspaceConfigs` |

**不改动的文件：**
- `src/workspace-workflow/workflow.ts`（单阶段终态语义已有支持）
- `src/persistence/file-config-store.ts`（目录式 SOP 加载已支持）
- `src/prompt-center/builder.ts`（handbook 注入机制已通用化）
- `src/workspace-workflow/manager-collaboration.ts`（transition hint 对无出边已有处理）

## 验证

### SOP 加载

- [ ] `FileConfigStore.loadAll()` 正确加载 `general-assistant` SOP
- [ ] SOP 包含 1 个 stage_definition（`chat`）和 1 个 role_definition（`assistant`）
- [ ] SOP 无 transitions（`getForwardTransitions` 返回空数组）
- [ ] `first_stage` 为 `chat`

### 对话流程

- [ ] 创建 Issue 时选择 `general-assistant` SOP，直接进入 `chat` 阶段
- [ ] `appendTransitionHint` 注入"终端阶段"提示（无误导信息）
- [ ] 人机对话正常进行，无轮次异常

### 前端

- [ ] `REQUIRED_WORKFLOW_STAGE_KEYS` 已删除，保存校验不再要求特定 stage key
- [ ] SOP 选择器显示可用 SOP 列表（含 `code-delivery` 和 `general-assistant`）
- [ ] 选择 `general-assistant` 后 stage 编辑器更新为 `chat` 阶段默认值
- [ ] 选择 `code-delivery` 后 stage 编辑器保持原有 4 阶段默认值
- [ ] `.snail` 路径下 stage 编辑器和 SOP 选择器均隐藏（行为不变）

### snail-loader

- [ ] `initializeSnailDirectory(root, { sopKey: "general-assistant" })` 写入 `general-assistant.yaml` 而非 `code-delivery.yaml`
- [ ] `chat#assistant.handbook.md` 同步复制到 `.snail/config/sop/` 目录
- [ ] `.snail` 路径下 SOP 加载后 handbook 内容正确（`@file` 引用未断裂）
- [ ] `workspace.json` 的 `default_sop_key` 为 `"general-assistant"`
- [ ] 不传 `sopKey` 时默认写入 `code-delivery`（向后兼容）
- [ ] 平台 SOP 目录不存在时 fallback 到 `DEFAULT_SOP_YAML`

### 通用

- [ ] `npm run check` 全部通过
- [ ] 现有 `code-delivery` SOP 工作流不受影响

## 关联

- **前置**: F2026060113（SOP 图驱动 stage 转移）— 建立了 SOP 转移图架构和终态语义
- **前置**: F2026060205（SOP 角色手册重构）— 建立了 handbook 从 YAML 分离为独立文件的模式
- **前置**: F2026060302（SOP handbook 提取）— 确立了 `@file` 引用手册的加载机制

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|---|---|---|
| R1 | 前端 `REQUIRED_WORKFLOW_STAGE_KEYS` + `DEFAULT_WORKSPACE_STAGE_DEFINITIONS` 双层硬编码阻断新 SOP | 合入前必须处理：删除硬编码校验 + 新增 SOP 选择器 + stage 编辑器按 SOP 动态更新 | 2026-06-04 |
| R2 | 单阶段 SOP 创建即终态，用户体验是否自然 | 可接受——"终态"仅表示流程引擎不再主动推进 stage，对话本身不受限制 | 2026-06-04 |
| R3 | `MAX_COLLABORATION_ROUNDS=30` 是否限制万能助理 | 不影响——该限制仅作用于多角色 AI 协作循环，单角色场景不触发 | 2026-06-04 |
| R4 | `snail-loader.ts` `initializeSnailDirectory` 硬编码 `code-delivery` | 合入前必须处理：新增 `sopKey` 参数，按所选 SOP 写入对应 YAML | 2026-06-04 |
| R5 | 网络搜索不可用时的行为 | 降级到模型知识回答，声明"信息可能不是最新"，不拒绝回答 | 2026-06-04 |
| D1 | 助理手册是否需要"网络搜索"章节 | 需要——用户明确要求搜索和信息梳理是核心能力 | 2026-06-04 |
| D2 | 追问策略："先尽力理解"还是"不确定就问" | 先尽力理解，有存疑点必须追问，不允许猜测。用户确认 | 2026-06-04 |
| D3 | 跨轮意图：不相关问题是否关联历史 | 不相关则当全新问题处理，不强行关联；有相关性则保持连贯。用户确认 | 2026-06-04 |
| D4 | 单阶段 SOP 的 acceptance_checklist 是否有 gate 阻断效果 | 无。单阶段无推进动作，`checkGateEvidence` 不触发。checklist 仅作 AI 自检引导 | 2026-06-04 |
| D5 | 前端 SOP 选择器方案 | 从 `GET /sops` API 获取列表，选择后更新 stage 编辑器默认值。未选择时 fallback 到 `DEFAULT_WORKSPACE_STAGE_DEFINITIONS` | 2026-06-04 |
