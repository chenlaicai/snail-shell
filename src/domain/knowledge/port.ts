import type { Workspace } from "@domain/workspace/model";
import type { KnowledgeEntry, CreateKnowledgeInput, RemoveKnowledgeInput } from "@domain/knowledge/model";

/**
 * Knowledge 端口定义。
 *
 * 知识库对外提供新增/移除/查看知识条目的方法。
 * 平台级和 workspace 级分开存储，每个 ws 读取到平台 + 本 ws 的合集。
 */
export interface KnowledgePort {
  /** 列出所有条目（页面展示用） */
  list(): KnowledgeEntry[];

  /** 获取指定 ws 的条目（平台 + 该 ws） */
  findByWorkspace(workspace: Workspace): KnowledgeEntry[];

  /** 新增条目 */
  add(input: CreateKnowledgeInput): KnowledgeEntry;

  /** 移除条目（按 scope + workspace + id 定位） */
  remove(input: RemoveKnowledgeInput): void;
}
