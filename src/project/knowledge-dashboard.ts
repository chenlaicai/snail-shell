import type { ConversationStore, KnowledgeEntry, KnowledgeEvent, KnowledgeProposal } from "../persistence/store";

export interface KnowledgeDashboardFilter {
  status?: string;
  health?: string;
  authority?: string;
  scope?: string;
  knowledge_type?: string;
  project_id?: string;
}

export interface KnowledgeDashboardSummary {
  total_entries: number;
  active_entries: number;
  superseded_entries: number;
  archived_entries: number;
  prompt_injected_events: number;
  validated_events: number;
  contested_events: number;
  superseded_events: number;
}

export interface KnowledgeHealthItem {
  entry: KnowledgeEntry;
  usage_count: number;
  validated_count: number;
  contested_count: number;
  superseded_count: number;
  latest_event_at: string | null;
  health: "healthy" | "warning" | "stale";
}

export interface KnowledgeGraphNode {
  id: string;
  label: string;
  health: KnowledgeHealthItem["health"];
  status: KnowledgeEntry["status"];
  authority: KnowledgeEntry["authority"];
  scope: KnowledgeEntry["scope"];
}

export interface KnowledgeGraphEdge {
  from: string;
  to: string;
  kind: "supersedes";
}

export interface KnowledgeDashboardData {
  summary: KnowledgeDashboardSummary;
  lifecycle: {
    pending_review: KnowledgeProposal[];
    accepted_project_local: KnowledgeProposal[];
    active_entries: KnowledgeHealthItem[];
    contested_entries: KnowledgeHealthItem[];
    superseded_entries: KnowledgeHealthItem[];
  };
  proposals: {
    pending_review: KnowledgeProposal[];
    deferred: KnowledgeProposal[];
    accepted_project_local: KnowledgeProposal[];
    rejected_recent: KnowledgeProposal[];
  };
  items: KnowledgeHealthItem[];
  operations: {
    warning_queue: KnowledgeHealthItem[];
    stale_queue: KnowledgeHealthItem[];
    contested_queue: KnowledgeHealthItem[];
    high_value_queue: KnowledgeHealthItem[];
    supersede_recent: KnowledgeHealthItem[];
  };
  graph: {
    nodes: KnowledgeGraphNode[];
    edges: KnowledgeGraphEdge[];
  };
  governance_log: Array<{
    kind: string;
    entry_id: string;
    title: string;
    note: string | null;
    created_at: string;
    severity: "info" | "warning" | "critical";
    scope: string;
  }>;
  available_filters: {
    statuses: string[];
    health: string[];
    authorities: string[];
    scopes: string[];
    knowledge_types: string[];
    projects: Array<{ id: string; name: string }>;
    governance_kinds: string[];
  };
}

export function buildKnowledgeDashboard(store: ConversationStore, filter: KnowledgeDashboardFilter = {}): KnowledgeDashboardData {
  const projects = store.listProjects(500, 0);
  const allEntries = projects.flatMap((project) => store.listKnowledgeEntriesByProject(project.id));
  const allProposals = projects.flatMap((project) => store.listKnowledgeProposalsByProject(project.id));
  const eventsByEntry = new Map<string, KnowledgeEvent[]>();
  allEntries.forEach((entry) => {
    eventsByEntry.set(entry.id, store.listKnowledgeEventsByEntry(entry.id));
  });

  const allItems = allEntries.map((entry) => buildKnowledgeHealthItem(entry, eventsByEntry.get(entry.id) ?? []));
  const items = applyFilter(allItems, filter).sort((left, right) => compareKnowledgeHealth(left, right));
  const allEvents = Array.from(eventsByEntry.values()).flat();

  return {
    summary: buildSummary(allEntries, allEvents),
    lifecycle: buildLifecycle(allProposals, allItems),
    proposals: buildProposalQueues(allProposals),
    items,
    operations: buildOperations(allItems),
    graph: buildGraph(items),
    governance_log: buildGovernanceLog(allItems, eventsByEntry),
    available_filters: {
      statuses: unique(allEntries.map((entry) => entry.status)),
      health: ["healthy", "warning", "stale"],
      authorities: unique(allEntries.map((entry) => entry.authority)),
      scopes: unique(allEntries.map((entry) => entry.scope)),
      knowledge_types: unique(allEntries.map((entry) => entry.knowledge_type)),
      projects: projects.map((project) => ({ id: project.id, name: project.name })),
      governance_kinds: ["validated", "contested", "superseded"],
    },
  };
}

