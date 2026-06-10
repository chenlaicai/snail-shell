# Skill 模块分析（v1 遗留）

> 本文档基于 `v1/` 目录下的遗留代码分析，用于指导 v2 重写。

---

## 一、业务场景

### 1.1 Skill 是什么

Skill 是 Snail Shell 向 AI Agent 注入**结构化能力**的载体。每个 Skill 由一个 `SKILL.md` 文件定义，包含元数据（YAML frontmatter）和指令内容（Markdown body）。部分 Skill 附带可执行脚本（JS），Agent 通过 CLI 调用。

### 1.2 核心业务场景

| 场景 | 说明 |
|------|------|
| **Skill 发现与注册** | 系统启动时扫描 `.meta/skills/` 目录，解析每个子目录下的 `SKILL.md`，构建全局注册表 |
| **Workspace Skill 加载** | 用户 workspace 的 `.snail/skills/` 目录下的自定义 Skill 与平台 Skill 合并，名称全局唯一 |
| **Agent 能力注入** | Skill 作为 ACS（Agent Capability Spec）的 8 个维度之一，通过 symlink 注入各 Agent CLI |
| **Web 展示** | Skill Center 页面展示所有平台 Skill 的名称、描述、文件路径，支持搜索 |
| **Skill 脚本执行** | 附带脚本的 Skill 在 Agent 运行时被调用，通过环境变量注入运行时上下文（conversationId, issueId, stageId） |

### 1.3 Skill 与其他模块的关系

- **与 Role 无关**：Skill 不绑定 Role，所有 Role 共享全部 Skill
- **与 SOP 无关**：SOP 不引用 Skill，二者正交
- **与 Prompt 平行**：Skill 和 Prompt 是 ACS 中的独立维度，Skill 不嵌入 systemPrompt
- **与 Workspace 关联**：workspace 可定义自定义 Skill，与平台 Skill 合并时强制名称唯一
- **与 Agent Adapter 关联**：各 Agent 适配器（Claude Code、Codex、OpenCode）通过 symlink 机制注入 Skill

### 1.4 平台 Skill 清单

| Skill | 有脚本 | 用途 |
|-------|--------|------|
| `snail-skill-creator` | 否 | 元 Skill：创建新 Skill 的指南 |
| `message-payload` | 是 | 格式化结构化消息内容块 |
| `query-current-context` | 是 | 查询运行时上下文（stage、issue、roles、conversation） |
| `set-task-anchor` | 是 | 写入任务锚点，长对话中保持意图一致 |
| `conversation-history` | 是 | 搜索/检索历史消息 |
| `feature-chain` | 是 | 查询 feature 文档索引和引用链 |
| `evolution-candidate` | 是 | 创建治理队列的演化条目 |
| `record-issue-repo-context` | 是 | 记录分支名、worktree 路径、PR URL |
| `knowledge-library` | 是 | 查询和创建知识库条目 |
| `prompt-constraints` | 否 | 规则型 Skill：引导 Agent 按需读取约束文件 |

---

## 二、数据模型

### 2.1 存储方式

**Skill 不入库，纯文件驱动。** 没有数据库表，没有 migration。所有 Skill 数据来自文件系统扫描。

### 2.2 SKILL.md 格式

```markdown
---
name: skill-name
description: 一句话描述
---

# Skill Title

## Purpose
...

## When To Use
...

## Instructions / Command
...

## Output
...

## Hard Rules
...
```

- Frontmatter：`---` 分隔，简单 YAML（key-value），必填 `name` 和 `description`
- Body：Markdown，约定俗成的章节结构

### 2.3 TypeScript 类型定义

**SkillDefinition**（内部注册表）：
```typescript
interface SkillDefinition {
  name: string;           // 来自 frontmatter
  description: string;    // 来自 frontmatter
  filePath: string;       // SKILL.md 的绝对路径
  content: string;        // Markdown body（不含 frontmatter）
  title: string;          // 从 content 提取的第一个 `# ` 标题
  source: "platform" | "workspace";
}
```

**SkillCapability**（ACS 投影，面向 Agent）：
```typescript
interface SkillCapability {
  name: string;
  description: string;
  filePath: string;
  directory: string;      // Skill 所在目录（用于 symlink）
  content: string;
  source: "platform" | "workspace";
}
```

**SkillDto**（API 响应）：
```typescript
type SkillDto = {
  name: string;
  description: string;
  filePath: string;
  content: string;
  title: string;
  source: "platform" | "workspace";
};
```

### 2.4 三种类型的差异

| 字段 | SkillDefinition | SkillCapability | SkillDto |
|------|----------------|-----------------|----------|
| name | ✓ | ✓ | ✓ |
| description | ✓ | ✓ | ✓ |
| filePath | ✓ | ✓ | ✓ |
| content | ✓ | ✓ | ✓ |
| title | ✓ | ✗ | ✓ |
| directory | ✗ | ✓ | ✗ |
| source | ✓ | ✓ | ✓ |

---

## 三、核心流程

### 3.1 Skill 注册流程

```
启动 → scanDir(.meta/skills/) → 解析每个 SKILL.md → validateSkillNames() → 构建 Map<name, SkillDefinition>
```

### 3.2 Workspace 合并流程

```
loadWorkspaceContext() → scanDir(.snail/skills/) → parseSkillDefinition()
→ listSkillsWithWorkspace(workspaceSkills) → 合并 + 名称冲突校验 → 返回合并列表
```

### 3.3 Agent 注入流程

```
buildConversationCapability()
  → collectActiveSkills(workspaceSkills)
  → listSkillsWithWorkspace() 合并平台 + workspace Skill
  → 映射为 SkillCapability[]（加 directory，去 title）
  → 放入 AgentCapability.skills

Agent Adapter.invokeMessage()
  → ensureSkillSymlinks(workspaceRoot, skills)
  → 为每个 Skill 创建 symlink：
      .claude/skills/<name>/ → <skillDirectory>
      .agents/skills/<name>/ → <skillDirectory>
```

### 3.4 API 流程

```
GET /api/meta/skills → listSkills() → 相对化 filePath → JSON 响应
```

---

## 四、关键设计决策（v1）

1. **文件驱动，不入库** — 无 migration，文件系统扫描即注册
2. **名称全局唯一** — 平台与 workspace Skill 名称不能冲突
3. **Symlink 注入，非 systemPrompt** — 各 Agent CLI 原生发现机制
4. **与 Role/SOP 正交** — Skill 是独立维度，不绑定角色或流程
5. **环境变量传递上下文** — Skill 脚本通过 `SNAIL_CTX_*` 环境变量获取运行时上下文
6. **路径安全** — Symlink 创建时校验名称不含 `/`、`\`、`..`

---

## 五、v2 重写待决问题

1. **是否保持纯文件驱动？** 还是引入数据库表支持 CRUD、版本管理、权限控制？
2. **Skill 与 Agent 的绑定方式？** Symlink 机制是否需要适配新的 Agent 适配器？
3. **Skill 是否需要绑定到 SOP/Role？** 当前正交设计是否满足新需求？
4. **Skill 脚本的执行模型？** 是否需要沙箱化、超时控制、日志采集？
5. **Workspace Skill 的管理界面？** 是否需要 Web 端 CRUD？
6. **SKILL.md 格式是否演进？** 是否需要更丰富的元数据（版本、作者、依赖等）？
