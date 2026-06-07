/**
 * SOP management service.
 *
 * Pure functions extracted from WorkspaceManager that delegate to the
 * file config store for SOP and role definition operations.
 */
import type { ConversationStore } from "../persistence/store";

export function listRoles(store: ConversationStore) {
  return store.fileConfigStore.listRoleDefinitionsByWorkspace("");
}

export function listSops(store: ConversationStore, source?: "platform" | "workspace") {
  return store.fileConfigStore.listSops(source);
}

export function getSop(store: ConversationStore, sopId: string) {
  return store.fileConfigStore.getSop(sopId);
}

export function createPlatformSop(store: ConversationStore, input: Parameters<ConversationStore["fileConfigStore"]["createPlatformSop"]>[0]) {
  return store.fileConfigStore.createPlatformSop(input);
}

export function updatePlatformSop(store: ConversationStore, sopId: string, input: Parameters<ConversationStore["fileConfigStore"]["updatePlatformSop"]>[1]) {
  return store.fileConfigStore.updatePlatformSop(sopId, input);
}

export function deletePlatformSop(store: ConversationStore, sopId: string): string[] {
  return store.fileConfigStore.deletePlatformSop(sopId);
}

export function listSopStageDefinitionsWithRoles(store: ConversationStore, sopId: string) {
  return store.fileConfigStore.listSopStageDefinitionsWithRoles(sopId);
}

export function collectSopRoleKeys(store: ConversationStore, sopId: string) {
  return store.fileConfigStore.collectSopRoleKeys(sopId);
}

export function listSopStageDefinitions(store: ConversationStore, sopId: string) {
  return store.fileConfigStore.listSopStageDefinitions(sopId);
}

export function getSopTransitions(store: ConversationStore, sopId: string) {
  return store.fileConfigStore.getSopTransitions(sopId);
}

export function getForwardTransitions(store: ConversationStore, sopId: string, fromStageKey: string) {
  return store.fileConfigStore.getForwardTransitions(sopId, fromStageKey);
}
