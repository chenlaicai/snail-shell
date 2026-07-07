---
id: F20260707fpw6
title: evolution-quality-and-operations
from_ids: []
tags: [evolution, mcp, web, api, prompt]
modules: [evolution, snail-mcp-server, adapter/http, web, prompt]
doc_kind: spec
---

# F20260707fpw6 [evolution] Evolution 自动提取质量修正与 UI 操作补全

## 背景

当前 evolution 系统存在两个问题：

### 问题 1：自动提取的条目质量低下

自动提取机制（F20260701rq3d）上线后，agent 在对话中检测到反馈信号时创建的 evolution 条目，其内容只是复述了来源 issue 正在处理的具体问题，而非系统层面的改进点。这说明 agent 对 evolution 业务能力的理解有误——evolution 条目应捕获**系统级改进机会**（prompt/skill/SOP/code 应如何改变），而非记录用户的具体抱怨。

根因有两层：
- **MCP 工具描述缺失质量指引**：`create_candidate` 工具的 description 只说"做什么"，没有"何时用""内容怎么写""什么情况不该用"。按 MCP 标准协议，tool description 应包含完整的使用指导，但当前描述是一行哑管道说明
- **T-01 错位承载了工具使用规则**：反馈信号识别 + 执行步骤被放在 `data/file/prompts/T-01-行为准则.md` 中，而非 MCP 工具描述中。这导致规则与工具分离，且 T-01 承载了不属于通用行为准则的工具专属逻辑

### 问题 2：Evolution 界面缺少操作能力

Evolution Center 界面（`src/web/pages/EvolutionCenter.tsx`）是纯只读的：
- 只展示条目列表和详情，没有任何操作按钮
- `src/web/mutations/evolution.mutations.ts` 是空文件（0 字节）
- HTTP API 只有 GET 端点（list + detail），没有写操作端点
- 后端 `EvolutionAppAdapter.createIssueFromItem()` 已实现但未暴露到 HTTP
- 用户无法从界面执行"创建对应 issue""关闭"等操作

## 用户意图锚

| # | 用户原话 | 关键修饰语 | 架构师解读 | 来源 |
|---|---------|-----------|-----------|------|
| UA-1 | 自动提取的evolution item必须是有价值的、绝对不能是该issue正在处理的问题 | 必须（强制性）、绝对不能（禁止性）、该issue正在处理的（范围限定：当前 issue 的处理范围） | 自动提取的条目有严格的价值标准：禁止复述当前 issue 的工作内容，必须产出超出当前 issue 范围的系统改进洞察 | msg-3926 |
| UA-2 | 这是对evolution业务能力的理解有误 | 业务能力的理解（语义层面） | evolution 的业务语义定义应包含在 MCP 工具描述中（何时用、创建什么内容、何时不用），当前工具描述缺失这些指导，导致 agent 无法从工具本身理解正确的使用方式 | msg-3926 |
| UA-3 | 无法"创建对应issue""关闭"等操作，这些操作都没实现吗 | 创建对应issue（动作）、关闭（动作）、等（暗示不止这两种） | 用户期望 Evolution 界面具备基本的生命周期操作能力，至少包括从条目创建治理 issue 和关闭不需要的条目 | msg-3926 |
| UA-4 | agent判断系统提供的某一个skill/mcp、或者系统的某一个功能，使用起来觉得不好用/不顺手，那也可以作为evolution item反馈出来 | agent判断（主体是 agent 非 user）、不好用/不顺手（体验判断）、skill/mcp/功能（范围限定：系统工具） | 反馈信号来源不限于用户侧，agent 自身使用系统工具时的体验问题也是有效的 evolution 触发源 | msg-4163 |

## 目标

1. 重写 `create_candidate` MCP 工具描述，使自动提取的 evolution 条目聚焦于系统级改进点，而非复述当前 issue 的问题
2. 补全 Evolution Center 界面的操作能力：创建对应 issue、关闭条目

## 非目标

- 不修改 EvolutionItem 数据模型（不新增状态、不改 schema）
- 不实现 NLP 自动语义分析（仍依赖 agent 语义理解，通过 MCP 工具描述约束）
- 不实现 evolution 条目编辑功能（标题/内容修改）
- 不实现批量操作

