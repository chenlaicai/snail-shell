---
title: Handbook Skill 清理：消除与 SOP 目录的重复
date: 2026-06-04
status: implemented
module: prompt
type: incompatible
---

# Handbook Skill 清理：消除与 SOP 目录的重复

## 背景

PR #340 "[I2026060302][sop][Issue Update][Incompatible] SOP 角色手册外提与结构重构" 已经将 handbook 内容从 SOP YAML 提取到独立的 `.handbook.md` 文件中，存放在 `config/sop/code-delivery/` 目录下。

但是 `developer-handbook` 和 `reviewer-handbook` skill 仍然存在，包含完整的 handbook 内容，导致内容重复。

## 问题分析

### 当前状态

1. **SOP 目录结构**（PR #340 创建）：
   - `config/sop/code-delivery/development#developer.handbook.md`
   - `config/sop/code-delivery/review#reviewer.handbook.md`
   - `config/sop/code-delivery/review#developer.handbook.md`
   - `config/sop/code-delivery/design#designer.handbook.md`
   - `config/sop/code-delivery/merge#merger.handbook.md`
   - `config/sop/code-delivery/shared.handbook.md`

2. **Skill 文件**（遗留）：
   - `.meta/skills/developer-handbook/skill.md`
   - `.meta/skills/reviewer-handbook/skill.md`

3. **引用情况**：
   - `.meta/prompts/reference/测试.md` → "详细质量规则见 developer-handbook skill"
   - `.meta/prompts/reference/设计分析.md` → "可视化格式和详细触发条件见 developer-handbook skill"
   - `.meta/prompts/reference/提示词治理.md` → "详细治理规则见 developer-handbook skill"
   - `.meta/prompts/reference/实现.md` → "详细规则见 developer-handbook skill"

### 问题根因

PR #340 将 handbook 内容移动到了 SOP 目录结构中，但没有删除 skill 文件，也没有更新引用这些 skill 的地方。这是清理不完整导致的遗留问题。

## 设计方案

### 方案一：删除 skill + 更新引用（推荐）

1. 删除 `developer-handbook` 和 `reviewer-handbook` skill
2. 更新 `.meta/prompts/reference/` 中的引用，改为引用 SOP handbook 文件
3. 删除 `.claude/skills/` 中的符号链接

**优点**：
- 消除内容重复
- 统一到 SOP 目录结构
- 减少维护成本

**缺点**：
- 需要更新引用

### 方案二：将 skill 转换为指针

1. 保留 skill 文件，但内容改为简单的指针，指向 SOP handbook 文件
2. 更新 skill 的 description，说明内容已迁移到 SOP 目录

**优点**：
- 保持 skill 入口不变
- 不需要更新引用

**缺点**：
- 增加了一层间接性
- 仍然有文件存在

## 决策

采用**方案一**：删除 skill + 更新引用。

理由：
1. SOP 目录结构是权威来源，skill 是遗留副本
2. 消除内容重复，减少维护成本
3. 统一到 SOP 目录结构，符合 PR #340 的设计意图

## 实现计划

1. 删除 `.meta/skills/developer-handbook/` 目录
2. 删除 `.meta/skills/reviewer-handbook/` 目录
3. 删除 `.claude/skills/developer-handbook` 符号链接
4. 删除 `.claude/skills/reviewer-handbook` 符号链接
5. 更新 `.meta/prompts/reference/测试.md` 中的引用
6. 更新 `.meta/prompts/reference/设计分析.md` 中的引用
7. 更新 `.meta/prompts/reference/提示词治理.md` 中的引用
8. 更新 `.meta/prompts/reference/实现.md` 中的引用

## 验证

1. 确认 SOP 目录中的 handbook 文件内容完整
2. 确认所有引用已更新
3. 确认系统启动正常
4. 确认 SOP 流程正常工作

## 检视修复

- 检视发现 `.meta/skills/query-current-context/scripts/query-current-context.js` 中仍有 handbook skill 引用
- 已删除该文件中的 4 处引用
- 已 rebase 到最新 origin/main

## 不兼容更新

- 删除 `developer-handbook` 和 `reviewer-handbook` skill
- 更新 `.meta/prompts/reference/` 中的引用方式

## 参考

- PR #340: [I2026060302][sop][Issue Update][Incompatible] SOP 角色手册外提与结构重构
- PR #355: https://github.com/chenlaicai/snail-shell/pull/355

## 编号说明

- 本 Feature 编号为 F2026060403
- PR #355 的 commit 标题使用了 F2026060401，是因为创建时未检测到编号冲突
- F2026060401 已被 input-multiline-enter 使用（PR #354）
