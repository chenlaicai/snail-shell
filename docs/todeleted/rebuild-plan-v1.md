# Snail Shell Rebuild Plan V1

## 目的

本文档定义 Snail Shell 当前阶段的重建策略。

当前项目仍处于早期阶段，因此本轮不采用兼容历史模型的迁移路线，而采用“直接重建核心模型”的方式推进。

这意味着：

1. 不背旧模型包袱
2. 不维护兼容层
3. 不做旧表迁移逻辑
4. 不继续围绕 session-centric 模型演化

## 当前重建原则

### 1. 直接以新主模型重建

本轮直接以当前已经确认的数据模型为核心：

`Project -> Stage -> Conversation -> Message -> Artifact`

### 2. 不保留旧 session 顶层语义

旧模型中的 `session` 顶层语义被移除。

新的主过程对象是 `Conversation`。

### 3. 不保留旧 requirements 特例模型

旧的 `requirements` 独立模型被移除。

需求文档、需求相关记录统一并入 `Artifact`。

### 4. 不保留旧 API 兼容层

旧的 `/api/sessions/*` 等兼容接口不继续保留。

新的 API 直接围绕新主模型建立。

### 5. 不保留旧数据库迁移逻辑

当前阶段不再为历史数据库做兼容迁移。

旧 schema 可以直接清理，新的 schema 按新模型重建。

### 6. 知识文档保留

`docs/` 与 `docs/evolution/` 下当前已经形成的文档属于当前阶段的重要知识产物，应继续保留。

### 7. skills 只保留必要部分

如果现有 `skills` 与旧模型强耦合，则按新模型一起重构；如果暂时不需要，则可先简化保留最小骨架。

## 明确移除范围

本轮默认移除以下历史包袱：

1. 旧 `session` 顶层建模
2. 旧 `requirements` 专用表与专用 API
3. 旧的会话兼容接口
4. 旧的 schema migration 逻辑
5. 只为了兼容旧模型而存在的中间状态代码

## 明确保留范围

本轮默认保留以下内容：

1. `docs/` 下的蓝图文档
2. `docs/evolution/` 下的知识体系文档
3. 基础 agent 接口与流式能力
4. WebSocket 基础能力
5. 现有项目中仍适合新模型的通用工具代码

## 新核心模型

本轮重建以以下模型为准：

1. `Project`
   最外层工作容器

2. `Stage`
   project 的真实阶段实例链

3. `Conversation`
   stage 下的具体工作过程

4. `Message`
   conversation 内部消息流

5. `Artifact`
   conversation 产出的统一产物对象

## 第一版重建目标

本轮重建结束后，系统至少应满足：

1. project 是唯一顶层入口
2. stage 是 project 下的固定类型阶段链实例
3. conversation 是 stage 下的主工作对象
4. artifact 是统一产物对象
5. UI 保持左 project/conversation，中间对话，右 stage/artifact/review

## 重建顺序

建议按以下顺序执行：

### Step 1. 重建 persistence schema

直接删除旧模型依赖，重建以下主表：

1. `projects`
2. `stages`
3. `conversations`
4. `messages`
5. `artifacts`

### Step 2. 重建 manager 层

围绕新模型重写业务管理逻辑：

1. create project
2. create stage chain
3. create conversation
4. send message
5. create artifact
6. review and stage progression

### Step 3. 重建 API

删除旧 session-centric 接口，改成：

1. `/api/projects`
2. `/api/projects/:projectId/stages`
3. `/api/stages/:stageId/conversations`
4. `/api/conversations/:conversationId/messages`
5. `/api/stages/:stageId/artifacts`

### Step 4. 重建前端数据流

前端改为完全围绕新模型读取数据，不再兼容旧 session 数据流。

### Step 5. 重建测试

旧测试如果建立在旧模型上，则直接删除或重写。

测试目标应直接覆盖新主模型。

## Stage 的实现方向

当前阶段中，stage 不是固定定义表，而是 project 的真实阶段实例链。

这意味着：

1. 同一 `type` 可以在一个 project 中出现多次
2. `sequence` 表示真实推进顺序
3. `formal_artifacts` 保存该 stage 最终被认定为正式交付物的 artifact ids

## Artifact 的实现方向

Artifact 是统一产物。

这里不再单独维护：

1. `documents` 表
2. `commits` 表
3. `requirements` 表

这些都统一通过 `artifact_type` 来表达。

## 风险与接受点

这种“直接重建”方式的代价是：

1. 旧数据不做自动兼容
2. 当前已有旧运行数据可以直接忽略
3. 某些旧功能可能会被主动删除后再重新实现

但当前阶段接受这个代价，因为：

1. 项目仍在早期
2. 当前更重要的是把主模型一次性做正确
3. 继续兼容旧模型只会拖慢后续演进

## 一句话总结

本轮采用的是：

`保留知识产物，删除旧模型包袱，围绕新主模型直接重建系统`
