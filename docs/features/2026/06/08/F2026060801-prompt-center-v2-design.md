# Prompt Center v2 设计文档

> 2026-06-08 | 范围：Prompt 文件加载与组装（原则类通用 prompt → systemPrompt）

## 一、V1 现状分析

### 1.1 当前职责

`prompt-center/registry.ts` 负责：
1. 从 `.meta/prompts/prompts/*.md` 发现并加载 prompt 文件
2. 解析 YAML frontmatter（id, title, layer, priority, when, stability）
3. When 条件匹配（runtime, stageType, roleName, conversationKind, ownerType）
4. 模板变量渲染（`{{variable}}` 替换）
5. 按 layer + priority 排序
6. 按 stability 分层组装（static → systemPrompt，dynamic → systemReminder）
7. 数量校验（3+3 架构上限）

### 1.2 问题

| 问题 | 描述 |
|------|------|
| 模块级副作用 | `const prompts = buildRegistry()` 在 import 时立即执行磁盘 I/O |
| 硬编码路径 | `path.join(process.cwd(), ".meta", "prompts")` 写死 |
| 职责混合 | 文件发现、解析、匹配、渲染、组装全在一个函数链里 |
| 不可测试 | 无法 mock 路径，无法独立测试各环节 |

---

## 二、优化方向

### 2.1 继承什么

- **Frontmatter 格式**：保持 `id, title, layer, priority, when` 字段（去掉 stability）
- **When 匹配逻辑**：只保留 runtime 维度（当前只有 B-03 使用 when，且只用 runtimes）
- **排序规则**：layer 优先级（sop > workspace > platform）+ priority 数值
- **数量校验**：3+3 架构上限

### 2.2 优化什么

| 优化点 | v1 | v2 |
|--------|----|----|
| 初始化时机 | import 时立即 I/O | 启动时绑定 |
| 路径配置 | 硬编码 `process.cwd()` | 启动时注入 |
| 职责分离 | 一个函数链 | Loader + Matcher + Assembler 三个类 |
| 接口复杂度 | 多个方法 + 多个参数 | 单一方法 `getSystemPrompt` |
| stability | 区分 static/dynamic | 只加载 static，不需要 stability 字段 |
| 模板变量 | 支持 `{{variable}}` | 当前 static prompt 无模板变量，移除 |

---

## 三、代码设计

### 3.1 目录结构

```
prompt-center/
├── api.ts                 # 公共 API — 接口 + 启动绑定
├── types.ts               # 类型定义
└── _internal/
    ├── loader.ts          # 文件发现 + Frontmatter 解析
    ├── matcher.ts         # When 条件匹配（只匹配 runtime）
    └── assembler.ts       # 排序 + 拼接
```

### 3.2 类型定义 (`types.ts`)

```typescript
import type { AgentRuntime } from "@/shared/types.js";

/** Prompt 来源层级 */
export type PromptLayer = "platform" | "sop" | "workspace";

/** When 条件匹配规则 */
export interface PromptWhen {
  runtimes?: AgentRuntime[];
}

/** Prompt 文档（解析后） */
export interface PromptDocument {
  id: string;
  title: string;
  layer: PromptLayer;
  priority: number;
  when?: PromptWhen;
  content: string;
  filePath: string;
}
```

### 3.3 公共 API (`api.ts`)

