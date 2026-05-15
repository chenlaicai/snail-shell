export function renderStageContractView(target, input) {
  target.innerHTML = "";
  const { currentStage, snails, escapeHtml } = input;
  if (!currentStage) return;
  const definition = currentStage.stage_definition;
  if (!definition) return;
  const roleDefs = Array.isArray(currentStage.role_definitions) ? currentStage.role_definitions : [];
  const snailNames = roleDefs.map((rd) => rd.snail_id);
  const primarySnailName = roleDefs.find((rd) => rd.is_primary)?.snail_id || snailNames[0] || "";
  const snailCards = snailNames.map((snailName) => renderSnailCard(snailName, snails, primarySnailName, roleDefs, escapeHtml)).join("");
  const inputText = currentStage.input_artifacts?.join(", ") || "";
  const outputText = currentStage.output_artifacts?.join(", ") || "";
  const acceptance = renderList(definition.acceptance_focus, escapeHtml);
  target.innerHTML = `
    <div class="stage-contract-card">
      <div class="name">${escapeHtml(definition.title)}</div>
      <div class="meta" style="margin-top: 8px;">参与角色: ${escapeHtml(snailNames.join(", ") || "无")}</div>
      <div class="meta" style="margin-top: 6px;">输入: ${escapeHtml(inputText || "无")}</div>
      <div class="meta" style="margin-top: 6px;">输出: ${escapeHtml(outputText || "无")}</div>
      ${definition.input_description ? `<div class="meta" style="margin-top: 10px;">输入描述</div><pre>${escapeHtml(definition.input_description)}</pre>` : ""}
      ${definition.output_description ? `<div class="meta" style="margin-top: 10px;">产出描述</div><pre>${escapeHtml(definition.output_description)}</pre>` : ""}
      <div class="meta" style="margin-top: 10px;">验收关注点</div>
      <ul style="margin-left: 18px; color: #cbd5e1; line-height: 1.6;">${acceptance}</ul>
      <div class="meta" style="margin-top: 12px;">角色详情</div>
      ${snailCards}
    </div>
  `;
}

function renderSnailCard(snailName, snails, primarySnailName, roleDefs, escapeHtml) {
  const snail = snails.find((item) => item.name === snailName);
  const isPrimary = snailName === primarySnailName;
  const roleDef = roleDefs.find((rd) => rd.snail_id === snailName);
  const workingRules = renderList(roleDef?.working_rules, escapeHtml);
  if (!snail) return `<div class="stage-contract-card" style="margin-top: 10px;"><div class="name">${escapeHtml(snailName)}${isPrimary ? " (主角色)" : ""}</div></div>`;
  const capabilities = renderList(snail.capability_expectations, escapeHtml);
  return `
    <div class="stage-contract-card" style="margin-top: 10px;">
      <div class="name">${escapeHtml(snail.name)}${isPrimary ? " (主角色)" : ""}</div>
      <div class="meta" style="margin-top: 6px;">${escapeHtml(snail.runtime)}</div>
      <div class="meta" style="margin-top: 8px;">${escapeHtml(snail.description || "")}</div>
      <div class="meta" style="margin-top: 10px;">能力预期</div>
      <ul style="margin-left: 18px; color: #cbd5e1; line-height: 1.6;">${capabilities}</ul>
      ${workingRules ? `<div class="meta" style="margin-top: 10px;">工作规则</div><ul style="margin-left: 18px; color: #cbd5e1; line-height: 1.6;">${workingRules}</ul>` : ""}
    </div>
  `;
}

function renderList(items, escapeHtml) {
  return Array.isArray(items) ? items.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : "";
}
