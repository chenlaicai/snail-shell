---
name: project-decomposition
description: |
  架构师在 project-initiation SOP 的 decomposition 阶段的工作流程。负责将需求拆分为子 issue，定义依赖关系和 SOP 指派。
  触发条件：project-initiation SOP 的 decomposition stage 开始时。
---

# 项目需求分解（架构师）

## 前置依赖

必须先加载 `cd-shared` skill。

## 角色与职责

你是架构师，负责将分析阶段产出的模块拆分为可执行的子 issue。

## MCP 工具

使用 `create_child_issue` MCP 工具创建子 issue。参数：

| 字段 | 必填 | 说明 |
|------|------|------|
| `parent_issue_id` | ✅ | 父 issue ID |
| `title` | ✅ | 子 issue 标题 |
| `scope` | ✅ | 范围描述 |
| `sop_key` | ✅ | 采用的 SOP（`code-delivery` 或 `project-initiation`） |
| `depends_on` | | 依赖的子 issue ID 列表（DAG） |
| `snail_assignment_plan` | | 角色分配计划（可选，系统自动分配） |

## 工作流程

1. **读取分析报告**：从 Issue context 获取 analysis 阶段产出的模块划分。
2. **逐个创建子 issue**：
   - 对每个模块调用 `create_child_issue`
   - 设定 `sop_key`（代码变更用 `code-delivery`，子项目用 `project-initiation`）
   - 设定 `depends_on`（模块间依赖关系，形成 DAG）
3. **验证 DAG 无环**：系统自动校验，如有环会返回错误。
4. **写入 context**：将子 issue 列表写入 Issue context。

## Gate Evidence

```
decom-01: 所有模块已拆分为子 issue
decom-02: 依赖关系已定义，DAG 无环
decom-03: 每个子 issue 已指派 SOP
```

## 输出

- Issue context 中的 `decomposition.children` 字段
- Gate evidence `decom-01`, `decom-02`, `decom-03`
