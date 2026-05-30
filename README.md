# Snail Shell

中文 | [English](./README.en.md)

Snail Shell 是一个多智能体协作工作空间系统，通过结构化工作流编排专业职责角色，并由 Snail Den 中的 runtime 承担实际执行。

## 项目概览

Snail Shell 通过阶段化工作流（初始化 -> 讨论 -> 编码 -> 检查 -> 发布）管理项目。每个阶段都有指定的角色协作产出正式交付物。

### 核心概念

- **项目与阶段**：项目按固定工作流推进，每个阶段都需要产出特定的正式交付物。
- **角色（Roles）**：项目管理工作流中的职责身份，包括产品、设计、实现和验收等角色。
- **蜗牛（Snails）**：Snail Den 中包装 agent runtime 与 model 的实际运行承担者。
- **对话（Conversations）**：阶段内的讨论线程，角色通过 `@<Role Name>` 提及互相协作，`Role Name` 是消息路由中的唯一职责标识。
- **交付物（Artifacts）**：正式交付物，例如需求文档、设计文档和代码变更记录。

### 技术架构

- **运行时抽象**：支持 Claude Code CLI（无状态）和 OpenCode CLI（有状态）。
- **数据持久化**：使用 SQLite，并通过 FTS5 提供全文搜索能力。
- **API 服务**：使用 Express + WebSocket 提供 REST API 和实时智能体事件。
- **智能体编排**：`ProjectManager` 负责协调多智能体协作和消息路由。

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
# lint
npm run lint
npm run lint:fix

# 运行所有检查（lint + build + test）
npm run check

# 运行测试
npm run test
```

## 配置

### LLM 配置

在 `config/llm.json` 中配置 OpenAI：

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

- `.meta/stages.json`：定义工作流阶段。
- `.meta/roles.json`：定义工作流职责角色，其中 JSON key 就是每个 role 的唯一 name。
- `.meta/snails.json`：定义 Snail Den 运行承担者，其中 JSON key 就是每个 snail 的唯一 name。
- `.meta/artifact-types.json`：定义交付物类型。

## API 使用

### 创建工作区

```bash
POST /api/workspaces
{
  "name": "工作区名称",
  "description": "工作区描述"
}
```

### 发送消息

注意：消息 API 现已切换到统一的 `kind + payload` part 模型，旧的 `{ part_type, text_value, json_value, mentions }` 输入格式不再接受。

```bash
POST /api/conversations/:id/messages
{
  "from_role": "Boss Role",
  "parts": [
    {
      "kind": "result",
      "payload": {
        "format": "structured",
        "content": "请 @Product Role 跟进",
        "mentions": ["Product Role"]
      }
    }
  ]
}
```

### 推进阶段

```bash
POST /api/workspaces/:id/advance
```

### 搜索历史

```bash
GET /api/conversations/:id/history/search?query=关键词
```

## 数据库

开发数据库位于 `data/snail-shell.db`，使用 SQLite 存储工作区、对话、消息和交付物数据。

## 项目结构

```text
src/
├── agent/          # AI 智能体运行时适配器
├── api/            # REST API 和 WebSocket 服务
├── llm/            # OpenAI 集成
├── persistence/    # 数据库操作
├── workspace/      # 工作区管理和协作逻辑
└── types/          # TypeScript 类型定义

.meta/              # 元数据配置
config/             # 运行时配置
tests/              # 测试
```

## 仓库协作

- GitHub Actions 会在 `main` 和 Pull Request 上执行 `npm run check`。
- Pull Request 模板会统一记录改动背景、影响范围、风险点和验证方式。
- 安全问题应通过 GitHub Security Advisories 私密反馈。

## 文档语言规则

- `README.md` 使用中文。
- `README.en.md` 使用英文，并且必须与 `README.md` 保持一致。
- `CONTRIBUTING.md` 使用英文。
- `SECURITY.md` 使用英文。
- `.github/pull_request_template.md` 使用英文。
- `.github/ISSUE_TEMPLATE/*` 使用英文。
- GitHub 仓库 `About` 区域中的 Description、Homepage 和 Topics 使用英文。
- 需求文档、设计文档、分析文档、讨论纪要和阶段产出文档使用中文。
- `.meta/` 下的文件仅使用英文键名和面向代码的约定，不额外提供中英文双份。

## License

MIT
