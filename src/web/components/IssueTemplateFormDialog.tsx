import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api-client";
import { queryKeys } from "@/queries/keys";
import { showToast } from "@/components/Toast";
import { useCreateIssueTemplate, useUpdateIssueTemplate } from "@/mutations/issue-template.mutations";
import { CronExpressionParser } from "cron-parser";
import type { IssueTemplateDto, IssueSnailAssignmentPlanDto, SnailDenTemplateDto, SopDto, StagePreviewDto, WorkspaceSummaryDto } from "@/types";

interface IssueTemplateFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** 编辑模式时传入已有模板 */
  template?: IssueTemplateDto | null;
}

const CRON_PRESETS = [
  { label: "每天 9:00", value: "0 9 * * *" },
  { label: "每周一 9:00", value: "0 9 * * 1" },
  { label: "每月 1 号 9:00", value: "0 9 1 * *" },
  { label: "自定义", value: "" },
];

export function IssueTemplateFormDialog({ open, onClose, template }: IssueTemplateFormDialogProps) {
  const isEdit = !!template;
  const createMutation = useCreateIssueTemplate();
  const updateMutation = useUpdateIssueTemplate();

  const [title, setTitle] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [sopKey, setSopKey] = useState("");
  const [roleAssignments, setRoleAssignments] = useState<IssueSnailAssignmentPlanDto>({});
  const [cronExpression, setCronExpression] = useState("0 9 * * *");
  const [enabled, setEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const { data: workspacesData } = useQuery({
    queryKey: queryKeys.workspaces.all,
    queryFn: () => api("GET /api/workspaces"),
    enabled: open,
  });

  const { data: sopsData } = useQuery({
    queryKey: queryKeys.sops.all,
    queryFn: () => api("GET /api/sops"),
    enabled: open,
  });

  const { data: snailsData } = useQuery({
    queryKey: queryKeys.meta.snailDen,
    queryFn: () => api("GET /api/snail-den"),
    enabled: open,
  });

  const { data: stagePreviewsData } = useQuery({
    queryKey: ["sops", sopKey, "stage-previews", title.trim()],
    queryFn: () => api("GET /api/sops/:sopKey/stage-previews", {
      params: { sopKey },
      query: { title: title.trim() || undefined },
    }),
    enabled: open && !!sopKey,
  });

  const workspaces = useMemo(() => (Array.isArray(workspacesData) ? workspacesData : []) as WorkspaceSummaryDto[], [workspacesData]);
  const sops = useMemo(() => (Array.isArray(sopsData) ? sopsData : []) as SopDto[], [sopsData]);
  const snails = useMemo(() => (Array.isArray(snailsData) ? snailsData : []) as SnailDenTemplateDto[], [snailsData]);
  const stagePreviews = useMemo(() => (Array.isArray(stagePreviewsData) ? stagePreviewsData : []) as StagePreviewDto[], [stagePreviewsData]);

  // 编辑模式：填充表单
  useEffect(() => {
    if (!open) return;
    if (template) {
      setTitle(template.title);
      setWorkspacePath(template.workspace_path);
      setSopKey(template.sop_key);
      setRoleAssignments(template.snail_assignment_plan);
      setCronExpression(template.cron_expression);
      setEnabled(template.enabled);
    } else {
      setTitle("");
      setWorkspacePath("");
      setSopKey("");
      setRoleAssignments({});
      setCronExpression("0 9 * * *");
      setEnabled(true);
    }
  }, [open, template]);

  // 选择 SOP 后自动填充角色分配
  useEffect(() => {
    if (!open || !sopKey || stagePreviews.length === 0) {
      if (!template) setRoleAssignments({});
      return;
    }
    setRoleAssignments((current) => {
      const next: IssueSnailAssignmentPlanDto = {};
      const preferred = snails[0]?.key ?? "";
      for (const stage of stagePreviews) {
        next[stage.key] = {};
        for (const role of stage.role_instances) {
          next[stage.key][role.role_instance] = current[stage.key]?.[role.role_instance] ?? preferred;
        }
      }
      return next;
    });
  }, [open, sopKey, stagePreviews, snails, template]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const nextFirePreview = useMemo(() => {
    if (!cronExpression) return "";
    try {
      const next = CronExpressionParser.parse(cronExpression).next().toDate();
      return next.toLocaleString();
    } catch {
      return "Invalid expression";
    }
  }, [cronExpression]);

  const missingAssignment = useMemo(() => {
    if (stagePreviews.length === 0) return null;
    return stagePreviews
      .flatMap((stage) => stage.role_instances.map((role) => ({ stage, role })))
      .find(({ stage, role }) => !roleAssignments[stage.key]?.[role.role_instance]) ?? null;
  }, [roleAssignments, stagePreviews]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !workspacePath || !sopKey || !cronExpression.trim() || submitting) return;
    if (missingAssignment) {
      showToast(`请选择 ${missingAssignment.stage.key} / ${missingAssignment.role.role_instance} 对应的 Snail`, true);
      return;
    }

    setSubmitting(true);
    try {
      if (isEdit && template) {
        await updateMutation.mutateAsync({
          id: template.id,
          title: title.trim(),
          sop_key: sopKey,
          snail_assignment_plan: roleAssignments,
          cron_expression: cronExpression.trim(),
          enabled,
        });
      } else {
        await createMutation.mutateAsync({
          workspace_path: workspacePath,
          title: title.trim(),
          sop_key: sopKey,
          snail_assignment_plan: roleAssignments,
          cron_expression: cronExpression.trim(),
          enabled,
        });
      }
      onClose();
    } catch {
      /** onError handler in mutation shows toast */
    }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/80 px-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="bg-surface-2 border border-white/6 rounded-xl w-full max-w-2xl h-[86vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-white/6 shrink-0">
          <h2 className="text-lg font-semibold">{isEdit ? "Edit Template" : "New Issue Template"}</h2>
          <p className="text-[12px] text-text-muted mt-1">Configure a scheduled task that periodically creates child issues.</p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">Title *</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-surface-0 border border-white/6 rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-shell-600/40"
                placeholder="Template title"
                autoFocus
              />
            </div>

            {!isEdit && (
              <div>
                <label className="block text-xs text-text-muted mb-1">Workspace *</label>
                <select
                  value={workspacePath}
                  onChange={(e) => setWorkspacePath(e.target.value)}
                  className="w-full bg-surface-0 border border-white/6 rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-shell-600/40"
                >
                  <option value="">Select workspace...</option>
                  {workspaces.map((ws) => (
                    <option key={ws.path} value={ws.path}>{ws.path}</option>
                  ))}
                </select>
              </div>
            )}

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
                  <div className="text-[13px] font-medium text-text-primary">Snail Assignment Plan</div>
                  <div className="text-[11px] text-text-muted mt-1">Assign every role instance to a Snail.</div>
                </div>
                {stagePreviews.length === 0 ? (
                  <div className="text-[12px] text-text-muted py-4">Loading stage preview...</div>
                ) : (
                  <div className="space-y-3">
                    {stagePreviews.map((stage) => (
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
                                {snails.map((snail) => (
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

            <div>
              <label className="block text-xs text-text-muted mb-1">Cron Expression *</label>
              <div className="flex gap-2">
                <select
                  value={CRON_PRESETS.find(p => p.value === cronExpression)?.value ?? ""}
                  onChange={(e) => {
                    const preset = CRON_PRESETS.find(p => p.value === e.target.value);
                    if (preset && preset.value) setCronExpression(preset.value);
                  }}
                  className="w-[180px] shrink-0 bg-surface-0 border border-white/6 rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-shell-600/40"
                >
                  {CRON_PRESETS.map((p) => (
                    <option key={p.label} value={p.value}>{p.label}</option>
                  ))}
                </select>
                <input
                  value={cronExpression}
                  onChange={(e) => setCronExpression(e.target.value)}
                  className="flex-1 bg-surface-0 border border-white/6 rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-shell-600/40 font-mono"
                  placeholder="0 9 * * 1"
                />
              </div>
              {nextFirePreview && (
                <div className="text-[11px] text-text-muted mt-1">Next fire: {nextFirePreview}</div>
              )}
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="rounded border-white/6"
              />
              <span className="text-sm text-text-secondary">Enabled</span>
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-white/6 shrink-0">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || (!isEdit && !workspacePath) || !sopKey || !cronExpression.trim() || !!missingAssignment || submitting}
              className="px-4 py-1.5 rounded-md bg-shell-600 hover:bg-shell-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {submitting ? "Saving..." : isEdit ? "Save" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
