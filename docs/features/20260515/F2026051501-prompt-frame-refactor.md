# F2026051501 架子优先的提示词注入机制

## 背景

当前系统提示词注入机制基于 `target`、`order`、`semantic_layer`、`when` 等字段进行条件匹配和组装，存在以下问题：

1. **逻辑倒置**：提示词文件自己声明生效条件（target、when），但逻辑上应该是组装架子决定哪些提示词生效
2. **字段冗余**：每个提示词需要维护 `target`、`order`、`semantic_layer`、`when`、`inject_matched_prompts` 等多个字段
3. **知识治理特殊处理**：知识治理对话的系统提示词在 `builder.ts` 中硬编码（`buildKnowledgeGovernanceSection`），没有走统一的匹配机制
4. **组装逻辑分散**：组装逻辑嵌入在 `buildConversationSystemPrompt` 中，难以理解和扩展

## 目标

1. **架子即模板**：架子（Frame）是一份完整的系统提示词模板，Markdown 正文即骨架结构
2. **提示词简化**：提示词只声明内容（id、title、skill_references），不再声明生效条件
3. **模板填充**：架子通过 `{{prompt:ID}}` 标记嵌入提示词内容，通过 `{{#when:...}}` 条件块控制段落
4. **知识治理统一**：知识治理对话通过架子（F-02）+ `owner_types` 匹配，不再硬编码
5. **优先级匹配**：架子按条件具体度排序，更具体的架子优先匹配

## 非目标

1. 修改提示词内容本身
2. 改变系统提示词的注入方式（--append-system-prompt 等）
3. 影响前端 UI 的提示词展示逻辑

## 设计

### 核心概念

#### 架子（Frame）= 模板

架子是一份完整的系统提示词模板，Markdown 正文即骨架结构。用 `{{prompt:ID}}` 标记嵌入提示词内容，用 `{{#when:...}}` 条件块控制段落可见性：

```markdown
---
id: F-01
title: 项目推进会话
type: frame
---

## 身份与责任契约

{{prompt:B-01}}

## 知识治理

{{prompt:B-02}}

{{#when:runtimes=claude-code-cli,claude-code-stateful-cli}}
## 运行时边界

{{prompt:B-03}}
{{/when}}

## 项目上下文

{{prompt:S-01}}

## 历史能力

{{prompt:S-02}}

{{#when:stage_types=development,review;snails=Implementation Snail}}
## 研发者手册

{{prompt:S-03}}
{{/when}}

{{#when:stage_types=review;snails=Acceptance Snail}}
## 检视者手册

{{prompt:S-04}}
{{/when}}
```

模板语法：
- `{{prompt:ID}}` — 嵌入提示词内容（展开时自动去掉提示词的首个 `## ` 标题，由架子负责标题）
- `{{#when:field=value1,value2;field2=value3}}...{{/when}}` — 条件段落，条件不满足则移除整段
- `{{#if:variable}}...{{/if}}` — 变量条件块，变量为空则移除整段
- `{{variable}}` — 变量替换

#### 提示词（Prompt）= 可复用内容块

提示词只声明内容，不含任何生效条件：

```yaml
---
id: B-01
title: 身份与责任契约
skill_references:
  - id: message-out
    mode: required
    reason: "需要结构化呈现时使用"
---

## 身份与责任契约

（正文内容）
```

提示词的 `## ` 标题在被架子展开时自动去除（架子负责标题），标题本身保留在提示词文件中便于独立阅读。

### 架子选择机制

架子在设计时就明确自己服务于哪个业务场景，不需要条件匹配。调用方根据业务场景直接获取对应架子：

```typescript
// 主会话：根据 owner_type 选择架子
const frameId = context.conversation.owner_type === "knowledge_governance" ? "F-02" : "F-01";
const frame = getFrame(frameId);

// 专项任务：直接指定架子
const mentionFrame = getFrame("F-03");
const summaryFrame = getFrame("F-04");
```

### 模板条件上下文

架子模板内的 `{{#when:...}}` 条件段落仍需要运行时上下文来决定可见性：

```typescript
interface FrameMatchContext {
  runtime?: AgentRuntime;
  stageType?: StageType;
  snailName?: SnailName;
  conversationKind?: ConversationKind;
  ownerType?: ConversationOwnerType;
  repoRelated?: boolean;
}
```

### 知识治理对话

知识治理对话由 F-02 架子负责，调用方根据 `owner_type === "knowledge_governance"` 直接获取：

```markdown
---
id: F-02
title: 知识治理对话
type: frame
---

## 身份与责任契约

{{prompt:B-01}}

## 知识治理

{{prompt:B-02}}

{{#when:runtimes=claude-code-cli,claude-code-stateful-cli}}
## 运行时边界

{{prompt:B-03}}
{{/when}}

## 项目上下文

{{prompt:S-01}}

## 历史能力

{{prompt:S-02}}

## 知识治理上下文

- Governance ID: {{governance_id}}
- Knowledge ID: {{knowledge_id}}
- 候选标题: {{knowledge_title}}
...
```

