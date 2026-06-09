# Snail Shell DDD 重构设计文档

## 1. 概述

### 1.1 重构目标

按照领域驱动设计（DDD）思路重构后端代码架构，实现：
- 原子模块高度内聚，私有+公开两部分组成
- 业务场景使用原子模块的公开接口
- 消除 `shared` 这种跨模块共享的"上帝模块"
- 清晰的模块边界和依赖关系

### 1.2 核心原则

1. **高内聚低耦合**：每个模块只关注自己的领域
2. **依赖倒置**：原子模块依赖接口，不依赖具体实现
3. **明确的层次**：领域层、基础设施层、业务场景层分离
4. **单一职责**：每个模块只有一个变化的理由

---

## 2. 当前架构分析

### 2.1 现有模块结构

```
src/
├── agent/              # Agent运行时适配 (23文件)
├── api-contracts/      # API契约定义 (15文件)
├── bin/                # CLI工具 (1文件)
├── evolution-center/   # 演进治理 (3文件)
├── feature-chain/      # 文档索引 (1文件)
├── interaction-entry/  # 交互入口 (21文件)
├── llm/                # LLM调用 (5文件)
├── lobby/              # IM大厅 (7文件)
├── logger/             # 日志服务 (1文件)
├── mcp/                # MCP服务 (5文件)
├── message-bus/        # 消息总线 (10文件)
├── persistence/        # 持久化层 (18文件)
├── prompt-center/      # 提示词中心 (5文件)
├── roles/              # 角色定义 (1文件)
├── shared/             # 共享类型 (11文件)
├── skill-center/       # 技能中心 (2文件)
├── snail-den/          # Agent注册中心 (2文件)
└── workspace-workflow/ # 工作流管理 (16文件)
```

### 2.2 核心问题

#### 2.2.1 上帝对象

**ConversationStore** (660行)：
- 聚合了15+个实体的CRUD
- 包含8个子store
- 违反单一职责原则

**WorkspaceManager** (510行)：
- 编排了几乎所有业务操作
- 直接依赖多个模块
- 职责过于宽泛

#### 2.2.2 边界模糊

**message-bus 和 workspace-workflow**：
- collaboration.ts (550行) 同时承担消息持久化、agent调用编排、mention路由、stage transition扫描
- 职责重叠，边界不清

#### 2.2.3 shared/ 模块问题

**职责混合**：
- 纯领域类型定义
- 通用工具函数
- 跨模块共享的"上帝模块"

**依赖混乱**：
- 被几乎所有模块依赖
- 工具函数应该就近归属使用方

#### 2.2.4 配置模块分散

**多个配置模块**：
- sop-file-utils.ts
- guard-profile-store.ts
- llm-config-store.ts
- logging-config-store.ts
- snail-den-store.ts
- feishu-config-store.ts
- wecom-config-store.ts

**问题**：
- 配置加载逻辑分散
- 缺乏统一的配置管理

### 2.3 模块依赖关系

```
shared (纯类型, 无依赖)
  ↑
persistence ──→ feature-chain
  ↑
logger ←── (被所有模块依赖)
  ↑
agent ──→ shared, persistence(类型), logger
  ↑
llm ──→ shared, persistence(类型), logger
  ↑
skill-center ──→ (仅 fs)
  ↑
snail-den ──→ agent/resolver, llm
  ↑
prompt-center ──→ shared, agent/capability, agent/guard-config, mcp/registry, roles
  ↑
evolution-center ──→ persistence/store
  ↑
message-bus ──→ shared, persistence, agent, roles, logger
  ↑
workspace-workflow ──→ shared, persistence, agent, message-bus, snail-den,
  ↑                    prompt-center, evolution-center, logger
lobby ──→ shared, persistence, workspace-workflow, interaction-entry/gateway, logger
  ↑
interaction-entry ──→ shared, workspace-workflow, message-bus, persistence,
                      prompt-center, skill-center, snail-den, mcp, lobby, agent, logger
```

---

## 3. 目标DDD架构设计

### 3.1 架构分层

