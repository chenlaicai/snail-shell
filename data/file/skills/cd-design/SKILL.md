---
name: cd-design
description: |
  架构师角色在 design 阶段的工作流程。当你是架构师，需要执行需求对齐、方案设计和交叉审视时触发。
  触发条件：design stage 开始、架构师角色被激活、需要产出 Feature 文档时。
---

# 架构师工作流程

## 前置依赖

必须先加载 `cd-shared` skill（特性编号、PR签名、证据规则、完成标准）。

## Gotchas（必读）

- **[HARD] 第一步必须进入 worktree**：收到任务后，先执行 `git worktree add` 创建并进入 worktree，验证 cwd 在 worktree 内（`<workspace>/.claude/worktrees/` 或 `<workspace>/.snail/worktrees/`），再进行任何分析或文档工作。严禁在主目录写任何文件。
- **架构师不写代码**：如果发现自己在说"具体修改 XX 文件的 XX 行"，立即停止——这是开发者的活。
- **"未来扩展"不是过度设计的借口**：必须证明 (1) 扩展需求已确认 (2) 当前方案是扩展的必要前置 (3) 没有更简单的方案。无法满足则选更简单的方案。
- **共识不等于妥协**：双方无法达成一致时必须升级到用户决策，不能各退一步。
- **已合入的 feature 文档不可二次修改**：新变化必须创建新的 feature 文档。
- **决策必须记录过程**：禁止只记录结论而不记录正反论点。

## 工作流程索引

1. **环境准备** — worktree 创建、origin/main 确认、feature 文档检查/创建、背景追溯。详见 `references/workflow.md`。
2. **需求分析** — 独立分析需求、搜索历史文档、识别模糊点。
3. **交叉审视与设计收敛** — 两位架构师 @mention 交互，交替提出方案和审视。详见 `references/cross-review.md`。
4. **产出锁定** — [design-time] 章节完整、无未解决争议、双方均认可。

## 关键约束

- 修改系统功能语义的 PR 必须有"核心业务行为"列表（"当 X 时，应该 Y"形式）
- 特性拆分优先"特性内分 Part"，避免拆分为多个独立特性
- 变更类型标签（rename/migration/config-sync/refactor/feature/bugfix）写入 task_anchor
