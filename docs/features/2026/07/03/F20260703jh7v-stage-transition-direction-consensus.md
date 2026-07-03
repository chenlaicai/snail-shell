---
id: F20260703jh7v
title: stage-transition-direction-consensus
tags: [issue-collaboration, stage, transfer, intake, incompatible]
---

# F20260703jh7v — Stage Transition 方向共识机制

## 元信息

- **Issue**: stage的推进意图只有单向、没有反向
- **Issue ID**: 337b582c-d45f-4213-8e5d-9c04093e5d5d
- **创建日期**: 2026-07-02
- **影响范围**: stage_transition 信号协议、auto-advance 引擎、cd-design/cd-development/cd-review skill 文档
- **兼容性**: 不兼容更新（stage_transition 语义变更、新增 transferStage API）

## 问题陈述

当前系统的 stage 推进在实践层面是单向的。agent 进入新阶段时盲目接受上一阶段的产物，不会评估其质量是否足以支撑本阶段工作。即使发现根本性问题，也没有结构化的机制将工作打回到上游阶段。

### 根因分析

缺口不在基础设施层（SOP 已定义反向路径、rollbackStage API 已存在），而在三个层面：

1. **引擎层**：stage_transition 信号的语义是"我准备好了"（方向已知），不是"我判断下一步应该去 X"（方向需要判断）。auto-advance 引擎假设方向是正向的。且 rollbackStage 与 advanceStage 是两套独立 API，rollbackStage 硬校验只能回退到 `from_stage_id` 指向的直接前驱，无法处理 SOP 定义的跨阶段反向路径（如 review→design）。
2. **认知层**：agent 的目标函数是"完成本阶段职责"，不是"评估系统状态并判断最佳方向"。agent 把上游产物当作已确认的事实，而非待验证的假设。
3. **Skill 层**：没有 intake 审视流程。agent 进入新阶段后直接开始工作，不评估上游产物是否足够。

### 问题链路

```
上一阶段产物有根本性缺陷
  → 当前阶段 agent 未被要求评估上一阶段产物
  → agent 盲目接受并开始工作
  → 工作建立在错误基础上
  → 产出质量差 / 需要大量返工
  → 或者：agent 发现了问题但没有 sendback 信号
  → 只能通过 disagreement 升级到人工
  → 人工手动调用 rollbackStage
  → 效率损失
```

### 影响范围

当前只有 code-delivery SOP 是多阶段流程，但问题根因在机制层（stage_transition 的语义假设），所有未来的多阶段 SOP 都会继承此问题。修正应发生在机制层，而非具体 SOP 的 skill 文档。

## 已有基础设施（不重复建设）

| 机制 | 状态 | 说明 |
|------|------|------|
| SOP 反向路径定义 | ✅ 已有 | dev→design, review→design, merge→review |
| rollbackStage() API | ✅ 已有 | 但只能回退到直接前驱，不支持跨阶段反向路径 |
| StageTransitionSuggestion.target_key | ✅ 已有 | 当前语义是"正向目标"，可扩展为"方向判断" |
| disagreement 信号 | ✅ 已有 | 但只升级到人工，不触发自动回退 |
| 阶段内对抗性审视 | ✅ 已有 | architect vs architect, reviewer vs reviewer |

## 设计方案：三层修正

### 第一层：引擎层 — 统一转移 API + stage_transition 语义变更

#### 1.1 统一 transferStage API

引入 `transferStage(stageId, targetKey)` API，统一正向和反向转移的执行路径。

**内部逻辑**：
1. 校验 `targetKey` 在 `stage.available_transitions` 中
2. 判断方向：正向 transitions 中包含此 targetKey → 正向；否则 → 反向
3. 正向路径：复用现有 `advanceStage` 逻辑（创建新 stage）
4. 反向路径：
   - 在 issue 的 stage 历史中找到 key === targetKey 的 stage
   - 将当前 stage 及中间 stage 标记为 `rolled_back` 状态（不硬删除，保留数据）
   - 清除目标 stage 的 `left_at`，重新激活

**与现有 API 的关系**：
- `advanceStage` 保留，但内部实现迁移到 `transferStage` 的正向分支
- `rollbackStage` 保留，但内部实现迁移到 `transferStage` 的反向分支
- `transferStage` 是新的统一入口，auto-advance 引擎调用此 API

**边界处理**：
- 反向转移时，中间 stage 的数据（如 development 阶段的 PR）保留，stage 记录标记为 `rolled_back` 而非删除
- 再次从目标 stage 向前推进时，创建新 stage（不复用被 rolled_back 的 stage）

#### 1.2 stage_transition 语义变更

stage_transition 信号的语义从"我准备好了"变为"我判断下一步应该去 X"。

方向不是预设的，而是多个 role instance 基于当前产物质量集体判断的结果。向前和向后是共识结论的不同取值，引擎不做方向假设。

