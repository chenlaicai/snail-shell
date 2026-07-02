# 架构师工作流程详细流程

## 阶段一：环境准备

### GATE-1: 进入隔离 worktree
- 使用 `git worktree add` 基于最新 `origin/main` 创建 worktree
- 验证：当前工作目录必须在 worktree 内（`<workspace>/.claude/worktrees/` 或 `<workspace>/.snail/worktrees/`）
- 严禁在主目录进行任何文件修改（包括 feature 文档）
- 创建 worktree 和分支后，调用 `set_context` 写入 Issue.context：
  - key: `worktree_path`, value: `<worktree 绝对路径>`
  - key: `branch_name`, value: `<分支名>`

### GATE-2: 拉取并确认 `origin/main` 最新
- 在 worktree 内执行 `git fetch origin main` 并 rebase

### GATE-3: Feature 文档已检查/创建
- 扫描 `docs/features/YYYY/MM/DD/`
- 无对应文档 → 按 `docs/README.md` 模板创建
- 有文档 → 确认属于当前 issue，加载上下文
- 已合入的 feature 文档是历史交付记录，不得二次修改；新变化必须创建新的 feature 文档
- feature 文档不应残留未确认的问题；风险、疑问或待决策事项必须向用户或相关参与者提出并收敛

### GATE-4: 背景已追溯
- 基于用户需求描述、上一 Stage 产物、Feature 文档、已记录 PR 和必要的 conversation history
- 搜索相关的历史 Feature 文档（feature-chain skill）
- 查阅知识库中的相关约束和决策（knowledge-library skill）

所有 GATE 通过后方可进入阶段二。

## 阶段二：需求分析

1. 独立分析需求，理解用户要解决的真实问题
2. 搜索历史 Feature 文档和知识库，建立上下文
3. 识别需求中的模糊点、冲突点和边界条件
4. 向用户提问时，说明已查证的线索和仍缺失的决策点

## 阶段三：交叉审视与设计收敛

详见 `cross-review.md`。

## 决策日志

架构师在设计过程中做出的事后纠正模式决策，必须记录在 Feature 文档的"关键决策记录"章节。记录格式：
- 决策内容：做了什么决策
- 决策依据：基于什么理由
- 纠正通道：用户标记"这个决策不对"并说明原因
- **纠正标记格式**：用户以 `[纠正]` 前缀标记决策纠正，格式为 `[纠正] {决策内容引用}：{纠正原因}`。例：`[纠正] 选择方案 A：我需要的是 X，不是 Y`。
- **纠正处理流程**：架构师收到纠正后 → (1) 确认纠正范围（精确定位被纠正的决策）(2) 按"被纠正后的恢复"规则判断是否升级介入层级 (3) 重新分析并给出新方案 (4) 更新决策日志，保留原始决策和纠正记录。

当前 feature 只实现决策记录和纠正标记。自动升级介入层级作为后续 feature。

## 阶段四：产出锁定

### 前置条件（design-04 Gate）

产出锁定前必须满足：
- 对话历史中必须存在双方架构师的审视记录（Phase 2 完成）
- 缺少一方审视则 Gate 不通过
- Phase 2 完成前不得向用户呈现方案

详见 `cross-review.md` 的 Stage Gate（design-04）章节。

### 强制输出给用户确认

1. 设计文档锁定前，必须将完整文档内容通过消息输出给用户审阅
2. 用户确认后才能锁定；有疑问必须向用户确认，禁止自行猜测
3. 用户对部分内容有异议时，针对异议点局部回退重新分析，不需要整体回退
4. 用户长时间未确认时，系统提醒一次（不设超时，用户是最终决策者）

### 锁定检查

1. 确认 Feature 文档的 `[design-time]` 章节完整
2. 修改系统功能语义的 PR：确认"核心业务行为"章节已填写且列表非空；每条行为满足 `behavior-item-guide.md` 中的 5 条质量标准（S1 触发条件具体、S2 预期行为可观测、S3 值得守护、S4 粒度适中、S5 不绑定实现）
3. 确认「设计约束摘要」已从设计章节中提取关键边界、决策和语义不变量
4. 确认无未解决的设计争议
5. 两位架构师均明确表示设计方案可接受
6. 将 Feature 文档的 `[design-time]` 章节视为锁定——进入实现阶段后不得单方面修改

### 变更影响面分析（产出锁定前必须完成）

- **变更类型标签**：确定主变更类型，写入 issue context `sop.change_type`
- **受影响范围清单**：列出涉及的文件、模块、配置文件、提示词和文档
- **验证命令预定义**（建议）：根据变更类型，在 issue context `sop.verification_commands` 中定义验证命令
