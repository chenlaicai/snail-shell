# F2026050608 UI 布局核心设计文档落地

## 背景

当前 Web UI 已覆盖项目、Feature、Stage、Conversation、消息、产物、Prompt、系统状态和知识中心等能力，但布局规范仍主要散落在前端实现中，缺少可供后续设计、实现和检视裁决的长期核心文档。

用户明确指出当前对话主界面底部输入区存在空间浪费：输入框下方的“发送”按钮独占一整行，而输入框与发送按钮可以同一行排放。该问题不是单个按钮样式问题，而是 Web UI 需要重新梳理信息架构、功能面与响应式布局基线。

## 目标

1. 新增一份 `docs/core` 下的 Web UI 布局核心设计文档，作为后续 UI 实现、测试和评审的长期裁决基线。
2. 梳理当前 Web UI 已有功能面，避免只针对单点按钮问题写局部方案。
3. 在文档中画出优化后的桌面 Web 布局，而不是只用文字描述。
4. 明确一级导航、Workspace、Knowledge、Governance、对话画布、输入区、对象栏、详情面板、产物归属、消息与结构化内容的布局规则。
5. 暂不修改前端代码，先完成设计文档落地。

## 非目标

1. 本轮不调整 `src/web` 代码、CSS 或测试。
2. 本轮不实现新的 UI 组件或交互行为。
3. 本轮不重写消息数据模型、知识模型、stage 工作流或 API。
4. 本轮不引入图片、设计稿源文件或外部设计工具产物。
5. 本轮不设计或实现移动端专属 UI；现有代码中的小屏 `@media` 只作为兼容事实记录，不作为本 feature 的目标。

## 设计

新增 `docs/core/web-ui-layout-design.md`，定位为 Snail Shell Web UI 的核心布局设计文档。

文档将包含以下内容：

1. 文档定位、裁决范围和设计原则。
2. 当前功能面清单，覆盖项目工作区、对话、产物、Prompt Center、System State、知识中心和仓库上下文。
3. 跳出现有三栏实现的新版桌面布局线框图。
4. 顶部一级导航、Context Bar、对象栏、中央对话画布和按需 Detail Panel 的分层规则。
5. 对话主界面线框图，重点将输入框、发送按钮和中断按钮编排到同一输入行。
6. Knowledge 与 Governance 作为一级工作区的布局线框图，并明确 Governance 不承载当前 Feature/Stage 的产物链路。
7. 窄屏兼容边界说明，但不把移动端专属设计纳入本轮目标。
8. 后续实现约束与检视检查点。

核心设计取舍：

1. 一级功能横向分层：`Workspace`、`Knowledge`、`Governance` 进入顶部全局导航，不继续堆叠在左侧栏中段。
2. 工作流对象纵向分层：Project、Feature、Stage、Conversation 只属于 Workspace 内部对象栏。
3. 主工作区优先服务当前 conversation 的持续阅读与输入，底部 composer 只能占用必要高度。
4. 发送与中断是 composer 的行内操作，不能默认独占整行。
5. 顶部中间区域应承载一级导航、当前位置、状态和关键动作，避免空白和重复 workspace 信息。
6. 右侧不常驻低价值摘要，改为 Workspace 内按需 Detail Panel 承载 Feature、Stage、Deliverables、Message 等详情。
7. Deliverables/Artifacts 是当前 Feature/Stage 的正式交付链路，不能归入全局 Governance 一级菜单。

## 生效路径

1. `docs/core/web-ui-layout-design.md` 作为长期核心 UI 布局设计文档生效。
2. 后续修改 `src/web/ui-shell.js`、`src/web/styles.css`、`src/web/message-renderer.js`、`src/web/knowledge-center.js`、`src/web/workspace-context.js` 或相关 Web 测试时，应对照该核心文档。
3. 相关 PR 检视时，应检查实际 UI 布局是否违背该文档定义的一级导航、功能分层、空间利用、去冗余、composer、产物归属和 Detail Panel 边界。

## 改动范围

1. 新增 `docs/features/F2026050608-ui-layout-core-doc.md`。
2. 新增 `docs/core/web-ui-layout-design.md`。

## 验证

1. 确认 feature 文档符合 `docs/README.md` 模板和编号规则。
2. 确认核心 UI 文档位于 `docs/core`，且内容不依赖本轮临时实现节奏。
3. 确认核心 UI 文档包含当前功能面清单、功能分层和可读线框图。
4. 运行 `npm run build`，确认文档变更不破坏类型生成、lint 和构建。

## 风险与决策记录

当前没有未经确认的问题。

决策记录：用户已明确要求本轮先落地优化后的 UI 设计文档，暂不改代码。因此本文档把具体实现留给后续 feature，避免在设计尚未检视前直接调整前端。

决策记录：用户进一步澄清，本轮不应把移动端作为目标；文档中如提到小屏，只能作为现有代码兼容事实或后续边界说明。用户还要求跳出现有 UI 布局，重点提升空间利用率、减少重复信息并强化功能分层，因此核心文档从“三栏现状优化”调整为“顶部一级导航 + Workspace 对象栏 + 中央对话画布 + 按需 Detail Panel + Knowledge/Governance 一级工作区”的新版方案。

决策记录：用户指出产物应与当前 Feature 强绑定，不应归入 Governance 一级菜单。经确认，Deliverables/Artifacts 属于当前 Feature/Stage 的正式交付链路，应放在 Workspace 的 Feature/Stage Detail Panel 中；Governance 只承载跨 feature 的 Prompt、System State、Runtime、配置和诊断能力。

## 范围变更记录

1. 用户反馈后确认移动端不是本轮目标；范围从“桌面、窄屏和移动端布局”调整为“桌面 Web 核心布局 + 窄屏兼容边界”，并明确移动端专属 UI 为非目标。
2. 用户反馈后确认不能只保持当前 UI 布局做局部优化；范围从“当前三栏布局优化”调整为“跳出现状的信息架构重编排”，新增顶部一级导航、Context Bar、Knowledge/Governance 一级工作区和按需 Detail Panel 的设计要求。
3. 用户反馈后确认 Deliverables/Artifacts 不能归入 Governance；范围补充产物归属约束，将产物管理固定在 Workspace 的 Feature/Stage Detail Panel，Governance 收窄为跨 feature 治理与诊断工作区。