```typescript
/**
 * Prompt Center 域公开 API — 接口层 + 启动绑定。
 *
 * 调用方只 import 本文件，不关心实现细节。
 * 实现在 _internal/ 目录，启动时通过 bootstrapPromptCenter() 绑定。
 */

import type { AgentRuntime } from "@/shared/types.js";
import type { PromptDocument } from "./types.js";

// ═══════════════════════════════════════════════════════════
// PromptService — Prompt 域服务接口
// ═══════════════════════════════════════════════════════════

/** Prompt 域服务接口 */
export interface PromptService {
  /**
   * 提供系统提示词。
   *
   * 内部流程：
   * 1. 加载平台级 prompt（<platformPromptsDir>/*.md）
   * 2. 加载 workspace 级 prompt（<workspaceRoot>/.snail/prompts/*.md，可选）
   * 3. When 条件匹配（按 runtime 过滤）
   * 4. 按 layer + priority 排序
   * 5. 拼接返回
   *
   * @param runtime 当前 agent runtime（用于 When 匹配）
   * @param workspaceRoot workspace 根路径（可选，用于加载 workspace 级 prompt）
   */
  getSystemPrompt(runtime: AgentRuntime, workspaceRoot?: string): string;
}

// ═══════════════════════════════════════════════════════════
// Service 实例管理
// ═══════════════════════════════════════════════════════════

let _instance: PromptService | null = null;

/** 获取 PromptService 实例（启动时必须调用 bootstrapPromptCenter） */
export function getPromptService(): PromptService {
  if (!_instance) {
    throw new Error("PromptService 未初始化，请在启动时调用 bootstrapPromptCenter()");
  }
  return _instance;
}

// ═══════════════════════════════════════════════════════════
// 启动绑定
// ═══════════════════════════════════════════════════════════

/** 启动配置 */
export interface PromptCenterBootstrapConfig {
  /** 平台级 prompt 目录（绝对路径） */
  platformPromptsDir: string;
}

/**
 * 初始化 Prompt Center。
 * 在应用启动时调用一次。
 */
export function bootstrapPromptCenter(config: PromptCenterBootstrapConfig): void {
  const { PromptLoader } = require("./_internal/loader.js");
  const { PromptMatcher } = require("./_internal/matcher.js");
  const { PromptAssembler } = require("./_internal/assembler.js");

  const loader = new PromptLoader({ platformDir: config.platformPromptsDir });
  const matcher = new PromptMatcher();
  const assembler = new PromptAssembler();

  _instance = {
    getSystemPrompt: (runtime, workspaceRoot) => {
      const platformPrompts = loader.load();
      const workspacePrompts = workspaceRoot ? loader.loadWorkspace(workspaceRoot) : [];
      const allPrompts = assembler.merge(platformPrompts, workspacePrompts);
      const matched = matcher.filter(allPrompts, runtime);
      return assembler.assemble(matched);
    },
  };
}

// ═══════════════════════════════════════════════════════════
// 类型再导出（调用方便利）
// ═══════════════════════════════════════════════════════════

export type {
  PromptDocument,
  PromptWhen,
  PromptLayer,
};
```

### 3.4 实现层 (`_internal/loader.ts`)