```
┌─────────────────────────────────────────────────────────────┐
│                    业务场景层 (Application)                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              issue-conversation（唯一复杂场景）         │  │
│  │  编排: workspace + conversation + agent + prompt + sop  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│                    原子模块层 (Domain)                        │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │  conversation │ │   workspace  │ │     sop      │        │
│  │ 会话/消息/事件│ │ 工作区/Issue  │ │ 模板/阶段    │        │
│  │ Repository   │ │ Stage生命周期 │ │ 转移规则     │        │
│  │ (接口定义)   │ │ (接口定义)   │ │ (接口定义)   │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │agent-runtime │ │agent-capability│ │    prompt    │        │
│  │ 运行时适配   │ │ 能力声明      │ │ 提示词构建   │        │
│  │ 进程管理     │ │ 权限管理      │ │ 匹配组装     │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │     llm      │ │   evolution  │ │     mcp      │        │
│  │ LLM调用      │ │ 演进治理     │ │ MCP服务管理  │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │    skill     │ │    logger    │ │   feature    │        │
│  │ Skill注册    │ │ 日志服务     │ │ 文档索引     │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│                    基础设施层 (Infrastructure)                │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                    database                           │  │
│  │  ┌─────────────────┐ ┌─────────────────┐             │  │
│  │  │ SqliteConnection│ │ SchemaManager   │             │  │
│  │  │ (连接管理)      │ │ (迁移管理)      │             │  │
│  │  └─────────────────┘ └─────────────────┘             │  │
│  │  ┌─────────────────┐ ┌─────────────────┐             │  │
│  │  │ ConversationRepo│ │ WorkspaceRepo   │  ...        │  │
│  │  │ (接口实现)      │ │ (接口实现)      │             │  │
│  │  └─────────────────┘ └─────────────────┘             │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                    config                             │  │
│  │  ┌─────────────────┐ ┌─────────────────┐             │  │
│  │  │ FileConfigLoader│ │ ConfigValidator │             │  │
│  │  │ (文件配置加载)  │ │ (配置校验)      │             │  │
│  │  └─────────────────┘ └─────────────────┘             │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 原子模块定义

#### 3.2.1 conversation 模块

**职责**：会话、消息、事件的持久化和读取

**公开类型** (types.ts)：
```typescript
export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  created_at: string;
  updated_at: string;
}

export interface MessageEvent {
  id: string;
  message_id: string;
  kind: MessageEventKind;
  payload: MessageEventPayload;
  created_at: string;
}

export interface Conversation {
  id: string;
  stage_id: string;
  kind: ConversationKind;
  status: ConversationStatus;
  created_at: string;
  updated_at: string;
}
```

**公开方法** (repository.ts)：
```typescript
export interface ConversationRepository {
  // ═══ Message CRUD ═══
  getMessage(id: string): Promise<Message | null>;
  getMessages(conversationId: string, limit?: number): Promise<Message[]>;
  saveMessage(message: Message): Promise<void>;
  updateMessageStatus(id: string, status: MessageStatus): Promise<void>;

  // ═══ MessageEvent CRUD ═══
  getMessageEvents(messageId: string): Promise<MessageEvent[]>;
  saveMessageEvent(event: MessageEvent): Promise<void>;

  // ═══ Conversation CRUD ═══
  getConversation(id: string): Promise<Conversation | null>;
  getStageConversation(stageId: string): Promise<Conversation | null>;
  saveConversation(conversation: Conversation): Promise<void>;

  // ═══ 查询方法 ═══
  getRecentMessages(conversationId: string, limit: number): Promise<Message[]>;
  searchMessages(query: string): Promise<Message[]>;
}
```

**私有实现** (internal/sqlite-repository.ts)：
```typescript
export class SqliteConversationRepository implements ConversationRepository {
  constructor(private db: Database) {}

  async getMessage(id: string): Promise<Message | null> {
    // SQLite实现
  }

  // ... 其他实现
}
```

#### 3.2.2 workspace 模块

**职责**：工作区、Issue、Stage的生命周期管理

**公开类型** (types.ts)：
```typescript
export interface Workspace {
  id: string;
  name: string;
  summary: string | null;
  workspace_root: string;
  created_at: string;
  updated_at: string;
}