## 设计

### Part 1：自动提取质量修正（MCP 工具描述重写）

#### 语义定义

Evolution 条目的本质是**系统级改进机会**，而非问题记录。条目内容必须回答"系统的哪个部分应该怎样改变才能避免此类问题再次发生"，而非"发生了什么问题"。

#### 架构调整：规则从 T-01 移到 MCP 工具描述

按 MCP 标准协议，tool description 不只是"怎么用"，也包括"何时用""何时不用""内容怎么写"。当前 `create_candidate` 的 description 只有一行管道说明，质量规则被错位放在 T-01 中。

调整方向：
- **MCP 工具描述**承载完整的使用指导（何时用、何时不用、内容要求、前置判断、执行步骤）
- **T-01** 移除 evolution 反馈识别段落——这些规则是工具专属的，不属于通用行为准则

#### 新的 `create_candidate` 工具描述

description 字段重写为：

```
创建演进候选项。当在对话中识别到以下反馈信号时使用：
- 用户不满：明确表达对系统行为的不满意、生气、失望
- 用户困惑：表示不理解、困惑、不清楚
- 用户纠正：纠正你的行为或输出
- 重复问题：同一问题反复提出（第三次及以上）
- 功能缺失：期望的功能不存在（多次出现或明确影响工作流）
- 工具使用体验不佳：agent 在使用系统提供的 skill/MCP/功能时，发现操作不便、流程冗余、参数缺失或语义不清

不应创建的情况：
- 当前 issue 正在处理的问题本身（条目应指向系统改进点，而非复述问题）
- 审美偏好、首次 feature request、随口建议、与系统无关的抱怨

创建前判断：改进点必须超出当前 issue 范围、指向系统层面（prompt/skill/SOP/code/知识库）、且具有复用价值。任一不满足则不创建。

内容要求：
- title：系统改进点简述（如"review skill 应增加 XX 检查"而非"XX 问题"）
- content：改进方向 + 触发场景 + 建议落点，必须回答"系统的哪个部分需要怎样改变"

执行步骤：先搜索已有条目判断重复 → 不重复则调用本工具（metadata 带 auto_generation）→ 回复中说明已记录 → 继续正常回复

此 tool 仅创建 evolution_item 记录（状态为 Candidate）。治理对话的 Issue/Stage/Conversation 由治理流程创建，不由本 tool 创建。
```

#### inputSchema 字段描述更新

- `title` description 从 `"演进项标题"` 改为 `"系统改进点简述（如'review skill 应增加 XX 检查'而非'XX 问题'）"`
- `content` description 从 `"演进项内容（Markdown）"` 改为 `"改进方向 + 触发场景 + 建议落点。必须回答'系统的哪个部分需要怎样改变'"`

#### trigger_reason 枚举新增

`TRIGGER_REASONS` 常量新增 `"tool_friction"`，对应"工具使用体验不佳"信号。`validateAutoGeneration` 的校验自动覆盖新值（因使用 `isTriggerReason` 函数校验）。

#### T-01 修改

从 `data/file/prompts/T-01-行为准则.md` 中移除整个 evolution 反馈识别段落（"识别到以下反馈信号时..."及其所有子项）。这些规则已由 MCP 工具描述承载。

### Part 2：UI 操作补全

#### 2.1 后端 HTTP API

新增两个写操作端点：

| 方法 | 路径 | 描述 | 状态约束 |
|------|------|------|---------|
| POST | `/api/evolution/items/:itemId/create-issue` | 从条目创建治理 issue | 仅 Candidate 可操作 |
| POST | `/api/evolution/items/:itemId/close` | 关闭条目（直接完成，不走治理） | 仅 Candidate 可操作 |

**`create-issue` 端点**：
- 调用 `EvolutionAppPort.createIssueFromItem(itemId)`
- 成功后返回更新后的 item（status: in_progress, issue_id 有值）
- 前端可从返回值获取 issue_id 用于跳转

**`close` 端点**：
- 接收可选 body：`{ result?: string }`
- 调用 `EvolutionAppPort.closeItem(itemId, result)`
- 返回更新后的 item

