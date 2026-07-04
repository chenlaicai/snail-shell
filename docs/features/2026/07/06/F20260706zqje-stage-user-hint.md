---
id: F20260706zqje
title: 推进 Stage 时支持用户补充说明
status: locked
created_at: 2026-07-03
---

# F20260706zqje — 推进 Stage 时支持用户补充说明

## 背景

Stage 推进时，`autoInvokeNewStage()` 向新阶段发送 kickoff 消息触发 agent 工作。当前 kickoff 消息是固定的：
- 首次进入：`"开始执行。"`
- 重新进入：`"重新进入 [key] 阶段。请先了解前序阶段的情况和变更，再开始工作。"`

**问题**：用户在推进 stage 时，往往有具体的原因或指示想传达给新阶段的 agent，例如：
- "我发现了一个问题 X，你重新做一下设计"
- "之前的方案有性能问题，需要优化"
- "LGTM，继续开发"

当前系统无法在推进时传递这些信息，agent 只能依赖 context block 中的历史消息来推断用户意图。

**对比 createIssue 场景**：`autoInvokeFirstStage()` 已支持使用 `summary` 作为用户消息发送给第一个阶段的 agent。推进 stage 应有类似能力。

## 核心业务行为

1. **当用户推进 stage 时**，可以可选地填写一段补充说明（`user_hint`，最长 2000 字符）
2. **当 `user_hint` 有内容时**，系统应将其作为**用户消息**发送给新阶段的 agent，而非使用默认的系统消息
3. **当 `user_hint` 为空时**，保持当前行为（首次进入发"开始执行。"，重新进入发"重新进入..."）
4. **`user_hint` 应优先于重新进入提示**：即使是重新进入场景，如果用户提供了 `user_hint`，应使用用户的文本，而非固定的"重新进入..."提示
5. **`user_hint` 支持 @mentions 路由**：用户可以在 hint 中使用 `@角色名` 实现精确路由（利用现有 `resolveToSpeakers` 能力）
6. **`rollbackStage` 自动继承 `userHint` 支持**：因为 `rollbackStage` 是 `advanceStage` 的别名

## [design-time]

### 决策记录

#### D0: userHint 作为用户消息还是系统消息

**问题**：`user_hint` 应该作为用户消息（`fromSpeaker="user"`）还是系统消息（`fromSpeaker=""`）发送？

**方案 A**：作为用户消息
**方案 B**：作为系统消息

**选择方案 A**。理由：
- `user_hint` 本质上是**用户给 agent 的指令**，不是 metadata
- 作为用户消息发送，agent 会将其视为用户意图，优先处理
- 与 `autoInvokeFirstStage()` 使用 `summary` 作为用户消息的行为一致
- UI 渲染为用户气泡（右侧），视觉上明确表示这是用户的输入

#### D1: userHint 与重新进入提示的优先级

**问题**：重新进入场景下，`user_hint` 和"重新进入..."提示如何共存？

**方案 A**：`user_hint` 优先，忽略重新进入提示
**方案 B**：两者合并，重新进入提示在前，`user_hint` 在后
**方案 C**：重新进入提示作为系统消息，`user_hint` 作为用户消息（两条消息）

**选择方案 A**。理由：
- 用户主动填写的说明比系统自动生成的提示更有价值
- 如果用户写了"我发现了一个问题 X"，再附加"重新进入..."会显得冗余
- 简化实现，只有一条 kickoff 消息
- 如果用户想了解前序情况，可以在 `user_hint` 中自行提及

#### D2: 前端 UI 形式

**问题**：`user_hint` 输入框应该是什么形式？

**方案 A**：固定显示的 textarea
**方案 B**：可折叠的展开区域，默认隐藏
**方案 C**：点击"Advance"后弹出对话框