export interface Issue {
  id: string;
  workspace_id: string;
  title: string;
  summary: string | null;
  task_anchor: string | null;
  sop_snapshot: SopSnapshot;
  role_snail_mapping: Record<string, Record<string, string>>;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface Stage {
  id: string;
  issue_id: string;
  key: string;
  title: string;
  status: StageStatus;
  sequence: number;
  created_at: string;
  updated_at: string;
}
```

**公开方法** (repository.ts)：
```typescript
export interface WorkspaceRepository {
  // ═══ Workspace CRUD ═══
  getWorkspace(id: string): Promise<Workspace | null>;
  listWorkspaces(limit?: number, offset?: number): Promise<Workspace[]>;
  saveWorkspace(workspace: Workspace): Promise<void>;

  // ═══ Issue CRUD ═══
  getIssue(id: string): Promise<Issue | null>;
  listIssues(workspaceId: string): Promise<Issue[]>;
  saveIssue(issue: Issue): Promise<void>;
  updateIssue(id: string, updates: Partial<Issue>): Promise<void>;

  // ═══ Stage CRUD ═══
  getStage(id: string): Promise<Stage | null>;
  listStages(issueId: string): Promise<Stage[]>;
  saveStage(stage: Stage): Promise<void>;
  updateStageStatus(id: string, status: StageStatus): Promise<void>;

  // ═══ 查询方法 ═══
  findWorkspaceByName(name: string): Promise<Workspace | null>;
  getIssueStages(issueId: string): Promise<Stage[]>;
}
```

#### 3.2.3 sop 模块

**职责**：SOP模板、阶段定义、转移规则

**公开类型** (types.ts)：
```typescript
export interface Sop {
  id: string;
  source: "platform" | "workspace";
  source_ref: string | null;
  key: string;
  name: string;
  description: string | null;
  first_stage: string | null;
  shared_handbook: string | null;
  created_at: string;
  updated_at: string;
}

export interface SopStageDefinition {
  id: string;
  sop_id: string;
  key: string;
  title: string;
  sequence: number;
  input_description: string | null;
  output_description: string | null;
  acceptance_focus: string[];
  acceptance_checklist: StageChecklistItem[];
}

export interface SopTransition {
  id: string;
  sop_id: string;
  from_stage_key: string;
  to_stage_key: string;
  guard: TransitionGuard | null;
}
```

**公开方法** (repository.ts)：
```typescript
export interface SopRepository {
  // ═══ Sop CRUD ═══
  getSop(id: string): Promise<Sop | null>;
  getSopByKey(source: "platform" | "workspace", key: string): Promise<Sop | null>;
  listSops(source?: "platform" | "workspace"): Promise<Sop[]>;
  saveSop(sop: Sop): Promise<void>;
  deleteSop(id: string): Promise<void>;

  // ═══ SopStageDefinition CRUD ═══
  getSopStageDefinition(id: string): Promise<SopStageDefinition | null>;
  listSopStageDefinitions(sopId: string): Promise<SopStageDefinition[]>;
  saveSopStageDefinition(definition: SopStageDefinition): Promise<void>;

  // ═══ SopTransition CRUD ═══
  getSopTransitions(sopId: string): Promise<SopTransition[]>;
  getForwardTransitions(sopId: string, fromStageKey: string): Promise<SopTransition[]>;
  saveSopTransition(transition: SopTransition): Promise<void>;

  // ═══ 查询方法 ═══
  validateTransition(sopId: string, fromStageKey: string, toStageKey: string): Promise<SopTransition>;
}
```

#### 3.2.4 agent-runtime 模块

**职责**：Agent运行时适配、进程管理

**公开类型** (types.ts)：
```typescript
export interface SnailRuntime {
  readonly name: string;
  readonly runtime: AgentRuntime;