#### 1.3 复用 target_key 承载方向判断

不在 Position 上增加字段（避免与 stance 语义冲突）。直接利用现有的 `StageTransitionSuggestion.target_key`。

当前 `target_key` 的语义是"正向目标"，但实际使用时被当作"我请求转移到哪"。修正后：

- `target_key` 的语义明确为"我判断下一步应该去哪"，可以是正向也可以是反向
- 共识检查：所有 speaker 的 `target_key` 一致 → 共识达成，调用 `transferStage`
- `target_key` 不一致 → 分歧，升级到人工
- `target_key` 缺失 → 回退到现有行为（使用 SOP 的正向默认路径）

**此设计同时解决了 evaluateGateComplete 路径的覆盖问题**：`gate_complete` 信号的 `target_key` 也按同样逻辑处理。development agent 的 gate_complete 信号中 `target_key` 可以是 "design"（反向），引擎按统一逻辑处理。

#### 1.4 引擎处理流程变更

当前流程：
```
过滤信号 → 校验 gate → 校验对抗产物 → 执行 advance（方向预设为正向）
```

变更后：
```
过滤信号 → 校验 gate → 校验对抗产物 →
检查所有 speaker 的 target_key 一致性 →
  一致 → 调用 transferStage（方向由共识决定）
  不一致 → escalation
```

#### 1.5 向后兼容

- `target_key` 已有字段，语义扩展而非新增
- 缺失时回退到现有行为：使用 SOP 的正向默认路径
- 现有的 disagreement 信号不受影响

### 第二层：认知层 — agent 目标函数变更

#### 需要打破的假设

**假设 1：上一阶段的产物是可信的。**
→ 修正：上游产物是"待验证的假设"，不是"已确认的事实"。

**假设 2：完成本阶段工作 = 系统应该向前。**
→ 修正：方向判断是本阶段工作的核心产出之一。

#### 新的认知模型

agent 进入阶段时的思维链从：
```
收到上一阶段产物 → 接受为事实基础 → 按本阶段职责开始工作 → 完成后建议推进
```

变为：
```
收到上一阶段产物 → 评估其是否足以支撑本阶段工作 →
  足够 → 完成本阶段工作 → 判断方向 → 建议转移
  不足 → 说明具体缺陷 → 立即建议打回到上游阶段
```

#### 向后的语义

向后不是"失败"或"异常"，而是与向前对等的判断结果。在错误的基础上继续工作才是真正的浪费。向后是节省系统整体成本。

### 第三层：Skill 层 — intake 审视 protocol

#### 设计原则

intake 审视不作为 gate_ids 中的一项（与现有"离开前检查"机制时间点相反），而是作为 **skill 层的 protocol step**。agent 进入阶段后首先执行 intake 审视，产出一个独立的早期信号。

#### 执行流程

```
agent 进入阶段
  → 执行 intake 审视（skill protocol step）
  → 结论："不足" + 存在上游 stage → 立即发出 stage_transition 信号（target_key 指向上游）
  → 结论："不足" + 无上游 stage（首阶段）→ 发出 notification 请求用户补充信息，等待用户响应后重新评估
  → 结论："足够" → 继续正常工作
```

早期信号与后续的 gate_complete / adversarial_consensus 信号互斥：
- 如果 agent 已发出早期 sendback 信号，后续的正向信号被拒绝（触发 disagreement）
- 如果 agent 已发出正向信号，后续的 sendback 信号被拒绝（触发 disagreement）

#### 首阶段的 intake 边界处理

SOP 的第一个阶段（如 code-delivery 的 design）没有上游 stage 可以打回。`available_transitions` 不包含 `user` 或 `issue` 这样的合法 target_key。

处理方式：**不走 stage 转移路径，走 notification 路径**。

- agent 的 intake 审视结论为"上游输入不足"时，不发出 stage_transition 信号
- 而是通过 set_final_body 的 to_speakers 路由到 user，说明具体缺陷并请求补充信息
- stage 状态变为 needs_human（等待用户输入）
- 用户补充信息后，agent 重新执行 intake 审视

这个处理方式通用于所有多阶段 SOP 的第一个阶段。

#### 各阶段的 intake 审视

**design 阶段（评估 issue 描述）**：
1. issue 描述是否包含足够的上下文让我理解"要解决什么问题"？
2. 描述中是否有自相矛盾或模糊到无法消歧的约束？
3. 基于这个描述开始设计，最大的风险是什么？

如果第 1 或第 2 题答案为"否"，且第 3 题风险是根本性的 → 作为首阶段，走 notification 路径请求用户补充信息（见上方"首阶段的 intake 边界处理"）。

**development 阶段（评估 feature 文档）**：
1. 行为规格是否明确到可以直接实现，而不需要猜测意图？
2. 是否存在技术上不可行或成本极高的设计约束？
3. 预期哪些地方需要做"文档没说但必须做"的决策？

