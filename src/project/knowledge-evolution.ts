import { randomUUID } from "crypto";
import type { ConversationStore, KnowledgeEventKind } from "../persistence/store";

export function recordKnowledgeEvent(
  store: ConversationStore,
  knowledgeEntryId: string,
  input: {
    eventKind: KnowledgeEventKind;
    note?: string;
    projectId: string;
    stageId?: string | null;
    conversationId?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  return store.createKnowledgeEvent({
    id: randomUUID(),
    knowledgeEntryId,
    projectId: input.projectId,
    stageId: input.stageId ?? null,
    conversationId: input.conversationId ?? null,
    eventKind: input.eventKind,
    note: input.note ?? null,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
  });
}

export function supersedeKnowledgeEntry(
  store: ConversationStore,
  input: {
    entryId: string;
    replacementEntryId: string;
    projectId: string;
    stageId?: string | null;
    note?: string;
  }
) {
  const current = store.getKnowledgeEntry(input.entryId);
  const replacement = store.getKnowledgeEntry(input.replacementEntryId);
  if (!current || !replacement) {
    throw new Error("Knowledge entry not found for supersede operation");
  }

  store.updateKnowledgeEntry(current.id, {
    status: "superseded",
    superseded_by_entry_id: replacement.id,
  });
  store.updateKnowledgeEntry(replacement.id, {
    supersedes_entry_id: current.id,
  });

  recordKnowledgeEvent(store, current.id, {
    eventKind: "superseded",
    note: input.note ?? `Superseded by ${replacement.title}`,
    projectId: input.projectId,
    stageId: input.stageId ?? null,
    metadata: { replacement_entry_id: replacement.id },
  });
}