  invokeMessage(
    input: SnailRuntimeMessageInput,
    onEvent: (event: AgentEvent) => void,
    options?: AgentInvocationOptions,
  ): Promise<AgentInvocationResult>;
}

export interface AgentRuntime {
  id: string;
  name: string;
  type: "stateless" | "stateful";
}
```

**公开方法** (resolver.ts)：
```typescript
export interface RuntimeResolver {
  // ═══ 运行时解析 ═══
  resolve(runtime: string): SnailRuntime;
  list(): SnailRuntime[];
}
```

#### 3.2.5 agent-capability 模块

**职责**：Agent能力声明、权限管理

**公开类型** (types.ts)：
```typescript
export interface AgentCapability {
  systemPrompt: string;
  systemReminder: string;
  skills: SkillDefinition[];
  mcpServers: McpServerConfig[];
  hooks: HookConfig[];
  permissions: PermissionConfig;
  tools: ToolConfig[];
  subAgents: SubAgentConfig[];
  guardProfile: GuardProfile | null;
}
```

**公开方法** (builder.ts)：
```typescript
export interface CapabilityBuilder {
  // ═══ 能力构建 ═══
  build(context: CapabilityBuildContext): Promise<AgentCapability>;
}
```

#### 3.2.6 prompt 模块

**职责**：提示词构建、匹配、组装

**公开类型** (types.ts)：
```typescript
export interface PromptDocument {
  id: string;
  path: string;
  content: string;
  metadata: PromptMetadata;
}

export interface PromptMetadata {
  name: string;
  description: string;
  tags: string[];
  priority: number;
}
```

**公开方法** (builder.ts)：
```typescript
export interface PromptBuilder {
  // ═══ 提示词构建 ═══
  buildSystemPrompt(context: PromptBuildContext): Promise<string>;
  buildSystemReminder(context: PromptBuildContext): Promise<string>;

  // ═══ 查询方法 ═══
  listPrompts(): PromptDocument[];
}
```

#### 3.2.7 llm 模块

**职责**：LLM调用、摘要、mention提取

**公开类型** (types.ts)：
```typescript
export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatCompletionResponse {
  id: string;
  choices: ChatChoice[];
  usage: Usage;
}

export interface SummaryInput {
  conversationId: string;
  messages: Message[];
  targetChars: number;
}

export interface Mention {
  name: string;
  confidence: number;
}
```

**公开方法** (client.ts)：
```typescript
export interface LlmClient {
  // ═══ LLM调用 ═══
  chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;

  // ═══ 摘要生成 ═══
  generateSummary(input: SummaryInput): Promise<string>;

  // ═══ Mention提取 ═══
  extractMentions(text: string): Promise<Mention[]>;
}

export interface LlmClientFactory {
  // ═══ 客户端创建 ═══
  create(config: LlmConfig): LlmClient;
}
```

#### 3.2.8 mcp 模块

**职责**：MCP服务注册和管理

**公开类型** (types.ts)：
```typescript
export interface McpServer {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
```

**公开方法** (registry.ts)：
```typescript
export interface McpRegistry {
  // ═══ 服务注册 ═══
  registerServer(server: McpServer): void;

  // ═══ 查询方法 ═══
  getServer(name: string): McpServer | null;
  listServers(): McpServer[];
  getTools(serverName: string): McpTool[];
}
```

#### 3.2.9 skill 模块

**职责**：Skill注册和查询

**公开类型** (types.ts)：
```typescript
export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  path: string;
  content: string;
}
```

**公开方法** (registry.ts)：
```typescript
export interface SkillRegistry {
  // ═══ Skill注册 ═══
  registerSkill(skill: SkillDefinition): void;