**选择方案 B**。理由：
- 大多数情况下用户不需要填写 `user_hint`，默认隐藏减少视觉干扰
- 可折叠区域让用户知道有这个功能，但不强制填写
- 比弹出对话框更轻量，不需要额外的确认步骤
- placeholder 提示用户可以填写推进原因

### 变更清单

#### C0: advanceStage 接口增加 userHint 参数（collaboration.ts）

**文件**：
- `src/app/issue-collaboration/collaboration.ts`

**变更**：

1. **`IssueCollaboration.advanceStage()`**：接收 `userHint` 参数，传递给 `autoInvokeNewStage()`
2. **`autoInvokeNewStage()`**：接收 `userHint` 参数，根据是否有内容决定 kickoff 消息

**注意**：port.ts 不需要变更。`userHint` 只在 `autoInvokeNewStage` 中使用，port 层的 `advanceStage` 签名不涉及 kickoff 逻辑。

**已知行为**：`rollbackStage` 是 `advanceStage` 的别名（collaboration.ts:412-414），会自动继承 `userHint` 支持。这是合理的——回滚场景同样可能需要用户指示。

**实现逻辑**：

```typescript
async advanceStage(stageId: string, targetKey: string, userHint?: string): Promise<Stage> {
  const stage = this.deps.stagePort.advanceStage(stageId, targetKey);
  this.cleanupDispatchStates(stageId);
  for (const s of (this.suggestions.get(stageId) ?? [])) this.deps.stageSuggestionRepo.markProcessed(s.message_id.toString(), "confirmed");
  this.suggestions.delete(stageId);
  this.helpers.initStageCursors(stage);
  this.autoInvokeNewStage(stage, userHint);
  return stage;
}

private autoInvokeNewStage(stage: Stage, userHint?: string): void {
  if (!stage.default_role_instance) return;

  // 用户提供了 hint，作为用户消息发送
  if (userHint?.trim()) {
    this.sendMessage(stage.id, userHint.trim(), "user").catch((err) => {
      log.error({ stageId: stage.id, err }, "autoInvokeNewStage failed");
    });
    return;
  }

  // 默认行为：首次进入发系统消息，重新进入发提示
  const reEntry = isStageReEntry(this.deps.stagePort.listStages(stage.issue_id) ?? [], stage.id);
  const text = reEntry
    ? `重新进入 [${stage.key}] 阶段。请先了解前序阶段的情况和变更，再开始工作。`
    : "开始执行。";
  this.sendMessage(stage.id, text, "").catch((err) => {
    log.error({ stageId: stage.id, err }, "autoInvokeNewStage failed");
  });
}
```

#### C1: API 路由增加 user_hint 字段（issue.route.ts）

**文件**：
- `src/infra/http/routes/issue.route.ts`

**变更**：

1. **`advanceStageBody` schema**：增加可选字段 `user_hint: z.string().max(2000).optional()`
2. **路由处理函数**：将 `body.user_hint` 传递给 `collaboration.advanceStage()`

```typescript
const advanceStageBody = z.object({
  target_key: z.string().min(1),
  user_hint: z.string().max(2000).optional(),  // 新增，限制 2000 字符
});

app.post("/api/stages/:stageId/advance", zValidator("json", advanceStageBody), async (c) => {
  const stageId = c.req.param("stageId");
  const body = c.req.valid("json");
  const evaluation = await deps.collaboration.evaluateAdvance(stageId);
  if (evaluation.action === "blocked") {
    return c.json({ error: "Advance blocked by engine", evaluation }, 409);
  }
  const stage = await deps.collaboration.advanceStage(stageId, body.target_key, body.user_hint);
  return c.json(toStageDto(deps, stage), 201);
});
```

#### C2: 前端 StageActionBar 增加 user_hint 输入框（StageActionBar.tsx）

**文件**：`src/web/components/StageActionBar.tsx`

**变更**：

1. 增加 `userHint` state 和 `showHintInput` state
2. 在 Advance 按钮上方增加可折叠的 textarea
3. `handleAdvance()` 将 `userHint` 传递给 API

