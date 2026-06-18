---
id: F2026061803
title: ui-polish-issue-conversation
from_ids: [F2026060401]
tags: [ux, web]
modules: [web]
doc_kind: spec
change_type: refactor
verification_commands:
  - grep -r "Agents" src/web/
  - grep -r "StatusBadge" src/web/pages/IssueConversation.tsx
  - grep -r "StatusBadge" src/web/components/PropertiesPanel.tsx
---

# F2026061803 [web] Issue 对话界面 UI 优化

<!-- [design-time] 以下章节在需求收敛与设计阶段（代码前）完成并锁定 -->
<!-- 进入实现阶段后不得单方面修改，如需变更须通过问题卡片向用户提出并确认 -->

## 背景

Issue 对话界面存在多个 UI 体验问题：
1. 面包屑导航缺少 workspace 层级，且显示无意义的 ID 片段
2. 状态信息（StatusBadge）在页面中重复出现 3 次，消耗用户认知精力
3. 输入框换行行为与历史设计（F2026060401）不一致
4. 参与者展示以 snail 为主，与"以 role instance 为主"的产品定位不符
5. 术语不一致：系统概念是 Role，但 UI 显示为 "Agents"

## 目标

### P1 — UI 体验优化

1. 面包屑导航改为 `Workspaces > [workspace 名称] > [issue 标题]`，支持点击跳转
2. 去除重复的状态信息显示，保留 issue header 的 StatusBadge
3. 恢复 F2026060401 的输入框换行行为：Enter 换行、Shift+Enter 发送
4. 参与者展示以 role_instance 为主，snail_key 为辅
5. "Agents" 术语修正为 "Roles"

### P2 — @mention 自动补全（独立 feature）

- 输入框支持 @mention 自动补全当前 stage 的 role_instance
- 数据源：`currentStage.assignments` 的 role_instance 列表
- 与 `message-payload` skill 的 mention 协议对齐

## 非目标

- 不改变 Evolution Center 治理对话的输入行为（独立组件）
- 不改变 @mention 建议选择时的 Enter/Tab 行为（仍为确认选择）
- 不改变发送按钮的点击行为
- 不改变后端 API 或数据模型

## 核心业务行为

| # | 场景 | 预期行为 | 测试覆盖 |
|---|------|----------|----------|
| B1 | 当用户在 Issue 对话页面时 | 面包屑应显示 `Workspaces > [workspace 名称] > [issue 标题]`，点击 Workspaces 跳转到 `/workspaces`，点击 workspace 名称跳转到 `/workspaces/:id/board` | |
| B2 | 当用户在 Issue 对话页面时 | issue header 区域应显示 StatusBadge，properties grid 和 PropertiesPanel 不应显示 StatusBadge | |
| B3 | 当用户在输入框中按 Enter 时 | 光标应换行到下一行，不发送消息 | |
| B4 | 当用户在输入框中按 Shift+Enter 时 | 消息应发送成功 | |
| B5 | 当用户点击发送按钮时 | 消息应发送成功 | |
| B6 | 当用户查看 Participants 区域时 | 主显示应为 role_instance，次显示应为 snail_key | |
| B7 | 当用户查看 stage roles 区域时 | 标题应为 "Roles"，不是 "Agents" | |

## 设计

### P1 详设 — 面包屑导航

**数据源**：
- `workspace.summary`（优先）：用户可读的 workspace 描述
- `workspace.path`（fallback）：workspace 标识路径
- `workspaceId`（最终 fallback）：当 summary 和 path 均为空时使用

**实现方式**：
- IssueConversation 页面额外查询 workspace 详情（`api("GET /api/workspaces/:workspaceId")`）
- 面包屑数组：`[{ label: "Workspaces", to: "/workspaces" }, { label: workspaceName, to: "/workspaces/:id/board" }, { label: issue.title }]`

**风险与缓解**：
- 风险：`workspace.path` 可能包含 `/` 前缀
- 缓解：优先使用 `workspace.summary`，`path` 作为 fallback

### P1 详设 — 状态去重

**当前状态显示位置**：
1. `IssueConversation.tsx:124` — issue header（保留）
2. `IssueConversation.tsx:151` — properties grid（去掉）
3. `PropertiesPanel.tsx:19` — 右侧栏 Details（去掉）

**设计决策**：
- 保留 issue header 的 StatusBadge（最醒目的位置）
- properties grid 精简为只保留 Stage 和 SOP，去掉 Status 行
- PropertiesPanel Details 去掉 Status 行，保留 Stage、SOP、Created、Closed

### P1 详设 — 输入框换行

**历史设计**（F2026060401）：
- Enter：换行（浏览器默认行为，不调用 `preventDefault`）
- Shift+Enter：发送消息
- 与 Slack/Discord 默认模式一致

**当前实现**（v2）：
- Enter：发送（调用 `preventDefault`）
- Shift+Enter：换行

**设计**：恢复 F2026060401 的行为，修改 `ChatInput.tsx` 的 `handleKeyDown` 逻辑。

### P1 详设 — 参与者展示

**当前**（`PropertiesPanel.tsx:82-94`）：
- 主显示：`snail_key`（如 "snail-001"）
- 次显示：`role_instance`（如 "架构师-1"）

**设计**：
- 主显示：`role_instance`（如 "架构师-1"），使用 text-[12px] text-text-primary
- 次显示：`snail_key`（如 "snail-001"），使用 text-[10px] text-text-muted

