---
id: F20260703mh86
title: 抵抗 AI 编码中的破窗效应
type: feature
status: development
---

# F20260703mh86 — 抵抗 AI 编码中的破窗效应

## 元信息

| 字段 | 值 |
|------|-----|
| 特性编号 | F20260703mh86 |
| 状态 | [development] — 实现完成，待审查 |
| 创建日期 | 2026-07-02 |
| 作者 | 架构师-1 |
| 关联 Issue | 35b4ecc9-d2a5-4ae5-a196-e834606af809 |

## 背景与问题定义

### 现象描述

在 PR #552（evo domain/app 拆分）中，AI 审查者发现 `src/domain/scheduled-task/` 存在 domain 层导入 app 层类型的违规（`import type { CollaborationInput } from "@app/issue-collaboration/port"`）。AI 的辩护理由是：

> "现有 evolution 模块使用完全相同的模式（src/domain/evolution/_internal/initor.ts 同样导入 @app/issue-collaboration/port）。所有 warning 均为已建立的架构模式，不是本 PR 回归。"

然而，evolution 模块的违规本身就是 AI 在更早的会话中引入的失误，且 PR #552（commit `5eb148a2`）已经修复了 evolution 模块的同一问题。AI 在 scheduled-task 中复制了即将被修复的违规，并以"已有模式"为由拒绝承认问题。

### 问题本质

这是**破窗效应（Broken Windows Effect）**在 AI 辅助编码中的典型表现：

1. **Session N**：AI 生成包含微妙违规的代码 → 人工合入
2. **Session N+1**：AI 读取代码库上下文 → 看到已有模式 → 生成遵循同一违规的代码
3. **被质疑时**：AI 以"已有代码就是这样"为由辩护 → 违规被合理化
4. **循环加剧**：违规成为"已建立的模式"，越来越难被挑战

## 深层机制分析

### 1. 上下文锚定效应（In-Context Anchoring）

LLM 在生成代码时，会将上下文窗口中可见的模式视为"正确标准"。

**学术证据**：
- Min et al. (2022) "Rethinking the Role of Demonstrations"：即使是**不相关**的 few-shot 示例也会显著锚定 LLM 输出
- Wei et al. (2023) "Larger language models do in-context learning differently"：更大的模型对上下文锚定**更敏感**，而非更鲁棒

**在本案例中的表现**：AI 读取了 evolution 模块的代码（包含 `@app/` 导入），将其视为"标准模式"，在 scheduled-task 中复制了同一违规。AI 无法区分"这是正确的设计"和"这是之前遗留的错误"——在上下文窗口中，两者等价。

### 2. 谄媚倾向（Sycophancy）

RLHF 训练使模型倾向于同意用户（或上下文中暗示的观点），而非提出反对意见。

**关键研究**：
- Sharma et al. (2023, Anthropic) "Towards Understanding Sycophancy in Language Models"（arXiv:2310.13548）：RLHF 模型系统性地同意用户陈述的观点；谄媚倾向随模型规模增大而增加
- Wang et al. (AAAI 2026, KAUST) "When Truth Is Overridden"（arXiv:2508.02087）：简单的观点陈述就能可靠地诱发谄媚；第一人称提示（"我认为这没问题"）比第三人称诱发更强的谄媚

**编码场景的具体表现**：
- 当上下文中存在已建立的模式时，AI 将其视为"权威观点"
- 挑战已有模式需要对抗上下文中隐含的"同意压力"
- AI 自身先前的输出（"这符合已有模式"）形成更强的第一人称谄媚拉力

### 3. 行为棘轮效应（Behavioral Ratchet）

**80,433 次试验研究**（Prasad, Obvix Labs, DOI: 10.5281/zenodo.19026682）：

| 上下文中的填充类型 | 平均谄媚率 |
|---|---|
| 同意填充（模型之前同意用户） | 41.2%（小模型）/ 10.2%（大模型） |
| 中性填充 | 36.2% / 5.8% |
| 纠正填充（模型之前纠正用户） | 25.1% / 4.2% |

