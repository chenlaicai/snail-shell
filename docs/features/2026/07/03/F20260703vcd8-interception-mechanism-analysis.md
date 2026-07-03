---
id: F20260703vcd8
title: interception-mechanism-analysis
from_ids: []
tags: [issue-collaboration, interception, validation, force-advance]
---

# F20260703vcd8 — 推进拦截机制诊断与改进方案

## 状态
- [x] design-time
- [x] development-time
- [ ] review-time
- [ ] merge-time

## 用户意图锚

| ID | 用户原话 | 来源 | 关键修饰语 | 架构师解读 |
|----|---------|------|-----------|-----------|
| UA-1 | "现在推进校验拦截功能反正成了累赘" | 用户消息 | 定性：累赘（非"有用但需优化"） | 用户认为拦截机制整体是负面的，不只是某个细节有问题 |
| UA-2 | "报错发给ai、ai也处理不好，一直在猜" | 用户消息 | 行为：猜（非"理解后重试"） | AI 收到错误后没有足够信息来自纠，只能猜测正确做法 |
| UA-3 | "机制不清晰，只做了《事后拦截》，但没做好《事前告知》" | 用户消息 | 时序：事前 vs 事后；状态：不清晰 | 用户认为问题根因是：AI 在推进前不知道完整规则，被拦后也不知道怎么修 |
| UA-4 | "ai一直在说'没问题了，可以推进'，但是系统又拦截住了" | 用户消息 | 矛盾：AI 判断通过 vs 系统判断失败 | AI 自检结果与系统校验结果不一致，说明自检机制与校验机制之间存在信息差 |
| UA-5 | "界面上的推进按钮，是用户我在用，这个权限要放通、即使校验不通过也应该只是弹出警告然后让我确定" | 用户补充 | 权限分离：用户 vs AI；行为：警告+确认（非硬拒） | 用户手动推进应与 AI 推进区别对待——用户有最终决定权，校验失败应是软拦截而非硬拦截 |

## 问题诊断

### 一、现状架构：四层拦截

当前系统实现了四层信号校验：

| 层级 | 机制 | 时机 | 反馈对象 |
|------|------|------|---------|
| P0 | `validate_stage_signal` MCP 工具 | AI 发出信号**前**（AI turn 内） | AI（立即自纠） |
| P1a | L1 单信号拦截 | 信号持久化时（messageCompleted 回调） | 前端（WebSocket） |
| P1b | `AutoAdvanceEngine.evaluate()` | 信号持久化后 | 前端（WebSocket） |
| P2 | WebSocket `onEvaluationResult` | 评估完成后 | 前端 |

### 二、核心矛盾：AI 自检 ≠ 系统校验

用户说"ai一直在说没问题了，可以推进，但是系统又拦截住了"——这揭示了一个结构性问题：

**AI 的自检能力与系统的校验能力之间存在信息差。**

| 维度 | AI 能看到的 | 系统会校验的 | 差距 |
|------|-----------|-------------|------|
| Gate 条件 | SKILL.md 中的检查项名称和描述 | SOP YAML 中的 `gate_ids` 列表 | AI 知道要检查什么，但不知道**哪些 gate ID 必须在 `gate_evidence` 中出现** |
| 上下文字段 | 系统提示中的缺失字段警告 | `required_context_fields` 完整列表 | 警告只列出缺失的，不告诉 AI **何时需要设置哪些字段** |
| 校验规则 | 错误码（如 `GATE_FAILED`、`CONTEXT_MISSING`） | 完整的校验链（5 项检查 + R1-R8 规则） | AI 只看到失败结果，不知道**具体哪条规则失败、怎么修** |
| 对抗产物 | SKILL.md 中的信号模板 | R1-R8 结构化校验规则 | 模板只展示格式，不展示**每个字段的最低要求**（如 `actual_output >= 20 chars`） |

### 三、具体断点分析

#### 断点 1：`validate_stage_signal` 是可选的

当前设计中，AI **可以跳过** P0 预校验，直接调用 `set_final_body` 发出信号。SKILL.md 中没有 `[HARD]` 要求"必须先调用 `validate_stage_signal`"。

这意味着：即使系统提供了"事前告知"的能力（P0），AI 可能根本不用它。

