# Architecture Decisions

## 1. 严禁创建 shared 这种上帝类

**决策**: 禁止创建 `shared/` 这种大而全的共享模块。

**原因**:
- 上帝类导致所有模块都依赖它，违反单一职责
- 类型修改影响范围不可控，牵一发动全身
- 阻碍模块独立演进和测试

**做法**:
- 类型定义在使用它的模块内（如 `workspace/model.ts`）
- 多模块共用的类型，明确归属到某个模块，其他模块依赖该模块
- 工具函数同理，跟随业务归属，不搞大杂烩

## 2. 六边形架构：端口-适配器模式

**决策**: 每个 domain 模块采用端口-适配器模式。

**结构**:
```
domain/xxx/
├── model.ts              # 结构体定义（对外）
├── port.ts               # 端口（接口定义）
└── _internal/
    ├── repository.ts     # 持久层接口 + 实现类（内部）
    └── adapter.ts        # 适配器 + 工厂函数（内部）
```

**职责**:
- `model.ts`：对外暴露结构体（PromptDocument, Skill, Sop 等）
- `port.ts`：对外暴露接口（TenetPrompt, SkillPort, SopPort 等）
- `_internal/repository.ts`：持久层接口 + 实现类（注入 infra）
- `_internal/adapter.ts`：适配器实现业务逻辑 + 工厂函数

**原则**:
- 对外只暴露契约（结构体 + 接口）
- 实现细节封装在 `_internal/` 中
- main 负责组装：创建 repository → 创建 adapter → 注入依赖

## 3. 路径封装

**决策**: repository 只接收 `repoRoot`，自己拼接内部路径。

**做法**:
- `FileWorkspaceRepository(fileSystem, repoRoot)` → 内部拼接 `config/workspaces.json`
- `FileTenetPromptRepository(fileSystem, repoRoot, workspacePaths)` → 内部拼接 `.meta/prompts/`
- main 不感知模块内部路径细节

## 4. 基础设施层（infra）

**决策**: infra 只提供通用技术能力，不包含业务逻辑。

**结构**:
```
infra/
├── file-system.ts       # 文件读写（readFile, writeJson, listDir 等）
├── database.ts          # SQLite 操作（run, get, all, transaction）
└── index.ts             # 导出桶文件
```

**职责**:
- `FileSystem`：文件读写、目录操作、JSON 解析
- `SQLiteDatabase`：SQL 执行、事务管理、表结构初始化

**原则**:
- infra 不知道业务语义，只提供技术能力
- domain repository 注入 infra 完成具体实现
- infra 可被多个 domain 模块复用

## 5. Path Aliases

**决策**: 使用 TypeScript path aliases 避免相对路径。

**配置**:
```json
{
  "baseUrl": ".",
  "paths": {
    "@domain/*": ["src/domain/*"],
    "@infra/*": ["src/infra/*"],
    "@app/*": ["src/app/*"]
  }
}
```

**用法**:
```typescript
import { WorkspaceAdapter } from "@domain/workspace/_internal/adapter";
import { FileSystem } from "@infra/file-system";
```

**好处**:
- 避免 `../../` 相对路径，重构目录时不易出错
- import 路径清晰表达模块归属

## 6. _internal 私有性约束

**决策**: 使用 ESLint 强制 `_internal` 目录的私有性。

**规则**:
- 每个 domain 模块只能 import 自己的 `_internal`
- 跨模块 import `_internal` 会被 ESLint 阻止
- `main.ts` 例外（组装层，需要 import 所有适配器）

## 7. 初始化分离：adapter.ts + initor.ts

**决策**: 业务逻辑与初始化职责分离。

**结构**:
```
domain/xxx/
├── model.ts
├── port.ts
└── _internal/
    ├── repository.ts
    ├── adapter.ts        # 适配器（业务逻辑）
    └── initor.ts         # 初始化（依赖组装）
```

**adapter.ts**:
```typescript
export class WorkspaceAdapter implements WorkspacePort {
  constructor(private repo: WorkspaceRepository) {}
  // 业务逻辑方法...
}
```

**initor.ts**:
```typescript
export function init(fs: FileSystem, repoRoot: string) {
  const repo = new FileWorkspaceRepository(fs, repoRoot);
  const adapter = new WorkspaceAdapter(repo);
  return { repo, adapter };
}
```

**main.ts**:
```typescript
import { init as initWorkspace } from "@domain/workspace/_internal/initor";
const workspace = initWorkspace(fs, repoRoot);
```

**好处**:
- adapter 只关心业务逻辑
- initor 只关心依赖组装
- 职责清晰，易于维护

## 8. App 层：跨模块业务编排

**决策**: 跨模块业务场景放在 `app/` 层，不放在 `domain/` 层。

**结构**:
```
src/
├── domain/              # 领域层（原子模块）
├── infra/               # 基础设施层
└── app/                 # 应用层（跨模块编排）
    └── evolution-governance.ts
```

**职责**:
- `domain/`：单模块业务逻辑，不依赖其他 domain
- `app/`：跨模块业务编排，依赖多个 domain adapter

**示例**:
```typescript
// app/evolution-governance.ts
export class EvolutionGovernance {
  constructor(
    private evolutionAdapter: EvolutionAdapter,
    private issueAdapter: IssueAdapter,
    private imAdapter: IMAdapter,
    private sopAdapter: SopAdapter,
  ) {}

  createGovernancePipeline(input: GovernanceInput): GovernanceOutput {
    // 编排：创建 evolution_item + issue + stage + conversation
  }
}
```

**好处**:
- domain 模块职责单一，不依赖其他 domain
- 跨模块业务逻辑集中在 app 层，易于理解和维护
- 依赖方向清晰：app → domain → infra

## 9. 增量开发：先骨架后血肉

**决策**: 先实现读取+缓存，业务使用时再按需补齐。

**当前阶段**:
- workspace：读取 `workspaces.json` → 缓存
- tenet-prompt：读取 `.meta/prompts/*.md` → 缓存
- skill：读取 `.meta/skills/*/SKILL.md` → 缓存
- sop：读取 `config/sop/*/*.yaml` → 缓存

**原则**:
- 不提前设计"未来可能需要"的功能
- 在 `issue-conversation` 实际使用时，再补齐写入、更新等功能
- 一点点做起，而不是全量迁移

## 10. 环境变量 Key 管理

**决策**: 统一管理 snail 注入到 agent 进程的环境变量 key。

**定义**:
```typescript
// domain/acs/context-keys.ts
export const CONTEXT_KEYS = {
  WORKSPACE_PATH: "SNAIL_CTX_WORKSPACE_PATH",
  ISSUE_ID: "SNAIL_CTX_ISSUE_ID",
  CONVERSATION_ID: "SNAIL_CTX_CONVERSATION_ID",
  STAGE_ID: "SNAIL_CTX_STAGE_ID",
} as const;
```

**使用**:
- skill 脚本通过 `process.env[CONTEXT_KEYS.WORKSPACE_PATH]` 获取

**好处**:
- 统一管理，避免硬编码
- 易于维护和扩展