```typescript
import type { PromptDocument, PromptLayer, PromptWhen } from "../types.js";
import fs from "fs";
import path from "path";
import yaml from "yaml";

/** Loader 配置 */
export interface PromptLoaderConfig {
  /** 平台级 prompt 目录（绝对路径） */
  platformDir: string;
}

/**
 * Prompt 文件加载器（内部实现）。
 *
 * 职责：
 * 1. 从指定目录发现 .md 文件
 * 2. 解析 YAML frontmatter + Markdown body
 * 3. 返回 PromptDocument[]
 *
 * 注意：只加载 stability: "static" 的 prompt，其他自动跳过。
 */
export class PromptLoader {
  private platformCache: PromptDocument[] | null = null;
  private readonly config: PromptLoaderConfig;

  constructor(config: PromptLoaderConfig) {
    this.config = config;
  }

  /** 加载平台级 prompt 文件（带缓存） */
  load(): PromptDocument[] {
    if (!this.platformCache) {
      this.platformCache = this.loadFromDir(this.config.platformDir);
    }
    return this.platformCache;
  }

  /** 加载 workspace 级 prompt 文件 */
  loadWorkspace(workspaceRoot: string): PromptDocument[] {
    const workspaceDir = path.join(workspaceRoot, ".snail", "prompts");
    return this.loadFromDir(workspaceDir);
  }

  /** 从指定目录加载 prompt 文件 */
  private loadFromDir(dir: string): PromptDocument[] {
    if (!fs.existsSync(dir)) return [];

    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith(".md") && !f.startsWith("_template") && !f.endsWith(".template.md"))
      .map(f => path.join(dir, f));

    const prompts: PromptDocument[] = [];

    for (const filePath of files) {
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const doc = this.parseFile(filePath, raw);
        if (doc) prompts.push(doc);
      } catch (err) {
        console.warn(`[PromptLoader] 读取失败 ${filePath}: ${(err as Error).message}`);
      }
    }

    return prompts;
  }

  /** 解析单个文件（只返回 stability: "static" 的 prompt） */
  parseFile(filePath: string, raw: string): PromptDocument | null {
    try {
      const { head, body } = splitFrontmatter(raw);
      const meta = parseFrontmatter(head);

      // 只保留 static 的 prompt
      if (meta.stability && meta.stability !== "static") {
        return null;
      }

      return {
        id: meta.id,
        title: meta.title,
        layer: meta.layer ?? "platform",
        priority: meta.priority ?? 100,
        when: meta.when,
        content: body.trim(),
        filePath,
      };
    } catch (err) {
      console.warn(`[PromptLoader] 跳过 ${filePath}: ${(err as Error).message}`);
      return null;
    }
  }
}

function splitFrontmatter(raw: string): { head: string; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error("缺少 frontmatter");
  return { head: match[1], body: match[2] };
}

function parseFrontmatter(yamlStr: string): {
  id: string;
  title: string;
  layer?: PromptLayer;
  priority?: number;
  when?: PromptWhen;
  stability?: "static" | "dynamic";
} {
  const parsed = yaml.parse(yamlStr);
  if (!parsed.id || !parsed.title) throw new Error("frontmatter 缺少 id 或 title");
  return parsed;
}
```

### 3.5 实现层 (`_internal/matcher.ts`)

```typescript
import type { PromptDocument, PromptWhen } from "../types.js";
import type { AgentRuntime } from "@/shared/types.js";

/**
 * When 条件匹配器（内部实现）。
 *
 * 只匹配 runtime 维度。
 */
export class PromptMatcher {
  /** 过滤出匹配当前 runtime 的 prompt */
  filter(prompts: PromptDocument[], runtime: AgentRuntime): PromptDocument[] {
    return prompts.filter(p => this.matches(p, runtime));
  }

  /** 判断单个 prompt 是否匹配 */
  private matches(doc: PromptDocument, runtime: AgentRuntime): boolean {
    if (!doc.when) return true;
    return matchesWhen(doc.when, runtime);
  }
}

function matchesWhen(when: PromptWhen, runtime: AgentRuntime): boolean {
  if (when.runtimes?.length && !when.runtimes.includes(runtime)) return false;
  return true;
}
```

### 3.6 实现层 (`_internal/assembler.ts`)