  // ═══ 查询方法 ═══
  getSkill(id: string): SkillDefinition | null;
  listSkills(): SkillDefinition[];
}
```

#### 3.2.10 evolution 模块

**职责**：演进治理CRUD

**公开类型** (types.ts)：
```typescript
export interface EvolutionItem {
  id: string;
  conversation_id: string;
  type: EvolutionItemType;
  content: string;
  status: EvolutionItemStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateEvolutionItemInput {
  conversation_id: string;
  type: EvolutionItemType;
  content: string;
}

export interface UpdateEvolutionItemInput {
  content?: string;
  status?: EvolutionItemStatus;
}

export interface EvolutionItemListFilters {
  conversation_id?: string;
  type?: EvolutionItemType;
  status?: EvolutionItemStatus;
}
```

**公开方法** (service.ts)：
```typescript
export interface EvolutionService {
  // ═══ CRUD操作 ═══
  create(input: CreateEvolutionItemInput): Promise<EvolutionItem>;
  get(id: string): Promise<EvolutionItem | null>;
  list(filters: EvolutionItemListFilters): Promise<EvolutionItem[]>;
  update(id: string, input: UpdateEvolutionItemInput): Promise<EvolutionItem>;
}
```

#### 3.2.11 logger 模块

**职责**：日志服务

**公开类型** (types.ts)：
```typescript
export interface LoggerConfig {
  level: "debug" | "info" | "warn" | "error";
  dir: string;
  maxSize: number;
  maxFiles: number;
}
```

**公开方法** (index.ts)：
```typescript
export interface Logger {
  // ═══ 日志方法 ═══
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

// ═══ 工厂方法 ═══
export function createLogger(config: LoggerConfig): Logger;
```

#### 3.2.12 feature 模块

**职责**：文档索引

**公开类型** (types.ts)：
```typescript
export interface FeatureDocument {
  id: string;
  path: string;
  title: string;
  content: string;
  metadata: FeatureMetadata;
}

export interface FeatureMetadata {
  version: string;
  date: string;
  tags: string[];
}
```

**公开方法** (indexer.ts)：
```typescript
export interface FeatureIndexer {
  // ═══ 索引管理 ═══
  rebuildIndex(): Promise<void>;
  updateIndex(filePath: string): Promise<void>;

  // ═══ 查询方法 ═══
  search(query: string): Promise<FeatureDocument[]>;
}
```

### 3.3 基础设施层设计

#### 3.3.1 database 模块

**职责**：数据库连接管理、Schema迁移、Repository实现

**公开接口**：
```typescript
// database/types.ts
export interface DatabaseConnection {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface SchemaManager {
  migrate(): Promise<void>;
  getVersion(): Promise<number>;
}

// database/connection.ts
export interface DatabaseConnectionFactory {
  create(config: DatabaseConfig): Promise<DatabaseConnection>;
}

// database/repository.ts
export interface RepositoryFactory {
  createConversationRepo(): ConversationRepository;
  createWorkspaceRepo(): WorkspaceRepository;
  createSopRepo(): SopRepository;
  // ... 其他Repository
}
```

**实现**：
```typescript
// database/sqlite/connection.ts
export class SqliteConnection implements DatabaseConnection {
  private db: Database;

