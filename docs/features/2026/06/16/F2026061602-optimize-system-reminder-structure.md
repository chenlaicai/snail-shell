---
id: F2026061602
title: optimize-system-reminder-structure
tags:
  - prompt
  - system-reminder
  - identity
  - llm
  - acs
modules:
  - issue-collaboration
  - snail
doc_kind: spec
---

# F2026061602: 优化 system-reminder 结构和身份锚定

## 背景

当前 system-reminder 的结构存在以下问题：

1. **XML嵌套过深**：4层嵌套（system-reminder → role-handbook → invocation-context → snail-invocation-context）增加LLM解析负担
2. **信息重复**：handbook和invocation-context中的collaboration有重叠
3. **身份锚定位置靠后**：身份声明在handbook第3行，不够突出
4. **自检规则被动**：依赖LLM主动触发
5. **角色切换断裂**：没有明确声明身份变化

## 目标

1. 扁平化XML结构，减少嵌套层数
2. 强化身份锚定，让LLM更容易识别和遵从角色职责
3. 保持信息完整性，不丢失关键上下文

## 非目标

1. 不改变system message的静态规则
2. 不改变业务逻辑，只优化prompt结构

## 设计

### 核心设计原则

1. **身份锚定第一优先**：identity信息必须在system-reminder的最前面，用最醒目的格式
2. **结构扁平化**：减少XML嵌套，最多2层
3. **信息不重复**：避免handbook和context中的信息重叠
4. **职责清晰**：collaboration层负责内容构建，snail层负责简单包装

### 结构优化

**之前结构**：
```xml
<system-reminder>
  <role-handbook>
    ## 架构师手册
    - 当前身份：架构师...
    ## 工作规则
    ...
  </role-handbook>
  <invocation-context>
    <snail-invocation-context>
      { JSON }
    </snail-invocation-context>
  </invocation-context>
</system-reminder>
```

**优化后结构**：
```xml
<system-reminder>
  <identity>
    # 你是架构师-1
    **角色实例**：架构师-1
    **职责**：需求对齐与设计
    **禁止**：超出职责范围的行为
    **自检**：如果发现自己在做职责范围外的事情，立即停止
  </identity>
  
  <handbook>
    ## 通用规则
    ...
    ## 角色手册
    ## 工作规则
    ...
    ## 角色边界
    ...
  </handbook>
  
  <context>
    ## 项目上下文
    ...
    ## 当前阶段
    ...
    ## 可用流转
    ...
    ## 协作规则
    ...
  </context>
</system-reminder>
```

### 身份锚定强化

1. **身份声明前移**：第一句话就是"你是XXX"
2. **禁止项加粗**：用`**禁止**`、`**不要**`等强标记
3. **自检规则主动化**：明确的自检指令

### 职责分工

1. **collaboration.ts**：负责构建完整的system-reminder内容
   - 构建identity部分（从SOP中提取角色信息）
   - 构建handbook部分（从SOP handbook中提取）
   - 构建context部分（简化版，去掉重复信息）
   - 返回完整的system-reminder字符串

2. **snail adapter.ts**：只做简单的XML包装
   - 接收collaboration层构建的内容
   - 包装在`<system-reminder>`标签中
   - 不做任何内容处理

### 实现位置

1. `src/app/issue-collaboration/collaboration.ts`：修改`buildSystemReminder`方法
2. `src/domain/snail/_internal/adapter.ts`：简化`buildSystemReminder`方法
3. `v1/config/sop/code-delivery/design#designer.handbook.md`：优化内容结构
4. `v1/config/sop/code-delivery/development#developer.handbook.md`：优化内容结构
5. `v1/config/sop/code-delivery/review#reviewer.handbook.md`：优化内容结构

## 生效路径

1. 修改collaboration的system-reminder构建逻辑
2. 简化snail adapter的包装逻辑
3. 更新handbook文件结构
4. 测试验证

## 设计约束摘要

- 保持信息完整性
- 不改变业务逻辑
- 向后兼容
- **handbook格式约束**：禁止项和自检规则必须使用 `**禁止**：xxx` 和 `**自检**：xxx` 的单行格式，以便代码解析

## 关键决策记录

### 决策1：身份信息的来源

**决策点**：identity信息应该从哪里提取？

**正方论点**：从SOP的role definition中提取，确保信息准确一致
**反方论点**：从handbook中解析，但handbook格式不固定

**最终决策**：从SOP的role definition中提取

**决策依据**：
- SOP的role definition是结构化的，格式固定
- handbook是自由格式的markdown，解析复杂
- 从SOP提取可以确保信息一致性

### 决策2：context的简化方式

**决策点**：如何简化context的JSON结构？

**正方论点**：保持原有结构，只添加identity信息
**反方论点**：重新设计context结构，去掉重复信息

**最终决策**：重新设计context结构，使用更清晰的markdown格式

**决策依据**：
- markdown格式更易于LLM解析
- 去掉重复信息减少token消耗
- 更清晰的结构提升可读性

### 决策3：禁止项和自检规则的来源

**决策点**：禁止项和自检规则应该从哪里提取？

**正方论点**：从handbook中提取，让handbook明确包含这些内容
**反方论点**：用代码解析handbook，但handbook格式不固定

**最终决策**：修改handbook文件，让它明确包含禁止项和自检规则

**决策依据**：
- handbook是角色手册，应该明确包含角色的所有约束
- 用代码解析handbook增加了复杂度
- 修改handbook更简单，也更符合"handbook是角色手册"的设计理念

## 变更记录

### 2026-06-16: 初始设计

- 完成结构优化设计
- 实现collaboration.ts的buildSystemReminder方法
- 简化snail adapter的buildSystemReminder方法
- 优化handbook文件结构

### 2026-06-16: 修复设计

- 移除自引用问题：从context对象中移除system_reminder字段
- 恢复丢失的信息：在context部分添加all_role_instances和extendable_context
- 灵活化规则：修改handbook文件，让它明确包含禁止项和自检规则
- 重新设计adapter：adapter直接透传collaboration的完整输出
- 添加角色信息fallback：当SOP中找不到角色信息时，从handbook中提取
- 标注handbook格式约束：明确禁止项和自检规则的格式要求
