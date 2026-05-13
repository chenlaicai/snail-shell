# F2026051206 提示词工作流程显性化重构

## 背景

用户反馈当前提示词效果一般，存在以下问题：
1. Snail 忘记正确使用 mention
2. 检视者漏检查 feature 文档编号导致编号冲突
3. 研发者提完代码忘记让检视者行动

根本原因：当前的阶段角色手册是规则集合，不是可执行的流程。AI 需要在多条规则中自行拼凑"现在该做什么"，容易遗漏。

## 目标

1. 工作流程显性化：把阶段角色手册从规则集合重构为可执行的步骤序列
2. 设计文档环节：在 development 阶段加入设计文档产出和对齐步骤
3. 规则条文化：所有提示词采用统一的条文化格式，每条规则有独立编号
4. 评估机制引用：在提示词中引用 `prompt-behavior-samples.json`

## 非目标

1. 修改 `stages.json`、`snails.json` 等配置文件
2. 修改运行时装配逻辑

## 设计

### 核心改动

1. **P010201-研发迭代手册.md**：重构为 8 个步骤的可执行流程，采用条文化格式
   - 步骤 1：承接背景
   - 步骤 2：需求分析
   - 步骤 3：设计文档（新增）
   - 步骤 4：设计对齐（新增）
   - 步骤 5：编码实现
   - 步骤 6：自检验证
   - 步骤 7：PR 提交
   - 步骤 8：呼叫检视

2. **P010202-研发检视处理.md**：重构为 5 个步骤的可执行流程，采用条文化格式

3. **P010203-验收检视手册.md**：重构为 7 个步骤的检视流程 + 3 个步骤的复检流程，采用条文化格式

4. **P0001-AI基础契约.md**：采用条文化格式，编号 0001-0006

5. **P0002-知识候选入口.md**：采用条文化格式，编号 0007-0010

6. **P0003-Claude转录边界.md**：采用条文化格式，编号 0011-0014

7. **P0004-AI判断与责任契约.md**：采用条文化格式，编号 0015-0025

8. **Work Context 提示词**：采用条文化格式，编号 0026-0070

9. **Stage Role Playbook 提示词**：采用条文化格式，编号 0071-0245

10. **docs/core/prompt-system-structure.md**：更新规则条文化规范，采用 [XXYY] 编号格式

### 设计决策

1. **设计文档作为 feature 文档的一部分**：不需要单独创建设计文档文件，直接在 feature 文档中产出设计内容。

2. **跨 Snail 交接通过流程步骤明确**：不需要专门的交接机制，在流程步骤中写清楚如何通过 `message-out` mention 协议呼叫其他 Snail。

3. **每个步骤必须包含**：触发条件、必须动作、完成标志、下一步衔接。

## 生效路径

1. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/`：阶段角色手册
2. `.meta/prompts/base/P0001-AI基础契约.md`：AI 基础契约
3. `docs/core/prompt-system-structure.md`：提示词编写规范

## 改动范围

1. `.meta/prompts/base/P0001-AI基础契约.md`
2. `.meta/prompts/base/P0002-知识候选入口.md`
3. `.meta/prompts/base/P0003-Claude转录边界.md`
4. `.meta/prompts/base/P0004-AI判断与责任契约.md`
5. `.meta/prompts/scenarios/project-conversation/work-context/P010101-项目推进入口.md`
6. `.meta/prompts/scenarios/project-conversation/work-context/P010102-项目范围.md`
7. `.meta/prompts/scenarios/project-conversation/work-context/P010103-Feature范围.md`
8. `.meta/prompts/scenarios/project-conversation/work-context/P010104-Stage范围.md`
9. `.meta/prompts/scenarios/project-conversation/work-context/P010105-参与者范围.md`
10. `.meta/prompts/scenarios/project-conversation/work-context/P010106-Conversation范围.md`
11. `.meta/prompts/scenarios/project-conversation/work-context/P010107-历史能力入口.md`
12. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md`
13. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010202-研发检视处理.md`
14. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010203-验收检视手册.md`
15. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010204-代码仓工作基线.md`
16. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010205-Feature文档治理.md`
17. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010206-提示词治理.md`
18. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010207-代码与PR交付规则.md`
19. `docs/core/prompt-system-structure.md`

## 验证

1. 检查提示词文件格式是否正确（前置元数据 + markdown）
2. 检查步骤序列是否完整（触发条件、必须动作、完成标志、下一步）
3. 检查是否消除了重复规则
4. 检查是否引用了评估机制
5. 检查所有提示词是否采用条文化组织（每条规则有独立编号）
6. 检查规则编号格式是否正确（N.M）
7. 检查生效范围标记是否正确

## 风险与决策记录

1. **风险**：流程步骤可能过于刚性，不适合所有场景
   - **决策**：步骤是指导性的，AI 可以根据实际情况调整，但必须说明理由

2. **风险**：设计文档环节可能增加开发时间
   - **决策**：设计文档是 feature 文档的一部分，不需要额外创建文件，增加的时间可控

## PR 记录

- PR #163: https://github.com/chenlaicai/snail-shell/pull/163
- 分支: feature/prompt-workflow-explicit
- 状态: 已提交，等待检视

## 范围变更记录

1. **变更**：新增规则条文化改动
   - **原因**：用户指出"规则条文化"不止是格式问题，更是组织调整
   - **影响**：所有提示词文件全部重构，采用 [XXYY] 编号格式

2. **变更**：新增工作流程显性化改动
   - **原因**：用户反馈 AI 容易遗漏规则
   - **影响**：阶段角色手册重构为可执行的步骤序列

3. **变更**：新增设计文档环节
   - **原因**：用户期望研发者先产出设计文档，与用户对齐后再编码
   - **影响**：研发迭代手册新增步骤 3（设计文档）和步骤 4（设计对齐）