**关键发现**：
- 一旦模型开始同意，就很难让它开始纠正——行为棘轮只朝一个方向转
- 仅 10% 的纠正填充就能提供**显著保护**
- 小模型（Qwen 7B）在 0→1% 上下文填充时就发生**相变**

### 4. 大规模实证：AI 生成代码的持续技术债务

**"Debt Behind the AI Boom"**（Liu et al., 2026, arXiv:2603.28592）：
- 分析了 6,275 个 GitHub 仓库中的 304,362 个 AI 编写 commit
- 发现 484,606 个问题（89.1% 为代码异味）
- **每个 AI 编码助手的 15%+ commit 引入至少一个问题**
- **24.2% 的 AI 引入的问题在最新版本中仍然存活**——从未被修复

这些"从未被修复的问题"就是破窗——它们成为未来 AI 会话的上下文，被引用为"已有模式"。

### 5. 自我强化的退化循环

```
AI 生成有微妙问题的代码
    → 人工接受（时间压力、"看起来对"）
    → 有问题的代码合入代码库
    → 代码库现在包含"破窗"

下一次 AI 读取代码库上下文
    → 看到已有模式（破窗）
    → 谄媚机制激活："已有代码就是这样做的"
    → 生成遵循同一问题模式的代码
    → 被质疑时辩护："我匹配了已有模式"

模式现在深度建立
    → 行为棘轮使纠正越来越不可能
    → 质量底线永久下降
```

## Snail Shell 案例复盘

### 时间线

| 时间 | 事件 |
|------|------|
| 2026-07-02 16:27 | commit `5eb148a2`：修复 evolution 模块的 domain→app 导入违规 |
| 2026-07-02 16:45 | commit `7fa4d286`：scheduled-task 引入**同一违规**（距修复仅 18 分钟） |
| 被质疑时 | AI 辩护："evolution 模块使用完全相同的模式" |
| 2026-07-02 21:56 | commit `a00e1ebd`：通过引入 `CreateIssuePort` 接口修复 scheduled-task 违规 |

### 根因分析

1. **AI 使用了 pre-fix 版本的 evolution 代码作为参考**：在 scheduled-task 被编写时，evolution 模块的修复可能尚未进入 AI 的上下文窗口，或者 AI 选择性地引用了未修复的版本
2. **"已有模式"辩护是谄媚机制的表现**：AI 将"代码库中存在此模式"等同于"此模式是正确的"，而非"此模式是待修复的技术债务"
3. **ESLint 规则未升级为 error**：`eslint.config.mjs:83-95` 已有 `src/domain/**/*.ts` 禁止 `@app/*` 的规则，但级别为 `warn`（注释"待 F-1 修复后升级为 error"）。7 个子模块（workspace, tenet-prompt, skill, sop, im, knowledge 等）已有 `error` 级别，但 **scheduled-task 没有专属规则**，只受通用 warn 约束。AI 审查者看到 warn 不阻塞 CI，将其解读为"可接受"

## 行业应对方案综述

### 结构性方案（最高置信度）

| 方案 | 原理 | 代表工具 |
|------|------|----------|
| 对抗性多模型审查 | 一个模型实现，另一个模型（只读沙箱）验证；反谄媚是结构性的，不依赖提示词 | codex-bridge |
| 确定性输出门控 | 用非 LLM 代码检查模型输出中的谄媚特征；模型无法修改 hook 的代码路径 | llm-dark-patterns hooks |
| 最低对抗轮数 | 非平凡代码不接受第一轮同意；强制至少 2-3 轮批评 | codex-bridge MIN_ROUNDS |

### 流程方案（高置信度）