## 生效路径

1. **架子获取**：调用方根据业务场景直接 `getFrame(id)` 获取对应架子
2. **模板渲染**：`renderFrame()` 执行渲染管线：
   1. **展开 prompt 引用** — `{{prompt:ID}}` 替换为提示词内容（去掉首个 `## ` 标题），追加 skill_references 段
   2. **条件段落过滤** — `{{#when:...}}...{{/when}}` 块根据上下文保留或移除
   3. **变量条件过滤** — `{{#if:var}}...{{/if}}` 块根据变量是否为空保留或移除
   4. **变量替换** — `{{variable}}` 替换为实际值
   5. **清理空行** — 折叠连续空行，trim 输出

## 改动范围

### 新增文件

1. `.meta/prompts/frames/F-01-project-conversation.md` - 项目推进会话架子
2. `.meta/prompts/frames/F-02-knowledge-governance.md` - 知识治理对话架子
3. `.meta/prompts/frames/F-03-mention-extraction.md` - Mention 提取任务架子
4. `.meta/prompts/frames/F-04-conversation-summary.md` - 会话摘要任务架子
5. `.meta/prompts/prompts/B-01-身份与责任契约.md` - 迁移自 base/
6. `.meta/prompts/prompts/B-02-知识治理.md` - 迁移自 base/
7. `.meta/prompts/prompts/B-03-运行时边界.md` - 迁移自 base/
8. `.meta/prompts/prompts/S-01-项目上下文.md` - 迁移自 scenarios/
9. `.meta/prompts/prompts/S-02-历史能力.md` - 迁移自 scenarios/
10. `.meta/prompts/prompts/S-03-研发者手册.md` - 迁移自 scenarios/
11. `.meta/prompts/prompts/S-04-检视者手册.md` - 迁移自 scenarios/
12. `.meta/prompts/prompts/S-05-mention提取.md` - 迁移自 scenarios/
13. `.meta/prompts/prompts/S-06-会话摘要.md` - 迁移自 scenarios/
14. `.meta/prompts/_template-frame.md` - 架子模板
15. `.meta/prompts/_template-prompt.md` - 提示词模板

### 删除文件

1. `.meta/prompts/base/` 整个目录
2. `.meta/prompts/scenarios/` 整个目录
3. `.meta/prompts/prompt.md.template`

### 修改文件

1. `src/prompt-center/registry.ts` - 重写，支持架子模板解析和 renderFrame() 渲染管线
2. `src/prompt-center/builder.ts` - 简化，buildFromFrame() 委托给 renderFrame()
3. `src/prompt-center/index.ts` - 更新导出
4. `src/meta/index.ts` - 更新 re-exports
5. `src/llm/mention-extractor.ts` - 适配新 API（getFrame + buildFromFrame）
6. `src/llm/summary.ts` - 适配新 API
7. `src/bin/regulation-expand.ts` - 适配新 API
8. `src/interaction-entry/api/server.ts` - 适配新 API，新增 /meta/frames 端点
9. `src/web/prompt-library.js` - 移除旧字段引用
10. `tests/meta/prompt-assets-test.ts` - 重写测试
11. `package.json` - 添加 yaml 依赖

## 验证

1. **TypeScript 编译**：`npx tsc --noEmit` 通过
2. **ESLint 检查**：0 errors，29 warnings（均为预存 restricted-import 警告）
3. **单元测试**：`npm test` 全部 35 个 compiled test files 通过

## 风险与决策记录

### 决策 1：使用 YAML frontmatter

**选择**：使用 YAML 格式而非 JSON 格式

**原因**：YAML 更易读，支持注释，适合配置文件

**代价**：需要引入 `yaml` 依赖

### 决策 2：架子按条件具体度排序

**选择**：`countWhenConditions()` 降序排列

**原因**：确保更具体的架子（如 F-02）在默认架子（F-01）之前被选中

**代价**：需要维护条件计数逻辑

### 决策 3：owner_types 独立于 conversation_kinds

**选择**：新增 `owner_types` 字段，不复用 `conversation_kinds`

**原因**：`ConversationKind` 是枚举类型（discussion/planning/design/implementation/review/bugfix），而 `owner_type` 是另一个维度（project_stage/knowledge_governance）

**代价**：需要在 `FrameMatchContext` 中新增字段

## 范围变更记录

### 变更 1：补充 prompt-library.js 适配

**原因**：自检发现 `src/web/prompt-library.js` 引用了大量旧字段

**影响**：移除 `semantic_layer`、`target`、`order`、`when` 等旧字段引用，更新 `TREE_LABELS` 和统计显示
