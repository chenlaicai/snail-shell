# F2026051403 Snail Den 配置改为 example 模式

## 背景

`snail-den.json` 是 Snail Den 的配置文件，包含所有可用的 snail template 定义。此前该文件直接提交到仓库，导致不同用户的本地环境配置（runtime、model、contextWindow）互相冲突，也无法适配多样化的 agent 接入场景。

## 目标

- 配置文件不再提交到仓库，改为由用户本地创建和维护
- 仓库提供 `snail-den.example.json` 作为配置参考
- 配置文件不存在时系统可正常启动（返回空 template 列表）

## 非目标

- 不涉及 snail template 的运行时热加载或动态刷新
- 不涉及 contextWindow 的实际使用逻辑（由后续 feature 实现）

## 设计

- 删除 `config/snail-den.json`，新增 `config/snail-den.example.json`
- `.gitignore` 中添加 `config/snail-den.json`
- `SnailTemplate` 接口新增 `contextWindow?: number` 字段，用于 runtime 未返回上下文窗口时的兜底
- `loadSnailDen()` 在配置文件不存在（ENOENT）时返回空数组，让系统正常启动

## 生效路径

- 代码：`src/snail-den/index.ts`（SnailTemplate 接口、loadSnailDen 函数）
- 配置：`config/snail-den.example.json`
- Git：`.gitignore`

## 改动范围

- `config/snail-den.example.json`（新增）
- `config/snail-den.json`（删除）
- `src/snail-den/index.ts`（接口扩展 + ENOENT 处理）
- `.gitignore`（添加忽略规则）

## 验证

- 构建通过（npm run build）
- Lint 通过（npm run lint）
- 测试通过（npm run test，35 个测试文件全部通过）
- 删除 config/snail-den.json 后系统可正常启动
- 复制 example 文件后配置生效

## 风险与决策记录

- contextWindow 字段目前只在 example 文件和接口定义中声明，实际使用逻辑尚未实现（等待 snail-den-context-threshold 分支合入）

## 范围变更记录

- 检视阶段：补充 contextWindow 到 SnailTemplate 接口（原 PR 只在 example 文件中有此字段）
- 检视阶段：为 ENOENT 处理添加 why 注释