  constructor(config: DatabaseConfig) {
    this.db = new Database(config.path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.db.prepare(sql).all(...(params || [])) as T[];
  }

  async execute(sql: string, params?: unknown[]): Promise<void> {
    this.db.prepare(sql).run(...(params || []));
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const transaction = this.db.transaction(fn);
    return transaction();
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

// database/sqlite/schema.ts
export class SqliteSchemaManager implements SchemaManager {
  constructor(private connection: DatabaseConnection) {}

  async migrate(): Promise<void> {
    // 执行迁移脚本
  }

  async getVersion(): Promise<number> {
    // 获取当前版本
  }
}
```

#### 3.3.2 config 模块

**职责**：配置文件加载、校验

**公开接口**：
```typescript
// config/types.ts
export interface ConfigLoader {
  load<T>(path: string): Promise<T>;
  watch<T>(path: string, callback: (config: T) => void): void;
}

export interface ConfigValidator {
  validate<T>(config: T, schema: Schema): ValidationResult;
}

// config/loader.ts
export interface ConfigLoaderFactory {
  create(): ConfigLoader;
}
```

### 3.4 业务场景层设计

#### 3.4.1 issue-conversation 场景

**职责**：Issue对话的完整生命周期管理

**公开接口**：
```typescript
// issue-conversation/types.ts
export interface IssueConversationOrchestrator {
  sendMessage(issueId: string, content: string): Promise<SendMessageResult>;
  getHistory(issueId: string, limit?: number): Promise<Message[]>;
  getConversationStatus(issueId: string): Promise<ConversationStatus>;
}

export interface SendMessageResult {
  message: Message;
  response: Message;
  stageTransition?: StageTransition;
}

// issue-conversation/orchestrator.ts
export interface IssueConversationOrchestratorFactory {
  create(
    workspaceRepo: WorkspaceRepository,
    conversationRepo: ConversationRepository,
    agentRuntime: RuntimeResolver,
    promptBuilder: PromptBuilder,
    sopRepo: SopRepository,
  ): IssueConversationOrchestrator;
}
```

**实现**：
```typescript
// issue-conversation/orchestrator.ts
export class IssueConversationOrchestratorImpl implements IssueConversationOrchestrator {
  constructor(
    private workspaceRepo: WorkspaceRepository,
    private conversationRepo: ConversationRepository,
    private agentRuntime: RuntimeResolver,
    private promptBuilder: PromptBuilder,
    private sopRepo: SopRepository,
  ) {}

  async sendMessage(issueId: string, content: string): Promise<SendMessageResult> {
    // 1. 获取Issue和当前Stage
    const issue = await this.workspaceRepo.getIssue(issueId);
    if (!issue) throw new Error(`Issue not found: ${issueId}`);

    const stages = await this.workspaceRepo.getIssueStages(issueId);
    const currentStage = stages.find(s => s.status === "in_progress");
    if (!currentStage) throw new Error(`No active stage for issue: ${issueId}`);

    // 2. 获取或创建Conversation
    let conversation = await this.conversationRepo.getStageConversation(currentStage.id);
    if (!conversation) {
      conversation = {
        id: generateId(),
        stage_id: currentStage.id,
        kind: "discussion",
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await this.conversationRepo.saveConversation(conversation);
    }

    // 3. 保存用户消息
    const userMessage: Message = {
      id: generateId(),
      conversation_id: conversation.id,
      role: "user",
      content,
      status: "completed",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await this.conversationRepo.saveMessage(userMessage);

    // 4. 构建系统提示词
    const systemPrompt = await this.promptBuilder.buildSystemPrompt({
      issue,
      stage: currentStage,
      conversation,
    });

    // 5. 获取历史消息
    const history = await this.conversationRepo.getRecentMessages(
      conversation.id,
      10,
    );

    // 6. 调用Agent
    const runtime = this.agentRuntime.resolve("claude-code");
    const response = await runtime.invokeMessage({
      systemPrompt,
      messages: history.map(m => ({
        role: m.role,
        content: m.content,
      })),
    });

    // 7. 保存Assistant消息
    const assistantMessage: Message = {
      id: generateId(),
      conversation_id: conversation.id,
      role: "assistant",
      content: response.content,
      status: "completed",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await this.conversationRepo.saveMessage(assistantMessage);

    // 8. 检查Stage转移
    const stageTransition = await this.checkStageTransition(
      issue,
      currentStage,
      conversation,
    );

    return {
      message: userMessage,
      response: assistantMessage,
      stageTransition,
    };
  }

  private async checkStageTransition(
    issue: Issue,
    currentStage: Stage,
    conversation: Conversation,
  ): Promise<StageTransition | undefined> {
    // 检查是否需要转移Stage
    const transitions = await this.sopRepo.getForwardTransitions(
      issue.sop_snapshot.sop_id,
      currentStage.key,
    );

    for (const transition of transitions) {
      if (!transition.guard) {
        // 无条件转移
        return {
          from: currentStage.key,
          to: transition.to_stage_key,
          reason: "No guard condition",
        };
      }

      // 检查guard条件
      const isSatisfied = await this.checkGuardCondition(
        transition.guard,
        conversation,
      );

      if (isSatisfied) {
        return {
          from: currentStage.key,
          to: transition.to_stage_key,
          reason: "Guard condition satisfied",
        };
      }
    }

    return undefined;
  }

  private async checkGuardCondition(
    guard: TransitionGuard,
    conversation: Conversation,
  ): Promise<boolean> {
    // 检查guard条件
    return false;
  }
}
```

---

## 4. 实施计划

### 4.1 阶段一：基础设施层（第1-2周）

**目标**：建立数据库连接管理和配置加载

**任务**：
1. 创建 `database` 模块
   - 实现 `SqliteConnection`
   - 实现 `SchemaManager`
   - 实现 `RepositoryFactory`
2. 创建 `config` 模块
   - 实现 `ConfigLoader`
   - 实现 `ConfigValidator`
3. 迁移现有Schema到新结构

**验收标准**：
- 数据库连接正常工作
- Schema迁移成功
- 配置加载正常

### 4.2 阶段二：原子模块重构（第3-6周）

**目标**：重构各原子模块，定义公开接口

**任务**：
1. 重构 `conversation` 模块
   - 定义 `ConversationRepository` 接口
   - 实现 `SqliteConversationRepository`
   - 迁移现有代码
2. 重构 `workspace` 模块
   - 定义 `WorkspaceRepository` 接口
   - 实现 `SqliteWorkspaceRepository`
   - 迁移现有代码
3. 重构 `sop` 模块
   - 定义 `SopRepository` 接口
   - 实现 `SqliteSopRepository`
   - 迁移现有代码
4. 重构 `agent-runtime` 和 `agent-capability` 模块
   - 拆分现有 `agent` 模块
   - 定义清晰的接口
5. 重构其他原子模块
   - `llm`、`mcp`、`skill`、`evolution`、`logger`、`feature`

**验收标准**：
- 每个模块有清晰的公开接口
- 依赖关系符合DDD原则
- 现有功能正常工作

### 4.3 阶段三：业务场景层（第7-8周）

**目标**：实现issue-conversation场景

**任务**：
1. 创建 `issue-conversation` 模块
   - 实现 `IssueConversationOrchestrator`
   - 编排各原子模块
2. 重构现有 `message-bus` 和 `workspace-workflow`
   - 将业务逻辑迁移到 `issue-conversation`
   - 简化现有模块

**验收标准**：
- Issue对话功能正常
- Stage转移逻辑正确
- 性能符合要求

### 4.4 阶段四：清理和优化（第9-10周）

**目标**：清理遗留代码，优化性能

**任务**：
1. 删除 `shared` 模块
   - 将类型定义迁移到各原子模块
   - 将工具函数就近归属
2. 删除遗留代码
   - 清理不再使用的模块
   - 更新导入路径
3. 性能优化
   - 数据库查询优化
   - 缓存策略

**验收标准**：
- 代码结构清晰
- 性能符合要求
- 文档完整

---

## 5. 风险评估

### 5.1 技术风险

**风险**：重构过程中引入bug
**缓解**：
- 保持现有测试通过
- 逐步迁移，不一次性重构
- 代码审查

**风险**：性能下降
**缓解**：
- 性能测试
- 数据库查询优化
- 缓存策略

### 5.2 进度风险

**风险**：重构时间过长
**缓解**：
- 分阶段实施
- 优先重构核心模块
- 保持系统可运行

### 5.3 人员风险

**风险**：团队对DDD不熟悉
**缓解**：
- 培训DDD概念
- 代码示例
- 技术指导

---

## 6. 迁移策略

### 6.1 逐步迁移

**原则**：
- 一次只重构一个模块
- 保持现有功能正常
- 逐步替换旧代码

**步骤**：
1. 创建新模块
2. 实现新接口
3. 迁移现有代码
4. 删除旧代码

### 6.2 兼容性

**原则**：
- 新旧接口可以共存
- 逐步切换到新接口
- 不破坏现有功能

**实现**：
- 使用适配器模式
- 提供兼容层
- 逐步切换

### 6.3 测试策略

**原则**：
- 保持现有测试通过
- 为新模块编写测试
- 集成测试验证

**实现**：
- 单元测试
- 集成测试
- 端到端测试

---

## 7. 总结

本设计文档详细描述了Snail Shell后端代码的DDD重构方案，包括：

1. **当前架构分析**：识别了上帝对象、边界模糊、shared模块问题等核心问题
2. **目标架构设计**：定义了原子模块、基础设施层、业务场景层
3. **详细接口设计**：为每个原子模块定义了公开接口
4. **实施计划**：分4个阶段，10周完成
5. **风险评估**：识别了技术、进度、人员风险
6. **迁移策略**：逐步迁移、兼容性、测试策略

通过这次重构，将实现：
- 模块高度内聚，职责清晰
- 依赖关系明确，符合DDD原则
- 代码可维护性大幅提升
- 为后续功能扩展打下良好基础
