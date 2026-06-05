import { useEffect, useState } from "react";
import { useConversationStore } from "../stores/conversationStore";
import { api } from "../services/api-client";
import { showToast } from "./Toast";
import type { WorkspaceSummaryDto, IssueDto, SnailDenTemplateDto } from "../types";

interface Participant {
  name: string;
  roleDef?: {
    name: string;
    description?: string;
    snail_template_id?: string;
  } | null;
  isPrimary: boolean;
}

interface RoleDefinition {
  name: string;
  description?: string;
  snail_template_id?: string;
  is_primary?: boolean;
}

export function ContextPanel({
  workspace,
  issue,
}: {
  workspace: WorkspaceSummaryDto | null;
  issue: IssueDto | null;
}) {
  const { currentStage, currentConversation, wsStatus } = useConversationStore();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [outputArtifacts, setOutputArtifacts] = useState<Record<string, string>>({});
  const [inputArtifacts, setInputArtifacts] = useState<Record<string, string>>({});
  const [templates, setTemplates] = useState<SnailDenTemplateDto[]>([]);
  const [newArtifactKey, setNewArtifactKey] = useState("");
  const [newArtifactValue, setNewArtifactValue] = useState("");

  // 加载 Stage 详情（参与者、产物）
  useEffect(() => {
    if (!currentStage) {
      setParticipants([]);
      setOutputArtifacts({});
      setInputArtifacts({});
      return;
    }
    api("GET /api/stages/:stageId", { params: { stageId: currentStage.id } })
      .then((data) => {
        const roleDefs = data.role_definitions || [];
        const convRoles = currentConversation?.participating_roles || [];
        const participantMap = new Map<string, Participant>();
        roleDefs.forEach((rd: RoleDefinition) => {
          participantMap.set(rd.name, {
            name: rd.name,
            roleDef: rd,
            isPrimary: rd.is_primary || false,
          });
        });
        convRoles.forEach((name: string) => {
          if (!participantMap.has(name)) {
            participantMap.set(name, { name, roleDef: null, isPrimary: false });
          }
        });
        setParticipants(Array.from(participantMap.values()));
        setOutputArtifacts(data.output_artifacts || {});
        setInputArtifacts(data.input_artifacts || {});
      })
      .catch(() => {});
  }, [currentStage?.id, currentConversation?.id]);

  // 加载可用模板
  useEffect(() => {
    api("GET /api/snail-den")
      .then(setTemplates)
      .catch(() => {});
  }, []);

  // 添加输出产物
  async function handleAddArtifact() {
    if (!currentStage || !newArtifactKey.trim() || !newArtifactValue.trim()) return;
    const updated = { ...outputArtifacts, [newArtifactKey.trim()]: newArtifactValue.trim() };
    try {
      await api("PATCH /api/stages/:stageId", { params: { stageId: currentStage.id }, body: { output_artifacts: updated } });
      setOutputArtifacts(updated);
      setNewArtifactKey("");
      setNewArtifactValue("");
      showToast("已添加输出产物");
    } catch (err: unknown) {
      showToast(`添加失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  // 删除输出产物
  async function handleRemoveArtifact(key: string) {
    if (!currentStage) return;
    const updated = { ...outputArtifacts };
    delete updated[key];
    try {
      await api("PATCH /api/stages/:stageId", { params: { stageId: currentStage.id }, body: { output_artifacts: updated } });
      setOutputArtifacts(updated);
      showToast("已移除输出产物");
    } catch (err: unknown) {
      showToast(`移除失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  // 切换角色模板
  async function handleTemplateChange(roleName: string, templateId: string) {
    if (!issue || !currentStage) return;
    try {
      await api("PATCH /api/issues/:issueId/role-snail", {
        params: { issueId: issue.id },
        body: { stage_id: currentStage.id, role_name: roleName, snail_template_id: templateId },
      });
      showToast(`已切换 ${roleName} 的模板`);
    } catch (err: unknown) {
      showToast(`切换失败：${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  return (
    <div className="context-rail">
      {/* Issue Context */}
      <section className="context-card" id="repo-context-summary-section">
        <div className="repo-context-summary-header">
          <div className="context-card-title">Issue Context</div>
        </div>
        <div className="repo-context-card repo-context-card-inline">
          <div className="context-line">
            <span>Workspace</span>
            <span>{workspace?.name || "未选择"}</span>
          </div>
          <div className="context-line">
            <span>Issue</span>
            <span>{issue?.title || "未选择"}</span>
          </div>
          <div className="context-line">
            <span>Stage</span>
            <span>{currentStage?.stage_definition?.title || currentStage?.type || "无"}</span>
          </div>
          <div className="context-line">
            <span>Conversation</span>
            <span>{currentConversation?.title || "未选择"}</span>
          </div>
          <div className="context-line">
            <span>WebSocket</span>
            <span style={{ color: wsStatus === "connected" ? "var(--color-accent-cyan)" : "var(--color-text-grey)" }}>
              {wsStatus === "connected" ? "● 已连接" : wsStatus === "reconnecting" ? "● 重连中" : "○ 已断开"}
            </span>
          </div>
        </div>
      </section>

      {/* 当前推进 */}
      {currentStage && (
        <section className="context-card workspace-progress-card">
          <div className="context-card-header">
            <div className="context-card-title">当前推进</div>
          </div>
          <div style={{ padding: "var(--space-md)" }}>
            <div className="context-line">
              <span>阶段</span>
              <span>{currentStage.stage_definition?.title || currentStage.type}</span>
            </div>
            <div className="context-line">
              <span>状态</span>
              <span className={`chip ${currentStage.status === "in_progress" ? "hot" : ""}`}>
                {currentStage.status}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* 参与者 */}
      {participants.length > 0 && (
        <section className="context-card">
          <div className="context-card-header">
            <div className="context-card-title">谁在执行</div>
          </div>
          <div style={{ padding: "var(--space-md)" }}>
            {participants.map((p) => (
              <div key={p.name} className="participant-card" title={p.roleDef?.description || ""}>
                <div className="participant-card-head">
                  <div>
                    <div className="participant-role">
                      {p.name}
                      {p.isPrimary && <span className="primary-chip">主响应</span>}
                    </div>
                    <div className="participant-snail">
                      {p.name === "项目负责人" ? "用户" : "协作角色"}
                    </div>
                  </div>
                  {p.roleDef?.snail_template_id && p.name !== "项目负责人" && templates.length > 0 && (
                    <select
                      className="participant-snail-select"
                      value={p.roleDef.snail_template_id}
                      onChange={(e) => handleTemplateChange(p.name, e.target.value)}
                    >
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", margin: "4px 0 0" }}>
                  {p.roleDef?.description || "暂无职责说明"}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 输出产物 */}
      {currentStage && (
        <section className="context-card">
          <div className="context-card-header">
            <div className="context-card-title">输出产物</div>
            <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-grey)" }}>
              {Object.keys(outputArtifacts).length}
            </span>
          </div>
          <div style={{ padding: "var(--space-md)" }}>
            {Object.entries(outputArtifacts).map(([key, value]) => (
              <div key={key} className="deliverable-pill output">
                <span className="artifact-key">{key}</span>
                <span className="artifact-value">{value}</span>
                <button
                  className="deliverable-remove"
                  onClick={() => handleRemoveArtifact(key)}
                  aria-label="移除"
                >
                  ×
                </button>
              </div>
            ))}
            <div style={{ display: "flex", gap: "var(--space-xs)", marginTop: "var(--space-sm)" }}>
              <input
                type="text"
                className="artifact-input artifact-key-input"
                placeholder="键"
                value={newArtifactKey}
                onChange={(e) => setNewArtifactKey(e.target.value)}
              />
              <input
                type="text"
                className="artifact-input artifact-value-input"
                placeholder="值"
                value={newArtifactValue}
                onChange={(e) => setNewArtifactValue(e.target.value)}
              />
              <button className="artifact-add-btn" onClick={handleAddArtifact}>添加</button>
            </div>
          </div>
        </section>
      )}

      {/* 输入产物 */}
      {Object.keys(inputArtifacts).length > 0 && (
        <section className="context-card">
          <div className="context-card-header">
            <div className="context-card-title">输入产物</div>
            <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-grey)" }}>
              {Object.keys(inputArtifacts).length}
            </span>
          </div>
          <div style={{ padding: "var(--space-md)" }}>
            {Object.entries(inputArtifacts).map(([key, value]) => (
              <div key={key} className="deliverable-pill input">
                <span className="artifact-key">{key}</span>
                <span className="artifact-value">{value}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