### P1 详设 — 术语修正

**当前**（`PropertiesPanel.tsx:41`）：Section title 为 "Agents"
**设计**：改为 "Roles"

## 生效路径

- `src/web/components/TopBar.tsx` — 面包屑组件
- `src/web/pages/IssueConversation.tsx` — 面包屑构建
- `src/web/components/ChatInput.tsx` — 输入框换行行为
- `src/web/components/PropertiesPanel.tsx` — 参与者展示和术语修正

## 设计约束摘要

- **边界**：只改 Issue 对话界面的前端组件，不动后端 API
- **关键决策**：
  - 面包屑用 `workspace.summary`（优先）或 `workspace.path`（fallback）
  - 输入框换行恢复 F2026060401 设计（Enter 换行、Shift+Enter 发送）
  - 参与者展示以 role_instance 为主
- **非目标约束**：不改变 Evolution Center、不改变后端 API、不实现 @mention（P2）
- **语义不变量**：
  - @mention 建议激活时 Enter 仍为确认选择
  - 发送按钮行为不变

<!-- [design-time] 章节结束 -->

## 改动范围

| 文件 | 改动 |
|---|---|
| `src/web/pages/IssueConversation.tsx` | 面包屑构建、properties grid 精简 |
| `src/web/components/TopBar.tsx` | 面包屑组件（可能无需改动） |
| `src/web/components/ChatInput.tsx` | 输入框换行行为 |
| `src/web/components/PropertiesPanel.tsx` | 参与者展示、术语修正 |

## 验证

### P1

- [ ] 面包屑显示 `Workspaces > [workspace 名称] > [issue 标题]`
- [ ] 点击 "Workspaces" 跳转到 `/workspaces`
- [ ] 点击 workspace 名称跳转到 `/workspaces/:id/board`
- [ ] issue header 显示 StatusBadge
- [ ] properties grid 不显示 StatusBadge
- [ ] PropertiesPanel 不显示 StatusBadge
- [ ] 在输入框中按 Enter，光标换行到下一行，不发送消息
- [ ] 按 Shift+Enter，消息发送成功
- [ ] 点击发送按钮，消息发送成功
- [ ] Participants 区域主显示为 role_instance
- [ ] Participants 区域次显示为 snail_key
- [ ] stage roles 区域标题为 "Roles"

### 验证命令

```bash
# 确认术语已修正
grep -r "Agents" src/web/
# 预期输出：0 匹配

# 确认状态去重
grep -r "StatusBadge" src/web/pages/IssueConversation.tsx
# 预期输出：1 匹配（仅 header）

grep -r "StatusBadge" src/web/components/PropertiesPanel.tsx
# 预期输出：0 匹配
```

### P2（@mention，独立 feature）

- [ ] 输入 @ 时显示 role_instance 补全列表
- [ ] 选择后插入 @role_instance_name
- [ ] 发送时解析 @mentions 填入 to_roles 字段

## 关联

- **前置**: F2026060401（输入框换行行为设计）

## 关键决策记录

| # | 决策点 | 正方论点 | 反方论点 | 最终决策 | 决策依据 | 参与者 | 日期 |
|---|--------|----------|----------|----------|----------|--------|------|
| D1 | 面包屑数据源 | `workspace.summary` 是用户可读的描述，最安全；`workspace.path` 在 IssueBoard 中已使用 | `workspace.summary` 可能为空；`workspace.path` 格式不确定 | 用 `workspace.summary`（优先）或 `workspace.path`（fallback） | 优先使用最安全的字段，fallback 确保功能可用 | 架构师-1, 架构师-2 | 2026-06-18 |
| D2 | 状态去重策略 | 保留 header StatusBadge（最醒目），去掉 properties grid 和 PropertiesPanel 的重复 | 可能导致某些用户找不到状态信息 | 保留 header，去掉其他两处 | header 是最醒目的位置，用户一眼可见 | 架构师-1, 架构师-2 | 2026-06-18 |
| D3 | 输入框换行行为 | F2026060401 已设计 Enter 换行、Shift+Enter 发送，与 Slack/Discord 默认一致 | 用户可能习惯 Enter 发送 | 恢复 F2026060401 设计 | 遵循历史设计决策，与主流聊天应用一致 | 架构师-1, 架构师-2 | 2026-06-18 |
| D4 | @mention 优先级 | 数据源为 role_instance，复杂度较高 | 功能缺失影响用户体验 | 作为 P2 独立 feature | 本次聚焦 P1 优化，@mention 可独立推进 | 架构师-1, 架构师-2 | 2026-06-18 |
| D5 | 参与者展示主次 | role_instance 是用户视角的主要标识，snail_key 是系统内部标识 | 无 | 主显示 role_instance，次显示 snail_key | 符合"以 role instance 为主"的产品定位 | 架构师-1, 架构师-2 | 2026-06-18 |
| D6 | 术语一致性 | 系统内部概念是 Role，UI 应保持一致 | 无 | "Agents" 改为 "Roles" | 术语对齐，减少认知混乱 | 架构师-1, 架构师-2 | 2026-06-18 |
| D7 | MCP 能力发现机制范围 | 放入本次 feature 一次性解决 | 关注点不同，范围扩大 | 单独做，创建独立 feature | 保持 UI 优化范围清晰，MCP 能力发现可独立复用 | 架构师-1, 架构师-2 | 2026-06-18 |

## 范围变更记录

无
