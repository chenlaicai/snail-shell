import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { issueTemplateQueries } from "@/queries/issue-template.queries";
import { IssueTemplateFormDialog } from "@/components/IssueTemplateFormDialog";
import { IssueTemplateDetail } from "@/components/IssueTemplateDetail";
import { Badge } from "@/components/ui/badge";
import { TopBar } from "@/components/TopBar";
import { cronSummary } from "@/lib/cron-summary";
import type { IssueTemplateDto } from "@/types";

export function IssueTemplates() {
  const { data: templates = [], isLoading } = useQuery(issueTemplateQueries.list());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<IssueTemplateDto | null>(null);

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  function openCreate() {
    setEditingTemplate(null);
    setDialogOpen(true);
  }

  function openEdit(template: IssueTemplateDto) {
    setEditingTemplate(template);
    setDialogOpen(true);
  }

  if (isLoading) return <div className="flex h-full items-center justify-center text-[13px] text-text-muted">Loading...</div>;

  return (
    <>
      <TopBar breadcrumbs={[{ label: "Issue Templates" }]} />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar: template list */}
        <aside className="w-[300px] shrink-0 overflow-y-auto border-r border-white/6 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium text-text-muted uppercase tracking-wider">Templates</span>
            <button
              onClick={openCreate}
              className="text-[12px] px-2 py-1 rounded-md bg-shell-600 hover:bg-shell-500 text-white transition-colors"
            >
              + New
            </button>
          </div>
          {templates.length === 0 ? (
            <div className="py-4 text-[13px] text-text-muted">No templates yet. Click "New" to create one.</div>
          ) : (
            templates.map((template) => (
              <button
                key={template.id}
                onClick={() => setSelectedId(template.id)}
                className={`mb-1 w-full rounded-lg p-3 text-left transition-colors ${selectedId === template.id ? "bg-white/8 text-text-primary" : "text-text-secondary hover:bg-white/5"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[13px] font-medium truncate">{template.title}</div>
                  <Badge variant={template.enabled ? "success" : "outline"}>
                    {template.enabled ? "ON" : "OFF"}
                  </Badge>
                </div>
                <div className="mt-1 text-[11px] text-text-muted">{cronSummary(template.cron_expression)}</div>
                {template.last_status && (
                  <div className="mt-1 text-[10px]">
                    <span className={template.last_status === "success" ? "text-status-green" : "text-status-red"}>
                      Last: {template.last_status}
                    </span>
                  </div>
                )}
              </button>
            ))
          )}
        </aside>

        {/* Detail panel */}
        <main className="flex-1 overflow-y-auto p-6">
          {selected ? (
            <IssueTemplateDetail template={selected} onEdit={() => openEdit(selected)} />
          ) : (
            <div className="py-4 text-[13px] text-text-muted">Select a template to view details.</div>
          )}
        </main>
      </div>

      <IssueTemplateFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        template={editingTemplate}
      />
    </>
  );
}
