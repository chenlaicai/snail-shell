# F2026052301 messageout 语义优化

## 背景

当前 AI 模型在使用 `message-out` 能力时存在认知偏差：模型倾向于认为"执行 message-out 命令 = 已成功呼叫、通知或联系到目标角色"。

实际情况：`message-out` 只是一个内容格式化工具，负责生成携带结构化 mentions 字段的 JSON payload。payload 的实际路由、投递和响应完全由 Snail Shell 系统在 AI 消息返回后执行，`message-out` 对此不提供任何保证。

这种误解会导致模型把一次输出动作误判为外部通信已完成，从而在协作流程中跳过必要的等待、确认或交接步骤。

### 任务锚

#### 本质目标

在所有 message-out 相关说明、提示词和协议文档中明确其通信边界——`message-out` 是内容格式化工具，不是通信投递系统。让 AI 模型理解：生成 payload ≠ 已通知到人。

#### 反目标

- 不得改变 message-out 的现有功能行为或命令接口
- 不得改变 mentions 的实际路由/投递机制
- 不得禁止或削弱跨角色协作流程——只是澄清语义，不是阻止协作

#### 语义不变量

- message-out 只负责生成 JSON payload —— 已确认，来源: message-out SKILL.md 实现
- 系统通过 payload 中的结构化 mentions 字段进行路由 —— 已确认，来源: message-out SKILL.md
- 角色协作通过 mention 协议实现 —— 已确认，来源: B-01 提示词

#### 成功标准

- message-out SKILL.md 包含显式的通信边界声明
- 所有引用 message-out 的提示词，其描述不产生"调用 message-out = 已通知/已呼叫"的歧义
- 改动最小化——只在必要位置补强语义，不重写整个协议

## 目标

- 在 `message-out` SKILL.md 中增加显式的通信边界（Communication Boundary）章节
- 在所有引用 message-out 的系统提示词中消除"调用 = 已通知"歧义
- 不改变 message-out 的功能行为、命令接口或 mentions 路由投递机制

## 非目标

- 不重写 message-out 协议或改变其命令接口
- 不改变 Snail Shell 的消息路由/投递系统
- 不修改 message-out.js 脚本实现

## 设计

### 核心改动

在 `message-out` SKILL.md 中新增 **Communication Boundary（通信边界）** 章节，显式声明：

1. `message-out` 是内容格式化工具，不是通信投递系统
2. 执行命令只生成 JSON payload，不代表已送达/已通知/已呼叫
3. 实际路由和投递由 Snail Shell 系统在消息返回后执行
4. 不要把"已发出 message-out"等同于"已联系到对方"

### 引用点改动

在所有引用 message-out 的提示词中补强语义，关键改动点：

| 文件 | 当前表述 | 问题 | 改动方向 |
|---|---|---|---|
| B-01 L29 | "通过 message-out mention 协议声明目标角色" | "声明"比"通知"更准确，但缺少边界说明 | 追加 message-out 不保证已呼叫/已通知 |
| B-01 L7 (skill_references) | "该 skill 不是发送工具" | 已部分正确，但不够强 | 加强为"是格式化工具，不是通信投递系统" |
| S-03 L70 | "通过 message-out mention 协议" | 无歧义风险 | 保持 |
| S-04 L49 | "通过 message-out mention 协议通知研发者" | "通知"易被误解为 message-out 执行完=已通知 | 改为"将通知研发者的内容封装为 message-out payload" |
| S-08 L5-L7, L40 | "发出 mention" "使用 message-out skill" | L40 "发出 mention" 有轻微歧义 | 补强为"使用 message-out 格式化 mention" |
| F-02 L38 | "按 message-out mention 协议发出结构化 mention" | "发出"轻微歧义 | 补强语义 |
| _template-prompt.md | 模板 | 模板本身无大问题 | 加强 skill_references 描述 |
| developer-handbook | "通过 message-out mention 协议" | 无歧义风险 | 保持 |
| reviewer-handbook | 同 S-04 描述 | 同 | 同 |

## 改动范围

- `.meta/skills/message-out/SKILL.md` —— 新增 Communication Boundary 章节 + 强化 Purpose
- `.meta/prompts/prompts/B-01-身份与责任契约.md` —— 强化 skill_references 描述 + 修正 STD 规则措辞
- `.meta/prompts/prompts/S-04-检视者手册.md` —— "通知"→"封装"
- `.meta/prompts/prompts/S-08-知识执行者手册.md` —— "发出 mention"→"格式化 mention"
- `.meta/prompts/frames/F-02-knowledge-governance.md` —— "发出"→"格式化"
- `.meta/prompts/_template-prompt.md` —— 强化 skill_references 描述
- `.meta/skills/reviewer-handbook/SKILL.md` —— "通知"→"封装"
- `tests/meta/prompt-assets-test.ts` —— 同步测试断言

### Part 2：record-feature-repo-context 自发现优化

- `.meta/skills/record-feature-repo-context/scripts/record-feature-repo-context.js` —— 新增 resolveStageFromWorkdir()：cwd → stage 匹配（re-recording via worktree_path，first-time via in_progress dev stage）；--stage-id/--feature-id 改为可选
- `.meta/skills/record-feature-repo-context/SKILL.md` —— 重写以自发现为主模式，无需 ID 参数
- `.meta/prompts/prompts/S-03-研发者手册.md` —— HARD 规则跟进为自发现调用
- `.meta/skills/developer-handbook/SKILL.md` —— step 19 更新为自发现调用
- `tests/project/repo-cleanup-test.ts` —— 新增首次记录自动发现测试

## 生效路径

- `.meta/skills/message-out/SKILL.md` —— AI 使用 message-out 前被指示先读取
- `.meta/prompts/` —— 注入到 AI 系统提示词

## 验证

- 人工审阅所有修改过的提示词文件，确认：
  - message-out 被描述为"格式化/封装"工具而非"发送/通知/呼叫"工具
  - 通信边界声明完整、无歧义
  - 没有破坏现有协作流程描述

## 风险与决策记录

- 风险：若约束过强，可能导致模型不敢使用 message-out 进行跨角色协作 → 缓解：仅澄清"格式化 ≠ 送达"，不改变使用前提
- 决策：record-feature-repo-context 的 Stage 定位放弃 `{{stage_id}}` 注入方案，改用脚本自发现：
  - re-recording：遍历 stage.output_artifacts.worktree_path 匹配 cwd
  - first-time recording：检测 git worktree + 查找无 worktree_path 的 in_progress development stage（必须唯一）
  - `--stage-id` 和 `--feature-id` 保留为显式指定备选

## 范围变更记录

- 2026-05-23 v1：用户指出 AI 未自动提交输出产物，且 record-feature-repo-context 存在 ID 混淆设计问题。经两轮设计迭代，最终方案：
  - v1（已废弃）：`src/prompt-center/builder.ts` 注入 `{{stage_id}}` 模板变量
  - v2（最终）：脚本自发现，从 worktree 自动定位 Stage，无需 ID 参数。首次记录通过检测 git worktree + 匹配 in_progress development stage 实现；重复记录通过 worktree_path 匹配。
