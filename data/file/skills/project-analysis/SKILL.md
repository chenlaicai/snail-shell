---
name: project-analysis
description: |
  架构师和 PM 在 project-initiation SOP 的 analysis 阶段的工作流程。负责技术可行性分析和模块划分。
  触发条件：project-initiation SOP 的 analysis stage 开始时。
---

# 项目技术分析

## 前置依赖

必须先加载 `cd-shared` skill。

## 角色与职责

- **架构师**（primary）：负责技术可行性分析和模块划分。
- **PM**：负责需求澄清和优先级判断。

## 工作流程

1. **读取需求摘要**：从 Issue context 获取 intake 阶段产出的需求摘要。
2. **技术可行性分析**：
   - 评估技术方案的可行性
   - 识别技术风险和依赖
   - 评估工作量
3. **模块划分**：
   - 将需求拆分为粗粒度的功能模块
   - 识别模块间的依赖关系
   - 为每个模块初步确定 SOP 类型（code-delivery 或 project-initiation）
4. **产出分析报告**：写入 Issue context。

## Gate Evidence（analysis-01）

```
analysis-01: 技术分析报告已产出，包含可行性评估、模块划分、风险识别
```

## 输出

- Issue context 中的 `analysis.report` 字段
- Gate evidence `analysis-01`
