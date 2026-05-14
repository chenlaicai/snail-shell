# F2026051402 移除 render_mode 字段

## 背景

当前系统提示词体系中的 `render_mode` 字段设计已不适用最新版本。该字段在 v2 重构时被保留（F2026051304 非目标第 3 条），但实际上导致了以下问题：

1. **Stage Role Playbook 的 checklist section 标题被过滤掉**：`render_mode: "outline"` 只注入以 `- ` 开头的行，导致 `**环境准备 →**` 等标题不会被注入
2. **模型无法理解工作流程的阶段顺序**：checklist 项目被当作可选待办事项，而不是必须按顺序执行的步骤
3. **研发 Snail 直接改本地代码**：由于看不到 worktree 隔离要求，研发 Snail 跳过环境准备阶段直接进入实现

## 目标

1. 移除 `render_mode` 字段，所有 prompt 文件统一使用完整注入
2. 简化 `renderPromptContent` 函数，移除 `outline` 相关逻辑
3. 移除 `renderPromptOutline` 函数及其所有引用
4. 更新文档和模板，移除 `render_mode` 相关说明

## 非目标

1. 不修改 prompt 文件的实际内容（只移除 frontmatter 中的 `render_mode` 字段）
2. 不改变 `target`、`when`、`order` 等其他字段的行为
3. 不修改 Prompt Center UI 的整体结构

## 设计

### 移除 render_mode 字段

所有 prompt 文件的 frontmatter 不再包含 `render_mode` 字段。运行时统一使用完整注入，不再区分 `full` 和 `outline` 模式。

### 简化 renderPromptContent 函数

```typescript
// 修改前
export function renderPromptContent(prompt: PromptDocument, variables: Record<string, string>): string {
  const rendered = renderPromptTemplate(prompt.content, variables);
  if (prompt.render_mode === "outline") {
    return extractOutlineLines(rendered).join("\n");
  }
  return rendered;
}

// 修改后
export function renderPromptContent(prompt: PromptDocument, variables: Record<string, string>): string {
  return renderPromptTemplate(prompt.content, variables);
}
```

### 移除 renderPromptOutline 函数

`renderPromptOutline` 函数及其所有引用将被移除：
- `src/prompt-center/registry.ts`：函数定义
- `src/prompt-center/index.ts`：导出
- `src/meta/index.ts`：导出
- `src/prompt-center/builder.ts`：调用
- `src/bin/regulation-expand.ts`：调用
- `tests/meta/prompt-assets-test.ts`：测试

### 更新 Prompt Center UI

移除 `render_mode` 相关的 chip 展示：
- `src/web/prompt-library.js`：移除 `render_mode` chip

## 生效路径

1. `src/prompt-center/registry.ts`：运行时 prompt 渲染逻辑
2. `src/prompt-center/builder.ts`：系统提示词构建逻辑
3. `src/web/prompt-library.js`：Prompt Center UI 展示
4. `docs/core/prompt-system-structure.md`：提示词规范文档
5. `.meta/prompts/prompt.md.template`：提示词模板
6. S-03、S-04 的 frontmatter：移除 `render_mode` 字段

## 改动范围

修改：

1. `src/prompt-center/registry.ts`
2. `src/prompt-center/index.ts`
3. `src/meta/index.ts`
4. `src/prompt-center/builder.ts`
5. `src/bin/regulation-expand.ts`
6. `src/web/prompt-library.js`
7. `tests/meta/prompt-assets-test.ts`
8. `docs/core/prompt-system-structure.md`
9. `.meta/prompts/prompt.md.template`
10. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/S-03-研发者手册.md`
11. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/S-04-检视者手册.md`

新增：

1. `docs/features/20260514/F2026051402-remove-render-mode.md`

## 验证

1. `npm run lint` ✓
2. `npm run build` ✓
3. `npm run test` ✓
4. 确认 S-03、S-04 的 frontmatter 中不再包含 `render_mode` 字段
5. 确认 `renderPromptContent` 函数返回完整内容，不再过滤
6. 确认 Prompt Center UI 不再展示 `render_mode` chip
7. 确认系统提示词构建时 Stage Role Playbook 使用完整内容

## 风险与决策记录

1. 决策：移除 `render_mode` 字段而不是修改 `extractOutlineLines` 函数。原因是用户认为当前提示词已经是完善版、内容聚焦很核心，内容直接注入即可，不再需要进行额外处理后再注入。
2. 决策：保留 `renderPromptContent` 函数但简化实现。原因是该函数被广泛使用，移除会影响面较大。
3. 风险：移除 `render_mode` 后，Stage Role Playbook 的内容会变得更长。但用户认为这是可接受的，因为完整内容有助于模型理解工作流程。
