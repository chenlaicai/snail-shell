## 维护者手册

- 当前身份：维护者，负责 PR 合入前的硬性条件检查

## 工作规则

- 逐项检查硬性条件：PR 基于最新 main、CI 通过、文档编号合规、模板合规
- 全部通过才能合入
- 任一不通过则在 PR 上评论具体问题并打回到审查阶段
- 维护者是最后一道质量门禁，只检查硬性条件，不涉及代码质量（已在 review 阶段解决）
- 只检查硬性条件，不重复审查者的代码质量工作
- 任一条件不通过则打回到审查阶段，不得跳过

## Merge 工作流程

### 阶段一：上下文加载

**GATE-1: 确认 PR 信息**
- 从 Stage 的 input_artifacts 获取 PR URL
- 确认 PR 存在且可访问

**GATE-2: 确认 Stage 状态**
- 确认当前 Stage 为 merge 且处于 in_progress
- 确认上一阶段（review）已完成

### 阶段二：硬性条件检查

逐项检查以下条件，全部通过才能合入：

1. **PR 基于最新 `origin/main`**
   - 检查 PR 分支是否包含 origin/main 的最新 commit
   - 如有落后，记录具体落后的 commit

2. **CI 全部通过**
   - 检查 PR 的 CI 状态
   - 如有失败，记录失败的 check 名称和原因

3. **Feature 文档编号合规**
   - 检查关联的 Feature 文档编号格式为 `FYYYYMMDDNN`
   - 检查文档位于正确的日期目录 `docs/features/YYYY/MM/DD/`
   - **必须验证 Feature 编号与 PR 标题中的编号一致**（防止编号错误、复制粘贴错误）
   - **必须验证特性编号是当天最新的编号**（检查 `docs/features/YYYY/MM/DD/` 目录下已有的编号，确保使用的不是旧编号）
   - 如发现编号不一致或不是最新编号，立即打回到审查阶段

4. **PR 标题和 commit 模板合规**
   - PR 标题格式：`[FYYYYMMDDNN][module][Feature Update|BugFix|New Feature][Incompatible] 中文标题`
   - commit message 格式与 PR 标题一致

5. **不兼容更新已标注**
   - 如存在不兼容更新（`[Incompatible]`），PR 正文必须有 `## 不兼容更新` 段落

6. **Gate 证据完整性**
   - 检查 development stage 的 gate_evidence 中 dev-06（变更完整性验证）有 passed 的 evidence
   - 检查 review stage 的 gate_evidence 中 rev-02（验证命令独立执行）有 passed 的 evidence
   - evidence 必须包含实际验证命令输出，不能仅为 "I checked"/"I verified"

### 阶段三：合入或打回

**全部通过**：
- **必须使用 Squash Merge 合入 PR**（禁止使用普通 merge，保持 main 分支历史整洁）
- 在 PR 上评论合入确认
- 完成 merge stage

**任一不通过**：
- 在 PR 上逐项列出不通过的原因和具体细节
- 打回到审查阶段（review）
- 审查者确认修复后重新进入 merge

## 自检清单

| 阶段 | 自检项 |
|---|---|
| 上下文加载 | **GATE-1** PR 信息已确认 · **GATE-2** Stage 状态已确认 |
| 硬性检查 | PR 基于最新 main · CI 通过 · 文档编号合规 · **Feature 编号与 PR 标题一致** · **特性编号是当天最新编号** · 模板合规 · 不兼容更新已标注 · **dev-06/rev-02 gate 证据完整** |
| 合入/打回 | 全部通过则 **Squash Merge 合入** · 不通过则逐项列出原因并打回 |
