import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api-client";
import { showToast } from "../components/Toast";
import { queryKeys } from "../queries/keys";
import { Button } from "@/components/ui/button";
import type { WorkspaceSummaryDto } from "../types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function WorkspaceConfig() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState("");
  const [workspaceRoot, setWorkspaceRoot] = useState("");

  async function handleSubmit() {
    if (!workspaceRoot.trim()) { showToast("工作区根目录不能为空", true); return; }
    try {
      const result = await api("POST /api/workspaces", {
        body: {
          path: workspaceRoot.trim(),
          summary: summary.trim() || undefined,
        },
      });
      queryClient.setQueryData<WorkspaceSummaryDto[]>(queryKeys.workspaces.list(), (current = []) => {
        const others = current.filter((workspace) => workspace.id !== result.id);
        return [result, ...others];
      });
      queryClient.setQueryData(queryKeys.workspaces.detail(result.id), result);
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all });
      showToast("工作区已创建");
      navigate(`/workspaces/${result.id}`);
    } catch (err: unknown) {
      showToast(`创建工作区失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0" data-view-pane="workspace-config">
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <div className="flex items-center gap-4 p-3 px-6 border-b border-[var(--color-border-muted)] bg-[var(--color-bg-base)] shrink-0">
          <div className="flex items-baseline gap-2 flex-1 min-w-0">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">新建工作区</span>
          </div>
          <div className="flex gap-1.5">
            <Button variant="outline" onClick={() => navigate("/workspaces")}>取消</Button>
            <Button onClick={handleSubmit}>创建工作区</Button>
          </div>
        </div>

        <div className="p-6 overflow-auto flex-1 max-w-[720px]">
          <section className="mb-[var(--space-xl)]">
            <h3 className="mb-[var(--space-md)]">基本信息</h3>
            <p className="mb-[var(--space-lg)] text-[var(--font-size-sm)] leading-[1.6] text-[var(--color-text-secondary)]">
              工作区只负责绑定一个本地项目根目录。SOP 模板会在创建具体 issue 时选择，因为不同 issue 可以采用不同协作流程。
            </p>
            <div className="mb-[var(--space-md)]">
              <label className="block mb-1 text-[var(--font-size-sm)]">工作区根目录 *</label>
              <Input value={workspaceRoot} onChange={(e) => setWorkspaceRoot(e.target.value)} placeholder="绝对路径，如 /Users/you/project" />
            </div>
            <div className="mb-[var(--space-md)]">
              <label className="block mb-1 text-[var(--font-size-sm)]">摘要</label>
              <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="可选；不填则使用目录路径展示" rows={2} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
