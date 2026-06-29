import { formatDate, formatRelativeTime } from "@/lib/utils";
import type { IssueDetailDto, StageDetailDto } from "@/types";

interface PropertiesPanelProps {
  issue: IssueDetailDto;
  stage?: StageDetailDto | null;
}

export function PropertiesPanel({ issue, stage }: PropertiesPanelProps) {
  const currentStage = stage ?? issue.current_stage;

  return (
    <aside className="w-[280px] shrink-0 bg-surface-1 border-l border-white/6 flex flex-col overflow-y-auto">
      <div className="px-4 py-4 space-y-4">

        <Section title="Details">
          <PropRow label="Stage">
            <span className="text-[13px]">{currentStage?.stage_definition?.title ?? "—"}</span>
          </PropRow>
          <PropRow label="SOP">
            <span className="text-[13px] text-text-secondary">{issue.sop_snapshot?.name ?? "—"}</span>
          </PropRow>
          <PropRow label="Created">
            <span className="text-[13px] text-text-secondary">{formatDate(issue.created_at)}</span>
          </PropRow>
          {issue.closed_at && (
            <PropRow label="Closed">
              <span className="text-[13px] text-text-secondary">{formatDate(issue.closed_at)}</span>
            </PropRow>
          )}
        </Section>

        <Divider />

        {currentStage?.stage_definition?.roles && currentStage.stage_definition.roles.length > 0 && (
          <>
            <Section title="Roles">
              <div className="space-y-2">
                {currentStage.stage_definition.roles.map((role: { name: string; description?: string; is_primary?: boolean }) => (
                  <div key={role.name} className="flex items-center gap-2">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-medium text-white shrink-0 ${role.is_primary ? "bg-gradient-to-br from-shell-500 to-shell-700" : "bg-surface-4"}`}>
                      {role.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] text-text-primary">{role.name}</span>
                        {role.is_primary && <span className="text-[9px] px-1 py-px rounded bg-shell-600/20 text-shell-400">primary</span>}
                      </div>
                      {role.description && <span className="text-[10px] text-text-muted">{role.description}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
            <Divider />
          </>
        )}

        {issue.context && Object.keys(issue.context).length > 0 && (
          <>
            <Section title="Context">
              <div className="space-y-1.5">
                {Object.entries(issue.context).map(([key, value]) => (
                  <div key={key} className="flex items-baseline gap-2">
                    <span className="text-[10px] text-shell-400 font-mono shrink-0 w-20 truncate">{key}</span>
                    <span className="text-[11px] text-text-secondary break-all">{String(value)}</span>
                  </div>
                ))}
              </div>
            </Section>
            <Divider />
          </>
        )}

        {currentStage?.assignments && currentStage.assignments.length > 0 && (
          <>
            <Section title="Participants">
              <div className="space-y-2">
                {currentStage.assignments.map((a) => (
                  <div key={a.role_instance} className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-shell-600 flex items-center justify-center text-[9px] font-medium text-white shrink-0">
                      {a.role_instance.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] text-text-primary truncate">{a.role_instance}</div>
                      <div className="text-[10px] text-text-muted truncate">{a.snail_key}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
            <Divider />
          </>
        )}

        <Section title="Stages">
          <div className="space-y-1">
            {issue.stages.map((s) => (
              <div key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors">
                <div className={`w-2 h-2 rounded-full shrink-0 ${s.status === "completed" ? "bg-status-green" : s.status === "in_progress" ? "bg-status-blue" : "bg-status-gray"}`} />
                <span className="text-[12px] text-text-secondary flex-1">{s.title || s.key}</span>
                <span className="text-[10px] text-text-muted">{s.status === "completed" ? "done" : s.status === "in_progress" ? "active" : ""}</span>
              </div>
            ))}
          </div>
        </Section>

        <Divider />

        <Section title="Activity">
          <div className="space-y-2.5">
            <ActivityItem name="System" action="created issue" time={formatRelativeTime(issue.created_at)} />
            {/* 遍历所有 stage 记录，按 entered_at 升序显示 */}
            {[...issue.stages]
              .filter((s) => s.entered_at)
              .sort((a, b) => new Date(a.entered_at!).getTime() - new Date(b.entered_at!).getTime())
              .map((s) => (
                <ActivityItem
                  key={s.id}
                  name="System"
                  action={`entered "${s.title || s.key}"`}
                  time={formatRelativeTime(s.entered_at!)}
                />
              ))}
          </div>
        </Section>
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-text-muted uppercase tracking-wider mb-3">{title}</div>
      {children}
    </div>
  );
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-text-muted">{label}</span>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-white/6" />;
}

function ActivityItem({ name, action, time }: { name: string; action: string; time: string }) {
  return (
    <div className="flex items-start gap-2">
      <div className="w-5 h-5 rounded-full bg-shell-600 flex items-center justify-center text-[9px] font-medium text-white mt-0.5 shrink-0">
        {name.charAt(0)}
      </div>
      <div className="text-[12px] text-text-secondary">
        <span className="text-text-primary">{name}</span> {action}{" "}
        <span className="text-text-muted">{time}</span>
      </div>
    </div>
  );
}