```typescript
const [userHint, setUserHint] = useState("");
const [showHintInput, setShowHintInput] = useState(false);

async function handleAdvance() {
  if (!currentStage || advancing || isClosing || transitions.length === 0 || needsSelection) return;
  const targetKey = transitions.length === 1 ? transitions[0].to : selectedTarget;
  if (!targetKey) { showToast("请选择目标阶段", true); return; }
  setAdvancing(true);
  try {
    const stage = await api("POST /api/stages/:stageId/advance", {
      params: { stageId: currentStage.id },
      body: {
        target_key: targetKey,
        user_hint: userHint.trim() || undefined,  // 新增
      },
    });
    showToast("阶段已推进");
    onStageChanged(stage);
    setSelectedTarget("");
    setUserHint("");  // 清空输入
    setShowHintInput(false);  // 折叠
  } catch (err: unknown) {
    showToast(`推进失败：${err instanceof Error ? err.message : String(err)}`, true);
  } finally {
    setAdvancing(false);
  }
}

// 在 Advance 按钮前增加
<div className="space-y-2">
  <button
    onClick={() => setShowHintInput(!showHintInput)}
    className="text-[11px] text-text-muted hover:text-text-secondary"
  >
    {showHintInput ? "收起" : "添加推进说明..."}
  </button>
  {showHintInput && (
    <textarea
      value={userHint}
      onChange={(e) => setUserHint(e.target.value)}
      placeholder="可选：填写推进原因或对新阶段的指示..."
      rows={3}
      className="w-full rounded-md border border-white/6 bg-surface-0 px-2.5 py-1.5 text-xs text-text-primary focus:border-shell-600/40 focus:outline-none resize-none"
    />
  )}
</div>
```

### 不兼容更新

无。所有变更都是向后兼容的：
- `userHint` 是可选参数，不提供时保持原有行为
- API 的 `user_hint` 字段是可选的，不传时保持原有行为

### 实现指引

- C0 是核心变更，C1 和 C2 依赖 C0
- `autoInvokeNewStage()` 的变更需要注意：`userHint` 有内容时直接 return，不执行后续的 re-entry 检测
- 前端 textarea 的 rows=3 适中，不会占用太多空间
- 可折叠的交互方式参考了"添加推进说明..."的文案，暗示这是可选功能

### 验收标准

| ID | 标准 | 验证方式 |
|----|------|----------|
| AC-0 | advanceStage 支持 userHint 参数 | 调用 advanceStage(stageId, targetKey, "测试说明") → 验证新阶段收到用户消息 |
| AC-1 | userHint 为空时保持默认行为 | 调用 advanceStage(stageId, targetKey) → 验证发送"开始执行。"系统消息 |
| AC-2 | userHint 优先于重新进入提示 | 先推进到 design，再回退到 development 并提供 userHint → 验证使用 userHint 而非"重新进入..." |
| AC-3 | API 支持 user_hint 字段 | POST /api/stages/:stageId/advance 带 user_hint → 返回 201 |
| AC-4 | API 不传 user_hint 时兼容 | POST /api/stages/:stageId/advance 不带 user_hint → 返回 201，行为不变 |
| AC-5 | API 长度约束 | POST /api/stages/:stageId/advance 带超长 user_hint（>2000 字符）→ 返回 400 |
| AC-6 | @mentions 路由 | user_hint 包含 "@开发者 请重新设计" → 验证消息路由到 mention 目标 |
| AC-7 | 前端可折叠输入框 | 点击"添加推进说明..." → 展开 textarea → 填写 → 推进 → 验证消息发送 |
| AC-8 | 前端推进后清空输入 | 推进成功后 → 验证 textarea 清空且折叠 |
| AC-9 | rollbackStage 继承 userHint | 调用 rollbackStage(stageId, targetKey, "回滚原因") → 验证使用 userHint |