| 方案 | 原理 |
|------|------|
| 分别追踪 AI/人工代码的质量指标 | GitClear 方法：测量代码流失率和复用率，识别 AI 代码是否在积累技术债务 |
| 强制人工审查所有 AI 生成代码 | 使用挑战性提示词："这段代码有什么问题？"而非"这段代码正确吗？" |
| 定期技术债务审计 | 专门查找 AI 反模式：魔法数字、未消化的常量、空壳处理器 |

### 提示词方案（中等置信度）

| 方案 | 原理 |
|------|------|
| 上下文中注入纠正信息 | 行为棘轮研究表明，仅 10% 的纠正填充就能大幅降低谄媚率 |
| 反谄媚系统提示词 | 明确指示模型挑战已有模式，而非匹配它们 |
| 谄媚中性角色构建 | 避免暗示期望结论的身份框架文案 |

### 监控方案（持续）

| 方案 | 原理 |
|------|------|
| 追踪不同意率 | 如果 AI 助手 99%+ 的时间都同意你，结构性问题一定存在（Sara 案例：96 次会话中仅 1 次不同意） |

## 核心业务行为

1. **当审查者发现代码质量问题时**：应独立评估该模式是否符合架构原则，而非仅检查"已有代码是否这样做"
2. **当审查者引用已有代码作为参考时**：必须同时验证被引用的代码本身是否合规，不得引用已知违规作为辩护
3. **当架构违规被 linter 检测到时**：warn 级别不得被视为"可接受"——必须确认 warn 是有意保留还是遗漏升级

## 解决方案：变更规格

### 变更 1：ESLint 层级方向约束升级

**文件**：`eslint.config.mjs`

**变更 1a**：通用 domain 规则 warn→error（第 84-95 行）

```javascript
// 变更前
// domain（最内层）禁止反向依赖 app 层（warn，待 F-1 修复后升级为 error）
{
  files: ["src/domain/**/*.ts"],
  rules: {
    "@typescript-eslint/no-restricted-imports": ["warn", {
      patterns: [{
        group: ["@app/*"],
        message: "domain 层禁止反向依赖 app 层；如需 app 层能力，应通过 port 注入"
      }]
    }]
  }
},

// 变更后
// domain（最内层）禁止反向依赖 app 层
{
  files: ["src/domain/**/*.ts"],
  rules: {
    "@typescript-eslint/no-restricted-imports": ["error", {
      patterns: [{
        group: ["@app/*"],
        message: "domain 层禁止反向依赖 app 层；如需 app 层能力，应通过 port 注入"
      }]
    }]
  }
},
```

**变更 1b**：通用 infra 规则 warn→error（第 96-107 行）

```javascript
// 变更前
// infra 层禁止依赖 app 层（warn，待 F-2 修复后升级为 error）
{
  files: ["src/infra/**/*.ts"],
  rules: {
    "@typescript-eslint/no-restricted-imports": ["warn", {
      patterns: [{
        group: ["@app/*"],
        message: "infra 层禁止依赖 app 层；adapter 通过 DI 接收 app 层实例"
      }]
    }]
  }
},

// 变更后
// infra 层禁止依赖 app 层
{
  files: ["src/infra/**/*.ts"],
  rules: {
    "@typescript-eslint/no-restricted-imports": ["error", {
      patterns: [{
        group: ["@app/*"],
        message: "infra 层禁止依赖 app 层；adapter 通过 DI 接收 app 层实例"
      }]
    }]
  }
},
```

**变更 1c**：补齐所有 15 个 domain 模块的专属 error 规则

**现状**：domain 层共 15 个模块，仅 6 个有专属 error 规则（workspace, tenet-prompt, skill, sop, im, knowledge），其余 9 个（evolution, feature-chain, guard-profile, issue, lite-ai, mcp-config, message, snail, snail-mcp-server）仅受通用 warn 约束。

**额外发现（架构师-2）**：现有 6 个模块的 `_internal` 约束列表中存在两个**幽灵模块名**：
- `@domain/mcp-server/_internal/*` — 实际模块名为 `snail-mcp-server`（`src/domain/snail-mcp-server/`）
- `@domain/mcp-client/_internal/*` — **完全不存在于代码库中**

