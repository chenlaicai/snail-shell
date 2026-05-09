export function renderStageContractView(target, input) {
  target.innerHTML = "";
  const { currentStage, definitions, snails, stageTitle, escapeHtml } = input;
  if (!currentStage) return;
  const definition = definitions[currentStage.type];
  if (!definition) return;
  const stageSnailNames = Array.isArray(definition.snails) ? definition.snails : [];
  const primarySnailName = stageSnailNames[0] || "";
  const snailCards = stageSnailNames.map((snailName) => renderSnailCard(snailName, snails, primarySnailName, escapeHtml)).join("");
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
      <div class="meta" style="margin-top: 12px;">Snails</div>
      ${snailCards}
    </div>
  `;
  if (stageTitle) stageTitle(currentStage.type);
}

function renderSnailCard(snailName, snails, primarySnailName, escapeHtml) {
  const snail = snails.find((item) => item.name === snailName);
  const isPrimary = snailName === primarySnailName;
  if (!snail) return `<div class="artifact-card" style="margin-top: 10px;"><div class="name">${escapeHtml(snailName)}${isPrimary ? " (主 snail)" : ""}</div></div>`;
  const capabilities = renderList(snail.capability_expectations, escapeHtml);
  const workingRules = renderList(snail.working_rules, escapeHtml);
  const preferredArtifacts = Array.isArray(snail.preferred_artifact_types) ? snail.preferred_artifact_types.join(", ") : "";
  return `
    <div class="artifact-card" style="margin-top: 10px;">
      <div class="name">${escapeHtml(snail.name)}${isPrimary ? " (主 snail)" : ""}</div>
      <div class="meta" style="margin-top: 6px;">${escapeHtml(snail.runtime)}</div>
      <div class="meta" style="margin-top: 8px;">${escapeHtml(snail.description || "")}</div>
      <div class="meta" style="margin-top: 10px;">Capability Expectations</div>
      <ul style="margin-left: 18px; color: #cbd5e1; line-height: 1.6;">${capabilities}</ul>
      <div class="meta" style="margin-top: 10px;">Working Rules</div>
      <ul style="margin-left: 18px; color: #cbd5e1; line-height: 1.6;">${workingRules}</ul>
      <div class="meta" style="margin-top: 10px;">Preferred Artifacts</div>
      <pre>${escapeHtml(preferredArtifacts || "")}</pre>
    </div>
  `;
}

function renderList(items, escapeHtml) {
  return Array.isArray(items) ? items.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : "";
}
