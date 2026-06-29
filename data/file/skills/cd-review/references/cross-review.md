# 交叉审视机制

## 规则

两位审查者独立完成各自检视后，必须交叉阅读对方的检视结论：

## 对抗产物协议

审查阶段的 `consensus: true` 信号必须携带 `adversarial_artifact`（通用字段 + Review 特有字段）。详见 `cd-shared/references/adversarial-artifact-protocol.md`。

Review 特有字段：
- `file_dispositions`：逐文件处置状态
- `cross_review`：交叉审视记录
- `ci_independence`：CI 状态独立确认（不接受开发者声明）
- `file_coverage`：文件覆盖（coverage_ratio = 1.0）

1. 阅读另一位审查者的检视结论和发现的问题
2. 如果自己表示「完全没问题」而对方发现了问题，必须重新审视自己的检视范围是否有遗漏
3. 如果对方表示「完全没问题」而自己发现了问题，必须更加仔细确认自己的发现是否准确
4. 对抗必须产生价值：不能为了反对而反对，必须指出具体风险或遗漏
5. 交叉审视后，两位审查者合并形成一份检视报告交给开发者