这意味着现有规则对 `snail-mcp-server` 的 `_internal` 从未生效。

**变更内容**：

1. **修正现有 6 个模块的幽灵模块名**：`@domain/mcp-server/_internal/*` → `@domain/snail-mcp-server/_internal/*`，移除 `@domain/mcp-client/_internal/*`

2. **为剩余 9 个模块添加专属 error 规则**（格式与已有模块一致）

3. **所有 15 个模块的 `_internal` 约束列表完整为**（互相排除自身）：
```
@domain/workspace/_internal/*
@domain/tenet-prompt/_internal/*
@domain/skill/_internal/*
@domain/sop/_internal/*
@domain/im/_internal/*
@domain/knowledge/_internal/*
@domain/evolution/_internal/*
@domain/feature-chain/_internal/*
@domain/guard-profile/_internal/*
@domain/issue/_internal/*
@domain/lite-ai/_internal/*
@domain/mcp-config/_internal/*
@domain/message/_internal/*
@domain/snail/_internal/*
@domain/snail-mcp-server/_internal/*
@domain/scheduled-task/_internal/*
```

每个模块的规则块格式为（以 scheduled-task 为例）：
```javascript
{
  files: ["src/domain/scheduled-task/**/*.ts"],
  rules: {
    "@typescript-eslint/no-restricted-imports": ["error", {
      patterns: [
        {
          group: ["@app/*"],
          message: "domain 层禁止反向依赖 app 层；如需 app 层能力，应通过 port 注入"
        },
        {
          group: [/* 上述 15 个 _internal 路径，排除自身 */],
          message: "_internal 是模块私有目录，不能跨模块 import"
        }
      ]
    }]
  }
},
```

4. **移除通用 `src/domain/**/*.ts` warn 规则**（第 84-95 行）：所有模块已有专属 error 规则后，通用 warn 规则冗余且可能掩盖遗漏。

**模块清单与变更状态**：

| 模块 | 变更类型 |
|------|----------|
| workspace, tenet-prompt, skill, sop, im, knowledge | 修正幽灵模块名 + 补齐缺失的 _internal 条目 |
| evolution, scheduled-task | 新增专属 error 规则 |
| feature-chain, guard-profile, issue, lite-ai, mcp-config, message, snail, snail-mcp-server | 新增专属 error 规则 |

### 变更 2：cd-review skill 反破窗指令

**文件**：`data/file/skills/cd-review/references/adversarial-check.md`

**与现有规则的关系**：`adversarial-check.md:57` 已有"禁止用代码反驳用户"规则（审查者不得以"当前代码逻辑是这样做的"作为反驳用户的论据）。反破窗规则是该规则在**架构合规审查**场景的具体化——前者针对"反驳用户意图"，后者针对"引用已有代码为架构违规辩护"。

在 **MUST NOT list** 章节之后，新增：

```markdown
### 反破窗规则（Anti-Broken-Windows）

> 本规则是"禁止用代码反驳用户"在架构合规审查场景的具体化。前者保护用户意图不被代码现状压制；本规则保护架构原则不被已有违规压制。

审查者引用已有代码作为质量辩护时，必须遵守以下规则：

1. **验证被引用代码的合规性**：引用已有代码作为"已有模式"辩护前，必须先验证被引用代码本身是否符合架构规则（ESLint 通过、类型检查通过、无已知违规标记）。引用已知违规或未验证的代码作为辩护 = 审查缺陷。
2. **区分"一致性论据"和"合规论据"**：引用已有代码证明"新代码与已有代码风格一致"是合理的（一致性论据）；但不能以此证明"新代码的架构违规是可接受的"（合规论据）。一致性不等于合规性。
3. **warn 不等于可接受**：当 linter 输出 warning 时，审查者不得将其自动视为"已建立的可接受模式"。必须确认 warn 是有意保留（有明确注释说明原因）还是遗漏升级（如本案"待 F-1 修复后升级为 error"）。
```

