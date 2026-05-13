---
{
  "id": "P010205",
  "title": "Feature 文档治理",
  "target": "scenario.project-conversation.stage-role-playbook",
  "order": 120,
  "semantic_layer": "stage_role_playbook",
  "when": {
    "stage_types": ["development", "review"],
    "snails": ["Implementation Snail", "Acceptance Snail"]
  },
  "render_mode": "outline"
}
---

## Feature 文档治理

### 目标

- 这组规则保护 `docs/features/` 作为当前 Feature 的需求、设计、范围变化、验证和交付记录，不让历史 feature 文档被二次改写。
- Feature 文档治理是项目推进场景的正式产物规则，不属于 AI base，也不属于单一研发阶段流程。

### 创建与更新规则

[0190] [检查已有文档] [development, review, Implementation Snail, Acceptance Snail] 面向 Snail Shell 本仓库的 feature 开发，必须先检查 `docs/features/YYYYMMDD/` 是否已有对应 feature 文档。
[0191] [先创建文档] [development, review, Implementation Snail, Acceptance Snail] 如果没有对应 feature 文档，应先按 `docs/README.md` 的日期目录、编号和模板规则创建 feature 文档，再进入实现。
[0192] [文档同步更新] [development, review, Implementation Snail, Acceptance Snail] feature 文档必须随需求收敛、设计取舍、检视反馈和验证结果同步更新，不能只作为事后记录。
[0193] [范围变化记录] [development, review, Implementation Snail, Acceptance Snail] 每次因用户补充、实现发现或检视意见导致实际 diff 超出 feature 文档原先范围时，必须先按 `docs/README.md` 中当前 feature 模板更新 feature 文档的受影响部分，并记录范围变化，再继续实现、回复检视或复检。

### 历史记录边界

[0194] [历史文档不可修改] [development, review, Implementation Snail, Acceptance Snail] 已合入 feature 的 `docs/features/` 文档是历史交付记录，后续 feature 不得二次修改。
[0195] [新变化新建文档] [development, review, Implementation Snail, Acceptance Snail] 新变化必须创建新的 feature 文档记录本次变化。
[0196] [长期规则沉淀] [development, review, Implementation Snail, Acceptance Snail] 需要长期维护的规则、事实或操作说明，应沉淀到 `docs/README.md`、`docs/core/`、`docs/user-manual/`、`AGENTS.md`、`.meta/prompts/`、代码或脚本等长期入口。
[0197] [禁止追写历史文档] [development, review, Implementation Snail, Acceptance Snail] 不要为了让历史记录适配当前实现状态而追写已完成 feature 文档。

### 风险与决策记录

[0198] [禁止残留未确认问题] [development, review, Implementation Snail, Acceptance Snail] feature 文档不应残留未经确认的问题。
[0199] [风险收敛] [development, review, Implementation Snail, Acceptance Snail] 研发者发现风险、疑问或待决策事项时，必须向用户或相关参与者提出并收敛。
[0200] [决策记录方式] [development, review, Implementation Snail, Acceptance Snail] 文档应记录沟通后的决策、接受遗留的原因、后续处理条件或跟进方式，而不是把"待确认"作为未处理问题池。

### 检视规则

[0201] [文档位置检查] [development, review, Implementation Snail, Acceptance Snail] 检视包含 `docs/features/` 的 PR 时，必须确认新增或移动的 feature 文档是否位于 `docs/features/YYYYMMDD/` 日期目录。
[0202] [文档归属检查] [development, review, Implementation Snail, Acceptance Snail] 检视包含 `docs/features/` 的 PR 时，必须确认被修改的 feature 文档是否属于当前 PR 正在交付的 feature。
[0203] [禁止二次修改检出] [development, review, Implementation Snail, Acceptance Snail] 如果 diff 二次修改已合入 feature 文档来追写新结论、更新旧范围或适配当前实现状态，必须作为文档治理问题提出，要求改为新建当前 feature 文档或沉淀到长期入口。
[0204] [文档治理PR对照] [development, review, Implementation Snail, Acceptance Snail] 检视文档治理类 PR 时，必须按 `docs/README.md` 中当前 feature 模板对照 feature 文档和实际 diff。
[0205] [文档治理问题提出] [development, review, Implementation Snail, Acceptance Snail] 如发现实际 diff 违反非目标、遗漏改动范围、缺少生效路径、验证未覆盖新增规则入口、范围变化未记录，或风险疑问被作为未经确认的问题残留，必须作为检视问题提出。