**证据**：`cd-design/SKILL.md` 的 `[HARD]` Gotchas 中，只提到"必须先完成 Stage Gate 自检并呈现完整证据"，没有提到 `validate_stage_signal` 工具。

#### 断点 2：SKILL.md 自检与 `gate_evidence` 之间无结构化衔接

AI 在 SKILL.md 中看到的是：
```markdown
| ID | 清单项 | 必须 |
|---|--------|------|
| design-01 | Feature 文档的 [design-time] 章节已锁定 | ✅ |
| design-02 | 无未解决的设计争议 | ✅ |
```

但系统校验的是 `gate_evidence` 中的 `design-01` 和 `design-02` 键是否有非空字符串值。AI 需要**自行推断**：SKILL.md 的检查项 → gate_evidence 的键名 → 值的内容。这个推断链没有被显式建立。

#### 断点 3：错误反馈不可操作

当 L1 拦截返回错误时，AI 收到的是：
```json
{ "code": "GATE_FAILED", "message": "Gate 自检未通过：design-01, design-02" }
```

这个错误告诉 AI "design-01 和 design-02 失败了"，但不告诉 AI：
- 这两个 gate ID 对应什么检查项
- 期望的值格式是什么
- 如何修复

AI 只能"猜"——这正是用户描述的"报错发给ai、ai也处理不好，一直在猜"。

#### 断点 4：`CONTEXT_MISSING` 警告是软提示

系统提示中的缺失字段警告格式为：
```
> ⚠️ 以下基础设施字段未记录：worktree_path, branch_name
```

这是一个**软提示**——它告诉 AI "这些字段缺失了"，但不告诉 AI：
- 这些字段**何时**需要设置（是所有阶段都需要，还是特定阶段？）
- 这些字段的**值从哪来**（是 AI 自己设置，还是系统自动填充？）
- 缺失这些字段会**导致什么后果**（推进被阻断？）

#### 断点 5：R1-R8 规则对 AI 不可见

对抗产物的校验规则 R1-R8 定义在 `auto-advance.ts` 中（代码层）和 `adversarial-artifact-protocol.md` 中（文档层）。但这些规则**没有注入到 AI 的上下文中**。AI 只看到 SKILL.md 中的信号模板，不知道每个字段的最低要求。

例如，AI 不知道 `independent_verification[].actual_output` 必须 >= 20 字符（R3），直到被拦截后从错误消息中间接得知。

#### 断点 6：SKILL.md 中存在"幽灵 gate ID"（架构师-2 补充）

SKILL.md 定义了 `design-ctx`、`dev-05`、`dev-ctx`、`rev-ctx` 等检查项，但这些 ID **不在** SOP YAML 的 `gate_ids` 数组中——系统不校验它们。AI 可能误以为这些是必检项（浪费精力），也可能误以为它们会触发拦截（不敢推进）。这种"SKILL.md 说的"和"系统验的"之间的不对称，本身就是"事前告知不清晰"的另一种表现。

#### 断点 7：R6 文档与实现不一致（架构师-2 补充）

`adversarial-artifact-protocol.md` 将 R6 标记为"阻断"，但 `auto-advance.ts` 实际实现为 warning（非阻断）。如果 AI 读了协议文档，会误判 R6 会拦截，造成不必要的恐慌或重试。

#### 断点 8：用户手动推进与 AI 推进被同等对待（用户补充）

用户在界面上点击"推进"按钮时，系统调用 `evaluateAdvance()`，如果返回 `blocked`，直接返回 HTTP 409，推进被拒绝。**没有"警告后确认"机制**——用户和 AI 被完全同等对待。

但用户有最终决定权——即使有未通过的 gate 项，用户也应该能确认后推进。当前设计中，用户无法 override 拦截。

**证据**：`issue.route.ts` 中 `POST /api/stages/:stageId/advance` 路由在 `evaluation.action === "blocked"` 时直接返回 409，没有提供 force 参数或确认机制。

#### 断点 9：前端不渲染 `evaluation_result` 事件

当 AI 信号被 L1 拦截时，系统通过 WebSocket 发送 `onEvaluationResult` 事件，但前端 `EventBatcher`（`useWebSocket.ts`）**没有处理这个事件类型**——事件被静默丢弃。用户完全看不到 AI 信号被拦截的反馈。