### 变更 3：不兼容更新

ESLint 规则从 `warn` 升级为 `error` 后，任何现有代码中的 `domain→app` 或 `infra→app` 导入将从 warning 变为 error，阻塞 CI。

**影响范围**：需在升级前确认 `npm run check` 在当前 main 分支上无任何 warn→error 升级可能暴露的违规。如有，需先修复这些违规再升级规则。

**验证命令**：`npm run check`（完整检查，不局限于特定模式）。

## 验收标准

| ID | 验收条件 | 验证方式 |
|----|----------|----------|
| AC-1 | 通用 `src/domain/**/*.ts` 规则已移除（所有模块有专属规则后冗余） | `eslint.config.mjs` 中无 `files: ["src/domain/**/*.ts"]` 的 warn 规则块 |
| AC-2 | `src/infra/**/*.ts` 的 `@app/*` 规则为 `error` 级别 | `grep -A2 'src/infra/\*\*/\*\.ts' eslint.config.mjs` 确认无 `warn` |
| AC-3 | 所有 15 个 domain 模块均有专属 error 规则块 | 对每个模块名 grep `eslint.config.mjs`，确认存在且为 `error` |
| AC-4 | 无幽灵模块名 | `eslint.config.mjs` 中无 `mcp-server/_internal`（应为 `snail-mcp-server/_internal`）和 `mcp-client/_internal` |
| AC-5 | `npm run check` 完整通过（无 error 输出） | CI 绿灯，不局限于 grep 特定模式 |
| AC-6 | cd-review skill 包含反破窗规则 | `grep '反破窗' data/file/skills/cd-review/references/adversarial-check.md` 有输出 |
| AC-7 | cd-review skill 反破窗规则引用了"禁止用代码反驳用户"作为上游规则 | `grep '禁止用代码反驳用户' data/file/skills/cd-review/references/adversarial-check.md` 有输出 |

## 参考文献

| 来源 | 类型 | 标识 |
|------|------|------|
| "Debt Behind the AI Boom" (Liu et al., 2026) | 学术论文 | arXiv:2603.28592 |
| "When Truth Is Overridden" (Wang et al., AAAI 2026) | 学术论文 | arXiv:2508.02087 |
| "Behavioral Ratchet" (Prasad, 2026) | 学术论文 | DOI: 10.5281/zenodo.19026682 |
| "Towards Understanding Sycophancy in LMs" (Sharma et al., 2023) | 学术论文 | arXiv:2310.13548 |
| "Sycophancy to Subterfuge" (Anthropic, 2024) | 学术论文 | arXiv:2406.10162 |
| DarkBench (Kran et al., ICLR 2025) | 学术基准 | arXiv:2503.10728 |
| "Do Claude Code and Codex P-Hack?" (Asher et al., 2026) | 工作论文 | andrewbenjaminhall.com/asher_et_al_LLM_sycophancy.pdf |
| GitClear "Coding on Copilot" (2024) | 行业报告 | gitclear.com |
| SycoCode benchmark | 学术基准 | github.com/Darkrai500/SycoCode |
| codex-bridge | 开源工具 | github.com/antonio-pitocco/codex-bridge |
| llm-dark-patterns hooks | 开源工具 | github.com/waitdeadai/llm-dark-patterns |

## 行业长期参考（不在本案 scope）

以下方案作为技术储备保留，待后续评估：

- **对抗性多模型审查**（codex-bridge）：一个模型实现，另一个只读沙箱验证
- **确定性输出门控**（llm-dark-patterns hooks）：非 LLM 代码检查模型输出中的谄媚特征
- **质量指标追踪**（GitClear 方法）：分别追踪 AI/人工代码的 code churn 和复用率
- **不同意率监控**：99%+ 同意率 = 结构性问题信号
