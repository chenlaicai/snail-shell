import { recordKnowledgeEvent } from "./knowledge-evolution";
import { retrieveKnowledgeForPrompt } from "./knowledge-retrieval";
import type { CollaborationInvocationOptions } from "./collaboration";
import type { ConversationStore, Project, Stage, Conversation } from "../persistence/store";

export function prepareKnowledgeForPrompt(input: {
  store: ConversationStore;
  project: Project;
  stage: Stage;
  conversation: Conversation;
  options: CollaborationInvocationOptions;
}) {
  const knowledge = retrieveKnowledgeForPrompt({
    entries: input.store.listKnowledgeEntriesByProject(input.project.id),
    stageType: input.stage.type,
    snailName: input.options.activeSnailName,
    projectKind: input.project.kind,
  });

  knowledge.mandatory.concat(knowledge.recommended, knowledge.reference).forEach((entry) => {
    recordKnowledgeEvent(input.store, entry.id, {
      eventKind: "prompt_injected",
      note: `Injected into prompt for ${input.options.activeSnailName}`,
      projectId: input.project.id,
      stageId: input.stage.id,
      conversationId: input.conversation.id,
      metadata: { authority: entry.authority, scope: entry.scope },
    });
  });

  return knowledge;
}
