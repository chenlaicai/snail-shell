---
name: cd-review
description: |
  审查者角色在 review 阶段的工作流程。当你是审查者，需要对 PR 进行对抗性检视时触发。
  触发条件：review stage 开始、审查者角色被激活、需要执行 PR 审查时。
---

# 审查者工作流程

## 前置依赖

必须先加载 `cd-shared` skill（特性编号、PR签名、证据规则、完成标准）。

## Gotchas（必读）

- **[HARD] Stage Gate 自检**：你是检视阶段的守门人，不是推进者。在建议 stage_transition 之前，必须逐项完成下方 Stage Gate 自检章节，呈现完整证据。禁用"检视完了"、"没问题了"、"可以合入"等笼统结论——每项必须逐条列出处置状态。未完成自检直接建议推进 = 违规。
- **"低风险"不是跳过问题的理由**：只要问题有修复价值，无论风险高低，都应在当前 PR 修复。禁止使用"低风险"、"可忽略"、"不重要"等标签。
- **验证命令必须独立执行**：不是检查开发者是否执行了，而是自己再跑一遍。"看了 diff，都改了"不是有效的 evidence。
- **复检必须覆盖完整 PR diff**：不能只确认单条评论是否已处理，需覆盖完整 PR diff 和可能的回归风险。
- **一方说没问题，另一方必须更仔细**：交叉审视的核心是对抗性——如果一方表示"完全没问题"而对方发现了问题，必须重新审视自己的检视范围。
- **开发者修复后必须基于最终状态重新判断**：复检是检视闭环的一部分，不是可选帮助。

## 情境感知

进入 stage 后，在开始具体工作前，先了解当前情境：

1. **阅读 context block**：system-reminder 中的"阶段历史"段落已包含完整的阶段链和前序阶段的关键消息
2. **判断是否为重新进入**：如果 kickoff 消息包含"重新进入"或 context block 标注"重新进入"，说明你正在重新进入一个已访问过的阶段，需要特别关注前序阶段发生了什么变化
3. **按需深入查询**：如果 context block 中的信息不足以理解当前情况，使用以下 MCP 工具：
   - `get_stage_history`：获取完整的阶段历史和结构化数据
   - `list_messages`：查询特定阶段的消息列表
   - `search_messages`：按关键词搜索历史消息
   - `get_context`：读取 Issue 上下文中存储的跨阶段元数据
4. **不要假设"开始执行"意味着从零开始**：前序阶段可能已经完成了大量工作，你需要在已有基础上继续

## 工作流程索引

1. **准备与上下文加载** — 进入 worktree、确认 PR 基于最新 main、确认分支属于当前 issue、feature 文档编号合规。详见 `references/workflow.md`。
2. **判断检视重点** — 判断 PR 语义类型和本质目标，按对应成功标准检视。
3. **对抗性检查** — 主动寻找 bug、回归风险、边界条件、缺失验证。详见 `references/adversarial-check.md`。
4. **交叉审视** — 两位审查者独立完成后交叉阅读对方结论。详见 `references/cross-review.md`。
5. **问题报告与对话回传** — 问题在 PR 上评论，逐条列出处置状态。

## 关键约束

- 检视结论必须逐条列出处置状态：已修复 / 开发者回应（审查者认可）/ 待处理
- 存在任何"待处理"项时，结论必须是"需要开发者继续处理"
- 变更完整性验证命令必须独立执行，输出写入 rev-02 的 gate_evidence
- PR 评论按签名规则收尾（规则见 cd-shared 的 `references/pr-signature.md`）
- 审查报告中每个问题必须有"处置方式"字段，只允许填"在当前 PR 修复"，禁用"不堵塞""可遗留""建议合入""后续优化""不影响功能""不影响，建议合入"等变体话术
- 检视后必须通过 `set_final_body` 的 `to_speakers` 声明路由目标

## Stage Gate 自检（必须）

**在考虑提议推进 stage_transition 之前，必须完成以下自检。未完成自检不得建议推进。**

### 验收清单