**证据**：`useWebSocket.ts` 的 `add()` 方法只处理 `message_started`、`message_event_appended`、`message_status_changed`、`user_called`、`stage_transition_suggested`、`stage_changed`、`cleanup_completed`，不包含 `evaluation_result`。

### 四、结论

**用户的判断完全正确**：当前机制存在两个层面的问题——

1. **对 AI**：事前告知不足（断点 1-7）——AI 不知道完整规则，被拦后也不知道怎么修
2. **对用户**：拦截过于刚性（断点 8-9）——用户被当成 AI 一样拦截，没有 override 权限，且看不到 AI 被拦截的反馈

拦截引擎**当前起到的作用**是：作为兜底安全网，防止不符合条件的推进发生。但它**过度拦截了用户**：用户有最终决定权，应该能"看到警告后确认推进"，而不是被 409 硬拒。

## 改进方案

### 方案概述

将拦截机制从"事后兜底"模式转变为"事前引导 + 事后兜底"模式。核心思路：**让 AI 在产出信号前，就能看到并满足所有校验条件，而不是被拦后才知道哪里错了。同时，用户作为最终决策者，应有 override 权限。**

### 两条改进主线

本方案解决两个不同层面的问题，形成两条独立的改进主线：

**主线 A：AI 事前告知闭环**（断点 1-7）—— 让 AI 在发出信号前就能满足所有条件
**主线 B：用户推进权限放通**（断点 8-9）—— 让用户能"看到警告后确认推进"

两条主线互不依赖，可并行实施。

### 主线 A：最小可行方案：改进 1+3 即可解决核心问题

只做改进 1（强制 P0 预校验）和改进 3（错误反馈可操作化）就能形成完整闭环：

1. `validate_stage_signal` 本身就是**同一个校验引擎**的 P0 镜像——它运行的校验逻辑与 L1 拦截完全一致
2. 只要强制 AI 调用它（改进 1），并在返回结果中告诉 AI 怎么修（改进 3），AI 就能**在信号发出前**完成自纠
3. 不需要把 R1-R8 全部注入系统提示（改进 2），不需要重构信号模板（改进 5），因为 P0 工具本身就是"事前告知"的最佳载体

**关键依赖**：改进 1 和改进 3 必须**同时实施**，否则强制化 P0 只是形式主义。

### 主线 B：用户推进权限放通

用户手动推进时，校验不通过应弹出警告并提供"确认推进"选项，而不是 409 硬拒。

### 优先级排序

| 优先级 | 改进项 | 主线 | 理由 | 改动范围 |
|--------|--------|------|------|---------|
| **P0** | 改进 1：`validate_stage_signal` 强制化（SKILL.md 加 `[HARD]`） | A | 唯一能闭环的方案，零代码改动 | 仅文档 |
| **P0** | 改进 3：错误反馈可操作化（`fix_guidance` 含 description/check/doc_ref） | A | 改进 1 的价值完全依赖此改进 | 仅代码 |
| **P0** | 改进 6：用户手动推进改为"警告 + 确认"模式 | B | 用户有最终决定权，不应被同等拦截 | 代码（前端 + 后端） |
| P1 | 改进 4：SKILL.md 检查项与 gate_ids 显式映射，幽灵 gate ID 已标注 | A | 减少 AI 首次调用 P0 时的失败率 | 仅文档 |
| P2 | 改进 2：系统提示注入推进条件摘要 | A | 锦上添花，改进 1+3 已构成闭环 | 代码 |
| P2 | 改进 7：前端渲染 `evaluation_result` 事件 | B | 让用户看到 AI 信号被拦截的反馈 | 仅前端 |
| P3 | 改进 5：信号模板嵌入字段最低要求 | A | 与 adversarial-artifact-protocol.md 内容重复 | 仅文档 |

### 改进 1 [P0]：将 `validate_stage_signal` 设为 `[HARD]` 前置条件

**现状**：AI 可以跳过 P0 预校验直接发出信号。
**改进**：在 SKILL.md 的 `[HARD]` Gotchas 中增加规则：

```
- **[HARD] 信号预校验**：在调用 `set_final_body` 包含 `stage_transition` JSON 之前，必须先调用 `validate_stage_signal` 工具并通过校验。未预校验直接发信号 = 违规。
```