function buildGovernanceLog(items: KnowledgeHealthItem[], eventsByEntry: Map<string, KnowledgeEvent[]>) {
  return items
    .flatMap((item) => (eventsByEntry.get(item.entry.id) ?? []).map((event) => ({
      kind: event.event_kind,
      entry_id: item.entry.id,
      title: item.entry.title,
      note: event.note,
      created_at: event.created_at,
      severity: resolveGovernanceSeverity(event.event_kind),
      scope: item.entry.scope,
    })))
    .filter((event) => ["validated", "contested", "superseded"].includes(event.kind))
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, 20);
}

function resolveGovernanceSeverity(kind: string): "info" | "warning" | "critical" {
  if (kind === "contested") return "warning";
  if (kind === "superseded") return "critical";
  return "info";
}

function buildLifecycle(proposals: KnowledgeProposal[], items: KnowledgeHealthItem[]) {
  return {
    pending_review: proposals.filter((item) => item.status === "pending_review").slice(0, 8),
    accepted_project_local: proposals.filter((item) => item.status === "accepted_project_local").slice(0, 8),
    active_entries: items.filter((item) => item.entry.status === "active").slice(0, 8),
    contested_entries: items.filter((item) => item.contested_count > 0).slice(0, 8),
    superseded_entries: items.filter((item) => item.entry.status === "superseded").slice(0, 8),
  };
}

function buildProposalQueues(proposals: KnowledgeProposal[]) {
  const sorted = [...proposals].sort((left, right) => right.created_at.localeCompare(left.created_at));
  return {
    pending_review: sorted.filter((item) => item.status === "pending_review").slice(0, 8),
    deferred: sorted.filter((item) => item.status === "deferred").slice(0, 8),
    accepted_project_local: sorted.filter((item) => item.status === "accepted_project_local").slice(0, 8),
    rejected_recent: sorted.filter((item) => item.status === "rejected").slice(0, 8),
  };
}

function buildOperations(items: KnowledgeHealthItem[]) {
  return {
    warning_queue: items.filter((item) => item.health === "warning").slice(0, 6),
    stale_queue: items.filter((item) => item.health === "stale").slice(0, 6),
    contested_queue: items.filter((item) => item.contested_count > 0).sort((left, right) => right.contested_count - left.contested_count).slice(0, 6),
    high_value_queue: items.filter((item) => item.entry.status === "active").sort((left, right) => scoreOperationalValue(right) - scoreOperationalValue(left)).slice(0, 6),
    supersede_recent: items.filter((item) => item.superseded_count > 0 || item.entry.status === "superseded").slice(0, 6),
  };
}

function buildSummary(entries: KnowledgeEntry[], events: KnowledgeEvent[]): KnowledgeDashboardSummary {
  return {
    total_entries: entries.length,
    active_entries: entries.filter((entry) => entry.status === "active").length,
    superseded_entries: entries.filter((entry) => entry.status === "superseded").length,
    archived_entries: entries.filter((entry) => entry.status === "archived").length,
    prompt_injected_events: events.filter((event) => event.event_kind === "prompt_injected").length,
    validated_events: events.filter((event) => event.event_kind === "validated").length,
    contested_events: events.filter((event) => event.event_kind === "contested").length,
    superseded_events: events.filter((event) => event.event_kind === "superseded").length,
  };
}

