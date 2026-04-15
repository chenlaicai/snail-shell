# Snail Shell

中文 | [English](./README.en.md)

一个多智能体协作工作空间系统，通过结构化工作流编排专业 AI 智能体（"蜗牛"）之间的对话协作。

## 项目简介

Snail Shell 通过阶段化工作流（初始化 → 讨论 → 编码 → 检查 → 发布）管理项目，每个阶段都有指定的蜗牛协作产出正式交付物。

### 核心概念

- **项目与阶段**：项目按固定工作流推进，每个阶段需要产出特定的正式交付物
- **蜗牛（Snails）**：具有特定角色的 AI 智能体，包括产品、设计、实现、验收等角色
- **对话（Conversations）**：阶段内的讨论线程，蜗牛通过 `@snail_name` 互相协作
- **交付物（Artifacts）**：阶段产出的正式文档（如需求文档、设计文档、代码变更记录等）

### 技术架构

- **运行时抽象**：支持 Claude Code CLI（无状态）和 OpenCode CLI（有状态）
- **数据持久化**：SQLite 数据库，支持全文搜索（FTS5）
- **API 服务**：Express + WebSocket，提供 REST API 和实时事件流
- **智能体编排**：ProjectManager 协调多智能体协作和消息路由

## 快速开始

### 安装依赖

```bash
npm install
```

### 构建项目

```bash
npm run build
```

### 运行服务

```bash
npm start
```

服务将在 `http://localhost:3000` 启动。

### 开发命令

```bash
# 代码检查
npm run lint
npm run lint:fix

# 运行所有检查（lint + build + test）
npm run check

# 运行测试
npm run test
```

## 配置

### LLM 配置

在 `config/llm.json` 中配置 OpenAI API：

```json
{
  "provider": "openai",
  "openai": {
    "api_key": "your-api-key",
    "model": "gpt-4",
    "base_url": "https://api.openai.com/v1",
    "timeout_ms": 30000
  }
}
```

### 元数据配置

- `.meta/stages.json`：定义工作流阶段
- `.meta/snails.json`：定义智能体角色
- `.meta/artifact-types.json`：定义交付物类型

## API 使用

### 创建项目

```bash
POST /api/projects
{
  "name": "项目名称",
  "description": "项目描述"
}
```

### 发送消息

```bash
POST /api/conversations/:id/messages
{
  "snail_name": "owner",
  "parts": [
    { "type": "text", "content": "消息内容" }
  ]
}
```

### 推进阶段

```bash
POST /api/projects/:id/advance
```

### 搜索历史

```bash
GET /api/conversations/:id/history/search?query=关键词
```

## 数据库

开发数据库位于 `data/snail-shell.db`，使用 SQLite 存储所有项目、对话、消息和交付物数据。

## 项目结构

```
src/
├── agent/          # 智能体运行时适配器
├── api/            # REST API 和 WebSocket 服务
├── llm/            # OpenAI 集成
├── persistence/    # 数据库操作
├── project/        # 项目管理和协作逻辑
└── types/          # TypeScript 类型定义

.meta/              # 元数据配置
config/             # 运行时配置
tests/              # 测试文件
```

## 仓库协作

- 使用 GitHub Actions 在 `main` 和 Pull Request 上执行 `npm run check`
- 通过 Pull Request 模板统一记录改动背景、影响范围、风险点和验证方式
- 安全问题请通过 GitHub Security Advisories 私密反馈

## 文档语言规则

- `README.md` 使用中文。
- `README.en.md` 使用英文，并且内容必须与 `README.md` 保持一致。
- `CONTRIBUTING.md` 使用英文。
- `SECURITY.md` 使用英文。
- `.github/pull_request_template.md` 使用英文。
- `.github/ISSUE_TEMPLATE/*` 使用英文。
- GitHub 仓库 `About` 区域中的 Description、Homepage、Topics 使用英文。
- 需求文档、设计文档、分析文档、讨论纪要、阶段产出文档使用中文。
- `.meta/` 下的项目配置文件使用英文键名和代码约定，不额外提供中英文双份。

## License

MIT
