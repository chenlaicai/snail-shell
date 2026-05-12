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
3. 规则条文化：消除重复，每条规则有明确的触发条件和行动
4. 评估机制引用：在提示词中引用 `prompt-behavior-samples.json`

## 非目标

1. 重新设计整个提示词组织结构（已有 P<层级编号> 体系）
2. 修改 `stages.json`、`snails.json` 等配置文件
3. 修改 work-context 相关提示词

## 设计

### 核心改动

1. **P010201-研发迭代手册.md**：重构为 8 个步骤的可执行流程
   - 步骤 1：承接背景
   - 步骤 2：需求分析
   - 步骤 3：设计文档（新增）
   - 步骤 4：设计对齐（新增）
   - 步骤 5：编码实现
   - 步骤 6：自检验证
   - 步骤 7：PR 提交
   - 步骤 8：呼叫检视

2. **P010202-研发检视处理.md**：重构为 5 个步骤的可执行流程
   - 步骤 1：接收检视通知
   - 步骤 2：分析检视意见
   - 步骤 3：修复或回应
   - 步骤 4：更新 PR
   - 步骤 5：呼叫复检

3. **P010203-验收检视手册.md**：重构为 7 个步骤的检视流程 + 3 个步骤的复检流程
   - 检视流程：
     - 步骤 1：接收检视请求
     - 步骤 2：读取设计文档（新增）
     - 步骤 3：对齐需求理解（新增）
     - 步骤 4：检视代码
     - 步骤 5：专项检查
     - 步骤 6：问题报告
     - 步骤 7：呼叫研发者
   - 复检流程：
     - 步骤 1：接收复检请求
     - 步骤 2：重新检视
     - 步骤 3：复检结论

4. **P0001-AI基础契约.md**：新增"效果评估边界"部分，引用 `prompt-behavior-samples.json`

5. **docs/core/prompt-system-structure.md**：更新阶段角色手册结构说明，强调流程显性化

### 设计决策

1. **设计文档作为 feature 文档的一部分**：不需要单独创建设计文档文件，直接在 feature 文档中产出设计内容。

2. **跨 Snail 交接通过流程步骤明确**：不需要专门的交接机制，在流程步骤中写清楚如何通过 `message-out` mention 协议呼叫其他 Snail。

3. **每个步骤必须包含**：触发条件、必须动作、完成标志、下一步衔接。

## 生效路径

1. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/`：阶段角色手册
2. `.meta/prompts/base/P0001-AI基础契约.md`：AI 基础契约
3. `docs/core/prompt-system-structure.md`：提示词编写规范

## 改动范围

1. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010201-研发迭代手册.md`
2. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010202-研发检视处理.md`
3. `.meta/prompts/scenarios/project-conversation/stage-role-playbooks/P010203-验收检视手册.md`
4. `.meta/prompts/base/P0001-AI基础契约.md`
5. `docs/core/prompt-system-structure.md`

## 验证

1. 检查提示词文件格式是否正确（frontmatter + markdown）
2. 检查步骤序列是否完整（触发条件、必须动作、完成标志、下一步）
3. 检查是否消除了重复规则
4. 检查是否引用了评估机制

## 风险与决策记录

1. **风险**：流程步骤可能过于刚性，不适合所有场景
   - **决策**：步骤是指导性的，AI 可以根据实际情况调整，但必须说明理由

2. **风险**：设计文档环节可能增加开发时间
   - **决策**：设计文档是 feature 文档的一部分，不需要额外创建文件，增加的时间可控

## 范围变更记录

无
