# F2026052101 系统提示词一次性重构

## 背景

当前系统提示词存在 6 个问题：
1. 结构扁平无 XML 锚点——纯 markdown，AI 注意力分散
2. 规则写成人读散文而非 AI 可扫描指令——偏人类阅读风格
3. B 层和 S 层存在跨层重复规则
4. S-03 研发者手册 149 行、S-04 检视者手册 99 行——大量操作步骤占用系统提示词
5. skill_references 内联浪费 token
6. 缺乏优先级分层——硬约束与风格建议混在一起

本 feature 基于 `F2026052007-prompt-optimization` 的 6 问题诊断和 4 方向设计，实施一次性重构。

## 目标

- 所有 prompt 模块使用 XML 锚点（`<constitution>` / `<protocol>` / `<guideline>`）结构化
- 规则统一为 `[HARD]` / `[STD]` / `[GUIDE]` 可扫描格式
- S-03/S-04 的操作步骤提取为独立 skill，系统提示词只保留行为原则
- 消除 B/S 层跨层重复
- 总行数从 575 压缩到 388（-33%）

## 非目标

- 不修改 Frame 组装逻辑（F-01~F-04 不变）
- 不修改 PromptRegistry 渲染管线
- 不改变 prompt ID 体系
- 不同步 `.meta/README.md` 架构文档（后续独立处理）

## 设计

### XML 语义分层

```xml
<constitution>  [HARD] 硬约束，绝不违反
<protocol>      [STD]  标准流程，始终遵守
<guideline>     [GUIDE] 最佳实践，倾向遵守
```

### 渐进披露：操作手册 skill 化

- 新建 `developer-handbook` skill：承载 S-03 中的 4 阶段操作流程、GATE 清单、commit/PR 模板、自检清单
- 新建 `reviewer-handbook` skill：承载 S-04 中的 4 阶段检视流程、复检流程、自检清单
- S-03/S-04 通过 `skill_references` 指向对应 skill，只保留行为原则和决策规则

### 规则格式

```
[HARD] 规则陈述 → 原因/后果
[STD]  规则陈述 → 原因
[GUIDE] 规则陈述 → 原因
```

## 生效路径

- `.meta/prompts/prompts/B-01~B-03`：Base 层提示词模块
- `.meta/prompts/prompts/S-01~S-07`：Skill 层提示词模块
- `.meta/skills/developer-handbook/SKILL.md`：研发者操作手册
- `.meta/skills/reviewer-handbook/SKILL.md`：检视者操作手册
- 通过 PromptRegistry → Frame 条件组装 → 系统提示词注入生效

## 改动范围

| 文件 | 改前 | 改后 | 变化 |
|------|------|------|------|
| B-01-身份与责任契约.md | 98 | 53 | -46% |
| B-02-知识治理.md | 32 | 21 | -34% |
| B-03-运行时边界.md | 26 | 18 | -31% |
| S-01-项目上下文.md | 76 | 65 | -14% |
| S-02-历史能力.md | 29 | 24 | -17% |
| S-03-研发者手册.md | 149 | 71 | -52% |
| S-04-检视者手册.md | 99 | 62 | -37% |
| S-05-mention提取.md | 26 | 22 | -15% |
| S-06-会话摘要.md | 29 | 26 | -10% |
| S-07-设计决策能力.md | 24 | 26 | +8% |
| developer-handbook/SKILL.md | — | 135 | 新建 |
| reviewer-handbook/SKILL.md | — | 102 | 新建 |

## 验证

- PromptRegistry 正常加载 10 prompts + 4 frames
- 全部 40 个测试通过
- 所有 `{{variable}}` 模板变量完整保留
- 所有 `skill_references` 正确指向对应 skill

## 风险与决策记录

- **[Incompatible] prompt 协议边界变更**：S-03/S-04 从自包含操作手册变为依赖外部 skill（`developer-handbook` / `reviewer-handbook`）的分层协议。影响对象为直接读取或引用 S-03/S-04 原始 prompt 文件的消费者——如需获取完整操作流程，必须同时加载对应 skill。通过 PromptRegistry 的正常注入路径不受影响（Frame 组装时自动加载所有 skill_references）。不保留兼容层是因为旧的自包含结构本身就是本次重构要解决的行数膨胀和跨层重复问题，保留兼容层会抵消核心收益。
- 重构只改内容格式和承载边界，不改 PromptRegistry 组装机制，正常注入路径下风险可控。
- Frame 文件与 prompt ID 体系未变动。