**API 契约定义**（`src/api-contracts/endpoints.ts`）：

```typescript
"POST /api/evolution/items/:itemId/create-issue": EndpointDef<{ itemId: string }, never, never, Dto.EvolutionItemDto>;
"POST /api/evolution/items/:itemId/close": EndpointDef<{ itemId: string }, never, { result?: string }, Dto.EvolutionItemDto>;
```

**HTTP 错误处理**：
- item 不存在：返回 404
- item 状态非 Candidate：返回 400（附错误信息）

**依赖变更**：
- `AppDeps` 新增 `evolutionApp: EvolutionAppPort`
- `EvolutionRoutesDeps` 新增 `evolutionApp: EvolutionAppPort`
- `main.ts` 的 `startHttpServer` 传入 `evolutionApp`

#### 2.2 App 层扩展

`EvolutionAppPort` 新增 `closeItem` 方法：

```typescript
closeItem(itemId: string, result?: string): EvolutionItem;
```

实现逻辑：
1. 查找 item，不存在则抛错
2. 校验 status 必须为 Candidate
3. 调用 `evolutionPort.update(itemId, { status: "completed", result: result ?? "手动关闭" })`
4. 返回更新后的 item

#### 2.3 前端

**Mutations**（填充空文件 `evolution.mutations.ts`）：

- `useCreateIssueFromItem`：POST `/api/evolution/items/:itemId/create-issue`，成功后刷新 list + detail
- `useCloseEvolutionItem`：POST `/api/evolution/items/:itemId/close`，成功后刷新 list + detail

**UI 操作按钮**（修改 `EvolutionCenter.tsx`）：

在详情面板中，根据 item.status 显示操作按钮：

| 状态 | 显示的按钮 |
|------|-----------|
| Candidate | "创建对应 Issue" + "关闭" |
| InProgress | 显示关联 Issue 链接（如有 issue_id） |
| Completed | 显示处理结果（如有 result） |

按钮交互：
- "创建对应 Issue"：点击后调用 mutation，成功后 toast 提示并刷新
- "关闭"：点击后弹出确认输入（可选填关闭原因），确认后调用 mutation

**状态徽章**：
在详情面板标题旁显示状态徽章（Candidate/InProgress/Completed），用不同颜色区分。

## 行为条目

| # | 行为 | 预期结果 | 追溯 |
|---|------|---------|------|
| B-1 | Agent 识别到反馈信号后，自问"改进点是否超出当前 issue 处理范围" | 如果改进点就是当前 issue 正在解决的问题，不创建 evolution 条目 | ← UA-1 |
| B-2 | Agent 创建 evolution 条目时，content 回答"系统的哪个部分需要怎样改变" | 条目内容是系统级改进方向，而非问题复述 | ← UA-1, UA-2 |
| B-3 | 用户在 Evolution Center 选中 Candidate 条目时 | 显示"创建对应 Issue"和"关闭"操作按钮 | ← UA-3 |
| B-4 | 用户点击"创建对应 Issue" | 调用后端创建治理 issue，条目状态变为 InProgress，显示关联 issue 链接 | ← UA-3 |
| B-5 | 用户点击"关闭" | 条目状态变为 Completed，可填写关闭原因 | ← UA-3 |
| B-6 | InProgress 条目展示关联 Issue 链接 | 用户可从 Evolution Center 跳转到对应 Issue | ← UA-3 |
| B-7 | Completed 条目展示处理结果 | 用户可查看条目的处理结果 | ← UA-3 |
| B-8 | 请求操作的 item 不存在 | 返回 404 | ← UA-3 |
| B-9 | 请求操作的 item 状态非 Candidate | 返回 400，附错误信息说明当前状态 | ← UA-3 |
| B-10 | Agent 在使用系统 skill/MCP/功能时感知到操作不便、流程冗余或语义不清 | 创建 evolution 条目，title 描述工具改进点，content 说明哪个工具的哪个环节需要怎样改进 | ← UA-4 |