如果第 1 或第 2 题答案为"否" → target_key 指向 design。

**review 阶段（评估 PR）**：
1. PR 的整体架构方向是否忠实于 feature 文档的设计意图？
2. PR 是否引入了 feature 文档未提及的重大架构变更？
3. 如果存在方向偏差，这是设计文档的问题还是实现的问题？

如果偏差是设计问题 → target_key 指向 design；如果是实现问题 → review 阶段内解决。

## 设计决策记录

### 决策 1：统一 transferStage API

**决策**：引入 `transferStage(stageId, targetKey)` 统一正向和反向转移。

**理由**：rollbackStage 与 advanceStage 是两套独立 API，rollbackStage 硬校验只能回退到直接前驱。SOP 定义的跨阶段反向路径（如 review→design）在 rollbackStage 中会抛异常。统一 API 让调用方不关心方向。

### 决策 2：复用 target_key 承载方向判断

**决策**：不在 Position 上增加 recommended_target，直接利用 StageTransitionSuggestion.target_key。

**理由**：Position.stance 已承载"是否应该推进"，recommended_target 会产生语义冲突。target_key 已有字段，语义扩展而非新增，向后兼容性更好。同时自然覆盖 evaluateGateComplete 路径。

### 决策 3：intake 审视作为 protocol step 而非 gate

**决策**：intake 审视是 skill 层的 protocol step，产出独立的早期信号，不放在 gate_ids 中。

**理由**：现有 gate 是"离开前检查"（agent 完成工作后提交证据），intake 是"进入后检查"（agent 开始工作前评估上游产物）。时间点相反，不能用同一机制。放在 gate_ids 中会导致 agent 在最后伪造 intake 评估结果。

### 决策 4：触发窗口

**决策**：不限制触发窗口，整个阶段内均可触发。

互斥约束：如果当前阶段已有方向不同的信号 → 触发 disagreement（不静默拒绝）。

**理由**：限制窗口会导致 agent 在窗口期没发现问题、窗口关闭后被迫继续工作。静默拒绝会掩盖真正的分歧。

### 决策 5：单 agent vs 双 agent 共识

**决策**：单 agent 即可触发，但有冲突处理机制。

- 单 agent 阶段（development、merge）：单个 agent 发出信号，通过门控后自动执行
- 双 agent 阶段（design、review）：任一 agent 可发出信号。如果另一个 agent 已发出方向不同的信号 → 触发 disagreement，升级到人工

**理由**：方向判断是事实性判断，不需要共识。但在双 agent 阶段，方向分歧就是 disagreement。

### 决策 6：反向转移的数据保留

**决策**：反向转移时，中间 stage 标记为 `rolled_back` 状态，不硬删除。

**理由**：硬删除会丢失中间 stage 的工作数据（如 PR、检视记录）。保留数据可为再次推进时提供参考。

**rolled_back 状态的生命周期**：
- `getStageHistory` / `listStages`：包含 rolled_back 的 stage，UI 可展示为"已回退"
- issue 关闭时：rolled_back 的 stage 与其他 stage 一起正常清理
- 重新推进时：创建新 stage，不复用 rolled_back 的 stage，旧记录保留作为历史

### 决策 7：反向转移后的 kickoff 消息

**决策**：反向转移后，reactivated stage 的 kickoff 消息不使用固定的"开始执行。"，而是构造包含打回上下文的消息。

**kickoff 消息结构**：
```
阶段 {targetKey} 被重新激活。

打回来源：{sourceKey} 阶段
打回原因：{reason}
下游发现的问题：
{target_key 来自的 speaker 的 argument 和 evidence}

请针对以上问题修复后重新推进。
```

**理由**：重新激活的 agent 需要知道为什么被打回、下游发现了什么问题，才能有针对性地修复。固定消息会导致 agent 不知道该做什么。

## 变更清单

### 引擎层

| 变更 | 文件 | 说明 |
|------|------|------|
| 新增 transferStage API | adapter.ts | 统一正向/反向转移入口，内部根据方向分发 |
| StageTransitionSuggestion.target_key 语义扩展 | port.ts | 从"正向目标"扩展为"方向判断" |
| 共识逻辑变更 | auto-advance.ts | evaluateAdversarialConsensus 和 evaluateGateComplete 中检查 target_key 一致性 |
| executeAutoAdvance 变更 | auto-advance.ts | 调用 transferStage 替代 advanceStage |
| stage 状态扩展 | model.ts | 新增 `rolled_back` 状态 |
| 互斥约束变更 | auto-advance.ts | 方向分歧触发 disagreement 而非 block |
| 反向 kickoff 消息 | collaboration.ts | transferStage 反向路径构造包含打回原因的 kickoff 消息 |

### 认知层

