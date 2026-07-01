import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api-client";
import { queryKeys } from "@/queries/keys";
import { showToast } from "@/components/Toast";
import type { IssueSnailAssignmentPlanDto, SnailDenTemplateDto, SopDto, StagePreviewDto } from "@/types";

interface NewIssueDialogProps {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
}

export function NewIssueDialog({ workspaceId, open, onClose }: NewIssueDialogProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [sopKey, setSopKey] = useState("");
  const [roleAssignments, setRoleAssignments] = useState<IssueSnailAssignmentPlanDto>({});
  const [submitting, setSubmitting] = useState(false);

  const { data: sopsData } = useQuery({
    queryKey: queryKeys.sops.all,
    queryFn: () => api("GET /api/sops", { query: { source: "platform" } }),
    enabled: open,
  });

  const { data: snailsData } = useQuery({
    queryKey: queryKeys.meta.snailDen,
    queryFn: () => api("GET /api/snail-den"),
    enabled: open,
  });

  const { data: stagePreviewsData, isFetching: previewsLoading } = useQuery({
    queryKey: ["sops", sopKey, "stage-previews", title.trim()],
    queryFn: () => api("GET /api/sops/:sopKey/stage-previews", {
      params: { sopKey },
      query: { title: title.trim() || undefined },
    }),
    enabled: open && !!sopKey,
  });

  const sops = useMemo(() => (Array.isArray(sopsData) ? sopsData : []) as SopDto[], [sopsData]);
  const stableStagePreviews = useMemo(() => (Array.isArray(stagePreviewsData) ? stagePreviewsData : []) as StagePreviewDto[], [stagePreviewsData]);
  const stableSnails = useMemo(() => (Array.isArray(snailsData) ? snailsData : []) as SnailDenTemplateDto[], [snailsData]);

  const selectedSop = useMemo(
    () => sops.find((sop) => sop.key === sopKey) ?? null,
    [sops, sopKey],
  );

  useEffect(() => {
    if (!open || !sopKey || stableStagePreviews.length === 0) {
      setRoleAssignments({});
      return;
    }

    setRoleAssignments((current) => {
      const next: IssueSnailAssignmentPlanDto = {};
      const preferred = stableSnails[0]?.key ?? "";
      for (const stage of stableStagePreviews) {
        next[stage.key] = {};
        for (const role of stage.role_instances) {
          next[stage.key][role.role_instance] = current[stage.key]?.[role.role_instance] ?? preferred;
        }
      }
      return next;
    });
  }, [open, sopKey, stableStagePreviews, stableSnails]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const missingAssignment = useMemo(() => {
    if (stableStagePreviews.length === 0) return null;
    return stableStagePreviews
      .flatMap((stage) => stage.role_instances.map((role) => ({ stage, role })))
      .find(({ stage, role }) => !roleAssignments[stage.key]?.[role.role_instance]) ?? null;
  }, [roleAssignments, stableStagePreviews]);

  function resetForm() {
    setTitle("");
    setSummary("");
    setSopKey("");
    setRoleAssignments({});
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !sopKey || submitting) return;
    if (!selectedSop) { showToast("请选择有效 SOP", true); return; }
    if (stableStagePreviews.length === 0) { showToast("当前 SOP 没有可启动的 Stage", true); return; }
    if (missingAssignment) {
      showToast(`请选择 ${missingAssignment.stage.key} / ${missingAssignment.role.role_instance} 对应的 Snail`, true);
      return;
    }

    setSubmitting(true);
    try {
      const result = await api("POST /api/workspaces/:workspaceId/issues", {
        params: { workspaceId },
        body: {
          title: title.trim(),
          summary: summary.trim() || undefined,
          adopted_sop_key: sopKey,
          snail_assignment_plan: roleAssignments,
        },
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.issues(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(result.issue.id) });
      resetForm();
      onClose();
      navigate(`/workspaces/${workspaceId}/issue/${result.issue.id}${result.stage ? `?stage=${result.stage.id}` : ""}`);
    } catch (err: unknown) {
      showToast(`创建失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/80 px-4" onClick={handleClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="new-issue-title" className="bg-surface-2 border border-white/6 rounded-xl w-full max-w-2xl h-[86vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-white/6 shrink-0">
          <h2 id="new-issue-title" className="text-lg font-semibold">New Issue</h2>
          <p className="text-[12px] text-text-muted mt-1">Create an issue with a complete SOP role assignment plan.</p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-surface-0 border border-white/6 rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-shell-600/40"
                placeholder="Issue title"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">问题描述</label>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                className="w-full bg-surface-0 border border-white/6 rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-shell-600/40 resize-none"
                placeholder="描述你希望 AI 帮你解决的问题"
                rows={6}
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">SOP *</label>
              <select
                value={sopKey}
                onChange={(e) => setSopKey(e.target.value)}
                className="w-full bg-surface-0 border border-white/6 rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-shell-600/40"
              >
                <option value="">Select SOP...</option>
                {sops.map((sop) => (
                  <option key={sop.key} value={sop.key}>{sop.name}</option>
                ))}
              </select>
            </div>

            {sopKey && (
              <section className="rounded-lg border border-white/6 bg-surface-1 p-4">
                <div className="mb-3">
                  <div className="text-[13px] font-medium text-text-primary">SOP Execution Plan</div>
                  <div className="text-[11px] text-text-muted mt-1">Assign every role instance to a Snail before creating the issue.</div>
                </div>

                {previewsLoading ? (
                  <div className="text-[12px] text-text-muted py-4">Loading stage preview...</div>
                ) : !selectedSop ? (
                  <div className="rounded-md border border-status-red/30 bg-status-red/10 p-3 text-[12px] text-status-red">Selected SOP does not exist.</div>
                ) : stableStagePreviews.length === 0 ? (
                  <div className="text-[12px] text-text-muted py-4">No launchable stages in this SOP.</div>
                ) : (
                  <div className="space-y-3">
                    {stableStagePreviews.map((stage) => (
                      <div key={stage.key} className="rounded-lg border border-white/6 bg-surface-0 p-3">
                        <div className="mb-3">
                          <div className="text-[12px] font-medium text-text-primary">{stage.title}</div>
                          {stage.description && <div className="text-[11px] text-text-muted mt-1">{stage.description}</div>}
                        </div>
                        <div className="space-y-2">
                          {stage.role_instances.map((role) => (
                            <label key={role.role_instance} className="grid grid-cols-[1fr_220px] gap-3 items-center">
                              <div className="min-w-0">
                                <div className="text-[12px] text-text-secondary truncate">{role.role_instance}</div>
                                {role.description && <div className="text-[10px] text-text-muted truncate">{role.description}</div>}
                              </div>
                              <select
                                value={roleAssignments[stage.key]?.[role.role_instance] ?? ""}
                                onChange={(e) => setRoleAssignments((current) => ({
                                  ...current,
                                  [stage.key]: { ...(current[stage.key] ?? {}), [role.role_instance]: e.target.value },
                                }))}
                                className="bg-surface-2 border border-white/6 rounded-md px-2.5 py-1.5 text-[12px] text-text-primary focus:outline-none focus:border-shell-600/40"
                              >
                                <option value="">Select Snail...</option>
                                {stableSnails.map((snail) => (
                                  <option key={snail.key} value={snail.key}>{snail.name}</option>
                                ))}
                              </select>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-white/6 shrink-0">
            <button type="button" onClick={handleClose} className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || !sopKey || !selectedSop || stableStagePreviews.length === 0 || !!missingAssignment || submitting}
              className="px-4 py-1.5 rounded-md bg-shell-600 hover:bg-shell-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {submitting ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
