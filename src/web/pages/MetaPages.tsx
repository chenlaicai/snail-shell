import { useQuery } from "@tanstack/react-query";
import { TopBar } from "@/components/TopBar";
import { QueryState } from "@/components/QueryState";
import { metaQueries } from "@/queries/meta.queries";
import type { PromptDto, SkillDto, SnailDenTemplateDto, McpServerDto } from "@/types";

export function PromptCenter() {
  const query = useQuery(metaQueries.prompts());
  return (
    <>
      <TopBar breadcrumbs={[{ label: "Prompt Center" }]} />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <h1 className="text-xl font-semibold mb-6">Prompt Center</h1>
        <QueryState query={query} emptyText="No prompts">
          <div className="space-y-2">{query.data?.map((p) => <PromptRow key={p.id} prompt={p} />)}</div>
        </QueryState>
      </div>
    </>
  );
}

function PromptRow({ prompt }: { prompt: PromptDto }) {
  return (
    <div className="bg-surface-2 rounded-lg border border-white/6 p-4 hover:bg-surface-3 transition-colors cursor-pointer">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-medium">{prompt.title}</h3>
          <span className="text-[11px] text-text-muted font-mono">{prompt.filePath}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${prompt.layer === "platform" ? "bg-shell-600/20 text-shell-400" : "bg-status-blue/15 text-status-blue"}`}>{prompt.layer}</span>
          <span className="text-[11px] text-text-muted">priority: {prompt.priority}</span>
        </div>
      </div>
    </div>
  );
}

export function SkillCenter() {
  const query = useQuery(metaQueries.skills());
  return (
    <>
      <TopBar breadcrumbs={[{ label: "Skill Center" }]} />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <h1 className="text-xl font-semibold mb-6">Skill Center</h1>
        <QueryState query={query} emptyText="No skills">
          <div className="space-y-2">{query.data?.map((s) => <SkillRow key={s.name} skill={s} />)}</div>
        </QueryState>
      </div>
    </>
  );
}

function SkillRow({ skill }: { skill: SkillDto }) {
  return (
    <div className="bg-surface-2 rounded-lg border border-white/6 p-4 hover:bg-surface-3 transition-colors cursor-pointer">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-medium">{skill.title}</h3>
          <p className="text-[12px] text-text-secondary mt-1">{skill.description}</p>
        </div>
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${skill.source === "platform" ? "bg-shell-600/20 text-shell-400" : "bg-status-blue/15 text-status-blue"}`}>{skill.source}</span>
      </div>
    </div>
  );
}

export function SnailDen() {
  const query = useQuery(metaQueries.snailDen());
  return (
    <>
      <TopBar breadcrumbs={[{ label: "Snail Den" }]} />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <h1 className="text-xl font-semibold mb-2">Snail Den</h1>
        <p className="text-[13px] text-text-secondary mb-6">Agent runtime templates</p>
        <QueryState query={query} emptyText="No templates">
          <div className="space-y-2">{query.data?.map((t) => <TemplateRow key={t.id} template={t} />)}</div>
        </QueryState>
      </div>
    </>
  );
}

function TemplateRow({ template }: { template: SnailDenTemplateDto }) {
  return (
    <div className="bg-surface-2 rounded-lg border border-white/6 p-4 hover:bg-surface-3 transition-colors cursor-pointer">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-medium">{template.name}</h3>
          <span className="text-[11px] text-text-muted font-mono">{template.id}</span>
        </div>
        <div className="flex items-center gap-3 text-[12px] text-text-secondary">
          <span>{template.runtime}</span>
          <span>{template.model}</span>
          {template.contextWindow && <span>{Math.round(template.contextWindow / 1000)}k ctx</span>}
        </div>
      </div>
    </div>
  );
}

export function McpCenter() {
  const query = useQuery(metaQueries.mcps());
  return (
    <>
      <TopBar breadcrumbs={[{ label: "MCP Servers" }]} />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <h1 className="text-xl font-semibold mb-6">MCP Servers</h1>
        <QueryState query={query} emptyText="No MCP servers">
          <div className="space-y-2">{query.data?.map((s) => <McpRow key={s.name} server={s} />)}</div>
        </QueryState>
      </div>
    </>
  );
}

function McpRow({ server }: { server: McpServerDto }) {
  return (
    <div className="bg-surface-2 rounded-lg border border-white/6 p-4 hover:bg-surface-3 transition-colors cursor-pointer">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-medium">{server.name}</h3>
          <span className="text-[11px] text-text-muted font-mono">{server.command ?? server.url}</span>
        </div>
        {server.builtin && <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-shell-600/20 text-shell-400">builtin</span>}
      </div>
    </div>
  );
}
