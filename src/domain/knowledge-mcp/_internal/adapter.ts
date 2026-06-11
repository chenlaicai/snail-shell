import type { KnowledgePort } from "@domain/knowledge/port";
import type {
  SearchKnowledgeInput,
  SearchKnowledgeOutput,
  ListKnowledgeInput,
  ListKnowledgeOutput,
  AddKnowledgeInput,
  AddKnowledgeOutput,
  RemoveKnowledgeInputDto,
} from "../model";
import type { KnowledgeMCPPort } from "../port";

/**
 * Knowledge MCP 适配器实现。
 * Agent 通过 MCP 工具调用 knowledge 功能，直接调用 domain 层。
 */
export class KnowledgeMCPAdapter implements KnowledgeMCPPort {
  constructor(private knowledge: KnowledgePort) {}

  search(input: SearchKnowledgeInput): SearchKnowledgeOutput {
    const workspace = input.workspace_path ? { path: input.workspace_path, summary: null } : undefined;
    const entries = workspace
      ? this.knowledge.findByWorkspace(workspace)
      : this.knowledge.list();

    const lowerQuery = input.query.toLowerCase();
    const filtered = entries.filter(
      e => e.title.toLowerCase().includes(lowerQuery) || e.content.toLowerCase().includes(lowerQuery)
    );

    return { items: filtered };
  }

  list(input: ListKnowledgeInput): ListKnowledgeOutput {
    const workspace = input.workspace_path ? { path: input.workspace_path, summary: null } : undefined;
    const items = workspace
      ? this.knowledge.findByWorkspace(workspace)
      : this.knowledge.list();

    return { items };
  }

  add(input: AddKnowledgeInput): AddKnowledgeOutput {
    const entry = this.knowledge.add({
      id: input.id,
      title: input.title,
      tags: input.tags,
      content: input.content,
      scope: input.scope,
      workspace: input.workspace_path ? { path: input.workspace_path, summary: null } : undefined,
    });

    return { entry };
  }

  remove(input: RemoveKnowledgeInputDto): void {
    this.knowledge.remove({
      id: input.id,
      scope: input.scope,
      workspace: input.workspace_path ? { path: input.workspace_path, summary: null } : undefined,
    });
  }
}
