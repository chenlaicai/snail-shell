# 测试规则

## 行为契约测试范式

测试必须验证外部可观测行为，不是内部实现。

### 核心原则

- 断言的是外部可观测行为（输入/输出/状态变化/错误），不是内部实现（函数调用/参数/调用顺序）
- mock 仅作为隔离手段，不作为断言依据
- 测试应该对应 feature spec 中的核心业务行为
- 测试的规格来源必须是 spec 中的核心业务行为，不是从代码实现反推

### 规格来源

测试场景必须来源于 feature spec 的核心业务行为列表。建议在测试文件头部添加 spec 引用注释：

```typescript
// @spec-ref: F2026062601#B3
it('关闭 issue 后自动归档', async () => { ... })
```

- Spec 引用是建议而非硬约束（CI 不检查，reviewer 人工关注）
- 行为条目的质量标准见 `cd-design/references/behavior-item-guide.md`

### 断言约束

| 类别 | 允许 | 禁止 |
|------|------|------|
| 副作用验证 | `expect(fn).toHaveBeenCalled()` | `expect(fn).toBeCalledTimes(N)` |
| 参数验证 | — | `expect(fn).toHaveBeenCalledWith(args)` |
| 返回值验证 | `expect(result).toEqual(expected)` | — |
| 状态变更验证 | `expect(db.getState()).toBe(expected)` | — |
| 错误验证 | `expect(error).toBeInstanceOf(ExpectedError)` | — |

**理由**：Snail Shell 基于 hexagonal architecture，port 的实现是 side effect。允许断言"副作用是否触发"，禁止断言"副作用的具体参数"。如果需要验证副作用的输出内容，应使用 golden-file 或状态变更断言。

### 判断标准

如果删除测试中的 mock，断言是否仍然成立？
- 成立 = 行为契约（正确）
- 不成立 = 可能绑定了实现（需要重构）

## Mock 边界

- mock 只用于隔离外部依赖（数据库、网络、文件系统）
- mock 不用于断言内部调用细节
- 如果测试需要 mock 一个内部函数来验证行为，说明测试绑定了实现

## 测试失败决策树

当测试失败时，按以下顺序判断：

1. **是测试未适配新设计吗？** → 修改测试以匹配新设计
2. **是实现偏离了设计吗？** → 修改实现以匹配设计
3. **是设计本身有问题吗？** → 升级到架构师讨论

不得仅因测试失败就要求开发者回退业务代码。

## Golden-file 测试

用于验证复杂确定性输出（状态转移结果、数据转换输出、消息格式化）。

- 目录：`tests/golden/<module>/`
- 格式：JSON（diff-friendly）
- 更新机制：`UPDATE_GOLDEN=1 npx vitest run` 显式触发，更新必须有独立 commit
- 不适用于 AI/LLM 输出（非确定性）

## Property-based testing

用于核心业务逻辑的不变量验证（状态机、数据一致性、排序/过滤）。

- 依赖：`fast-check`
- 推荐但不强制
- 属性定义应描述不变量，不是枚举输入输出

## 反模式

- **字符串匹配反模式**：测试通过检查日志/输出中的特定字符串来验证行为。应该验证运行时状态/返回值。
- **填充式测试**：没有对应 feature spec 中核心业务行为的测试。可能是为了覆盖率而写的。
- **实现绑定测试**：断言内部函数调用而非外部行为的测试。
- **Trivially true 测试**：断言函数返回了它名字承诺的东西（如 `expect(createIssue()).toBeDefined()`）。没有守护价值。
