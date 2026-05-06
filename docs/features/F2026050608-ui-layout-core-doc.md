# F2026050608 UI 布局核心设计文档落地

## 背景

当前 Web UI 已覆盖项目、Feature、Stage、Conversation、消息、产物、Prompt、系统状态和知识中心等能力，但布局规范仍主要散落在前端实现中，缺少可供后续设计、实现和检视裁决的长期核心文档。

用户明确指出当前对话主界面底部输入区存在空间浪费：输入框下方的“发送”按钮独占一整行，而输入框与发送按钮可以同一行排放。该问题不是单个按钮样式问题，而是 Web UI 需要重新梳理信息架构、功能面与响应式布局基线。

## 目标

1. 新增一份 `docs/core` 下的 Web UI 布局核心设计文档，作为后续 UI 实现、测试和评审的长期裁决基线。
2. 梳理当前 Web UI 已有功能面，避免只针对单点按钮问题写局部方案。
3. 在文档中画出优化后的桌面、窄屏和移动端布局，而不是只用文字描述。
4. 明确对话主界面、输入区、侧栏、上下文区、Inspector、知识中心、消息与结构化内容的布局规则。
5. 暂不修改前端代码，先完成设计文档落地。

## 非目标

1. 本轮不调整 `src/web` 代码、CSS 或测试。
2. 本轮不实现新的 UI 组件或交互行为。
3. 本轮不重写消息数据模型、知识模型、stage 工作流或 API。
4. 本轮不引入图片、设计稿源文件或外部设计工具产物。

## 设计

新增 `docs/core/web-ui-layout-design.md`，定位为 Snail Shell Web UI 的核心布局设计文档。

文档将包含以下内容：

1. 文档定位、裁决范围和设计原则。
2. 当前功能面清单，覆盖项目工作区、对话、产物、Prompt Center、System State、知识中心和仓库上下文。
3. 桌面端三栏布局线框图。
4. 对话主界面线框图，重点将输入框、发送按钮和中断按钮编排到同一输入行。
5. Inspector 抽屉、知识中心、消息卡片、问题卡片和移动端布局线框图。
6. 响应式断点与布局降级规则。
7. 后续实现约束与检视检查点。

核心设计取舍：

1. 主工作区优先服务当前 conversation 的持续阅读与输入，底部 composer 只能占用必要高度。
2. 发送与中断是 composer 的行内操作，不能默认独占整行。
3. Stage、Participants、Deliverables 是上下文摘要，不应挤占消息阅读主通道。
4. Inspector 用于承载管理型、诊断型和高密度信息，避免把低频功能堆在主对话路径。
5. 移动端优先保留对话与输入闭环，项目/Feature/Conversation 导航通过后续实现中的抽屉或切换入口承载。

## 生效路径

1. `docs/core/web-ui-layout-design.md` 作为长期核心 UI 布局设计文档生效。
2. 后续修改 `src/web/ui-shell.js`、`src/web/styles.css`、`src/web/message-renderer.js`、`src/web/knowledge-center.js`、`src/web/workspace-context.js` 或相关 Web 测试时，应对照该核心文档。
3. 相关 PR 检视时，应检查实际 UI 布局是否违背该文档定义的主路径、composer、响应式和 Inspector 边界。

## 改动范围

1. 新增 `docs/features/F2026050608-ui-layout-core-doc.md`。
2. 新增 `docs/core/web-ui-layout-design.md`。

## 验证

1. 确认 feature 文档符合 `docs/README.md` 模板和编号规则。
2. 确认核心 UI 文档位于 `docs/core`，且内容不依赖本轮临时实现节奏。
3. 确认核心 UI 文档包含当前功能面清单和可读线框图。
4. 运行 `npm run build`，确认文档变更不破坏类型生成、lint 和构建。

## 风险与决策记录

当前没有未经确认的问题。

决策记录：用户已明确要求本轮先落地优化后的 UI 设计文档，暂不改代码。因此本文档把具体实现留给后续 feature，避免在设计尚未检视前直接调整前端。

## 范围变更记录

当前没有范围变更。
