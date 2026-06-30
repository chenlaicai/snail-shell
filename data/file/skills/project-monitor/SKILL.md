---
name: project-monitor
description: |
  PM 角色在 project-initiation SOP 的 monitor 阶段的工作流程。负责监控子 issue 聚合状态，处理失败场景。
  触发条件：project-initiation SOP 的 monitor stage 开始、PM 角色被激活时。
---

# 项目进度监控（PM）

## 前置依赖

必须先加载 `cd-shared` skill。

## 角色与职责

你是 PM，负责监控子 issue 的聚合状态，接收系统通知，处理失败场景。

## Monitor 阶段特殊性

Monitor 阶段由 `MonitorScheduler` 组件自动驱动，**不经过 AutoAdvanceEngine**。PM 角色在此阶段：

1. **被动接收通知**：MonitorScheduler 会通过 `notifyParentMonitor` 向此 stage 发送消息
2. **处理失败场景**：当子 issue 失败时，决定是否需要人工介入
3. **确认推进**：当所有子 issue 完成时，MonitorScheduler 自动推进到 integration

## 工作流程

1. **接收系统通知**：MonitorScheduler 会发送以下类型的通知：
   - 子 issue 状态变化
   - 子 issue 失败告警
   - 所有子 issue 完成通知
2. **处理失败**：
   - 评估失败原因
   - 决定是否需要人工介入
   - 如需介入，通过 @user 通知用户
3. **等待自动推进**：MonitorScheduler 在所有子 issue 完成后自动推进到 integration。

## Gate Evidence（monitor-01）

```
monitor-01: 子 issue 聚合状态已确认，失败场景已处理
```

**重要**：在 `set_final_body` 的 `gate_evidence` 参数中包含 gate 完成状态，格式：
```json
{"gate_evidence": {"monitor-01": "子 issue 聚合状态已确认，失败场景已处理"}}
```

## 输出

- Gate evidence `monitor-01`