```typescript
import type { PromptDocument, PromptLayer } from "../types.js";

/** Assembler 配置 */
export interface AssemblerConfig {
  layerOrder?: Record<PromptLayer, number>;
  limits?: { maxPlatform?: number; maxSop?: number; maxTotal?: number };
}

/**
 * Prompt 组装器（内部实现）。
 *
 * 职责：
 * 1. 合并全局和 workspace prompt（同 id 覆盖）
 * 2. 按 layer + priority 排序
 * 3. 数量校验
 * 4. 拼接返回
 */
export class PromptAssembler {
  private readonly config: Required<{
    layerOrder: Record<PromptLayer, number>;
    limits: { maxPlatform: number; maxSop: number; maxTotal: number };
  }>;

  constructor(config?: AssemblerConfig) {
    this.config = {
      layerOrder: config?.layerOrder ?? { sop: 0, workspace: 1, platform: 2 },
      limits: {
        maxPlatform: config?.limits?.maxPlatform ?? 6,
        maxSop: config?.limits?.maxSop ?? 3,
        maxTotal: config?.limits?.maxTotal ?? 6,
      },
    };
  }

  /** 合并全局和 workspace prompt，同 id 覆盖 */
  merge(global: PromptDocument[], workspace: PromptDocument[]): PromptDocument[] {
    const map = new Map<string, PromptDocument>();
    for (const p of global) map.set(p.id, p);
    for (const p of workspace) map.set(p.id, p);
    return Array.from(map.values());
  }

  /** 排序 + 数量校验 + 拼接 */
  assemble(prompts: PromptDocument[]): string {
    const sorted = this.sort(prompts);
    this.validateLimits(sorted);
    return sorted.map(p => p.content).join("\n\n");
  }

  /** 按 layer 优先级 + priority 排序 */
  private sort(prompts: PromptDocument[]): PromptDocument[] {
    return [...prompts].sort((a, b) => {
      const layerDiff = this.config.layerOrder[a.layer] - this.config.layerOrder[b.layer];
      if (layerDiff !== 0) return layerDiff;
      return a.priority - b.priority;
    });
  }

  /** 数量校验（warn 但不阻断） */
  private validateLimits(prompts: PromptDocument[]): void {
    const counts = { platform: 0, sop: 0, workspace: 0 };
    for (const p of prompts) counts[p.layer]++;

    if (counts.platform > this.config.limits.maxPlatform) {
      console.warn(`[PromptAssembler] platform prompt 数量 (${counts.platform}) 超过上限 (${this.config.limits.maxPlatform})`);
    }
    if (counts.sop > this.config.limits.maxSop) {
      console.warn(`[PromptAssembler] sop prompt 数量 (${counts.sop}) 超过上限 (${this.config.limits.maxSop})`);
    }
    if (prompts.length > this.config.limits.maxTotal) {
      console.warn(`[PromptAssembler] 总 prompt 数量 (${prompts.length}) 超过上限 (${this.config.limits.maxTotal})`);
    }
  }
}
```

---

## 四、使用示例

### 4.1 应用启动

```typescript
// main.ts 或 startup.ts
import { bootstrapPromptCenter } from "@/prompt-center/api.js";

bootstrapPromptCenter({
  platformPromptsDir: path.join(process.cwd(), ".meta", "prompts", "prompts"),
});
```

### 4.2 运行时调用

```typescript
import { getPromptService } from "@/prompt-center/api.js";

const systemPrompt = getPromptService().getSystemPrompt(
  "claude-code-cli",           // runtime
  "/path/to/workspace",        // workspaceRoot（可选）
);
```

---

## 五、迁移步骤

1. **创建目录结构**：`prompt-center/api.ts`、`prompt-center/types.ts`、`prompt-center/_internal/`
2. **实现内部类**：从 v1 `registry.ts` 提取逻辑到 `_internal/loader.ts`、`_internal/matcher.ts`、`_internal/assembler.ts`
3. **定义接口和启动绑定**：在 `api.ts` 中定义 `PromptService` 接口 + `bootstrapPromptCenter()`
4. **更新调用方**：从 `import { buildConversationSystemPrompt } from "../prompt-center"` 迁移到 `import { getPromptService } from "@/prompt-center/api.js"`
5. **删除旧代码**：确认所有调用方迁移后，删除 v1 `registry.ts`

---

## 六、关键决策

| 决策 | 理由 |
|------|------|
| 只加载 static prompt | 用户只要"原则类的通用的"prompt |
| 移除 stability 字段 | 只加载 static，不需要区分 |
| 移除 variables 参数 | 当前 static prompt 中无模板变量 |
| 只匹配 runtime | 当前只有 B-03 使用 when，且只用 runtimes |
| getSystemPrompt 返回 string | 不需要区分 systemPrompt/systemReminder |
| 启动时绑定 | 消除模块级副作用，路径可配置 |