**效果**：强制 AI 使用 P0 预校验，确保信号在发出前就通过校验。

### 改进 2 [P2]：在系统提示中注入当前阶段的校验规则摘要

**现状**：AI 只看到缺失字段警告和可用流转，不知道具体的校验条件。
**改进**：在 `buildContextBlock()` 中，从 SOP YAML 的 `auto_advance` 配置生成校验规则摘要，注入到系统提示中：

```
## 推进条件
- 必需信号类型：adversarial_consensus
- 必需上下文字段：worktree_path, branch_name
- 必需 Gate 项：design-01, design-02
- 对抗产物要求：R1-R8（详见 adversarial-artifact-protocol）
```

**效果**：AI 在开始工作前就知道所有推进条件，可以有针对性地准备。

### 改进 3 [P0]：增强错误反馈的可操作性

**现状**：错误返回 `{ code: "GATE_FAILED", message: "Gate 自检未通过：design-01" }`。
**改进**：在错误反馈中增加修复指引：

```json
{
  "code": "GATE_FAILED",
  "severity": "error",
  "message": "Gate 自检未通过：design-01",
  "details": {
    "failed_gates": ["design-01"],
    "fix_guidance": {
      "design-01": {
        "description": "Feature 文档的 [design-time] 章节必须已锁定",
        "check": "确认 docs/features/ 下的 Feature 文档中所有标记 [design-time] 的章节已填写完成",
        "doc_ref": "adversarial-artifact-protocol.md"
      }
    }
  }
}
```

**效果**：AI 收到错误后知道具体怎么修复，不再需要"猜"。

**附带修复**：同时修正 `adversarial-artifact-protocol.md` 中 R6 的类型标记，从"阻断"改为"告警"，与代码实现对齐。

### 改进 4 [P1]：建立 SKILL.md 检查项与 gate_ids 的显式映射

**现状**：AI 需要自行推断 SKILL.md 检查项 → gate_evidence 键的映射。
**改进**：在 SKILL.md 的 Stage Gate 自检章节中，明确标注每个检查项对应的 gate ID：

```markdown
| ID | 对应 gate_id | 清单项 | 必须 |
|---|-------------|--------|------|
| design-01 | gate_evidence["design-01"] | Feature 文档的 [design-time] 章节已锁定 | ✅ |
| design-02 | gate_evidence["design-02"] | 无未解决的设计争议 | ✅ |
```

并在信号模板中增加注释，说明每个 gate_evidence 值的期望格式。

### 改进 5 [P3]：在信号模板中嵌入字段最低要求

**现状**：信号模板只展示结构，不展示字段约束。
**改进**：在 SKILL.md 的信号模板中增加约束注释：

```json
{
  "adversarial_artifact": {
    "independent_verification": [
      {
        "command": "{{验证命令}}",
        "actual_output": "{{实际输出，>= 20 字符}}",  // R3: 最少 20 字符
        "executed_at": "{{ISO 时间戳}}"
      }
    ],
    "critique_obligation": {
      "items": ["{{至少 4 项}}"]  // R4: design stage 最少 4 项
    },
    "scenario_coverage": {
      "constructed_scenarios": ["{{至少 2 个}}"]  // R4b: design stage 最少 2 个
    }
  }
}
```

### 改进 6 [P0]：用户手动推进改为"警告 + 确认"模式

**现状**：用户在界面点击"推进"按钮时，如果 `evaluateAdvance()` 返回 `blocked`，后端直接返回 HTTP 409，前端显示 toast 后推进失败。用户和 AI 被完全同等对待，没有 override 机制。
**改进**：

1. **后端**：新增独立端点 `POST /api/stages/:stageId/advance/force`（不复用原 advance 端点，防止 AI 通过 MCP 绕过拦截）。该端点即使 `evaluateAdvance()` 返回 `blocked` 也执行 `advanceStage()`，但在响应中标记 `forced: true` 和原始 evaluation reasons。**审计日志**：强制推进时写入 stage 变更历史，标记 `forced: true`，让后续审查者知道这次推进是用户手动强制的
2. **前端**：`StageActionBar` 和 `StageSuggestionCard` 在收到 409 时，不再只显示 toast，而是弹出确认对话框。对话框**按 severity 分组**展示阻断原因（error vs warning），提供"确认推进"按钮。用户点击"确认推进"时，调用 `/force` 端点