| 变更 | 文件 | 说明 |
|------|------|------|
| design skill 增加 intake 审视 | cd-design/SKILL.md | 设计前评估 issue 描述，不足时立即发早期信号 |
| development skill 增加 intake 审视 | cd-development/SKILL.md | 编码前评估 feature 文档，不足时立即发早期信号 |
| review skill 增加 intake 审视 | cd-review/SKILL.md | 检视前评估 PR，方向偏差时立即发早期信号 |

### Skill 层

| 变更 | 文件 | 说明 |
|------|------|------|
| intake protocol 定义 | cd-shared/references/ | 各阶段 intake 审视的具体问题和判断标准 |
| intake 信号互斥规则 | cd-shared/references/ | 早期信号与正向信号的互斥约束说明 |

## 验证标准

### 引擎层验证

1. `transferStage(stageId, targetKey)` 正向路径：创建新 stage，行为与现有 advanceStage 一致
2. `transferStage(stageId, targetKey)` 反向路径：找到目标 stage，标记中间 stage 为 rolled_back，重新激活目标 stage
3. review→design 路径：transferStage 正确处理跨阶段反向转移（不抛异常）
4. 所有 speaker 的 target_key 一致时，引擎执行转移（无论向前还是向后）
5. 所有 speaker 的 target_key 不一致时，引擎返回 escalated
6. target_key 缺失时，引擎回退到现有行为（使用 SOP 正向默认路径）
7. target_key 不在 available_transitions 中时，信号被拒绝

### 认知层验证

1. 进入 development 阶段时，agent 的第一条输出包含对 feature 文档的 intake 审视
2. intake 审视结论为"不足"时，agent 立即发出早期 stage_transition 信号（不等到工作完成）
3. intake 审视结论为"足够"时，agent 继续正常工作

### 端到端验证

1. 构造一个有根本性缺陷的 feature 文档 → development agent 应在工作开始前识别并建议回到 design
2. 构造一个忠实实现的 PR → review agent 应识别并建议向前
3. 构造一个方向偏离的 PR → review agent 应识别并建议回到 design
4. 双 agent 阶段中方向分歧 → 引擎触发 disagreement，升级到人工
5. design 阶段 intake 审视发现 issue 描述不足 → agent 走 notification 路径请求用户补充信息（不发 stage_transition）
6. 反向转移后 reactivated stage 的 kickoff 消息包含打回原因和下游发现的问题
7. 反向转移后中间 stage 标记为 rolled_back，getStageHistory 可查到

## 不兼容更新

- `Stage` 接口新增 `status` 字段（`StageStatus = "active" | "rolled_back"`），数据库 schema 新增 `status` 列（`DEFAULT 'active'`）
- `StagePort` 接口新增 `transferStage` 方法
- `CollaborationInput` 接口新增 `transferStage` 方法
- `AutoAdvanceDeps.advanceStage` 重命名为 `transferStage`
- `stage_transition` 信号的 `target_key` 语义从"正向目标"扩展为"方向判断"

## 实现状态

### 引擎层

| 变更 | 状态 | 说明 |
|------|------|------|
| `StageStatus` 类型 + `Stage.status` 字段 | ✅ | model.ts 新增，repository.ts 新增 `status` 列 |
| `StageRepository.transferStage` | ✅ | repository.ts：反向路径标记中间 stage 为 rolled_back，重新激活目标 stage |
| `StageAdapter.transferStage` | ✅ | adapter.ts：判断方向，正向走 advanceStage，反向走 repository.transferStage |
| `StagePort.transferStage` | ✅ | port.ts 新增接口方法 |
| `AutoAdvanceDeps.transferStage` | ✅ | auto-advance.ts：替代原 advanceStage |
| target_key 一致性检查 | ✅ | auto-advance.ts：`checkTargetKeyConsistency` 方法 |
| 信号方向互斥约束 | ✅ | collaboration.ts：`checkDirectionConflict` 方法 |
| 反向 kickoff 消息 | ✅ | collaboration.ts：`autoInvokeBackwardStage` 方法 |

### 认知层

| 变更 | 状态 | 说明 |
|------|------|------|
| cd-design intake 审视 | ✅ | SKILL.md 新增 intake 章节 |
| cd-development intake 审视 | ✅ | SKILL.md 新增 intake 章节 |
| cd-review intake 审视 | ✅ | SKILL.md 新增 intake 章节 |

### Skill 层

| 变更 | 状态 | 说明 |
|------|------|------|
| intake-protocol.md | ✅ | cd-shared/references/ 新增 |
| stage-gate.md 更新 | ✅ | 新增反向转移、方向互斥、target_key 一致性、intake 审视规则 |

### 测试

- 206 tests pass（原有 204 + 新增 2）
- 新增：target_key 一致性检查（不一致 → escalated，一致 → auto_advanced）