function buildKnowledgeHealthItem(entry: KnowledgeEntry, events: KnowledgeEvent[]): KnowledgeHealthItem {
  const usageCount = events.filter((event) => event.event_kind === "prompt_injected").length;
  const validatedCount = events.filter((event) => event.event_kind === "validated").length;
  const contestedCount = events.filter((event) => event.event_kind === "contested").length;
  const supersededCount = events.filter((event) => event.event_kind === "superseded").length;

  return {
    entry,
    usage_count: usageCount,
    validated_count: validatedCount,
    contested_count: contestedCount,
    superseded_count: supersededCount,
    latest_event_at: events[0]?.created_at ?? null,
    health: resolveHealth(entry, usageCount, validatedCount, contestedCount),
  };
}

function resolveHealth(
  entry: KnowledgeEntry,
  usageCount: number,
  validatedCount: number,
  contestedCount: number
): KnowledgeHealthItem["health"] {
  if (entry.status === "superseded" || entry.status === "archived") return "stale";
  if (contestedCount > validatedCount) return "warning";
  if (usageCount === 0 && validatedCount === 0) return "stale";
  return "healthy";
}

function applyFilter(items: KnowledgeHealthItem[], filter: KnowledgeDashboardFilter): KnowledgeHealthItem[] {
  return items.filter((item) => matchesFilter(item, filter));
}

function matchesFilter(item: KnowledgeHealthItem, filter: KnowledgeDashboardFilter): boolean {
  return matchesStatus(item, filter)
    && matchesHealth(item, filter)
    && matchesAuthority(item, filter)
    && matchesScope(item, filter)
    && matchesKnowledgeType(item, filter)
    && matchesProject(item, filter);
}

function matchesStatus(item: KnowledgeHealthItem, filter: KnowledgeDashboardFilter): boolean {
  return !filter.status || item.entry.status === filter.status;
}

function matchesHealth(item: KnowledgeHealthItem, filter: KnowledgeDashboardFilter): boolean {
  return !filter.health || item.health === filter.health;
}

function matchesAuthority(item: KnowledgeHealthItem, filter: KnowledgeDashboardFilter): boolean {
  return !filter.authority || item.entry.authority === filter.authority;
}

function matchesScope(item: KnowledgeHealthItem, filter: KnowledgeDashboardFilter): boolean {
  return !filter.scope || item.entry.scope === filter.scope;
}

function matchesKnowledgeType(item: KnowledgeHealthItem, filter: KnowledgeDashboardFilter): boolean {
  return !filter.knowledge_type || item.entry.knowledge_type === filter.knowledge_type;
}

function matchesProject(item: KnowledgeHealthItem, filter: KnowledgeDashboardFilter): boolean {
  return !filter.project_id || item.entry.project_id === filter.project_id;
}

function buildGraph(items: KnowledgeHealthItem[]) {
  const ids = new Set(items.map((item) => item.entry.id));
  return {
    nodes: items.map((item) => ({
      id: item.entry.id,
      label: item.entry.title,
      health: item.health,
      status: item.entry.status,
      authority: item.entry.authority,
      scope: item.entry.scope,
    })),
    edges: items
      .filter((item) => item.entry.supersedes_entry_id && ids.has(item.entry.supersedes_entry_id))
      .map((item) => ({
        from: item.entry.id,
        to: item.entry.supersedes_entry_id as string,
        kind: "supersedes" as const,
      })),
  };
}

function compareKnowledgeHealth(left: KnowledgeHealthItem, right: KnowledgeHealthItem): number {
  const healthScore = scoreHealth(right.health) - scoreHealth(left.health);
  if (healthScore !== 0) return healthScore;
  return (right.latest_event_at || "").localeCompare(left.latest_event_at || "");
}

function scoreOperationalValue(item: KnowledgeHealthItem): number {
  return item.usage_count * 3 + item.validated_count * 5 - item.contested_count * 4;
}

function scoreHealth(health: KnowledgeHealthItem["health"]): number {
  if (health === "warning") return 3;
  if (health === "healthy") return 2;
  return 1;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values)).filter(Boolean).sort((left, right) => left.localeCompare(right));
}
