# F2026051901 项目配置页面化

## 背景

项目管理已在上一轮重构中将 stage 定义、stage role 定义和 role 到 Snail Den template 的绑定收束到数据库，但 Web 新建 Project 仍只通过浏览器弹窗收集项目名称和摘要。这与实际配置复杂度不匹配：新项目需要显式配置 stage 链条、每个 stage 上的角色职责，以及各 role 由哪个 Snail Den template 执行。

## 目标

1. 将 Web 新建 Project 从 `prompt()` 弹窗改为项目主视图中的配置页面。
2. 配置页面支持编辑项目名称、摘要、stage 定义、stage 验收要点、role 职责、role 工作规则和 role 绑定的 Snail Den template。
3. 后端 `POST /projects` 接收并校验 `stage_definitions`，项目创建时一次性写入 stage/role 配置。
4. 明确 role 选择 snail 的时机：项目创建时写入 `stage_role_definition.snail_template_id`，运行时再由 RoleRegistry 和 Snail Den 解析成具体 runtime/model。

## 非目标

1. 不实现已创建 Project 的配置编辑。
2. 不改变 Snail Den template 管理机制。
3. 不改变 Feature、Stage、Conversation 的运行时状态流转。

## 设计

新建 Project 入口仍位于左侧 Workspace Tree 的“新建”按钮，但点击后不再弹窗，而是在项目主视图渲染 `project-config-page`。配置页使用一份默认 stage 模板作为初始值，用户可在页面中直接调整 stage 与 role：

1. Project 层：名称、摘要、类型保持 `product_delivery`。
2. Stage 层：`key`、显示名称、输入要求、输出要求、验收要点。
3. Role 层：角色名称、职责描述、工作规则、是否主角色、绑定的 `snail_template_id`。

提交时前端向 `POST /projects` 传入 `stage_definitions`。后端新增规范化和校验逻辑：stage key 在项目内唯一、每个 stage 至少有一个 role、每个 stage 必须有主 role、同一 stage 内 role 名称唯一、每个 role 必须绑定 Snail Den template。

role 与 snail 的选择链路保持上一轮重构后的模型：

1. 配置页选择的是 role 绑定的 Snail Den template。
2. 项目创建时该绑定写入 `stage_role_definition.snail_template_id`。
3. Conversation 创建时使用 stage 的主 role 作为默认 role，并记录参与 role 名称。
4. 消息派发时根据 role ID/name 找到 role definition，再通过 `RoleRegistry.getSnailTemplateId()` 获得 template ID。
5. `SnailDen.getSnailRuntime(templateId)` 将 template 解析为 runtime、model 和 contextWindow。

## 生效路径

1. `src/web/ui-shell.js` 提供项目配置页面挂载点。
2. `src/web/app.js` 管理项目配置草稿、渲染配置页并提交 `stage_definitions`。
3. `src/web/styles.css` 提供长表单配置页布局。
4. `src/interaction-entry/api/server.ts` 接收并校验项目 stage/role 配置。
5. `tests/web/ui-entrypoint-test.ts` 和 `tests/web/workspace-layout-test.ts` 固化 UI 入口与布局约束。

## 改动范围

1. `src/web/ui-shell.js`
2. `src/web/app.js`
3. `src/web/styles.css`
4. `src/interaction-entry/api/server.ts`
5. `tests/web/ui-entrypoint-test.ts`
6. `tests/web/workspace-layout-test.ts`
7. `docs/features/20260519/F2026051901-project-config-ui.md`

## 验证

1. `npm run test -- tests/web/ui-entrypoint-test.ts tests/web/workspace-layout-test.ts`
2. `npx tsc`
3. 手工验证页面入口：点击“新建”后应进入配置页面而不是浏览器弹窗，提交时 payload 包含 `stage_definitions`。

## 风险与决策记录

1. 当前仅处理新建 Project 配置，不处理既有 Project 编辑。原因是编辑既有配置会影响已有 stage/conversation 的运行时语义，需要独立设计迁移和约束。
2. 若本地 `config/snail-den.json` 没有 template，配置页无法创建带 role 绑定的新 Project。该限制符合当前 role 必须绑定执行者的模型。

## 范围变更记录

暂无。
