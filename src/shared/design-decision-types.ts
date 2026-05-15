// Design decision types.

export type DesignDecisionStatus = "active" | "superseded" | "deprecated";

export interface DesignDecision {
  id: string;
  project_id: string | null;
  scope_type: string;
  scope_ref: string | null;
  title: string;
  content: string;
  status: DesignDecisionStatus;
  source_knowledge_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DesignDecisionSearchResult {
  id: string;
  project_id: string | null;
  scope_type: string;
  scope_ref: string | null;
  title: string;
  content: string;
  snippet: string;
  status: DesignDecisionStatus;
  source_knowledge_id: string | null;
  updated_at: string;
}

export interface CreateDesignDecisionInput {
  id: string;
  projectId?: string | null;
  scopeType: string;
  scopeRef?: string | null;
  title: string;
  content: string;
  status?: DesignDecisionStatus;
  sourceKnowledgeId?: string | null;
}

export interface UpdateDesignDecisionInput {
  title?: string;
  content?: string;
  status?: DesignDecisionStatus;
  scopeType?: string;
  scopeRef?: string | null;
  projectId?: string | null;
}

export interface DesignDecisionListFilters {
  projectId?: string | null;
  scopeType?: string;
  scopeRef?: string;
  status?: DesignDecisionStatus;
  query?: string;
  limit?: number;
  offset?: number;
}
