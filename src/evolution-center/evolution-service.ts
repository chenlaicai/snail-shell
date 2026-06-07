import { randomUUID } from "crypto";
import { HUMAN_ROLE_NAME } from "../shared/domain-types";
import { buildSopSnapshot } from "../workspace-workflow/workflow";
import { SopSnapshotReader } from "../workspace-workflow/sop-snapshot-reader";
import type { SopSnapshot } from "../shared/types";
import type {
  ConversationStore,
  CreateEvolutionItemInput,
  EvolutionItemListFilters,
  EvolutionItemSearchResult,
  EvolutionItemWithConversation,
  UpdateEvolutionItemInput,
} from "../persistence/store";

export function createEvolutionItem(
  store: ConversationStore,
  input: Omit<CreateEvolutionItemInput, "id">,
  roleSnailMapping: Record<string, Record<string, string>>,
): EvolutionItemWithConversation {
  const id = randomUUID();
  const { snapshot, reader } = resolveEvolutionSop(store);
  const workspace = store.fileConfigStore.getWorkspace(input.workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${input.workspaceId}`);
  store.evolution.create({ ...input, id });
  linkEvolutionIssue(store, { evolutionItemId: id, input, snapshot, reader, roleSnailMapping });
  return store.evolution.get(id)!;
}

function resolveEvolutionSop(store: ConversationStore): { snapshot: SopSnapshot; reader: SopSnapshotReader } {
  const sop = store.fileConfigStore.getSopByKey("platform", "evolution");
  if (!sop) throw new Error("Evolution SOP not found — ensure config/sop/evolution/evolution.yaml exists");
  const snapshot = buildSopSnapshot({ store: store.fileConfigStore }, sop.id);
  return { snapshot, reader: new SopSnapshotReader(snapshot) };
}

function linkEvolutionIssue(
  store: ConversationStore,
  ctx: { evolutionItemId: string; input: Omit<CreateEvolutionItemInput, "id">; snapshot: SopSnapshot; reader: SopSnapshotReader; roleSnailMapping: Record<string, Record<string, string>> },
): void {
  const { evolutionItemId, input, snapshot, reader, roleSnailMapping } = ctx;
  const issue = store.createIssue({ id: randomUUID(), workspaceId: input.workspaceId, title: input.title, sopSnapshot: snapshot, roleSnailMapping });
  const firstStageKey = snapshot.first_stage ?? reader.listSopStageDefinitions()[0]?.key;
  if (!firstStageKey) throw new Error("Evolution SOP has no stage definitions");
  const stageDef = reader.getSopStageDefinitionByKey(firstStageKey);
  if (!stageDef) throw new Error(`Evolution stage definition '${firstStageKey}' not found in SOP`);
  const stage = store.createStage({ id: randomUUID(), workspaceId: input.workspaceId, issueId: issue.id, stageDefinitionId: stageDef.id, type: stageDef.key, sequence: 1, status: "in_progress", enteredAt: new Date().toISOString() });
  const roles = reader.listRoleDefinitionsByStage(firstStageKey);
  const primaryRole = roles.find((r) => r.is_primary === 1) ?? roles[0];
  if (!primaryRole) throw new Error(`No roles configured for evolution stage '${firstStageKey}'`);
  store.createConversation({ id: randomUUID(), workspaceId: input.workspaceId, issueId: issue.id, stageId: stage.id, ownerType: "evolution", ownerId: evolutionItemId, title: input.title, kind: "discussion", defaultRole: primaryRole.name, participatingRoles: [HUMAN_ROLE_NAME, ...roles.map((r) => r.name)], summary: "治理对话", fromConversationIds: [] });
  store.evolution.update(evolutionItemId, { issueId: issue.id });
}

export function getEvolutionItem(
  store: ConversationStore,
  id: string,
): EvolutionItemWithConversation | null {
  return store.evolution.get(id);
}

export function listEvolutionItems(
  store: ConversationStore,
  filters: EvolutionItemListFilters = {},
): EvolutionItemSearchResult[] {
  return store.evolution.list(filters);
}

export function updateEvolutionItem(
  store: ConversationStore,
  id: string,
  input: UpdateEvolutionItemInput,
): EvolutionItemWithConversation {
  return store.evolution.update(id, input);
}