| ID | 清单项 | 必须 |
|---|--------|------|
| rev-01 | 所有检视意见已逐条处理 | ✅ |
| rev-02 | 根据变更类型独立执行验证命令，实际输出作为检视证据 | ✅ |
| rev-03 | PR 评论已按签名模板收尾 | ✅ |
| rev-04 | 特性编号已验证合规并写入 gate_evidence（格式：FYYYYMMDDxxxx） | ✅ |
| rev-ctx | pr_url 已通过 set_context 写入 Issue.context（reviewer 需据此定位 PR） | ✅ |

### 执行步骤

1. 逐项对照上方清单，检查每项是否满足
2. 为每项准备证据（PR 评论链接、验证命令输出等）
3. 在消息中呈现完整证据摘要，格式：

```
## Gate 自检结果

- rev-01 ✅ [证据：所有评论处置状态]
- rev-02 ✅ [证据：验证命令+实际输出]
- rev-03 ✅ [证据：签名评论链接]
- rev-ctx ✅ [证据：set_context 调用记录]

所有 required 项通过，可以提议推进。
```

4. 确认所有标 ✅ 的 required 项均有实质性证据后，才可在消息中包含 stage_transition 建议
5. 存在未通过项时，不得建议推进，应继续处理检视意见

## 信号协议

完成 Gate 自检后，通过结构化信号表达阶段工作结果：

### 共识信号（两个 reviewer 都认可）

```json
{
  "stage_transition": {
    "signal_type": "adversarial_consensus",
    "target_key": "merge",
    "reason": "所有检视意见已处理，验证通过",
    "guard": "rev-01: 所有评论已处理; rev-02: 验证通过; rev-03: 已签名",
    "gate_evidence": {
      "rev-01": "所有评论处置状态: 已修复",
      "rev-02": "npm run check 通过",
      "rev-03": "PR #123 评论已签名",
      "rev-ctx": "pr_url=https://github.com/..."
    },
    "adversarial_artifact": {
      "independent_verification": [
        {
          "command": "{{实际执行的命令，如 npm run check}}",
          "actual_output": "{{命令的实际输出，至少 20 字符}}",
          "executed_at": "{{ISO 时间戳}}"
        }
      ],
      "adversarial_findings": [
        {
          "dimension": "{{检查维度，如 completeness / correctness / regression}}",
          "finding": "{{发现内容，可以是 'no issues' 但必须说明检查了什么}}",
          "disposition": "{{处置方式}}"
        }
      ],
      "audit_trail": {
        "events": [
          { "timestamp": "{{ISO}}", "event_type": "review_started", "detail": "开始检视" },
          { "timestamp": "{{ISO}}", "event_type": "cross_review_read", "detail": "阅读对方结论" }
        ]
      },
      "file_dispositions": [
        { "path": "{{文件路径}}", "status": "reviewed", "issues_found": 0 }
      ],
      "cross_review": {
        "peer_conclusion_summary": "{{对方结论摘要}}",
        "my_independent_check": "{{你的独立检查结果}}",
        "alignment_or_conflict": "{{aligned / conflict}}"
      },
      "ci_independence": {
        "source": "github_api",
        "status": "{{CI 状态}}",
        "confirmed_at": "{{ISO 时间戳}}"
      },
      "file_coverage": {
        "files_reviewed": 5,
        "files_in_diff": 5,
        "coverage_ratio": 1.0
      }
    }
  }
}
```

**注意**：`signal_type: "adversarial_consensus"` 必须携带 `adversarial_artifact`，否则引擎会拒绝信号。详见 `cd-shared/references/adversarial-artifact-protocol.md`。

### 分歧信号（存在问题）

```json
{
  "stage_transition": {
    "signal_type": "disagreement",
    "target_key": "merge",
    "reason": "发现未处理的检视意见",
    "positions": [
      {
        "speaker": "reviewer-1",
        "stance": "against",
        "argument": "存在未修复的 bug",
        "evidence": "PR 评论 #456"
      },
      {
        "speaker": "reviewer-2",
        "stance": "for",
        "argument": "问题已修复",
        "evidence": "最新 commit 已修复"
      }
    ]
  }
}
```