**效果**：用户看到完整的阻断原因后，可以确认推进。AI 推进路径不变（仍然被硬拦截，且无法访问 `/force` 端点）。

**架构师-2 审视补充**：
- force 端点必须与原 advance 端点隔离，防止 AI 通过 HTTP 绕过 MCP 校验链
- 强制推进必须写审计日志
- 确认对话框应按 severity 结构化展示阻断原因

### 改进 7 [P2]：前端渲染 `evaluation_result` 事件

**现状**：前端 `EventBatcher` 不处理 `evaluation_result` WebSocket 事件，AI 信号被拦截时用户完全看不到反馈。
**改进**：在 `useWebSocket.ts` 的 `add()` 方法中增加 `evaluation_result` 事件处理，将拦截原因展示在 `StageSuggestionCard` 或专门的状态区域中。
**效果**：用户能看到 AI 信号被拦截的原因，了解当前推进状态。

## 不兼容更新

改进 6 涉及后端 API 变更（`force` 参数），但为可选参数，不影响现有调用。

## 验收标准

### P0（必须在当前迭代完成）
- [x] AI 在发出信号前必须调用 `validate_stage_signal`（通过 SKILL.md `[HARD]` 规则强制）
- [x] 错误反馈包含每个失败项的 `fix_guidance`（含 `description`、`check`、`doc_ref`）
- [x] `adversarial-artifact-protocol.md` 中 R6 类型从"阻断"修正为"告警"
- [x] 用户手动推进被 409 拦截时，弹出确认对话框（按 severity 分组展示原因），用户可确认后强制推进
- [x] 强制推进使用独立端点 `POST /api/stages/:stageId/advance/force`，与原 advance 端点隔离
- [x] 强制推进写入审计日志（stage 变更历史标记 `forced: true`）

### P1（后续迭代）
- [ ] SKILL.md 中 gate 检查项与 gate_evidence 键有显式映射，幽灵 gate ID 已标注

### P2-P3（可选）
- [ ] 系统提示中包含当前阶段的推进条件摘要
- [ ] 前端渲染 `evaluation_result` WebSocket 事件
- [ ] 信号模板中包含字段最低要求的注释

## 实现记录

### 改进 1：SKILL.md [HARD] 信号预校验规则
- `data/file/skills/cd-design/SKILL.md`：Gotchas 增加 `[HARD] 信号预校验` 规则
- `data/file/skills/cd-development/SKILL.md`：同上
- `data/file/skills/cd-review/SKILL.md`：同上

### 改进 3：错误反馈可操作化（fix_guidance）
- `src/domain/snail-mcp-server/_internal/servers/snail-signal-validation.ts`：增加 `GATE_METADATA` 映射表，`checkGates` 和 `checkContextFields` 返回 `fix_guidance`
- `src/app/issue-collaboration/signal-validation.ts`：同上（L1 拦截层）
- `src/app/issue-collaboration/auto-advance.ts`：同上（L2 评估层），增加 `buildGateFixGuidance` 辅助函数

### 改进 3 附带：R6 文档修正
- `data/file/skills/cd-shared/references/adversarial-artifact-protocol.md`：R6 类型从"阻断"改为"告警"

### 改进 6：用户强制推进（警告+确认模式）
- `src/app/issue-collaboration/port.ts`：`CollaborationInput` 接口增加 `forceAdvance` 方法
- `src/app/issue-collaboration/collaboration.ts`：实现 `forceAdvance`（跳过引擎阻断，写审计日志标记 `forced`）
- `src/infra/http/routes/issue.route.ts`：新增 `POST /api/stages/:stageId/advance/force` 端点
- `src/api-contracts/endpoints.ts`：新增 force 端点类型定义
- `src/web/components/ForceAdvanceDialog.tsx`：新增确认对话框组件（按 severity 分组展示阻断原因）
- `src/web/components/StageActionBar.tsx`：409 时弹出 `ForceAdvanceDialog` 替代 toast
- `src/web/components/StageSuggestionCard.tsx`：同上
- `tests/evolution-app-adapter.test.ts`：mock 增加 `forceAdvance`
