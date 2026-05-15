export function renderStageContractView(target, input) {
  target.innerHTML = "";
  const { currentStage, definitions, snails, stageTitle, escapeHtml } = input;
  if (!currentStage) return;
  const definition = definitions[currentStage.type];
  if (!definition) return;

  const roles = Array.isArray(definition.roles) ? definition.roles : [];
  const stageSnailNames = [...new Set(roles.flatMap((role) => Array.isArray(role.assigned_snails) ? role.assigned_snails : []))];
  const roleCards = roles.map((role) => renderRoleCard(role, snails, escapeHtml)).join("");

  const inputText = Array.isArray(definition.input) ? definition.input.join(", ") : "";
  const required = Array.isArray(definition.output?.required_artifacts) ? definition.output.required_artifacts.join(", ") : "";
  const requirements = renderList(definition.output?.artifact_requirements, escapeHtml);
  const acceptance = renderList(definition.acceptance_focus, escapeHtml);
  target.innerHTML = `
    <div class="artifact-card">
      <div class="name">${escapeHtml(definition.title)}</div>
      <div class="meta" style="margin-top: 8px;">参与 Snails: ${escapeHtml(stageSnailNames.join(", ") || "无")}</div>
      <div class="meta" style="margin-top: 6px;">输入: ${escapeHtml(inputText || "无")}</div>
      <div class="meta" style="margin-top: 6px;">正式交付要求: ${escapeHtml(required || "无")}</div>
      <div class="meta" style="margin-top: 10px;">输出摘要</div>
      <pre>${escapeHtml(definition.output?.summary || "")}</pre>
      <div class="meta" style="margin-top: 10px;">产物要求</div>
      <ul style="margin-left: 18px; color: #cbd5e1; line-height: 1.6;">${requirements}</ul>
      <div class="meta" style="margin-top: 10px;">验收关注点</div>
      <ul style="margin-left: 18px; color: #cbd5e1; line-height: 1.6;">${acceptance}</ul>
      <div class="meta" style="margin-top: 12px;">Roles</div>
      ${roleCards}
    </div>
  `;
  if (stageTitle) stageTitle(currentStage.type);
}

function renderRoleCard(role, snails, escapeHtml) {
  const assignedSnails = Array.isArray(role.assigned_snails) ? role.assigned_snails : [];
  const snailDetails = assignedSnails.map((snailName) => {
    const snail = snails.find((item) => item.name === snailName);
    return snail ? `${escapeHtml(snail.name)}: ${escapeHtml(snail.description || "")}` : escapeHtml(snailName);
  });
  const workingRules = renderList(role.working_rules, escapeHtml);
  const preferredArtifacts = Array.isArray(role.preferred_artifact_types) ? role.preferred_artifact_types.join(", ") : "";
  return `
    <div class="artifact-card" style="margin-top: 10px;">
      <div class="name">${escapeHtml(role.name)} (${escapeHtml(role.id)})</div>
      <div class="meta" style="margin-top: 8px;">${escapeHtml(role.description || "")}</div>
      <div class="meta" style="margin-top: 10px;">Assigned Snails</div>
      <ul style="margin-left: 18px; color: #cbd5e1; line-height: 1.6;">${snailDetails.map((s) => `<li>${s}</li>`).join("") || "<li>无</li>"}</ul>
      <div class="meta" style="margin-top: 10px;">Working Rules</div>
      <ul style="margin-left: 18px; color: #cbd5e1; line-height: 1.6;">${workingRules || "<li>无</li>"}</ul>
      <div class="meta" style="margin-top: 10px;">Preferred Artifacts</div>
      <pre>${escapeHtml(preferredArtifacts || "无")}</pre>
    </div>
  `;
}

function renderList(items, escapeHtml) {
  return Array.isArray(items) ? items.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : "";
}