## 生效路径

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/domain/snail-mcp-server/_internal/servers/evolution.ts` | 修改 | 重写 `create_candidate` 工具的 description 和 inputSchema 字段描述；TRIGGER_REASONS 新增 `tool_friction` |
| `data/file/prompts/T-01-行为准则.md` | 修改 | 移除 evolution 反馈识别段落（规则已移至 MCP 工具描述） |
| `src/app/evolution/port.ts` | 修改 | 新增 `closeItem` 方法签名 |
| `src/app/evolution/_internal/adapter.ts` | 修改 | 实现 `closeItem` |
| `src/adapter/http/routes/evolution.route.ts` | 修改 | 新增 `create-issue` 和 `close` 端点 |
| `src/adapter/http/app.ts` | 修改 | `AppDeps` 新增 `evolutionApp` |
| `src/main.ts` | 修改 | `startHttpServer` 传入 `evolutionApp` |
| `src/api-contracts/endpoints.ts` | 修改 | 新增两个端点定义 |
| `src/web/mutations/evolution.mutations.ts` | 修改 | 填充 mutation hooks |
| `src/web/pages/EvolutionCenter.tsx` | 修改 | 添加操作按钮、状态徽章、Issue 链接 |

## 改动范围

- MCP 工具：`create_candidate` 工具描述重写（何时用、何时不用、内容要求、前置判断）
- Prompt：T-01 移除 evolution 反馈识别段落
- App 层：EvolutionAppPort + EvolutionAppAdapter（新增 closeItem）
- HTTP 适配层：evolution 路由（新增两个端点）+ app 依赖注入
- 前端：mutations 填充 + EvolutionCenter UI 操作按钮
- **不改动**：EvolutionItem 数据模型、数据库 schema、domain 层 port/adapter/repository

## 验证

- [ ] Agent 识别到反馈信号后，如果改进点就是当前 issue 正在处理的问题，不创建 evolution 条目
- [ ] 自动创建的 evolution 条目 content 回答"系统哪个部分需要怎样改变"，而非复述问题
- [ ] Evolution Center 中 Candidate 条目显示"创建对应 Issue"和"关闭"按钮
- [ ] 点击"创建对应 Issue"后，条目状态变为 InProgress，显示关联 issue 链接
- [ ] 点击"关闭"后，条目状态变为 Completed
- [ ] InProgress 条目显示关联 Issue 链接
- [ ] Completed 条目显示处理结果
- [ ] 非 Candidate 状态的条目不显示"创建对应 Issue"和"关闭"按钮
- [ ] Agent 在使用 skill/MCP/功能时感知到体验问题，创建 evolution 条目（trigger_reason: tool_friction）

## 风险与决策记录

| # | 风险或决策 | 结论 | 日期 |
|---|-----------|------|------|
| 1 | 关闭操作是否需要新状态 | 不需要。使用 "completed" 状态 + result 区分。与 evo-executor 的 false-trigger 处理方式一致 | 2026-07-06 |
| 2 | 是否允许从 UI 关闭 InProgress 条目 | 不允许。InProgress 条目已关联 issue，应通过治理流程关闭。UI 仅支持关闭 Candidate 条目 | 2026-07-06 |
| 3 | Prompt 规则修改是否能完全杜绝低质量条目 | 不能完全杜绝，但能显著减少。agent 语义理解能力有限，仍有误判可能。通过治理对话的 false-trigger 裁决兜底 | 2026-07-06 |
| 4 | close 端点放在 app 层还是 domain 层 | 放在 app 层。close 包含业务语义（校验 Candidate 状态 + 设置 result），属于编排逻辑 | 2026-07-06 |
| 5 | MCP `complete_evolution_item` 与 HTTP `closeItem` 的状态约束不一致 | MCP 路径不校验当前状态（治理流程本身有状态校验），HTTP 路径强制校验 Candidate（用户手动操作需 app 层校验）。设计差异可接受，因两条路径的使用场景和信任模型不同 | 2026-07-06 |
| 6 | 质量规则从 T-01 移到 MCP 工具描述 | MCP 标准协议中 tool description 包含"何时用"不只是"怎么用"。规则与工具 co-located，agent 在考虑使用工具时即可看到质量要求，无需跨文件引用。T-01 应只承载通用行为准则，不应包含工具专属逻辑 | 2026-07-06 |
